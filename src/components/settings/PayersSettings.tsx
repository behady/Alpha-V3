"use client";

import { useEffect, useMemo, useState } from "react";
import { getDoc, getDocs, setDoc, writeBatch } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { Building2, Loader2, Plus, RotateCcw, Save, Trash2, Wallet } from "lucide-react";
import { useUI } from "@/context/UIContext";
import { useLanguage } from "@/context/LanguageContext";
import { getClinicCollection, getClinicDoc } from "@/lib/db-utils";
import { useSettingsDraft } from "@/lib/settingsDraft";
import { PRICE_LISTS_DOC, parsePriceLists, type PriceList } from "@/lib/priceLists";
import {
  PRIVATE_PAYER_ID,
  commissionRateFor,
  hasOwnRate,
  parsePayers,
  payerIdFrom,
  payersDocFrom,
  withCommissionRate,
  type Payer,
} from "@/lib/payers";

/**
 * Who pays for the work, and what each dentist earns on it.
 *
 * Two tables that have to be on one screen, because neither makes sense alone. The first names the
 * payers — the clinic itself, and every insurer it works with — and points each at the price list
 * its tariff lives on. The second is the reason the first exists: the same dentist is almost never
 * paid the same percentage on an insurance case as on a private one, and until now the system held
 * exactly one number per dentist.
 *
 * The grid is deliberately sparse. A blank cell is not zero — it means "this dentist earns their
 * usual percentage here", and it shows that percentage greyed out so nobody has to remember what
 * it was. Typing a number makes it an exception; clearing it makes it inherit again. A clinic with
 * one payer sees one column and never thinks about any of this.
 *
 * Staff rows are written straight to `clinics/{id}/staff`, which is Admin-only in the rules — the
 * same gate this whole section sits behind.
 */

type StaffRow = {
  id: string;
  name: string;
  role: string;
  commissionPercentage: number;
  commissionByPayer: Record<string, number>;
};

const DENTIST_ROLES = new Set(["Dentist", "Owner", "Admin"]);

function pct(raw: unknown): number {
  const n = Number(raw);
  return Number.isFinite(n) ? Math.min(Math.max(n, 0), 100) : 0;
}

export default function PayersSettings({ canEdit }: { canEdit: boolean }) {
  const { language, isRTL } = useLanguage();
  const { showToast } = useUI();
  const isAr = language === "ar";

  const [stored, setStored] = useState<Payer[] | null>(null);
  const [priceLists, setPriceLists] = useState<PriceList[]>([]);
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [rates, setRates] = useState<Record<string, Record<string, number>>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [payersSnap, listsSnap, staffSnap] = await Promise.all([
          getDoc(getClinicDoc("settings", "payers")),
          getDoc(getClinicDoc("settings", PRICE_LISTS_DOC)),
          getDocs(getClinicCollection("staff")),
        ]);
        if (cancelled) return;
        setStored(parsePayers(payersSnap.exists() ? payersSnap.data() : null));
        setPriceLists(parsePriceLists(listsSnap.exists() ? listsSnap.data() : null).filter((l) => l.active));
        const rows: StaffRow[] = staffSnap.docs
          .map((d) => {
            const data = d.data() as Record<string, unknown>;
            const byPayer: Record<string, number> = {};
            const raw = data.commissionByPayer;
            if (raw && typeof raw === "object") {
              for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
                if (Number.isFinite(Number(v))) byPayer[k] = pct(v);
              }
            }
            return {
              id: d.id,
              name: String(data.name || "").trim() || "—",
              role: String(data.role || "").trim(),
              commissionPercentage: pct(data.commissionPercentage),
              commissionByPayer: byPayer,
            };
          })
          // Only people who can earn commission. An assistant has no percentage to split.
          .filter((r) => DENTIST_ROLES.has(r.role) || r.commissionPercentage > 0)
          .sort((a, b) => a.name.localeCompare(b.name));
        setStaff(rows);
        setRates(Object.fromEntries(rows.map((r) => [r.id, { ...r.commissionByPayer }])));
      } catch {
        if (!cancelled) showToast(isAr ? "تعذّر تحميل البيانات" : "Could not load this screen", "error");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const draft = useSettingsDraft<Payer[]>("payers", stored, []);
  const payers = draft.value;

  const ratesDirty = useMemo(
    () =>
      staff.some(
        (row) => JSON.stringify(rates[row.id] || {}) !== JSON.stringify(row.commissionByPayer)
      ),
    [staff, rates]
  );
  const isDirty = draft.isDirty || ratesDirty;

  const addPayer = () => {
    const name = isAr ? "شركة تأمين جديدة" : "New insurer";
    draft.setValue((current) => [
      ...current,
      { id: payerIdFrom(name, current), name, active: true, isDefault: false },
    ]);
  };

  const patch = (id: string, change: Partial<Payer>) =>
    draft.setValue((current) => current.map((p) => (p.id === id ? { ...p, ...change } : p)));

  const remove = (id: string) => {
    if (id === PRIVATE_PAYER_ID) return;
    draft.setValue((current) => current.filter((p) => p.id !== id));
  };

  const makeDefault = (id: string) =>
    draft.setValue((current) => current.map((p) => ({ ...p, isDefault: p.id === id })));

  const setRate = (staffId: string, payerId: string, raw: string) => {
    const trimmed = raw.trim();
    setRates((current) => ({
      ...current,
      [staffId]: withCommissionRate(current[staffId], payerId, trimmed === "" ? null : Number(trimmed)),
    }));
  };

  const save = async () => {
    setSaving(true);
    try {
      const doc = payersDocFrom(payers);
      await setDoc(getClinicDoc("settings", "payers"), doc, { merge: true });

      // Only the staff rows whose grid actually changed. Writing all of them would touch records
      // this screen has no other business in, and every write is one an admin could be asked about.
      const batch = writeBatch(db);
      let touched = 0;
      for (const row of staff) {
        const next = rates[row.id] || {};
        if (JSON.stringify(next) === JSON.stringify(row.commissionByPayer)) continue;
        batch.update(getClinicDoc("staff", row.id), { commissionByPayer: next });
        touched++;
      }
      if (touched > 0) await batch.commit();

      setStored(doc.payers);
      setStaff((current) => current.map((r) => ({ ...r, commissionByPayer: rates[r.id] || {} })));
      draft.markSaved();
      showToast(isAr ? "تم الحفظ" : "Saved", "success");
    } catch {
      showToast(isAr ? "فشل الحفظ. جرّب تاني." : "Could not save. Try again.", "error");
    } finally {
      setSaving(false);
    }
  };

  const discard = () => {
    draft.discard();
    setRates(Object.fromEntries(staff.map((r) => [r.id, { ...r.commissionByPayer }])));
  };

  if (loading) {
    return (
      <div className="space-y-4" aria-hidden>
        <div className="h-32 rounded-3xl bg-surface-muted animate-pulse" />
        <div className="h-64 rounded-3xl bg-surface-muted animate-pulse" />
      </div>
    );
  }

  const activePayers = payers.filter((p) => p.active);

  return (
    <div className="w-full space-y-8 pb-4" dir={isRTL ? "rtl" : "ltr"}>
      <div className="rounded-[1.75rem] bg-ink-slab px-6 py-6 text-white shadow-lg shadow-ink-slab/15 sm:px-8">
        <p className="flex items-center gap-2 font-display text-[10px] font-black uppercase tracking-[0.22em] text-white/45">
          <Wallet size={12} />
          {isAr ? "جهات الدفع" : "Payers"}
        </p>
        <p className="mt-2 max-w-2xl font-display text-[15px] font-bold leading-relaxed text-white sm:text-base">
          {isAr
            ? "مين بيدفع: العيادة نفسها، ولا شركة تأمين. كل جهة ليها قايمة أسعارها، ولكل دكتور نسبة مختلفة عليها."
            : "Who is paying: the clinic itself, or an insurer. Each one has its own price list, and each dentist can earn a different percentage on it."}
        </p>
        <p className="mt-2 font-figure text-[13px] tracking-tight text-white/70">
          {activePayers.length} {isAr ? "جهة شغّالة" : "active"}
        </p>
      </div>

      {/* --- the payers themselves ---------------------------------------------------------- */}
      <section>
        <div className="mb-3 flex items-center justify-between px-1">
          <h3 className="font-display text-[11px] font-black uppercase tracking-[0.18em] text-ink-muted">
            {isAr ? "الجهات" : "The payers"}
          </h3>
          {canEdit && (
            <button
              type="button"
              onClick={addPayer}
              className="inline-flex items-center gap-1.5 rounded-xl border border-line px-3 py-1.5 text-[12px] font-black text-ink-body transition-colors hover:text-ink"
            >
              <Plus size={14} />
              {isAr ? "أضف شركة تأمين" : "Add an insurer"}
            </button>
          )}
        </div>

        <div className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
          {payers.map((payer) => {
            const isPrivate = payer.id === PRIVATE_PAYER_ID;
            return (
              <div key={payer.id} className="px-4 py-3.5">
                <div className="flex flex-wrap items-center gap-3">
                  <Building2 size={15} className="shrink-0 text-ink-faint" />
                  <input
                    value={payer.name}
                    disabled={!canEdit || isPrivate}
                    onChange={(e) => patch(payer.id, { name: e.target.value })}
                    placeholder={isAr ? "اسم الجهة" : "Payer name"}
                    className="min-w-[10rem] flex-1 rounded-xl border border-line bg-surface px-3 py-2 text-[14px] font-bold text-ink outline-none transition focus:border-accent disabled:opacity-60"
                  />
                  <input
                    value={payer.nameAr || ""}
                    disabled={!canEdit || isPrivate}
                    onChange={(e) => patch(payer.id, { nameAr: e.target.value })}
                    placeholder={isAr ? "الاسم بالعربي" : "Arabic name"}
                    dir="rtl"
                    className="min-w-[8rem] flex-1 rounded-xl border border-line bg-surface px-3 py-2 text-[14px] font-bold text-ink outline-none transition focus:border-accent disabled:opacity-60"
                  />
                  <select
                    value={payer.priceListId || ""}
                    disabled={!canEdit}
                    onChange={(e) => patch(payer.id, { priceListId: e.target.value || undefined })}
                    className="rounded-xl border border-line bg-surface px-3 py-2 text-[13px] font-bold text-ink-body outline-none"
                  >
                    <option value="">{isAr ? "قايمة الأسعار العادية" : "The normal price list"}</option>
                    {priceLists.map((l) => (
                      <option key={l.id} value={l.id}>
                        {isAr ? l.nameAr || l.name : l.name}
                      </option>
                    ))}
                  </select>

                  <button
                    type="button"
                    disabled={!canEdit || payer.isDefault}
                    onClick={() => makeDefault(payer.id)}
                    className={`rounded-full px-2.5 py-1 text-[11px] font-black transition-colors ${
                      payer.isDefault
                        ? "bg-ink-slab text-white"
                        : "border border-line text-ink-faint hover:text-ink"
                    }`}
                  >
                    {isAr ? "الافتراضي" : "Default"}
                  </button>
                  {!isPrivate && canEdit && (
                    <>
                      <button
                        type="button"
                        onClick={() => patch(payer.id, { active: !payer.active })}
                        className={`rounded-full px-2.5 py-1 text-[11px] font-black transition-colors ${
                          payer.active ? "border border-line text-ink-body" : "bg-surface-muted text-ink-faint"
                        }`}
                      >
                        {payer.active ? (isAr ? "شغّالة" : "Active") : isAr ? "موقوفة" : "Retired"}
                      </button>
                      <button
                        type="button"
                        onClick={() => remove(payer.id)}
                        aria-label={isAr ? "حذف" : "Remove"}
                        className="grid size-8 place-items-center rounded-full text-ink-faint transition-colors hover:bg-surface-muted hover:text-danger"
                      >
                        <Trash2 size={14} />
                      </button>
                    </>
                  )}
                </div>
                {isPrivate && (
                  <p className="mt-1.5 text-[11.5px] font-medium text-ink-faint">
                    {isAr
                      ? "دي جهة الدفع الأساسية ومش ممكن تتشال — أي علاج مش على تأمين بيتحسب عليها."
                      : "The clinic's own work. It cannot be removed — anything not on an insurer is counted here."}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* --- the commission grid ------------------------------------------------------------- */}
      <section>
        <h3 className="mb-1 px-1 font-display text-[11px] font-black uppercase tracking-[0.18em] text-ink-muted">
          {isAr ? "نسبة كل دكتور" : "What each dentist earns"}
        </h3>
        <p className="mb-3 max-w-2xl px-1 text-[12px] font-medium leading-relaxed text-ink-faint">
          {isAr
            ? "الخانة الفاضية معناها إن الدكتور بياخد نسبته العادية على الجهة دي — والرقم الباهت هو نسبته العادية. اكتب رقم عشان تعمل استثناء، وامسحه عشان يرجع زي ما كان."
            : "An empty box means this dentist earns their usual percentage on that payer — the faded number is what that is. Type a number to make it an exception, clear it to go back."}
        </p>

        {staff.length === 0 ? (
          <p className="rounded-2xl border border-line bg-surface px-4 py-6 text-center text-[13px] font-medium text-ink-faint">
            {isAr ? "مفيش دكاترة متسجلين لسه." : "No dentists on the team yet."}
          </p>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
            <table className="w-full min-w-[34rem] border-collapse">
              <thead>
                <tr className="border-b border-line">
                  <th className="px-4 py-3 text-start text-[11px] font-black uppercase tracking-wider text-ink-muted">
                    {isAr ? "الدكتور" : "Dentist"}
                  </th>
                  <th className="px-3 py-3 text-center text-[11px] font-black uppercase tracking-wider text-ink-muted">
                    {isAr ? "النسبة العادية" : "Usual"}
                  </th>
                  {activePayers.map((p) => (
                    <th
                      key={p.id}
                      className="px-3 py-3 text-center text-[11px] font-black uppercase tracking-wider text-ink-muted"
                    >
                      {isAr ? p.nameAr || p.name : p.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {staff.map((row) => (
                  <tr key={row.id} className="border-b border-line last:border-b-0">
                    <td className="px-4 py-2.5 text-[13.5px] font-bold text-ink">{row.name}</td>
                    <td className="px-3 py-2.5 text-center font-figure text-[13px] text-ink-muted">
                      {row.commissionPercentage}%
                    </td>
                    {activePayers.map((p) => {
                      const current = rates[row.id] || {};
                      const own = hasOwnRate({ commissionByPayer: current }, p.id);
                      const effective = commissionRateFor(
                        { commissionPercentage: row.commissionPercentage, commissionByPayer: current },
                        p.id
                      );
                      return (
                        <td key={p.id} className="px-3 py-2.5 text-center">
                          <input
                            type="number"
                            min={0}
                            max={100}
                            disabled={!canEdit}
                            value={own ? String(current[p.id]) : ""}
                            placeholder={String(effective)}
                            onChange={(e) => setRate(row.id, p.id, e.target.value)}
                            className={`w-16 rounded-xl border border-line bg-surface px-2 py-1.5 text-center font-figure text-[13px] outline-none transition focus:border-accent ${
                              own ? "text-ink" : "text-ink-faint"
                            }`}
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p className="px-1 text-[11.5px] font-medium leading-relaxed text-ink-faint">
        {isAr
          ? "ملحوظة: العلاجات اللي اتسجلت قبل ما تظبّط الجهات دي بتتحسب على «خاص»، لأن مفيش طريقة نعرف بيها كانت على مين. التقسيم الصح بيبدأ من دلوقتي."
          : "Note: treatments recorded before you set these up are counted as Private, because there is no way to know what they were. The real split starts from now."}
      </p>

      {canEdit && isDirty && (
        <div className="sticky bottom-4 z-20 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-ink-slab px-4 py-3 shadow-2xl">
          <span className="text-xs font-bold text-white/70">
            {isAr ? "فيه تغييرات مش متحفظة" : "Unsaved changes"}
          </span>
          <span className="flex items-center gap-2">
            <button
              type="button"
              onClick={discard}
              disabled={saving}
              className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold text-white/60 transition hover:text-white disabled:opacity-50"
            >
              <RotateCcw size={14} /> {isAr ? "تجاهل" : "Discard"}
            </button>
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-xl bg-accent px-5 py-2.5 text-sm font-bold text-ink-on-accent transition hover:bg-accent-strong disabled:opacity-50"
            >
              {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
              {isAr ? "حفظ" : "Save"}
            </button>
          </span>
        </div>
      )}
    </div>
  );
}
