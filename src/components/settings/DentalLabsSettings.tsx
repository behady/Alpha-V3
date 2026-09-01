"use client";

import { useEffect, useMemo, useState } from "react";
import { getDoc, setDoc } from "firebase/firestore";
import {
  Plus,
  Trash2,
  Save,
  FlaskConical,
  MapPin,
  Phone,
  MessageCircle,
  Truck,
  CalendarClock,
  Printer,
  Coins,
  ChevronDown,
  Loader2,
  RotateCcw,
} from "lucide-react";
import { useUI } from "@/context/UIContext";
import { useLanguage } from "@/context/LanguageContext";
import { useSettingsText } from "@/lib/useSettingsText";
import { countedNoun } from "@/lib/arabicCount";
import { getClinicDoc } from "@/lib/db-utils";
import { useSettingsDraft } from "@/lib/settingsDraft";
import {
  LABS_SETTINGS_DOC,
  labPricedCount,
  makeLabId,
  parseDentalLabs,
  setLabPrice,
  parseLabPaper,
  serializeDentalLabs,
  type DentalLab,
} from "@/lib/dentalLabs";
import {
  DEFAULT_LAB_PAPER,
  LAB_PAPER_OPTIONS,
  LAB_WORK_TYPES,
  type LabOrderPaper,
} from "@/lib/labCases";

/**
 * The dental labs this clinic sends work to.
 *
 * Same buffered-edit model as Branches & Rooms, and for the same reason: the whole list is saved
 * on demand rather than per keystroke, so a half-typed lab name never appears in the picker an
 * assistant is using to raise an order in the next room. As there, Save now arrives in a bar when
 * there is something to save instead of sitting in the header looking the same either way.
 */
/** The labs screen edits two values that live in one document, so they travel together. */
type LabsDraft = { labs: DentalLab[]; paper: LabOrderPaper };

/** Module-level so the fallback keeps its identity between renders. */
const EMPTY_LABS_DRAFT: LabsDraft = { labs: [], paper: DEFAULT_LAB_PAPER };

const INPUT =
  "border border-line bg-surface-subtle text-ink outline-none transition-all " +
  "placeholder:text-ink-muted focus:border-accent focus:bg-surface focus:ring-4 focus:ring-accent/10";

export default function DentalLabsSettings() {
  const { showToast, confirm } = useUI();
  const { language, isRTL } = useLanguage();
  const isAr = language === "ar";
  const txt = useSettingsText("labs");

  const [stored, setStored] = useState<LabsDraft | null>(null);
  const [newLabName, setNewLabName] = useState("");
  /** Which labs have their price list expanded. Per lab, so two can be compared side by side. */
  const [openPrices, setOpenPrices] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [fetched, setFetched] = useState(false);
  /**
   * The clinic's own currency, not a hardcoded EGP.
   *
   * Every other price in the product is labelled from `settings/clinic_info`; this screen printed
   * EGP beside each lab price whatever the clinic actually charges in, which is wrong the moment
   * anyone outside Egypt uses it.
   */
  const [currency, setCurrency] = useState("EGP");

  // The labs and the paper size share one document, so they share one draft: an edit to either is
  // unsaved work, and one Save writes both. See lib/settingsDraft.ts.
  const {
    value: draft,
    setValue: setDraft,
    isDirty,
    discard,
    markSaved,
  } = useSettingsDraft<LabsDraft>("labs", stored, EMPTY_LABS_DRAFT);
  const { labs, paper } = draft;
  const setLabs = (next: DentalLab[] | ((current: DentalLab[]) => DentalLab[])) =>
    setDraft((current) => ({
      ...current,
      labs: typeof next === "function" ? next(current.labs) : next,
    }));
  const setPaper = (next: LabOrderPaper) => setDraft((current) => ({ ...current, paper: next }));

  useEffect(() => {
    getDoc(getClinicDoc("settings", LABS_SETTINGS_DOC))
      .then((snap) => {
        const data = snap.exists() ? snap.data() : null;
        setStored({ labs: parseDentalLabs(data), paper: parseLabPaper(data) });
      })
      .catch(() => {
        // An empty screen an admin can start typing into beats a spinner that never stops.
        // Without this the read's rejection left `fetched` false forever.
      })
      .finally(() => setFetched(true));
  }, []);

  useEffect(() => {
    void getDoc(getClinicDoc("settings", "clinic_info"))
      .then((snap) => {
        const value = snap.exists() ? (snap.data() as Record<string, unknown>).currency : null;
        if (typeof value === "string" && value.trim()) setCurrency(value.trim());
      })
      .catch(() => {
        // The default stands. A missing currency is not worth blocking the labs screen over.
      });
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      await setDoc(
        getClinicDoc("settings", LABS_SETTINGS_DOC),
        // serializeDentalLabs, not the raw state: clearing the turnaround box sets the field to
        // undefined, and Firestore rejects a write containing one — which would have made this
        // screen unsavable from then on, with an error that reads like a permissions problem.
        { labs: serializeDentalLabs(labs), paper, updatedAt: new Date().toISOString() },
        { merge: true }
      );
      setStored({ labs, paper });
      markSaved();
      showToast(txt.saved, "success");
    } catch {
      showToast(txt.failed, "error");
    } finally {
      setSaving(false);
    }
  };

  const addLab = () => {
    const name = newLabName.trim();
    if (!name) return;
    if (labs.some((l) => l.name.toLowerCase() === name.toLowerCase())) {
      showToast(txt.labExists, "error");
      return;
    }
    setLabs([...labs, { id: makeLabId(), name, phone: "", whatsapp: "", address: "", driverName: "", notes: "" }]);
    setNewLabName("");
  };

  const updateLab = (id: string, patch: Partial<DentalLab>) => {
    setLabs((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  };

  const setPrice = (lab: DentalLab, workId: string, raw: string) =>
    updateLab(lab.id, { prices: setLabPrice(lab.prices, workId, raw) });

  const removeLab = async (id: string) => {
    const lab = labs.find((l) => l.id === id);
    if (!lab) return;
    const ok = await confirm(
      isAr
        ? `حذف معمل "${lab.name}"؟ الحالات القديمة المسجلة عليه هتفضل موجودة باسمه.`
        : `Delete lab "${lab.name}"? Cases already sent to it keep its name and stay on the board.`
    );
    if (ok) setLabs((prev) => prev.filter((l) => l.id !== id));
  };

  const noTurnaround = useMemo(() => labs.filter((l) => !l.turnaroundDays).length, [labs]);
  const paperLabel = LAB_PAPER_OPTIONS.find((o) => o.id === paper);

  if (!fetched) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-ink-muted" />
      </div>
    );
  }

  const facts = [
    countedNoun(labs.length, isAr, {
      one: txt.labOne, two: txt.labTwo, few: txt.labFew, many: txt.labMany,
    }),
    paperLabel ? (isAr ? paperLabel.ar : paperLabel.en) : null,
  ].filter(Boolean).join(" · ");

  return (
    <div className="mx-auto w-full max-w-3xl space-y-8 pb-4" dir={isRTL ? "rtl" : "ltr"}>
      {/* What a lab entry buys you, and the one thing about it that surprises people — a case
          keeps the name it was raised under. That note used to be the last line on the page. */}
      <div className="rounded-[1.75rem] bg-ink-slab px-6 py-6 text-white shadow-lg shadow-ink-slab/15 sm:px-8">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 space-y-2">
            <p className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.22em] text-white/45">
              <FlaskConical size={12} />
              {txt.title}
            </p>
            <p className="max-w-xl text-[15px] font-bold leading-relaxed text-white sm:text-base">
              {txt.railNote}
            </p>
            <p className="max-w-xl text-[11px] font-semibold leading-relaxed text-white/45">
              {txt.nameIsKept}
            </p>
            {labs.length > 0 && (
              <p className="font-figure text-[13px] tracking-tight text-white/70">{facts}</p>
            )}
          </div>

          {noTurnaround > 0 && (
            <span className="inline-flex shrink-0 items-center gap-2 self-start rounded-full bg-amber-400/20 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.14em] text-amber-200">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
              {noTurnaround} {txt.withoutTurnaround}
            </span>
          )}
        </div>
      </div>

      {/* Add lab */}
      <div className="flex gap-2">
        <input
          type="text"
          value={newLabName}
          onChange={(e) => setNewLabName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addLab();
            }
          }}
          placeholder={txt.newLab}
          className={`min-w-0 flex-1 rounded-xl px-4 py-3 text-sm font-bold ${INPUT}`}
        />
        <button
          type="button"
          onClick={addLab}
          disabled={!newLabName.trim()}
          aria-label={txt.addLab}
          className="shrink-0 rounded-xl bg-accent px-4 py-3 text-ink-on-accent transition-colors hover:bg-accent-strong disabled:opacity-50"
        >
          <Plus size={20} />
        </button>
      </div>

      {labs.length === 0 && (
        <div className="rounded-2xl border border-dashed border-line bg-surface-subtle p-8 text-center text-sm font-medium text-ink-muted">
          {txt.empty}
        </div>
      )}

      {labs.map((lab) => (
        <div key={lab.id} className="overflow-hidden rounded-2xl border border-line bg-surface shadow-sm">
          <div className="space-y-3 p-4 sm:p-5">
            <div className="flex items-center gap-2">
              <FlaskConical size={16} className="shrink-0 text-ink-muted" />
              <input
                type="text"
                value={lab.name}
                onChange={(e) => updateLab(lab.id, { name: e.target.value })}
                className={`min-w-0 flex-1 rounded-xl px-3 py-2 text-sm font-black ${INPUT}`}
              />
              <button
                type="button"
                onClick={() => void removeLab(lab.id)}
                className="shrink-0 rounded-lg p-2 text-ink-muted transition-colors hover:bg-danger-tint hover:text-danger"
                aria-label={txt.deleteLab}
              >
                <Trash2 size={16} />
              </button>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="relative">
                <Phone size={14} className="absolute start-3 top-1/2 -translate-y-1/2 text-ink-muted" />
                <input
                  type="tel"
                  dir="ltr"
                  value={lab.phone || ""}
                  onChange={(e) => updateLab(lab.id, { phone: e.target.value })}
                  placeholder={txt.phone}
                  className={`w-full rounded-xl py-2 pe-3 ps-9 text-xs font-bold ${INPUT}`}
                />
              </div>
              <div className="relative">
                <MessageCircle size={14} className="absolute start-3 top-1/2 -translate-y-1/2 text-ink-muted" />
                <input
                  type="tel"
                  dir="ltr"
                  value={lab.whatsapp || ""}
                  onChange={(e) => updateLab(lab.id, { whatsapp: e.target.value })}
                  placeholder={txt.whatsapp}
                  className={`w-full rounded-xl py-2 pe-3 ps-9 text-xs font-bold ${INPUT}`}
                />
              </div>
              <div className="relative">
                <Truck size={14} className="absolute start-3 top-1/2 -translate-y-1/2 text-ink-muted" />
                <input
                  type="text"
                  value={lab.driverName || ""}
                  onChange={(e) => updateLab(lab.id, { driverName: e.target.value })}
                  placeholder={txt.driver}
                  className={`w-full rounded-xl py-2 pe-3 ps-9 text-xs font-bold ${INPUT}`}
                />
              </div>
              <div className="relative">
                <CalendarClock size={14} className="absolute start-3 top-1/2 -translate-y-1/2 text-ink-muted" />
                <input
                  type="number"
                  min={1}
                  max={90}
                  dir="ltr"
                  value={lab.turnaroundDays ?? ""}
                  onChange={(e) =>
                    updateLab(lab.id, {
                      // Cleared reads as "no usual turnaround" rather than zero days, which would
                      // make every case from this lab due the moment it was raised.
                      turnaroundDays: e.target.value === "" ? undefined : Number(e.target.value),
                    })
                  }
                  placeholder={txt.turnaround}
                  className={`w-full rounded-xl py-2 pe-3 ps-9 text-xs font-bold ${INPUT}`}
                />
              </div>
              <div className="relative sm:col-span-2">
                <MapPin size={14} className="absolute start-3 top-1/2 -translate-y-1/2 text-ink-muted" />
                <input
                  type="text"
                  value={lab.address || ""}
                  onChange={(e) => updateLab(lab.id, { address: e.target.value })}
                  placeholder={txt.address}
                  className={`w-full rounded-xl py-2 pe-3 ps-9 text-xs font-bold ${INPUT}`}
                />
              </div>
            </div>

            {/* Price list.
                Collapsed by default: twelve work types is a long list, and most labs are priced
                for three or four of them. The summary line carries the only number that matters
                when it is shut. */}
            <div className="overflow-hidden rounded-xl border border-line">
              <button
                type="button"
                onClick={() => setOpenPrices((prev) => ({ ...prev, [lab.id]: !prev[lab.id] }))}
                aria-expanded={!!openPrices[lab.id]}
                className="flex w-full items-center justify-between gap-3 bg-surface-subtle px-3 py-2.5 transition-colors hover:bg-surface-muted"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <Coins size={14} className="shrink-0 text-ink-muted" />
                  <span className="text-[11px] font-black uppercase tracking-wider text-ink-body">
                    {txt.priceList}
                  </span>
                  <span className="truncate text-[11px] font-bold text-ink-muted">
                    {labPricedCount(lab) === 0
                      ? txt.nothingPriced
                      : `${labPricedCount(lab)} / ${LAB_WORK_TYPES.length}`}
                  </span>
                </span>
                <ChevronDown
                  size={16}
                  className={`shrink-0 text-ink-muted transition-transform ${openPrices[lab.id] ? "rotate-180" : ""}`}
                />
              </button>

              {openPrices[lab.id] && (
                <div className="space-y-1.5 border-t border-line bg-surface p-3">
                  <p className="mb-2 text-[11px] font-semibold leading-relaxed text-ink-muted">
                    {txt.priceHint}
                  </p>
                  {LAB_WORK_TYPES.map((w) => (
                    <div key={w.id} className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-xs font-bold text-ink-body">
                        {isAr ? w.ar : w.en}
                      </span>
                      <div className="relative shrink-0">
                        <input
                          type="number"
                          min={0}
                          step="any"
                          dir="ltr"
                          value={lab.prices?.[w.id] ?? ""}
                          onChange={(e) => setPrice(lab, w.id, e.target.value)}
                          placeholder="—"
                          className={`w-28 rounded-lg py-1.5 pe-12 ps-3 text-end text-xs font-bold tabular-nums ${INPUT}`}
                        />
                        <span className="pointer-events-none absolute end-2.5 top-1/2 -translate-y-1/2 text-[10px] font-black text-ink-muted">
                          {currency}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {!lab.turnaroundDays && (
              <p className="rounded-xl border border-warn/25 bg-warn-tint px-3 py-2 text-[11px] font-semibold leading-relaxed text-warn">
                {txt.noTurnaroundHint}
              </p>
            )}
          </div>
        </div>
      ))}

      {/* Paper size.
          Below the labs rather than above them, because it is set once and then never touched
          again — putting it first would make the screen open on the thing nobody came for. */}
      <section>
        <h3 className="mb-3 flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.18em] text-ink-muted">
          <Printer size={13} /> {txt.paperSize}
        </h3>
        <div className="grid grid-cols-1 gap-2">
          {LAB_PAPER_OPTIONS.map((opt) => {
            const active = paper === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => setPaper(opt.id)}
                aria-pressed={active}
                className={`w-full rounded-xl border px-4 py-3 text-start transition-all ${
                  active
                    ? "border-accent bg-accent-tint ring-4 ring-accent/10"
                    : "border-line bg-surface-subtle hover:bg-surface"
                }`}
              >
                <span className={`block text-sm font-black ${active ? "text-accent" : "text-ink-body"}`}>
                  {isAr ? opt.ar : opt.en}
                </span>
                <span className="mt-0.5 block text-[11px] font-semibold leading-relaxed text-ink-muted">
                  {isAr ? opt.hintAr : opt.hintEn}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {isDirty && (
        <div className="sticky bottom-4 z-20 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-ink-slab px-4 py-3 shadow-2xl">
          <span className="text-xs font-bold text-white/70">{txt.unsaved}</span>
          <span className="flex items-center gap-2">
            <button
              type="button"
              onClick={discard}
              disabled={saving}
              className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold text-white/60 transition hover:text-white disabled:opacity-50"
            >
              <RotateCcw size={14} /> {txt.discard}
            </button>
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-xl bg-accent px-5 py-2.5 text-sm font-bold text-ink-on-accent transition hover:bg-accent-strong disabled:opacity-50"
            >
              {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
              {txt.save}
            </button>
          </span>
        </div>
      )}
    </div>
  );
}
