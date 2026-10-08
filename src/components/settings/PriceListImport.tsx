"use client";

/**
 * Import a contract company's price list from its spreadsheet into one price list.
 *
 * The owner picks the company's Excel file; every priced row is read (lib/priceListImport.ts) and
 * lined up with the clinic's own treatments. Nothing is written until they have looked at the
 * result: each row says what will happen to it — this price on an existing treatment, a new
 * treatment that exists on this list only, or skip — and any of the three can be changed, the
 * price too. Close matches and prices that look wrong (a stray digit) are marked for a second look.
 *
 * Writes the way the workspace around it does: a list price is `prices.<listId>` on the treatment;
 * a new one is a treatment with `listId` (this list's own menu, see serviceMenu.ts).
 */

import { useMemo, useState } from "react";
import { AlertTriangle, Check, FileSpreadsheet, Loader2, Upload, X } from "lucide-react";
import { addDoc, doc, writeBatch } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { getClinicCollection, getGlobalClinicId } from "@/lib/db-utils";
import { useUI } from "@/context/UIContext";
import { useAuth } from "@/context/AuthContext";
import { logActivity } from "@/lib/logger";
import type { PriceList } from "@/lib/priceLists";
import { guessPricingMode, matchItems, parsePriceSheet, type CatalogueService, type ItemMatch } from "@/lib/priceListImport";
import { categoryOf, suggestCategory, suggestIcon } from "@/lib/dentalIcons";

type Action = { kind: "match"; serviceId: string } | { kind: "new" } | { kind: "skip" };
type ReviewRow = { match: ItemMatch; action: Action; price: string; mode: "per_tooth" | "per_arch" | "flat" };

const BATCH_LIMIT = 400;

function money(v: number): number {
  return Number((Number(v) || 0).toFixed(2));
}

export default function PriceListImport({
  list,
  services,
  ar,
}: {
  list: PriceList;
  services: readonly (CatalogueService & { price?: number })[];
  ar: boolean;
}) {
  const { showToast } = useUI();
  const { user } = useAuth();
  const [rows, setRows] = useState<ReviewRow[] | null>(null);
  const [fileName, setFileName] = useState("");
  const [reading, setReading] = useState(false);
  const [saving, setSaving] = useState(false);

  // Another list's own treatments are not offered as matches (they belong to that company).
  const candidates = useMemo(() => services.filter((s) => !s.listId || s.listId === list.id), [services, list.id]);

  const readFile = async (file: File) => {
    setReading(true);
    try {
      const XLSX = await import("xlsx");
      const wb = XLSX.read(await file.arrayBuffer());
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const raw = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: null });
      const items = parsePriceSheet(raw);
      if (items.length === 0) {
        showToast(ar ? "مالقيناش أسعار في الملف ده" : "No prices found in that file", "error");
        return;
      }
      const matches = matchItems(items, candidates, list.id);
      setRows(
        matches.map((m) => ({
          match: m,
          action: m.serviceId ? { kind: "match", serviceId: m.serviceId } : { kind: "new" },
          price: String(m.item.price),
          mode: guessPricingMode(m.item.name),
        })),
      );
      setFileName(file.name);
    } catch {
      showToast(ar ? "مقدرناش نقرا الملف ده. لازم يكون Excel." : "Could not read that file. It must be an Excel file.", "error");
    } finally {
      setReading(false);
    }
  };

  const counts = useMemo(() => {
    const c = { match: 0, new: 0, skip: 0, check: 0 };
    for (const r of rows ?? []) {
      c[r.action.kind] += 1;
      if (r.action.kind !== "skip" && (r.match.suspicious || r.match.kind === "close")) c.check += 1;
    }
    return c;
  }, [rows]);

  const setRow = (i: number, patch: Partial<ReviewRow>) =>
    setRows((rs) => (rs ? rs.map((r, j) => (j === i ? { ...r, ...patch } : r)) : rs));

  const apply = async () => {
    if (!rows) return;
    const toPrice = rows.filter((r) => r.action.kind === "match" && Number(r.price) >= 0 && r.price.trim() !== "");
    const toCreate = rows.filter((r) => r.action.kind === "new" && Number(r.price) >= 0 && r.price.trim() !== "");
    setSaving(true);
    try {
      const clinicId = getGlobalClinicId();
      for (let i = 0; i < toPrice.length; i += BATCH_LIMIT) {
        const batch = writeBatch(db);
        for (const r of toPrice.slice(i, i + BATCH_LIMIT)) {
          const id = (r.action as { serviceId: string }).serviceId;
          batch.update(doc(db, `clinics/${clinicId}/services`, id), { [`prices.${list.id}`]: money(Number(r.price)) });
        }
        await batch.commit();
      }
      for (const r of toCreate) {
        const name = r.match.item.name;
        const category = suggestCategory(name);
        await addDoc(getClinicCollection("services"), {
          name,
          price: money(Number(r.price)),
          category,
          icon: suggestIcon(name) || categoryOf(category).icon,
          requiresLab: false,
          estimatedLabFee: 0,
          durationMinutes: null,
          pricingMode: r.mode,
          prices: {},
          listId: list.id,
          createdAt: new Date().toISOString(),
        });
      }
      await logActivity(
        { uid: user?.uid, name: user?.name, role: user?.role },
        "Price Lists Updated",
        `Imported "${fileName}" into "${list.name}": ${toPrice.length} priced, ${toCreate.length} added`,
      );
      showToast(
        ar ? `اتسجّل ${toPrice.length} سعر واتضاف ${toCreate.length} علاج جديد` : `${toPrice.length} prices set, ${toCreate.length} treatments added`,
        "success",
      );
      setRows(null);
      setFileName("");
    } catch {
      showToast(ar ? "مقدرناش نحفظ. محدش اتغير غير اللي اتحفظ قبل الغلطة." : "Could not save. Only what was written before the error changed.", "error");
    } finally {
      setSaving(false);
    }
  };

  const modeLabel = (m: ReviewRow["mode"]) =>
    m === "flat" ? (ar ? "للزيارة" : "Per visit") : m === "per_arch" ? (ar ? "للفك" : "Per jaw") : ar ? "للسنة" : "Per tooth";

  if (!rows) {
    return (
      <div className="rounded-2xl border border-line bg-surface-subtle p-5">
        <h4 className="flex items-center gap-2 text-sm font-black text-ink">
          <FileSpreadsheet size={15} className="text-accent-ink" /> {ar ? "استيراد من Excel" : "Import from Excel"}
        </h4>
        <p className="mt-1 max-w-prose text-xs font-medium text-ink-muted">
          {ar
            ? "ارفع ملف الأسعار اللي الشركة بعتته. هنقرا كل سعر ونطابقه مع علاجاتك، وتراجع قبل ما يتحفظ أي حاجة."
            : "Upload the price sheet the company sent. Every price is read and matched to your treatments, and you review it before anything is saved."}
        </p>
        <label className={`mt-3 inline-flex cursor-pointer items-center gap-2 rounded-xl bg-ink-slab px-4 py-2.5 text-sm font-bold text-white transition hover:bg-ink ${reading ? "pointer-events-none opacity-60" : ""}`}>
          {reading ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}
          {ar ? "اختار ملف Excel" : "Choose an Excel file"}
          <input
            type="file"
            accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void readFile(f);
            }}
          />
        </label>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-accent-soft bg-surface p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h4 className="flex items-center gap-2 text-base font-black text-ink">
            <FileSpreadsheet size={17} className="text-accent-ink" /> {ar ? "راجع قبل الحفظ" : "Review before saving"}
          </h4>
          <p className="mt-1 text-[13px] font-medium text-ink-muted">
            <bdi>{fileName}</bdi> ·{" "}
            {ar
              ? `${rows.length} سعر: ${counts.match} على علاجات عندك، ${counts.new} جديد على القائمة دي بس، ${counts.skip} متخطّي`
              : `${rows.length} prices: ${counts.match} on your treatments, ${counts.new} new on this list only, ${counts.skip} skipped`}
          </p>
          {counts.check > 0 && (
            <p className="mt-1 flex items-center gap-1.5 text-[13px] font-bold text-warn">
              <AlertTriangle size={14} />
              {ar ? `${counts.check} سطر محتاج نظرة (مطابقة تقريبية أو سعر غريب)` : `${counts.check} row${counts.check === 1 ? "" : "s"} to check (close match or odd price)`}
            </p>
          )}
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => setRows(null)} disabled={saving} className="inline-flex items-center gap-1.5 rounded-xl border border-line px-4 py-2.5 text-sm font-bold text-ink-body hover:bg-surface-subtle disabled:opacity-50">
            <X size={15} /> {ar ? "إلغاء" : "Cancel"}
          </button>
          <button type="button" onClick={apply} disabled={saving || counts.match + counts.new === 0} className="inline-flex items-center gap-2 rounded-xl bg-accent px-5 py-2.5 text-sm font-bold text-ink-on-accent hover:bg-accent-strong disabled:opacity-40">
            {saving ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
            {ar ? `احفظ ${counts.match + counts.new}` : `Save ${counts.match + counts.new}`}
          </button>
        </div>
      </div>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[46rem] border-collapse text-[14px]">
          <thead>
            <tr className="border-b border-line text-[12.5px] font-bold text-ink-muted">
              <th className="py-2 pe-3 text-start">{ar ? "في الملف" : "In the file"}</th>
              <th className="py-2 pe-3 text-end w-28">{ar ? "السعر" : "Price"}</th>
              <th className="py-2 pe-3 text-start">{ar ? "هيتحفظ على" : "Goes on"}</th>
              <th className="py-2 text-start w-32">{ar ? "بيتحسب" : "Charged"}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const check = r.action.kind !== "skip" && (r.match.suspicious || (r.action.kind === "match" && r.match.kind === "close" && r.action.serviceId === r.match.serviceId));
              const value = r.action.kind === "match" ? `m:${r.action.serviceId}` : r.action.kind;
              return (
                <tr key={r.match.item.row} className={`border-b border-line/60 align-top ${check ? "bg-warn-tint/40" : ""} ${r.action.kind === "skip" ? "opacity-50" : ""}`}>
                  <td className="py-2.5 pe-3">
                    <p className="font-semibold text-ink">{r.match.item.name}</p>
                    <p className="text-[12px] font-medium text-ink-muted">
                      {r.match.item.section}
                      {r.match.item.marked ? <span className="ms-2 rounded bg-surface-muted px-1.5 py-0.5 text-[11px] font-bold text-ink-body">**</span> : null}
                    </p>
                    {r.match.suspicious && r.action.kind !== "skip" && (
                      <p className="mt-0.5 flex items-center gap-1 text-[12px] font-bold text-danger">
                        <AlertTriangle size={12} /> {ar ? "السعر ده أكبر بكتير من الباقي — راجعه" : "Far above every other price — check it"}
                      </p>
                    )}
                  </td>
                  <td className="py-2.5 pe-3">
                    <input
                      type="number"
                      min={0}
                      inputMode="decimal"
                      value={r.price}
                      onChange={(e) => setRow(i, { price: e.target.value })}
                      className="w-full rounded-lg border border-line bg-surface px-2.5 py-1.5 text-end font-figure text-[15px] font-semibold text-ink outline-none focus:border-accent"
                    />
                  </td>
                  <td className="py-2.5 pe-3">
                    <select
                      value={value}
                      onChange={(e) => {
                        const v = e.target.value;
                        setRow(i, { action: v === "new" ? { kind: "new" } : v === "skip" ? { kind: "skip" } : { kind: "match", serviceId: v.slice(2) } });
                      }}
                      className="w-full rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[14px] font-semibold text-ink outline-none focus:border-accent"
                    >
                      <option value="new">{ar ? "➕ علاج جديد على القائمة دي بس" : "➕ New treatment, this list only"}</option>
                      <option value="skip">{ar ? "تخطّي" : "Skip"}</option>
                      {candidates.map((s) => (
                        <option key={s.id} value={`m:${s.id}`}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                    {r.action.kind === "match" && r.match.kind === "close" && r.action.serviceId === r.match.serviceId && (
                      <p className="mt-0.5 text-[12px] font-bold text-warn">{ar ? "مطابقة تقريبية — اتأكد إنه نفس العلاج" : "Close match — make sure it is the same treatment"}</p>
                    )}
                    {r.action.kind === "match" && r.match.kind === "exact" && r.action.serviceId === r.match.serviceId && (
                      <p className="mt-0.5 text-[12px] font-semibold text-ok">{ar ? "نفس الاسم" : "Same name"}</p>
                    )}
                  </td>
                  <td className="py-2.5">
                    {r.action.kind === "new" ? (
                      <select
                        value={r.mode}
                        onChange={(e) => setRow(i, { mode: e.target.value as ReviewRow["mode"] })}
                        className="w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-[13px] font-semibold text-ink outline-none focus:border-accent"
                      >
                        {(["per_tooth", "per_arch", "flat"] as const).map((m) => (
                          <option key={m} value={m}>
                            {modeLabel(m)}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="text-[12.5px] font-medium text-ink-muted">{r.action.kind === "match" ? (ar ? "زي العلاج" : "As the treatment") : "—"}</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
