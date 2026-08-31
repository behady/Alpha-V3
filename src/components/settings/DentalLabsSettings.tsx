"use client";

import { useEffect, useState } from "react";
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
} from "lucide-react";
import { useUI } from "@/context/UIContext";
import { useLanguage } from "@/context/LanguageContext";
import { getClinicDoc } from "@/lib/db-utils";
import { useSettingsDraft } from "@/lib/settingsDraft";
import {
  LABS_SETTINGS_DOC,
  labPricedCount,
  makeLabId,
  parseDentalLabs,
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
 * assistant is using to raise an order in the next room.
 */
/** The labs screen edits two values that live in one document, so they travel together. */
type LabsDraft = { labs: DentalLab[]; paper: LabOrderPaper };

/** Module-level so the fallback keeps its identity between renders. */
const EMPTY_LABS_DRAFT: LabsDraft = { labs: [], paper: DEFAULT_LAB_PAPER };

export default function DentalLabsSettings() {
  const { showToast, confirm } = useUI();
  const { language } = useLanguage();
  const isAr = language === "ar";

  const [stored, setStored] = useState<LabsDraft | null>(null);
  const [newLabName, setNewLabName] = useState("");
  /** Which labs have their price list expanded. Per lab, so two can be compared side by side. */
  const [openPrices, setOpenPrices] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [fetched, setFetched] = useState(false);

  // The labs and the paper size share one document, so they share one draft: an edit to either is
  // unsaved work, and one Save writes both. See lib/settingsDraft.ts.
  const { value: draft, setValue: setDraft, markSaved } = useSettingsDraft<LabsDraft>(
    "labs",
    stored,
    EMPTY_LABS_DRAFT
  );
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
      showToast(isAr ? "تم الحفظ!" : "Labs saved!", "success");
    } catch {
      showToast(isAr ? "فشل الحفظ" : "Save failed", "error");
    } finally {
      setSaving(false);
    }
  };

  const addLab = () => {
    const name = newLabName.trim();
    if (!name) return;
    if (labs.some((l) => l.name.toLowerCase() === name.toLowerCase())) {
      showToast(isAr ? "المعمل موجود بالفعل" : "Lab already exists", "error");
      return;
    }
    setLabs([...labs, { id: makeLabId(), name, phone: "", whatsapp: "", address: "", driverName: "", notes: "" }]);
    setNewLabName("");
  };

  const updateLab = (id: string, patch: Partial<DentalLab>) => {
    setLabs((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  };

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

  if (!fetched) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-6 h-6 text-slate-400 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-sky-50 flex items-center justify-center shrink-0">
            <FlaskConical size={20} className="text-sky-600" />
          </div>
          <div>
            <h2 className="text-base font-black text-ink tracking-tight">
              {isAr ? "المعامل" : "Dental Labs"}
            </h2>
            <p className="text-xs text-ink-muted font-medium mt-0.5">
              {isAr
                ? "المعامل اللي بتبعتلها شغل. هتظهر عند إنشاء أمر معمل، وميعاد التسليم بيتحسب لوحده من مدة كل معمل."
                : "The labs you send work to. They appear when raising a lab order, and each lab's usual turnaround fills the due date in for you."}
            </p>
          </div>
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-accent text-ink-on-accent text-xs font-black uppercase tracking-wide shadow-md hover:bg-accent-strong disabled:opacity-50 transition-all shrink-0"
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          {isAr ? "حفظ" : "Save"}
        </button>
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
          placeholder={isAr ? "اسم المعمل الجديد… (مثال: معمل النور)" : "New lab name… (e.g. Cairo Dental Lab)"}
          className="flex-1 px-4 py-3 bg-surface border border-line rounded-xl text-sm font-bold text-slate-700 placeholder:text-slate-400 focus:outline-none focus:border-sky-500 focus:ring-4 focus:ring-sky-500/10 transition-all min-w-0"
        />
        <button
          onClick={addLab}
          disabled={!newLabName.trim()}
          className="px-4 py-3 bg-sky-50 text-sky-700 rounded-xl hover:bg-sky-100 disabled:opacity-50 transition-colors shrink-0"
        >
          <Plus size={20} />
        </button>
      </div>

      {labs.length === 0 && (
        <div className="p-8 text-center text-slate-400 text-sm font-medium bg-surface border border-dashed border-line rounded-2xl">
          {isAr
            ? "مفيش معامل لسه. ضيف معمل واحد على الأقل عشان تقدر تعمل أمر معمل."
            : "No labs yet. Add at least one before raising a lab order."}
        </div>
      )}

      {labs.map((lab) => (
        <div key={lab.id} className="bg-surface border border-line rounded-2xl shadow-sm overflow-hidden">
          <div className="p-4 sm:p-5 space-y-3">
            <div className="flex items-center gap-2">
              <FlaskConical size={16} className="text-sky-600 shrink-0" />
              <input
                type="text"
                value={lab.name}
                onChange={(e) => updateLab(lab.id, { name: e.target.value })}
                className="flex-1 min-w-0 px-3 py-2 bg-surface-subtle border border-line rounded-xl text-sm font-black text-slate-800 focus:outline-none focus:border-sky-500 transition-all"
              />
              <button
                onClick={() => void removeLab(lab.id)}
                className="p-2 text-slate-400 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-colors shrink-0"
                aria-label={isAr ? "حذف المعمل" : "Delete lab"}
              >
                <Trash2 size={16} />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="relative">
                <Phone size={14} className="absolute start-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="tel"
                  dir="ltr"
                  value={lab.phone || ""}
                  onChange={(e) => updateLab(lab.id, { phone: e.target.value })}
                  placeholder={isAr ? "التليفون" : "Phone"}
                  className="w-full ps-9 pe-3 py-2 bg-slate-50/60 border border-line rounded-xl text-xs font-bold text-ink-body placeholder:text-slate-400 focus:outline-none focus:border-sky-500 transition-all"
                />
              </div>
              <div className="relative">
                <MessageCircle size={14} className="absolute start-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="tel"
                  dir="ltr"
                  value={lab.whatsapp || ""}
                  onChange={(e) => updateLab(lab.id, { whatsapp: e.target.value })}
                  placeholder={isAr ? "واتساب (لو مختلف)" : "WhatsApp (if different)"}
                  className="w-full ps-9 pe-3 py-2 bg-slate-50/60 border border-line rounded-xl text-xs font-bold text-ink-body placeholder:text-slate-400 focus:outline-none focus:border-sky-500 transition-all"
                />
              </div>
              <div className="relative">
                <Truck size={14} className="absolute start-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={lab.driverName || ""}
                  onChange={(e) => updateLab(lab.id, { driverName: e.target.value })}
                  placeholder={isAr ? "اسم المندوب (اختياري)" : "Driver's name (optional)"}
                  className="w-full ps-9 pe-3 py-2 bg-slate-50/60 border border-line rounded-xl text-xs font-bold text-ink-body placeholder:text-slate-400 focus:outline-none focus:border-sky-500 transition-all"
                />
              </div>
              <div className="relative">
                <CalendarClock size={14} className="absolute start-3 top-1/2 -translate-y-1/2 text-slate-400" />
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
                  placeholder={isAr ? "مدة التسليم بالأيام" : "Usual turnaround (days)"}
                  className="w-full ps-9 pe-3 py-2 bg-slate-50/60 border border-line rounded-xl text-xs font-bold text-ink-body placeholder:text-slate-400 focus:outline-none focus:border-sky-500 transition-all"
                />
              </div>
              <div className="relative sm:col-span-2">
                <MapPin size={14} className="absolute start-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={lab.address || ""}
                  onChange={(e) => updateLab(lab.id, { address: e.target.value })}
                  placeholder={isAr ? "العنوان (اختياري)" : "Address (optional)"}
                  className="w-full ps-9 pe-3 py-2 bg-slate-50/60 border border-line rounded-xl text-xs font-bold text-ink-body placeholder:text-slate-400 focus:outline-none focus:border-sky-500 transition-all"
                />
              </div>
            </div>

            {/* Price list.
                Collapsed by default: twelve work types is a long list, and most labs are priced
                for three or four of them. The summary line carries the only number that matters
                when it is shut. */}
            <div className="border border-line rounded-xl overflow-hidden">
              <button
                type="button"
                onClick={() => setOpenPrices((prev) => ({ ...prev, [lab.id]: !prev[lab.id] }))}
                className="w-full flex items-center justify-between gap-3 px-3 py-2.5 bg-slate-50/60 hover:bg-slate-100/60 transition-colors"
              >
                <span className="flex items-center gap-2 min-w-0">
                  <Coins size={14} className="text-slate-400 shrink-0" />
                  <span className="text-[11px] font-black uppercase tracking-wider text-ink-body">
                    {isAr ? "أسعار المعمل" : "Price list"}
                  </span>
                  <span className="text-[11px] font-bold text-slate-400 truncate">
                    {labPricedCount(lab) === 0
                      ? isAr ? "مفيش أسعار" : "nothing priced yet"
                      : isAr
                        ? `${labPricedCount(lab)} نوع شغل`
                        : `${labPricedCount(lab)} of ${LAB_WORK_TYPES.length} priced`}
                  </span>
                </span>
                <ChevronDown
                  size={16}
                  className={`text-slate-400 shrink-0 transition-transform ${openPrices[lab.id] ? "rotate-180" : ""}`}
                />
              </button>

              {openPrices[lab.id] && (
                <div className="p-3 space-y-1.5 bg-surface border-t border-line">
                  <p className="text-[11px] font-semibold text-ink-muted leading-relaxed mb-2">
                    {isAr
                      ? "سيب الخانة فاضية لو المعمل ده مبيعملش النوع ده، أو لسه مفيش سعر متفق عليه. السعر بيتحط لوحده في أمر المعمل، وتقدر تغيّره في أي أمر."
                      : "Leave a box empty for work this lab does not do, or has no agreed price for. The price fills itself in when an order is raised, and can still be changed on any order."}
                  </p>
                  {LAB_WORK_TYPES.map((w) => (
                    <div key={w.id} className="flex items-center gap-2">
                      <span className="flex-1 min-w-0 text-xs font-bold text-ink-body truncate">
                        {isAr ? w.ar : w.en}
                      </span>
                      <div className="relative shrink-0">
                        <input
                          type="number"
                          min={0}
                          step="any"
                          dir="ltr"
                          value={lab.prices?.[w.id] ?? ""}
                          onChange={(e) =>
                            updateLab(lab.id, {
                              prices: {
                                ...(lab.prices || {}),
                                // Cleared removes the entry rather than storing 0 — zero would
                                // fill an order in as free, which is a real answer for a remake
                                // and the wrong one for "we never agreed a price".
                                ...(e.target.value.trim() === ""
                                  ? { [w.id]: 0 }
                                  : { [w.id]: Number(e.target.value) }),
                              },
                            })
                          }
                          placeholder="—"
                          className="w-28 ps-3 pe-10 py-1.5 bg-slate-50/60 border border-line rounded-lg text-xs font-bold text-slate-700 text-end placeholder:text-slate-300 focus:outline-none focus:border-sky-500 transition-all tabular-nums"
                        />
                        <span className="absolute end-2.5 top-1/2 -translate-y-1/2 text-[10px] font-black text-slate-400 pointer-events-none">
                          EGP
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {!lab.turnaroundDays && (
              <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2 font-semibold leading-relaxed">
                {isAr
                  ? "من غير مدة تسليم، ميعاد الرجوع هيتكتب بالإيد كل مرة — وتنبيهات التأخير مش هتبقى معناها حاجة."
                  : "Without a turnaround, the due date is typed by hand every time — and the overdue warnings stop meaning anything."}
              </p>
            )}
          </div>
        </div>
      ))}

      {/* Paper size.
          Below the labs rather than above them, because it is set once and then never touched
          again — putting it first would make the screen open on the thing nobody came for. */}
      <div className="bg-surface border border-line rounded-2xl shadow-sm p-4 sm:p-5 space-y-3">
        <div className="flex items-center gap-2">
          <Printer size={16} className="text-slate-400 shrink-0" />
          <h3 className="text-sm font-black text-slate-800">
            {isAr ? "مقاس ورق أمر المعمل" : "Lab order paper size"}
          </h3>
        </div>
        <div className="grid grid-cols-1 gap-2">
          {LAB_PAPER_OPTIONS.map((opt) => {
            const active = paper === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => setPaper(opt.id)}
                className={`w-full text-start px-4 py-3 rounded-xl border transition-all ${
                  active
                    ? "bg-sky-50 border-sky-400 ring-4 ring-sky-500/10"
                    : "bg-slate-50/60 border-line hover:bg-surface"
                }`}
              >
                <span className={`block text-sm font-black ${active ? "text-sky-800" : "text-slate-700"}`}>
                  {isAr ? opt.ar : opt.en}
                </span>
                <span className="block text-[11px] font-semibold text-ink-muted mt-0.5 leading-relaxed">
                  {isAr ? opt.hintAr : opt.hintEn}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <p className="text-[11px] text-slate-400 font-medium leading-relaxed">
        {isAr
          ? "ملاحظة: الحالات بتحتفظ باسم المعمل وقت إنشائها، فتغيير الاسم هنا مش بيغير الأوامر القديمة أو الورق اللي اتطبع."
          : "Note: a case keeps the lab's name as it was when the case was raised, so renaming a lab here never rewrites old orders or paper that has already been printed."}
      </p>
    </div>
  );
}
