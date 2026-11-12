"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { stockApi } from "@/lib/stock/api";
import { unitLabel } from "@/lib/stock/catalog";
import { gapLabel } from "@/lib/stock/counts";
import { lastPrice, matches } from "@/lib/stock/math";
import type { CountCompareRow, StockCountSave } from "@/lib/stock/types";
import { Btn, Card, Eyebrow, Ltr, fmtMoney, inputCls, variantLabel, type StockCtx } from "./shared";

/**
 * Count by count. Every press of "Save count" is listed with its time and person; pick one and
 * it is laid beside an earlier one: what was there then, what came in or went out on record in
 * between, what was counted now, and so what was used.
 */
export function CountsCompareView({ ctx }: { ctx: StockCtx }) {
  const { snap, t, ar, toast } = ctx;
  const [saves, setSaves] = useState<StockCountSave[]>([]);
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [toId, setToId] = useState("");
  const [fromId, setFromId] = useState("");
  const [result, setResult] = useState<null | { from: StockCountSave | null; to: StockCountSave; rows: CountCompareRow[] }>(null);
  const [comparing, setComparing] = useState(false);
  const [everyRow, setEveryRow] = useState(false);
  const [q, setQ] = useState("");
  const [exporting, setExporting] = useState(false);

  const load = useCallback(
    async (beforeMs?: number) => {
      setLoading(true);
      try {
        const r = await stockApi.counts(beforeMs);
        setSaves((prev) => {
          const seen = new Set(beforeMs ? prev.map((s) => s.id) : []);
          return [...(beforeMs ? prev : []), ...r.saves.filter((s) => !seen.has(s.id))];
        });
        setMore(r.more);
        if (!beforeMs && r.saves.length) setToId((cur) => cur || r.saves[0].id);
      } catch (e) {
        toast(e instanceof Error ? e.message : "Could not load the counts.", "error");
      } finally {
        setLoading(false);
      }
    },
    [toast]
  );

  useEffect(() => {
    void load();
  }, [load]);

  const compare = useCallback(
    async (to: string, from: string) => {
      if (!to) return;
      setComparing(true);
      try {
        setResult(await stockApi.compareCounts(to, from || undefined));
      } catch (e) {
        setResult(null);
        toast(e instanceof Error ? e.message : "Could not compare those counts.", "error");
      } finally {
        setComparing(false);
      }
    },
    [toast]
  );

  useEffect(() => {
    void compare(toId, fromId);
  }, [compare, toId, fromId]);

  const when = (ms: number) => new Date(ms).toLocaleString(ar ? "ar-EG" : "en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const scopeOf = (s: StockCountSave) => (s.whole ? t("Whole cupboard", "الدولاب كله") : s.drawerCodes.join(", ") || t("Some rows", "بعض السطور"));
  const target = saves.find((s) => s.id === toId) || result?.to || null;
  const earlier = target ? saves.filter((s) => s.atMs < target.atMs) : [];

  const named = useMemo(() => {
    if (!result) return [];
    return result.rows
      .map((r) => {
        const variant = ctx.variants.get(r.variantId);
        const item = variant ? ctx.items.get(variant.itemId) : undefined;
        const name = item ? (ar ? item.nameAr : item.nameEn) : t("Removed item", "صنف اتمسح");
        const brand = variant && !variant.isGeneric ? variantLabel(variant, item, ar) : "";
        const codes = r.drawerIds.map((id) => ctx.drawers.get(id)?.code || "").filter(Boolean).sort();
        const price = lastPrice(variant, snap.deliveries);
        return { r, item, name, brand, codes, cost: r.used > 0 ? r.used * price : 0 };
      })
      .sort((a, b) => b.cost - a.cost || Math.abs(b.r.used) - Math.abs(a.r.used) || a.name.localeCompare(b.name));
  }, [result, ctx, snap.deliveries, ar, t]);

  const differing = named.filter((x) => x.r.used !== 0 || x.r.moved !== 0);
  const shown = (everyRow ? named : differing).filter((x) => matches([x.name, x.brand, ...x.codes], q));
  const usedValue = named.reduce((a, x) => a + x.cost, 0);
  const signed = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : "—");

  const exportExcel = async () => {
    if (!result) return;
    setExporting(true);
    try {
      const { default: XLSX } = await import("xlsx-js-style");
      const rows = shown.map((x) => ({
        [t("Item", "الصنف")]: x.name,
        [t("Brand", "الماركة")]: x.brand,
        [t("Drawers", "الأدراج")]: x.codes.join(", "),
        [t("Earlier count", "العدّ السابق")]: x.r.last ?? "",
        [t("In / out between", "دخل / خرج بينهم")]: x.r.moved,
        [t("Should be", "المفروض")]: x.r.expected,
        [t("This count", "العدّ ده")]: x.r.counted,
        [t("Used", "المستخدم")]: x.r.used,
        EGP: Math.round(x.cost),
      }));
      const head = [
        [t("This count", "العدّ ده"), when(result.to.atMs), result.to.byName, scopeOf(result.to)],
        [t("Compared with", "مقارنة بـ"), result.from ? when(result.from.atMs) : "—", result.from?.byName || "", result.from ? scopeOf(result.from) : ""],
        [],
      ];
      const sheet = XLSX.utils.aoa_to_sheet(head);
      XLSX.utils.sheet_add_json(sheet, rows, { origin: "A4" });
      sheet["!cols"] = [{ wch: 28 }, { wch: 28 }, { wch: 16 }, { wch: 13 }, { wch: 16 }, { wch: 11 }, { wch: 11 }, { wch: 10 }, { wch: 10 }];
      if (ar) sheet["!views"] = [{ rightToLeft: true }];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, sheet, t("Count comparison", "مقارنة العدّ"));
      XLSX.writeFile(wb, `stock-count-${result.to.date}.xlsx`, { compression: true });
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not make the Excel file.", "error");
    } finally {
      setExporting(false);
    }
  };

  if (!loading && !saves.length) {
    return (
      <Card className="p-4 text-sm text-ink-body">
        {t(
          "No count has been saved since this report was switched on. From now on, every time someone presses Save count — a single drawer or the whole cupboard — it appears here with its time, and you can lay it beside the one before.",
          "مفيش عدّ اتحفظ من ساعة ما التقرير ده اتفعّل. من دلوقتي، كل مرة حد يدوس «احفظ العدّ» — درج واحد أو الدولاب كله — هيظهر هنا بوقته، وتقدر تقارنه باللي قبله."
        )}
      </Card>
    );
  }

  return (
    <div className="grid items-start gap-3 lg:grid-cols-[280px_1fr]">
      <Card className="overflow-hidden">
        <div className="border-b border-line px-3.5 py-2.5"><Eyebrow>{t("Counts, newest first", "العدّات، الأحدث أولاً")}</Eyebrow></div>
        <div className="max-h-[260px] overflow-y-auto lg:max-h-[620px]">
          {saves.map((s) => (
            <button
              key={s.id}
              type="button"
              data-count-save={s.id}
              aria-pressed={s.id === toId}
              onClick={() => { setToId(s.id); setFromId(""); }}
              className={`block w-full border-t border-line px-3.5 py-2.5 text-start first:border-t-0 ${s.id === toId ? "bg-surface-subtle" : ""}`}
            >
              <b className="block font-display text-[13px] font-bold text-ink"><Ltr>{when(s.atMs)}</Ltr></b>
              <span className="block text-[12px] text-ink-body">{s.byName}{s.byRole ? ` · ${s.byRole}` : ""}</span>
              <span className="block text-[12.5px] text-ink-muted"><Ltr>{scopeOf(s)}</Ltr> · {s.changed} {t("changed", "اتغير")}</span>
            </button>
          ))}
          {loading ? <div className="grid place-items-center p-4 text-ink-muted"><Loader2 className="animate-spin" /></div> : null}
          {more && !loading ? <div className="border-t border-line p-2"><Btn onClick={() => void load(saves[saves.length - 1]?.atMs)}>{t("Load older", "حمّل الأقدم")}</Btn></div> : null}
        </div>
      </Card>

      <div className="grid gap-3">
        {target ? (
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-[180px] flex-1">
              <Eyebrow>{t("This count", "العدّ ده")}</Eyebrow>
              <div className="mt-0.5 font-display text-lg font-bold text-ink"><Ltr>{when(target.atMs)}</Ltr> · {target.byName}</div>
              <div className="text-[12px] text-ink-muted"><Ltr>{scopeOf(target)}</Ltr> · {target.counted} {t("rows counted", "سطر اتعدّ")}</div>
            </div>
            <label className="grid gap-1 text-[12px] font-semibold text-ink-body">
              {t("Compare with", "قارن بـ")}
              <select id="stock-compare-from" value={fromId} onChange={(e) => setFromId(e.target.value)} className={`${inputCls} !py-2`} disabled={!earlier.length}>
                <option value="">{earlier.length ? t("The count before it", "العدّ اللي قبله") : t("No earlier count", "مفيش عدّ قبله")}</option>
                {earlier.map((s) => <option key={s.id} value={s.id}>{`${when(s.atMs)} · ${s.byName} · ${scopeOf(s)}`}</option>)}
              </select>
            </label>
            <Btn onClick={exportExcel} busy={exporting} disabled={!shown.length}><Download size={15} /> {t("Excel", "إكسل")}</Btn>
          </div>
        ) : null}

        {result && !comparing ? (
          <>
            {result.from ? (
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <Card className="p-3.5"><Eyebrow>{t("Earlier count", "العدّ السابق")}</Eyebrow><div className="mt-1 font-display text-[15px] font-bold text-ink"><Ltr>{when(result.from.atMs)}</Ltr></div><div className="text-[12.5px] text-ink-muted">{result.from.byName} · <Ltr>{scopeOf(result.from)}</Ltr></div></Card>
                <Card className="p-3.5"><Eyebrow>{t("Time between", "الوقت بينهم")}</Eyebrow><div className="mt-1 font-display text-[15px] font-bold text-ink">{gapLabel(result.from.atMs, result.to.atMs, ar)}</div></Card>
                <Card className="p-3.5"><Eyebrow>{t("Rows that differ", "سطور مختلفة")}</Eyebrow><div className="mt-1 font-display text-2xl font-bold text-ink">{differing.length}</div><div className="text-[12.5px] text-ink-muted">{t("of", "من")} {named.length}</div></Card>
                <Card className="p-3.5"><Eyebrow>{t("Used between them", "المستخدم بينهم")}</Eyebrow><div className="mt-1 font-display text-2xl font-bold text-ink">{fmtMoney(usedValue)} <small className="text-xs font-semibold text-ink-muted">{t("EGP", "جنيه")}</small></div><div className="text-[12.5px] text-ink-muted">{t("at last purchase prices", "بآخر أسعار الشراء")}</div></Card>
              </div>
            ) : (
              <Card className="p-3.5 text-sm text-ink-body">
                {result.to.firstEver
                  ? t("This was the first count: the starting point. From the next count on, each one is compared with the one before it.", "ده كان أول عدّ: نقطة البداية. من العدّ الجاي، كل عدّ هيتقارن باللي قبله.")
                  : t("No earlier count is kept on its own yet, so this one is compared with what the system held just before it.", "لسه مفيش عدّ قبله محفوظ لوحده، فالعدّ ده متقارن باللي كان مسجل في النظام قبله على طول.")}
              </Card>
            )}

            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="inline-flex overflow-hidden rounded-xl border border-line text-[12px] font-semibold">
                <button type="button" onClick={() => setEveryRow(false)} className={`px-3 py-1.5 ${!everyRow ? "bg-ink text-white" : "text-ink-body"}`}>{t("Only what differs", "المختلف بس")}</button>
                <button type="button" onClick={() => setEveryRow(true)} className={`px-3 py-1.5 ${everyRow ? "bg-ink text-white" : "text-ink-body"}`}>{t("Every row", "كل السطور")}</button>
              </div>
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("item, brand, drawer…", "صنف، ماركة، درج…")} className={`${inputCls} max-w-[240px] !py-2`} />
            </div>

            <Card className="overflow-x-auto">
              <table className="w-full text-[13.5px] sm:min-w-[540px]" id="stock-compare-table">
                <thead>
                  <tr className="font-display text-[12px] uppercase tracking-[0.08em] text-ink-muted">
                    <th className="px-2 py-2.5 sm:px-3.5 text-start">{t("Item", "الصنف")}</th>
                    <th className="px-2 py-2.5 sm:px-3.5 text-end">{t("Earlier count", "العدّ السابق")}</th>
                    <th className="px-2 py-2.5 sm:px-3.5 text-end hidden sm:table-cell">{t("In / out", "دخل / خرج")}</th>
                    <th className="px-2 py-2.5 sm:px-3.5 text-end">{t("This count", "العدّ ده")}</th>
                    <th className="px-2 py-2.5 sm:px-3.5 text-end">{t("Used", "المستخدم")}</th>
                    <th className="px-2 py-2.5 sm:px-3.5 text-end hidden sm:table-cell">{t("EGP", "جنيه")}</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map(({ r, item, name, brand, codes, cost }) => (
                    <tr key={r.variantId} className="border-t border-line">
                      <td className="px-2 py-2 sm:px-3.5">
                        <b>{name}</b>
                        {brand ? <><br /><span className="text-[12.5px] text-ink-muted"><Ltr>{brand}</Ltr></span></> : null}
                        {codes.length ? <><br /><span className="font-display text-[12px] text-ink-muted"><Ltr>{codes.join(", ")}</Ltr></span></> : null}
                      </td>
                      <td className="px-2 py-2 sm:px-3.5 text-end font-display">{r.last ?? "—"}{r.moved ? <span className="block text-[12px] text-ink-muted sm:hidden"><Ltr>{signed(r.moved)}</Ltr></span> : null}</td>
                      <td className={`px-2 py-2 sm:px-3.5 text-end font-display hidden sm:table-cell ${r.moved ? "font-semibold text-ink" : "text-ink-muted"}`}><Ltr>{signed(r.moved)}</Ltr></td>
                      <td className="px-2 py-2 sm:px-3.5 text-end font-display font-semibold">{r.counted}</td>
                      <td className="px-2 py-2 sm:px-3.5 text-end font-display">
                        {r.used > 0 ? <b className="text-ink">{r.used} <span className="text-[12px] font-normal text-ink-muted">{unitLabel(item?.unit || "box", r.used, ar)}</span></b> : r.used < 0 ? <span className="font-semibold text-emerald-700"><Ltr>+{-r.used}</Ltr> {t("extra", "زيادة")}</span> : <span className="text-ink-muted">0</span>}
                      </td>
                      <td className="px-2 py-2 sm:px-3.5 text-end font-display text-ink-muted hidden sm:table-cell">{cost ? fmtMoney(cost) : "—"}</td>
                    </tr>
                  ))}
                  {!shown.length ? (
                    <tr><td colSpan={6} className="px-3.5 py-4 text-ink-muted">{named.length && !everyRow && !q.trim() ? t("Nothing differs between these two counts.", "مفيش فرق بين العدّتين دول.") : t("Nothing to show.", "مفيش حاجة تتعرض.")}</td></tr>
                  ) : null}
                </tbody>
              </table>
              <p className="p-3 text-xs text-ink-muted">
                {t(
                  "Earlier count + in/out − used = this count. “In / out” is everything on record in between: deliveries add; an item logged on a patient or a deleted row takes away. “Extra” means more was found than the records expected.",
                  "العدّ السابق + دخل/خرج − المستخدم = العدّ ده. «دخل / خرج» هو كل المسجل بين العدّتين: التوريد بيزوّد؛ صنف اتسجل لمريض أو سطر اتمسح بينقّص. «زيادة» يعني اتلقى أكتر من المتوقع في السجلات."
                )}
              </p>
            </Card>
          </>
        ) : (
          <div className="grid place-items-center p-8 text-ink-muted">{comparing || loading ? <Loader2 className="animate-spin" /> : null}</div>
        )}
      </div>
    </div>
  );
}
