"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { getDoc, getDocs, setDoc, writeBatch } from "firebase/firestore";
import { db } from "@/lib/firebase";
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  Check,
  Loader2,
  Pencil,
  Plus,
  Trash2,
  Wallet,
  X,
} from "lucide-react";
import { useUI } from "@/context/UIContext";
import { useLanguage } from "@/context/LanguageContext";
import { useDirtyFlag } from "@/context/UnsavedChangesContext";
import { getClinicCollection, getClinicDoc } from "@/lib/db-utils";
import { PRICE_LISTS_DOC, parsePriceLists, toStoredLists, type PriceList } from "@/lib/priceLists";
import {
  PRIVATE_PAYER_ID,
  parsePayers,
  payerIdFrom,
  payersDocFrom,
  withCommissionRate,
  type Payer,
} from "@/lib/payers";

/**
 * Setting up an insurance company, in three questions.
 *
 * The first version of this screen was rejected for being confusing, and it deserved to be. It
 * asked the clinic to hold three separate ideas in two different places: go to Prices, build a
 * price list, come back here, add a payer, link the two, then read a sparse grid of percentages.
 * A dentist does not think in price lists. He thinks "I work with AXA, they pay these prices, and
 * my doctor takes 25% on their cases" — one thing, not three.
 *
 * So the trip is gone and so is the vocabulary. Adding an insurer asks three questions in order:
 * what are they called, what do they pay, what does each dentist earn on them. The price list is
 * still what the rest of the app charges from, but it is created here, named after the insurer,
 * and the words never appear on screen.
 *
 * Steps two and three are both skippable, and skipping is the normal case. An insurer with no
 * prices filled in pays the clinic's normal prices; a dentist with no percentage filled in earns
 * their normal percentage. Every box shows, as its placeholder, exactly what happens if it is left
 * empty — so the clinic only ever types the exceptions, and can see at a glance that it has.
 */

type StaffRow = {
  id: string;
  name: string;
  role: string;
  commissionPercentage: number;
  commissionByPayer: Record<string, number>;
};

type ServiceRow = {
  id: string;
  name: string;
  price: number;
  prices: Record<string, number>;
};

const DENTIST_ROLES = new Set(["Dentist", "Owner", "Admin"]);
const STEPS = 3;

function pct(raw: unknown): number {
  const n = Number(raw);
  return Number.isFinite(n) ? Math.min(Math.max(n, 0), 100) : 0;
}

/** An insurer being added or edited. Absent entries mean "no exception", never zero. */
type Draft = {
  /** Empty for a new insurer; the payer id when editing one. */
  payerId: string;
  name: string;
  nameAr: string;
  /** Service id → what this insurer pays. */
  prices: Record<string, number>;
  /** Staff id → percentage on this insurer's cases. */
  rates: Record<string, number>;
};

export default function PayersSettings({ canEdit }: { canEdit: boolean }) {
  const { language, isRTL } = useLanguage();
  const { showToast } = useUI();
  const isAr = language === "ar";
  const Forward = isRTL ? ArrowLeft : ArrowRight;
  const Back = isRTL ? ArrowRight : ArrowLeft;

  const [payers, setPayers] = useState<Payer[]>([]);
  const [priceLists, setPriceLists] = useState<PriceList[]>([]);
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [services, setServices] = useState<ServiceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [step, setStep] = useState(1);

  /**
   * An open wizard is unsaved work, and nothing here is written until "Done".
   *
   * Without this, walking away from step two — having typed twenty prices — loses all of it with
   * no warning, which is the exact failure the settings screens were audited for. Cancel is still
   * one click; the difference is that it has to be a click.
   */
  useDirtyFlag("payers", draft !== null);

  const load = useCallback(async () => {
    const [payersSnap, listsSnap, staffSnap, servicesSnap] = await Promise.all([
      getDoc(getClinicDoc("settings", "payers")),
      getDoc(getClinicDoc("settings", PRICE_LISTS_DOC)),
      getDocs(getClinicCollection("staff")),
      getDocs(getClinicCollection("services")),
    ]);
    setPayers(parsePayers(payersSnap.exists() ? payersSnap.data() : null));
    setPriceLists(parsePriceLists(listsSnap.exists() ? listsSnap.data() : null));
    setStaff(
      staffSnap.docs
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
        // Only people who can earn commission — an assistant has no percentage to split.
        .filter((r) => DENTIST_ROLES.has(r.role) || r.commissionPercentage > 0)
        .sort((a, b) => a.name.localeCompare(b.name)),
    );
    setServices(
      servicesSnap.docs
        .map((d) => {
          const data = d.data() as Record<string, unknown>;
          const overrides: Record<string, number> = {};
          const raw = data.prices;
          if (raw && typeof raw === "object") {
            for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
              if (Number.isFinite(Number(v))) overrides[k] = Number(v);
            }
          }
          return {
            id: d.id,
            name: String(data.name || "").trim() || "—",
            price: Number(data.price) || 0,
            prices: overrides,
          };
        })
        .sort((a, b) => a.name.localeCompare(b.name)),
    );
  }, []);

  useEffect(() => {
    void load()
      .catch(() => showToast(isAr ? "تعذّر تحميل البيانات" : "Could not load this screen", "error"))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const insurers = useMemo(() => payers.filter((p) => p.id !== PRIVATE_PAYER_ID), [payers]);

  /** How many exceptions an insurer actually carries, for the one-line summary on its card. */
  const summaryOf = (payer: Payer) => {
    const listId = payer.priceListId || "";
    const priced = listId ? services.filter((s) => typeof s.prices[listId] === "number").length : 0;
    const rated = staff.filter((s) => typeof s.commissionByPayer[payer.id] === "number").length;
    return { priced, rated };
  };

  const startNew = () => {
    setDraft({ payerId: "", name: "", nameAr: "", prices: {}, rates: {} });
    setStep(1);
  };

  const startEdit = (payer: Payer) => {
    const listId = payer.priceListId || "";
    const prices: Record<string, number> = {};
    if (listId) {
      for (const s of services) {
        if (typeof s.prices[listId] === "number") prices[s.id] = s.prices[listId];
      }
    }
    const rates: Record<string, number> = {};
    for (const s of staff) {
      if (typeof s.commissionByPayer[payer.id] === "number") rates[s.id] = s.commissionByPayer[payer.id];
    }
    setDraft({ payerId: payer.id, name: payer.name, nameAr: payer.nameAr || "", prices, rates });
    setStep(1);
  };

  const remove = async (payer: Payer) => {
    // Deliberately not a hard confirm dialog: nothing is destroyed. Treatments already recorded
    // keep the insurer's name for ever, because the name is stamped on the row rather than looked
    // up. All this does is stop it being offered on new work, which the line below says plainly.
    setSaving(true);
    try {
      await setDoc(
        getClinicDoc("settings", "payers"),
        payersDocFrom(payers.filter((p) => p.id !== payer.id)),
        { merge: true },
      );
      await load();
      showToast(
        isAr ? "اتشالت — التقارير القديمة زي ما هي" : "Removed — past reports are unchanged",
        "success",
      );
    } catch {
      showToast(isAr ? "فشل الحفظ" : "Could not save", "error");
    } finally {
      setSaving(false);
    }
  };

  /**
   * Everything the wizard collected, written in one go.
   *
   * Three documents, and only the order matters: the price list has to exist before a service can
   * name it. A failure part-way through leaves an insurer that bills at normal prices rather than
   * a half-configured one — the safe direction, because it charges correctly and reads on the list
   * as "nothing filled in yet", which is true.
   */
  const saveDraft = async () => {
    if (!draft) return;
    const name = draft.name.trim();
    if (!name) {
      showToast(isAr ? "اكتب اسم الشركة" : "Give the insurer a name", "error");
      setStep(1);
      return;
    }
    setSaving(true);
    try {
      const isNew = !draft.payerId;
      const payerId = draft.payerId || payerIdFrom(name, payers);
      const nameAr = draft.nameAr.trim() || undefined;

      // The list the rest of the app charges from. Created here, named after the insurer, and
      // never called a "price list" on this screen.
      const existing = payers.find((p) => p.id === payerId);
      let listId = existing?.priceListId || "";
      let lists = priceLists;
      if (!listId) {
        listId = `payer-${payerId}`;
        lists = [
          ...priceLists,
          { id: listId, name, nameAr, generalDiscountPercent: 0, active: true, isDefault: false },
        ];
      } else {
        lists = priceLists.map((l) => (l.id === listId ? { ...l, name, nameAr } : l));
      }
      await setDoc(getClinicDoc("settings", PRICE_LISTS_DOC), { lists: toStoredLists(lists) }, { merge: true });

      const nextPayers: Payer[] = isNew
        ? [...payers, { id: payerId, name, nameAr, priceListId: listId, active: true, isDefault: false }]
        : payers.map((p) => (p.id === payerId ? { ...p, name, nameAr, priceListId: listId } : p));
      await setDoc(getClinicDoc("settings", "payers"), payersDocFrom(nextPayers), { merge: true });

      // Only the services and the staff whose answer actually changed. Clearing a box removes the
      // entry rather than storing a zero, because "pays my normal price" and "pays nothing" are
      // different answers and the store has to keep them apart.
      const batch = writeBatch(db);
      let writes = 0;
      for (const service of services) {
        const before = service.prices[listId];
        const after = draft.prices[service.id];
        const beforeSet = typeof before === "number";
        const afterSet = typeof after === "number";
        if (beforeSet === afterSet && (!afterSet || before === after)) continue;
        const nextPrices = { ...service.prices };
        if (afterSet) nextPrices[listId] = after;
        else delete nextPrices[listId];
        batch.update(getClinicDoc("services", service.id), { prices: nextPrices });
        writes++;
      }
      for (const member of staff) {
        const before = member.commissionByPayer[payerId];
        const after = draft.rates[member.id];
        const beforeSet = typeof before === "number";
        const afterSet = typeof after === "number";
        if (beforeSet === afterSet && (!afterSet || before === after)) continue;
        batch.update(getClinicDoc("staff", member.id), {
          commissionByPayer: withCommissionRate(member.commissionByPayer, payerId, afterSet ? after : null),
        });
        writes++;
      }
      if (writes > 0) await batch.commit();

      await load();
      setDraft(null);
      showToast(isAr ? "تم الحفظ" : "Saved", "success");
    } catch {
      showToast(isAr ? "فشل الحفظ. جرّب تاني." : "Could not save. Try again.", "error");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-4" aria-hidden>
        <div className="h-32 rounded-3xl bg-surface-muted animate-pulse" />
        <div className="h-48 rounded-3xl bg-surface-muted animate-pulse" />
      </div>
    );
  }

  /* --- the wizard --------------------------------------------------------------------------- */
  if (draft) {
    const who = draft.name.trim() || (isAr ? "الشركة" : "this insurer");
    const titles = [
      isAr ? "الشركة اسمها إيه؟" : "What is the insurer called?",
      isAr ? `${who} بتدفع كام؟` : `What does ${who} pay?`,
      isAr ? "كل دكتور بياخد كام؟" : "What does each dentist earn?",
    ];
    const hints = [
      isAr
        ? "الاسم ده هيظهر في التقارير وعلى شاشة العلاج."
        : "This name appears in the reports and on the treatment screen.",
      isAr
        ? "سيب الخانة فاضية لو بيدفعوا سعرك العادي — الرقم الباهت هو سعرك. املا بس اللي بيختلف."
        : "Leave a box empty if they pay your normal price — the faded number is yours. Only fill in what differs.",
      isAr
        ? "سيب الخانة فاضية لو الدكتور بياخد نسبته العادية. املا بس اللي بيختلف."
        : "Leave a box empty if the dentist earns their normal percentage. Only fill in what differs.",
    ];

    return (
      <div className="w-full space-y-6 pb-4" dir={isRTL ? "rtl" : "ltr"}>
        <div className="rounded-[1.75rem] bg-ink-slab px-6 py-6 text-white shadow-lg shadow-ink-slab/15 sm:px-8">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="font-display text-[10px] font-black uppercase tracking-[0.22em] text-white/45">
                {isAr ? `خطوة ${step} من ${STEPS}` : `Step ${step} of ${STEPS}`}
              </p>
              <h2 className="mt-2 font-display text-xl font-bold leading-tight tracking-tight sm:text-2xl">
                {titles[step - 1]}
              </h2>
              <p className="mt-2 max-w-xl text-[13.5px] font-medium leading-relaxed text-white/70">
                {hints[step - 1]}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setDraft(null)}
              aria-label={isAr ? "إلغاء" : "Cancel"}
              className="grid size-9 shrink-0 place-items-center rounded-full border border-white/15 text-white/60 transition-colors hover:bg-white/10 hover:text-white"
            >
              <X size={16} />
            </button>
          </div>
          <div className="mt-5 flex gap-1.5">
            {Array.from({ length: STEPS }, (_, i) => (
              <span
                key={i}
                className={`h-1 flex-1 rounded-full transition-colors ${i < step ? "bg-accent" : "bg-white/15"}`}
              />
            ))}
          </div>
        </div>

        {step === 1 && (
          <div className="space-y-4 rounded-2xl border border-line bg-surface p-5">
            <div>
              <label className="mb-1 block text-xs font-bold text-ink-muted">{isAr ? "الاسم" : "Name"}</label>
              <input
                autoFocus
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder={isAr ? "مثال: أكسا" : "e.g. AXA"}
                className="w-full rounded-xl border border-line bg-surface px-3 py-2.5 text-[15px] font-bold text-ink outline-none transition focus:border-accent"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-bold text-ink-muted">
                {isAr ? "الاسم بالعربي (اختياري)" : "Arabic name (optional)"}
              </label>
              <input
                value={draft.nameAr}
                onChange={(e) => setDraft({ ...draft, nameAr: e.target.value })}
                dir="rtl"
                className="w-full rounded-xl border border-line bg-surface px-3 py-2.5 text-[15px] font-bold text-ink outline-none transition focus:border-accent"
              />
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="overflow-hidden rounded-2xl border border-line bg-surface">
            {services.length === 0 ? (
              <p className="px-4 py-8 text-center text-[13px] font-medium text-ink-faint">
                {isAr ? "مفيش علاجات بأسعار لسه." : "No treatments priced yet."}
              </p>
            ) : (
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b border-line bg-surface-subtle">
                    <th className="px-4 py-3 text-start text-[10.5px] font-black uppercase tracking-wider text-ink-muted">
                      {isAr ? "العلاج" : "Treatment"}
                    </th>
                    <th className="px-3 py-3 text-end text-[10.5px] font-black uppercase tracking-wider text-ink-muted">
                      {isAr ? "سعرك" : "Your price"}
                    </th>
                    <th className="px-3 py-3 text-end text-[10.5px] font-black uppercase tracking-wider text-ink-muted">
                      {isAr ? "بيدفعوا" : "They pay"}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {services.map((s) => (
                    <tr key={s.id} className="border-b border-line last:border-b-0">
                      <td className="px-4 py-2 text-[13.5px] font-bold text-ink">{s.name}</td>
                      <td className="px-3 py-2 text-end font-figure text-[13px] text-ink-muted">
                        {s.price.toLocaleString()}
                      </td>
                      <td className="px-3 py-2 text-end">
                        <input
                          type="number"
                          min={0}
                          value={typeof draft.prices[s.id] === "number" ? String(draft.prices[s.id]) : ""}
                          placeholder={String(s.price)}
                          onChange={(e) => {
                            const raw = e.target.value.trim();
                            const next = { ...draft.prices };
                            if (raw === "") delete next[s.id];
                            else next[s.id] = Math.max(0, Number(raw) || 0);
                            setDraft({ ...draft, prices: next });
                          }}
                          className="w-24 rounded-xl border border-line bg-surface px-2 py-1.5 text-end font-figure text-[13px] text-ink outline-none transition focus:border-accent"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {step === 3 && (
          <div className="overflow-hidden rounded-2xl border border-line bg-surface">
            {staff.length === 0 ? (
              <p className="px-4 py-8 text-center text-[13px] font-medium text-ink-faint">
                {isAr ? "مفيش دكاترة متسجلين لسه." : "No dentists on the team yet."}
              </p>
            ) : (
              staff.map((member) => (
                <div
                  key={member.id}
                  className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3 last:border-b-0"
                >
                  <p className="min-w-0 text-[14px] font-bold text-ink">
                    {member.name}
                    <span className="ms-2 text-[12px] font-medium text-ink-faint">
                      {isAr ? `بياخد ${member.commissionPercentage}% عادةً` : `normally ${member.commissionPercentage}%`}
                    </span>
                  </p>
                  <span className="flex items-center gap-2">
                    <span className="text-[12.5px] font-bold text-ink-body">{isAr ? `على ${who}` : `on ${who}`}</span>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={typeof draft.rates[member.id] === "number" ? String(draft.rates[member.id]) : ""}
                      placeholder={String(member.commissionPercentage)}
                      onChange={(e) => {
                        const raw = e.target.value.trim();
                        const next = { ...draft.rates };
                        if (raw === "") delete next[member.id];
                        else next[member.id] = pct(raw);
                        setDraft({ ...draft, rates: next });
                      }}
                      className="w-20 rounded-xl border border-line bg-surface px-2 py-1.5 text-center font-figure text-[13px] text-ink outline-none transition focus:border-accent"
                    />
                    <span className="font-figure text-[13px] text-ink-faint">%</span>
                  </span>
                </div>
              ))
            )}
          </div>
        )}

        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => (step === 1 ? setDraft(null) : setStep(step - 1))}
            disabled={saving}
            className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2.5 text-[13px] font-bold text-ink-muted transition hover:text-ink disabled:opacity-50"
          >
            <Back size={15} />
            {step === 1 ? (isAr ? "إلغاء" : "Cancel") : isAr ? "رجوع" : "Back"}
          </button>

          <span className="flex items-center gap-2">
            {/* Skipping is the normal case, and saying so is what stops the two optional steps
                reading as two more forms to fill in. */}
            {step > 1 && step < STEPS && (
              <button
                type="button"
                onClick={() => setStep(step + 1)}
                disabled={saving}
                className="rounded-xl px-3 py-2.5 text-[13px] font-bold text-ink-faint transition hover:text-ink disabled:opacity-50"
              >
                {isAr ? "عدّي دي" : "Skip this"}
              </button>
            )}
            {step < STEPS ? (
              <button
                type="button"
                onClick={() => setStep(step + 1)}
                disabled={saving || (step === 1 && !draft.name.trim())}
                className="inline-flex items-center gap-2 rounded-xl bg-accent px-5 py-2.5 text-sm font-bold text-ink-on-accent transition hover:bg-accent-strong disabled:opacity-50"
              >
                {isAr ? "التالي" : "Next"}
                <Forward size={15} />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void saveDraft()}
                disabled={saving}
                className="inline-flex items-center gap-2 rounded-xl bg-accent px-5 py-2.5 text-sm font-bold text-ink-on-accent transition hover:bg-accent-strong disabled:opacity-50"
              >
                {saving ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
                {isAr ? "خلصنا" : "Done"}
              </button>
            )}
          </span>
        </div>
      </div>
    );
  }

  /* --- the list ----------------------------------------------------------------------------- */
  return (
    <div className="w-full space-y-6 pb-4" dir={isRTL ? "rtl" : "ltr"}>
      <div className="rounded-[1.75rem] bg-ink-slab px-6 py-6 text-white shadow-lg shadow-ink-slab/15 sm:px-8">
        <p className="flex items-center gap-2 font-display text-[10px] font-black uppercase tracking-[0.22em] text-white/45">
          <Wallet size={12} />
          {isAr ? "التأمين" : "Insurance"}
        </p>
        <p className="mt-2 max-w-2xl font-display text-[15px] font-bold leading-relaxed text-white sm:text-base">
          {isAr
            ? "شركات التأمين اللي بتشتغل معاها. كل شركة بتحدد بتدفع كام، وكل دكتور بياخد كام على حالاتها."
            : "The insurance companies you work with. Each one sets what it pays, and what each dentist earns on its cases."}
        </p>
        <p className="mt-2 font-figure text-[13px] tracking-tight text-white/70">
          {insurers.length === 0
            ? isAr
              ? "مفيش شركات لسه — كل الشغل محسوب «خاص»."
              : "None yet — all work is counted as Private."
            : isAr
              ? `${insurers.length} شركة`
              : `${insurers.length} ${insurers.length === 1 ? "insurer" : "insurers"}`}
        </p>
      </div>

      <div className="space-y-3">
        {insurers.map((payer) => {
          const { priced, rated } = summaryOf(payer);
          return (
            <div
              key={payer.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-surface px-4 py-3.5"
            >
              <div className="flex min-w-0 items-center gap-3">
                <span className="grid size-9 shrink-0 place-items-center rounded-full bg-surface-muted text-ink-body">
                  <Building2 size={16} />
                </span>
                <div className="min-w-0">
                  <p className="text-[15px] font-bold text-ink">{isAr ? payer.nameAr || payer.name : payer.name}</p>
                  {/* What is actually set, in words. A card that only showed a name would make
                      somebody open the wizard to find out whether they had finished. */}
                  <p className="text-[12px] font-medium text-ink-faint">
                    {priced === 0
                      ? isAr
                        ? "بيدفعوا أسعارك العادية"
                        : "Pays your normal prices"
                      : isAr
                        ? `${priced} علاج بسعر مختلف`
                        : `${priced} ${priced === 1 ? "treatment" : "treatments"} priced differently`}
                    {" · "}
                    {rated === 0
                      ? isAr
                        ? "الدكاترة بنسبهم العادية"
                        : "dentists on their normal percentage"
                      : isAr
                        ? `${rated} دكتور بنسبة مختلفة`
                        : `${rated} ${rated === 1 ? "dentist" : "dentists"} on a different percentage`}
                  </p>
                </div>
              </div>
              {canEdit && (
                <span className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => startEdit(payer)}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-line px-3 py-1.5 text-[12px] font-black text-ink-body transition-colors hover:text-ink"
                  >
                    <Pencil size={13} />
                    {isAr ? "تعديل" : "Edit"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void remove(payer)}
                    disabled={saving}
                    aria-label={isAr ? "حذف" : "Remove"}
                    className="grid size-8 place-items-center rounded-full text-ink-faint transition-colors hover:bg-surface-muted hover:text-danger disabled:opacity-50"
                  >
                    <Trash2 size={14} />
                  </button>
                </span>
              )}
            </div>
          );
        })}

        {canEdit && (
          <button
            type="button"
            onClick={startNew}
            className="flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-line-strong px-4 py-4 text-[14px] font-black text-ink-body transition-colors hover:border-accent hover:text-ink"
          >
            <Plus size={16} />
            {isAr ? "ضيف شركة تأمين" : "Add an insurer"}
          </button>
        )}
      </div>

      <p className="px-1 text-[11.5px] font-medium leading-relaxed text-ink-faint">
        {isAr
          ? "أي علاج مش على شركة تأمين بيتحسب «خاص» لوحده. والعلاجات اللي اتسجلت قبل ما تضيف الشركات دي بتتحسب «خاص» برضه، لأن مفيش طريقة نعرف بيها كانت على مين."
          : "Anything not on an insurer is counted as Private by itself. Treatments recorded before you added these are counted as Private too, because there is no way to know what they were."}
      </p>
    </div>
  );
}
