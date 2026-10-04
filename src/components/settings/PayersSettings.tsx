"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { doc, getDoc, getDocs, setDoc, writeBatch } from "firebase/firestore";
import { clearListPrices, countListUsage } from "@/lib/priceListUsage";
import { db } from "@/lib/firebase";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Loader2,
  Pencil,
  Plus,
  Trash2,
  Wallet,
  X,
} from "lucide-react";
import { useUI } from "@/context/UIContext";
import { useClinic } from "@/context/ClinicContext";
import { useLanguage } from "@/context/LanguageContext";
import { useDirtyFlag } from "@/context/UnsavedChangesContext";
import { getClinicCollection, getClinicDoc } from "@/lib/db-utils";
import { PRICE_LISTS_DOC, parsePriceLists, toStoredLists, type PriceList } from "@/lib/priceLists";
import InsurerBadge from "@/components/shared/InsurerBadge";
import { categoryOf, suggestCategory, suggestIcon } from "@/lib/dentalIcons";
import { CUSTOM_SERVICE_MINUTES } from "@/lib/setupWizard";
import { INSURER_GROUPS, presetsIn } from "@/lib/insurerPresets";
import {
  INSURER_FORMATS,
  PRIVATE_PAYER_ID,
  parsePayers,
  payerIdFrom,
  payersDocFrom,
  withCommissionRate,
  type InsurerFormat,
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
/**
 * The steps an insurer's wizard shows. An insurer with a document format (MetLife) gets its prices
 * from the approval paper, so the "what do they cover and pay" step would only invite the clinic
 * to type a tariff nobody reads; it is skipped, and no price list is kept for such an insurer.
 */
const stepsOf = (d: { format: string }): number[] => (d.format ? [1, 3] : [1, 2, 3]);
const nextStep = (d: { format: string }, step: number): number => {
  const steps = stepsOf(d);
  return steps[Math.min(steps.indexOf(step) + 1, steps.length - 1)];
};
const prevStep = (d: { format: string }, step: number): number => {
  const steps = stepsOf(d);
  return steps[Math.max(steps.indexOf(step) - 1, 0)];
};

function pct(raw: unknown): number {
  const n = Number(raw);
  return Number.isFinite(n) ? Math.min(Math.max(n, 0), 100) : 0;
}

/** A treatment typed into the coverage table that does not exist as a service yet. */
type AddedRow = {
  /** A Firestore id minted on the client, so the row can be covered and priced before it is saved. */
  id: string;
  name: string;
  /** The clinic's own price — what every other patient pays. */
  price: number;
};

/** An insurer being added or edited. Absent entries mean "no exception", never zero. */
type Draft = {
  /** Empty for a new insurer; the payer id when editing one. */
  payerId: string;
  name: string;
  nameAr: string;
  /** Which insurer's approval document this payer sends; empty = none of the known formats. */
  format: InsurerFormat | "";
  /** The clinic's own code with this insurer. */
  providerCode: string;
  /** Service id → what this insurer pays. */
  prices: Record<string, number>;
  /** The treatments on this insurer's own list. Every insurer keeps its own. */
  covered: Set<string>;
  /** Staff id → percentage on this insurer's cases. */
  rates: Record<string, number>;
  /** Service id → the name as retyped in the table. Saved only when it differs. */
  renamed: Record<string, string>;
  /** Treatments added from the table; a nameless or free row is dropped on save. */
  added: AddedRow[];
};

export default function PayersSettings({ canEdit }: { canEdit: boolean }) {
  const { language, isRTL } = useLanguage();
  const { showToast } = useUI();
  const { clinicId } = useClinic();
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

  /**
   * Keyed on the clinic, not run once.
   *
   * Loaded once, this screen kept showing — and worse, kept EDITING — the previous clinic's
   * payers after a switch, because every save re-derives from state loaded at mount. That is the
   * stale base that appended a duplicate AXA list. An open wizard is thrown away on switch for
   * the same reason: a draft built from one clinic must not be saved into another.
   */
  useEffect(() => {
    setLoading(true);
    setDraft(null);
    void load()
      .catch(() => showToast(isAr ? "تعذّر تحميل البيانات" : "Could not load this screen", "error"))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clinicId]);

  const insurers = useMemo(() => payers.filter((p) => p.id !== PRIVATE_PAYER_ID), [payers]);

  /** How many exceptions an insurer actually carries, for the one-line summary on its card. */
  const summaryOf = (payer: Payer) => {
    const listId = payer.priceListId || "";
    const priced = listId ? services.filter((s) => typeof s.prices[listId] === "number").length : 0;
    const rated = staff.filter((s) => typeof s.commissionByPayer[payer.id] === "number").length;
    return { priced, rated };
  };

  const startNew = () => {
    // A new insurer starts covering everything, then the clinic unticks what it does not.
    // Starting empty would mean the first treatment recorded on it silently falls to private,
    // which reads as the insurer not working rather than as a list nobody has filled in.
    setDraft({ payerId: "", name: "", nameAr: "", format: "", providerCode: "", prices: {}, rates: {}, renamed: {}, added: [], covered: new Set(services.map((s) => s.id)) });
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
    setDraft({
      payerId: payer.id,
      name: payer.name,
      nameAr: payer.nameAr || "",
      format: payer.format ?? "",
      providerCode: payer.providerCode || "",
      prices,
      rates,
      renamed: {},
      added: [],
      // No stored list means this insurer predates separate lists and covers everything.
      covered: new Set(payer.services ?? services.map((s) => s.id)),
    });
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

      /**
       * Take the insurer's price list with it.
       *
       * This screen never says the words "price list" — it is an implementation detail of "an
       * insurer pays these prices". So removing the insurer and leaving its list behind left the
       * clinic staring at a row on another screen it had never knowingly created, offered in every
       * treatment picker, and which the bin there refused to delete.
       *
       * Deleted outright only when nothing was ever recorded on it. Once work exists the list has
       * to survive, or a charge points at a tariff nobody can look up — so it is deactivated
       * instead, which keeps every past report readable and stops it being offered on new work.
       */
      const listId = payer.priceListId || "";
      const list = listId ? priceLists.find((l) => l.id === listId) : null;
      const sharedWithAnotherPayer = payers.some((p) => p.id !== payer.id && p.priceListId === listId);
      let listOutcome: "deleted" | "deactivated" | "kept" = "kept";

      if (list && !list.isDefault && !sharedWithAnotherPayer) {
        const used = await countListUsage(listId).catch(() => null);
        if (used && used.total === 0) {
          const pricedIds = services.filter((svc) => typeof svc.prices[listId] === "number").map((svc) => svc.id);
          await clearListPrices(listId, pricedIds);
          await setDoc(
            getClinicDoc("settings", PRICE_LISTS_DOC),
            { lists: toStoredLists(priceLists.filter((l) => l.id !== listId)) },
            { merge: true },
          );
          listOutcome = "deleted";
        } else if (list.active) {
          await setDoc(
            getClinicDoc("settings", PRICE_LISTS_DOC),
            { lists: toStoredLists(priceLists.map((l) => (l.id === listId ? { ...l, active: false } : l))) },
            { merge: true },
          );
          listOutcome = "deactivated";
        }
      }

      await load();
      showToast(
        listOutcome === "deleted"
          ? isAr
            ? "اتشالت هي وقائمة أسعارها — مفيش علاج كان متسجل عليها"
            : "Removed, along with its price list — no treatment had been recorded on it"
          : listOutcome === "deactivated"
            ? isAr
              ? "اتشالت. قائمة أسعارها اتعطّلت بس فضلت موجودة، عشان فيه علاج متسجل عليها"
              : "Removed. Its price list was deactivated rather than deleted, because treatments were recorded on it"
            : isAr
              ? "اتشالت — التقارير القديمة زي ما هي"
              : "Removed — past reports are unchanged",
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
      // Written in the services' own order so two saves of the same list produce the same
      // document, rather than a fresh permutation that reads as a change in every audit.
      // Rows typed into the table become services of their own; a blank or free one is noise.
      const newRows = draft.added
        .map((r) => ({ ...r, name: r.name.trim() }))
        .filter((r) => r.name && Number.isFinite(r.price) && r.price > 0);
      const coveredList = [
        ...services.filter((svc) => draft.covered.has(svc.id)).map((svc) => svc.id),
        ...newRows.filter((r) => draft.covered.has(r.id)).map((r) => r.id),
      ];
      const payerId = draft.payerId || payerIdFrom(name, payers);
      const nameAr = draft.nameAr.trim() || undefined;
      // Optional, and left off the payer entirely when blank: payersDocFrom drops an undefined, so a
      // cleared field removes the stored value instead of leaving the old one behind.
      const format = draft.format || undefined;
      const providerCode = draft.providerCode.trim() || undefined;

      // The list the rest of the app charges from. Created here, named after the insurer, and
      // never called a "price list" on this screen.
      const existing = payers.find((p) => p.id === payerId);
      // An insurer with a document format carries no price list and no coverage: its prices are
      // whatever the approval paper says. A list it had before the format was set is retired
      // (deactivated, never deleted: past work may still point at it).
      const listId = format ? "" : existing?.priceListId || `payer-${payerId}`;
      let lists = priceLists;
      if (format) {
        const old = existing?.priceListId || "";
        const sharedWithAnotherPayer = payers.some((p) => p.id !== payerId && p.priceListId === old);
        if (old && !sharedWithAnotherPayer && lists.some((l) => l.id === old && l.active && !l.isDefault)) {
          lists = lists.map((l) => (l.id === old ? { ...l, active: false } : l));
          await setDoc(getClinicDoc("settings", PRICE_LISTS_DOC), { lists: toStoredLists(lists) }, { merge: true });
        }
      } else {
        // Adopt an existing list under this id rather than appending a second one. The id is
        // derived from the payer, so a payer document that lost its link (a stale screen, a failed
        // save) would otherwise mint a duplicate — which is exactly what happened in production:
        // two "AXA" lists, same id, and every price the clinic typed claimed by both.
        if (lists.some((l) => l.id === listId)) {
          lists = lists.map((l) => (l.id === listId ? { ...l, name, nameAr } : l));
        } else {
          lists = [...lists, { id: listId, name, nameAr, generalDiscountPercent: 0, active: true, isDefault: false }];
        }
        await setDoc(getClinicDoc("settings", PRICE_LISTS_DOC), { lists: toStoredLists(lists) }, { merge: true });
      }

      const base = { name, nameAr, format, providerCode, priceListId: listId || undefined, services: undefined }; // absent = covers everything: coverage lists are gone, any service can be billed to any payer
      const nextPayers: Payer[] = isNew
        ? [...payers, { id: payerId, ...base, active: true, isDefault: false }]
        : payers.map((p) => (p.id === payerId ? { ...p, ...base } : p));
      await setDoc(getClinicDoc("settings", "payers"), payersDocFrom(nextPayers), { merge: true });

      // Only the services and the staff whose answer actually changed. Clearing a box removes the
      // entry rather than storing a zero, because "pays my normal price" and "pays nothing" are
      // different answers and the store has to keep them apart.
      const batch = writeBatch(db);
      let writes = 0;
      for (const service of format ? [] : services) {
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
      for (const row of format ? [] : newRows) {
        // Shaped like a service the Prices screen would create; category and icon are
        // keyword-matched from the name, as they are there.
        const category = suggestCategory(row.name);
        const icon = suggestIcon(row.name) || categoryOf(category).icon;
        const pays = draft.prices[row.id];
        const prices: Record<string, number> = {};
        if (draft.covered.has(row.id) && typeof pays === "number") prices[listId] = pays;
        batch.set(getClinicDoc("services", row.id), {
          name: row.name,
          price: row.price,
          requiresLab: false,
          estimatedLabFee: 0,
          durationMinutes: CUSTOM_SERVICE_MINUTES,
          pricingMode: "per_tooth",
          prices,
          category,
          icon,
          createdAt: new Date().toISOString(),
        });
        writes++;
      }
      for (const [id, raw] of Object.entries(draft.renamed)) {
        const name = raw.trim();
        const current = services.find((svc) => svc.id === id);
        if (!current || !name || name === current.name) continue;
        batch.update(getClinicDoc("services", id), { name });
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
      isAr ? `${who} بتدفع كام؟ (اختياري)` : `What does ${who} pay? (optional)`,
      isAr ? "كل دكتور بياخد كام؟" : "What does each dentist earn?",
    ];
    const hints = [
      isAr
        ? "الاسم ده هيظهر في التقارير وعلى شاشة العلاج."
        : "This name appears in the reports and on the treatment screen.",
      isAr
        ? "أسعار بتتملّي تلقائي لما تختار العلاج تحت الشركة دي، وتقدر تغيّرها على كل حالة. سيب الخانة فاضية لو بيدفعوا سعرك العادي."
        : "Prices that prefill when a treatment is picked under this insurer; you can overwrite them on any case. Leave a box blank if they pay your normal price.",
      isAr
        ? "سيب الخانة فاضية لو الدكتور بياخد نسبته العادية. املا بس اللي بيختلف."
        : "Leave a box empty if the dentist earns their normal percentage. Only fill in what differs.",
    ];

    // The coverage table, rows the clinic is adding included.
    const addRow = () => {
      // The id is minted now so the row can be ticked and priced like any other before it exists.
      const id = doc(getClinicCollection("services")).id;
      const covered = new Set(draft.covered);
      covered.add(id);
      setDraft({ ...draft, covered, added: [...draft.added, { id, name: "", price: 0 }] });
    };
    const updateAdded = (id: string, patch: Partial<AddedRow>) =>
      setDraft({ ...draft, added: draft.added.map((r) => (r.id === id ? { ...r, ...patch } : r)) });
    const removeAdded = (id: string) => {
      const covered = new Set(draft.covered);
      covered.delete(id);
      const prices = { ...draft.prices };
      delete prices[id];
      setDraft({ ...draft, covered, prices, added: draft.added.filter((r) => r.id !== id) });
    };
    const nameBoxCls =
      "w-full min-w-0 rounded-lg border border-transparent bg-transparent px-2 py-1 text-[13.5px] font-bold text-ink outline-none transition placeholder:font-medium placeholder:text-ink-faint hover:border-line focus:border-accent focus:bg-surface";
    const notCovered = (
      <span className="text-[11.5px] font-bold text-ink-faint">{isAr ? "مش مغطّى" : "Not covered"}</span>
    );
    const paysBox = (id: string, yourPrice: number) => (
      <input
        type="number"
        min={0}
        value={typeof draft.prices[id] === "number" ? String(draft.prices[id]) : ""}
        placeholder={String(yourPrice)}
        onChange={(e) => {
          const raw = e.target.value.trim();
          const next = { ...draft.prices };
          if (raw === "") delete next[id];
          else next[id] = Math.max(0, Number(raw) || 0);
          setDraft({ ...draft, prices: next });
        }}
        className="w-24 rounded-xl border border-line bg-surface px-2 py-1.5 text-end font-figure text-[13px] text-ink outline-none transition focus:border-accent"
      />
    );

    return (
      <div className="w-full space-y-6 pb-4" dir={isRTL ? "rtl" : "ltr"}>
        <div className="rounded-[1.75rem] bg-ink-slab px-6 py-6 text-white shadow-lg shadow-ink-slab/15 sm:px-8">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="font-display text-[10px] font-black uppercase tracking-[0.22em] text-white/45">
                {isAr ? `خطوة ${stepsOf(draft).indexOf(step) + 1} من ${stepsOf(draft).length}` : `Step ${stepsOf(draft).indexOf(step) + 1} of ${stepsOf(draft).length}`}
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
            {stepsOf(draft).map((n) => (
              <span
                key={n}
                className={`h-1 flex-1 rounded-full transition-colors ${n <= step ? "bg-accent" : "bg-white/15"}`}
              />
            ))}
          </div>
        </div>

        {step === 1 && (
          <div className="space-y-4 rounded-2xl border border-line bg-surface p-5">
            {/*
              The common names, picked rather than spelled.
              "NEXtCARE" and "جلوب ميد" are not words anybody types the same way twice, and the
              name is stamped on every case recorded under that payer — so three spellings become
              three columns in the report that never add up. Typing is still allowed below: a
              clinic with a private arrangement or a scheme nobody else has must not be blocked by
              a list, and a preset that refuses the unlisted case is worse than no preset.
            */}
            {!draft.payerId && (
              <div className="space-y-3">
                {INSURER_GROUPS.map((group) => (
                  <div key={group.id}>
                    <p className="mb-1.5 text-[10.5px] font-black uppercase tracking-wider text-ink-faint">
                      {isAr ? group.ar : group.en}
                      <span className="ms-2 normal-case tracking-normal">{isAr ? group.note.ar : group.note.en}</span>
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {presetsIn(group.id).map((preset) => {
                        const picked = draft.name === preset.name;
                        return (
                          <button
                            key={preset.name}
                            type="button"
                            onClick={() => setDraft({ ...draft, name: preset.name, nameAr: preset.nameAr })}
                            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-[12px] font-bold transition-colors ${
                              picked
                                ? "border-transparent bg-ink-slab text-white"
                                : "border-line text-ink-body hover:text-ink"
                            }`}
                          >
                            <InsurerBadge name={preset.name} size={18} />
                            {isAr ? preset.nameAr : preset.name}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
                <p className="pt-1 text-[11.5px] font-medium text-ink-faint">
                  {isAr
                    ? "مش لاقي شركتك؟ اكتب اسمها تحت عادي."
                    : "Not on the list? Just type the name below."}
                </p>
              </div>
            )}
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
            {/* Only an insurer reaches this wizard — Private is never edited here — so these two
                never appear for it. */}
            <div>
              <label className="mb-1 block text-xs font-bold text-ink-muted">
                {isAr ? "صيغة المستند" : "Document format"}
              </label>
              <select
                value={draft.format}
                onChange={(e) => setDraft({ ...draft, format: e.target.value as InsurerFormat | "" })}
                className="w-full rounded-xl border border-line bg-surface px-3 py-2.5 text-[15px] font-bold text-ink outline-none transition focus:border-accent"
              >
                <option value="">—</option>
                {INSURER_FORMATS.map((f) => (
                  <option key={f.id} value={f.id}>
                    {isAr ? f.ar : f.en}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-bold text-ink-muted">
                {isAr ? "كود مقدم الخدمة" : "Provider code"}
              </label>
              <input
                value={draft.providerCode}
                onChange={(e) => setDraft({ ...draft, providerCode: e.target.value })}
                dir="ltr"
                className="w-full rounded-xl border border-line bg-surface px-3 py-2.5 text-[15px] font-bold text-ink outline-none transition focus:border-accent"
              />
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-3">
            {/* The treatment names are boxes, not labels, and the last row is blank: an insurer's
                list is where the clinic finds out a treatment is misnamed or missing, and sending
                it to the Prices screen and back would lose the half-filled draft. A row added
                here becomes an ordinary service — priced at "your price" for everyone, and at
                "they pay" for this insurer — so the Prices screen sees it like any other. */}
            <div className="overflow-hidden rounded-2xl border border-line bg-surface">
              {services.length === 0 && draft.added.length === 0 ? (
                <p className="px-4 py-8 text-center text-[13px] font-medium text-ink-faint">
                  {isAr ? "مفيش علاجات بأسعار لسه. ضيف أول علاج تحت." : "No treatments priced yet. Add the first one below."}
                </p>
              ) : (
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="border-b border-line bg-surface-subtle">
                      <th className="px-3 py-3 text-start text-[10.5px] font-black uppercase tracking-wider text-ink-muted">
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
                    {services.map((s) => {
                      const on = true;
                      return (
                        <tr key={s.id} className="border-b border-line last:border-b-0">
                          <td className="px-2 py-1.5">
                            <input
                              type="text"
                              value={draft.renamed[s.id] ?? s.name}
                              onChange={(e) => setDraft({ ...draft, renamed: { ...draft.renamed, [s.id]: e.target.value } })}
                              aria-label={isAr ? "اسم العلاج" : "Treatment name"}
                              className={nameBoxCls}
                            />
                          </td>
                          <td className="px-3 py-2 text-end font-figure text-[13px] text-ink-muted">
                            {s.price.toLocaleString()}
                          </td>
                          <td className="px-3 py-2 text-end">
                            {/* A price on a treatment this insurer does not cover is a number that
                                can never be charged, so the box goes away rather than being
                                disabled — a greyed-out field invites somebody to try. */}
                            {on ? paysBox(s.id, s.price) : notCovered}
                          </td>
                        </tr>
                      );
                    })}
                    {draft.added.map((row) => {
                      const on = true;
                      return (
                        <tr key={row.id} className="border-b border-line last:border-b-0">
                          <td className="px-2 py-1.5">
                            <span className="flex items-center gap-1">
                              <input
                                type="text"
                                autoFocus={!row.name}
                                value={row.name}
                                placeholder={isAr ? "اسم العلاج" : "Treatment name"}
                                onChange={(e) => updateAdded(row.id, { name: e.target.value })}
                                aria-label={isAr ? "اسم العلاج الجديد" : "New treatment name"}
                                className={nameBoxCls}
                              />
                              <button
                                type="button"
                                onClick={() => removeAdded(row.id)}
                                aria-label={isAr ? "حذف الصف" : "Remove row"}
                                className="grid size-8 shrink-0 place-items-center rounded-lg text-ink-faint transition-colors hover:bg-danger-tint hover:text-danger"
                              >
                                <Trash2 size={14} />
                              </button>
                            </span>
                          </td>
                          <td className="px-2 py-1.5 text-end">
                            <input
                              type="number"
                              min={0}
                              value={row.price > 0 ? String(row.price) : ""}
                              placeholder="0"
                              onChange={(e) => updateAdded(row.id, { price: Math.max(0, Number(e.target.value) || 0) })}
                              aria-label={isAr ? "سعرك" : "Your price"}
                              className="w-24 rounded-xl border border-line bg-surface px-2 py-1.5 text-end font-figure text-[13px] text-ink outline-none transition focus:border-accent"
                            />
                          </td>
                          <td className="px-3 py-2 text-end">{on ? paysBox(row.id, row.price) : notCovered}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
            <button
              type="button"
              onClick={addRow}
              className="inline-flex items-center gap-1.5 text-[13px] font-bold text-accent-ink hover:underline"
            >
              <Plus size={15} /> {isAr ? "ضيف علاج مش في القائمة" : "Add a treatment that is not on the list"}
            </button>
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
            onClick={() => (step === 1 ? setDraft(null) : setStep(prevStep(draft, step)))}
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
                onClick={() => setStep(nextStep(draft, step))}
                disabled={saving}
                className="rounded-xl px-3 py-2.5 text-[13px] font-bold text-ink-faint transition hover:text-ink disabled:opacity-50"
              >
                {isAr ? "عدّي دي" : "Skip this"}
              </button>
            )}
            {step < STEPS ? (
              <button
                type="button"
                onClick={() => setStep(nextStep(draft, step))}
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
                <InsurerBadge name={payer.name} size={36} />
                <div className="min-w-0">
                  <p className="text-[15px] font-bold text-ink">{isAr ? payer.nameAr || payer.name : payer.name}</p>
                  {/* What is actually set, in words. A card that only showed a name would make
                      somebody open the wizard to find out whether they had finished. */}
                  <p className="text-[12px] font-medium text-ink-faint">
                    {payer.format ? (
                      isAr ? "الأسعار من ورقة الموافقة" : "Prices come from the approval paper"
                    ) : priced === 0
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
