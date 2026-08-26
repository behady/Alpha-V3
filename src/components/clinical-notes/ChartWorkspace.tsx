"use client";

import { useMemo } from "react";
import { Eraser, Hand, Loader2, Pencil, X } from "lucide-react";
import TeethChart from "@/components/TeethChart";
import { useLanguage } from "@/context/LanguageContext";
import { getCategoryForStatus, normalizeToothData, type ToothData } from "@/lib/diagnosisCatalog";
import ServiceEditorDrawer from "./ServiceEditorDrawer";
import { Note, Service, Staff } from "./types";
import { TREATMENT_STATES, resolveTreatments, type ToothTreatment, type TreatmentStateId } from "@/lib/toothTreatments";
import { LOWER_LEFT_TEETH, LOWER_RIGHT_TEETH, UPPER_LEFT_TEETH, UPPER_RIGHT_TEETH } from "./utils";

/**
 * The desktop way of recording work: the chart is the input, not a field buried in a pop-up.
 * You click the teeth you treated at the top, then fill the procedure in underneath — the same
 * order the work actually happens in. The pop-up editor is still what mobile uses, where a chart
 * this size cannot sit above a form.
 */
export default function ChartWorkspace({
  patientId,
  patientName,
  teethData,
  treatments,
  servicesList,
  doctors,
  editingNote,
  appointmentId,
  selectedTeeth,
  onSelectedTeethChange,
  onCancelEdit,
  onSaved,
  formKey,
  loading = false,
}: {
  patientId: string;
  patientName: string;
  teethData: Record<string, ToothData>;
  /** What has been done to each tooth, derived from the notes. See lib/toothTreatments. */
  treatments: Record<string, ToothTreatment[]>;
  servicesList: Service[];
  doctors: Staff[];
  editingNote: Note | null;
  appointmentId: string | null;
  selectedTeeth: string[];
  onSelectedTeethChange: (teeth: string[]) => void;
  onCancelEdit: () => void;
  onSaved: () => void;
  /** Changes whenever the form should start over — remounting is what clears it. */
  formKey: string;
  loading?: boolean;
}) {
  const { language } = useLanguage();
  const isAr = language === "ar";

  const chartData = useMemo(() => {
    const out: Record<string, ToothData> = {};
    Object.keys(teethData || {}).forEach((k) => {
      out[k] = normalizeToothData((teethData as any)[k]);
    });
    return out;
  }, [teethData]);

  /**
   * Only the treatments this patient has actually had, with the teeth they are on.
   *
   * Same rule as the diagnosis key beneath it: a legend should describe what is on the screen. A
   * fixed list of all eight states would explain seven marks that are nowhere in this mouth, and a
   * key that is mostly irrelevant is a key nobody reads twice.
   */
  const presentTreatments = useMemo(() => {
    const seen = new Map<TreatmentStateId, { color: string; label: string; teeth: string[] }>();
    Object.entries(treatments || {}).forEach(([toothId, entries]) => {
      // Both winners, not just the dominant one — otherwise a tooth that was root-filled and then
      // crowned lists only the crown, and the endo is missing from the chart AND the key.
      const { form, mark } = resolveTreatments(entries);
      [form, mark].forEach((done) => {
        if (!done) return;
        const state = TREATMENT_STATES[done.state];
        const entry = seen.get(done.state) || {
          color: state.color,
          label: isAr ? state.labelAr : state.labelEn,
          teeth: [] as string[],
        };
        if (!entry.teeth.includes(toothId)) entry.teeth.push(toothId);
        seen.set(done.state, entry);
      });
    });
    return Array.from(seen.values()).map((e) => ({
      ...e,
      teeth: e.teeth.sort((a, b) => Number(a) - Number(b)),
    }));
  }, [treatments, isAr]);

  const selectedNumbers = useMemo(
    () => selectedTeeth.map((t) => parseInt(t, 10)).filter((n) => !Number.isNaN(n)),
    [selectedTeeth]
  );

  /**
   * Only the diagnosis colours this patient actually has on the chart.
   *
   * The chart's built-in legend lists all eleven categories, which is right on the diagnosis page
   * where you are choosing between them — but here it explained ten colours that were nowhere on
   * screen for any patient without a charted diagnosis. A key should describe what you can see.
   */
  const presentCategories = useMemo(() => {
    const seen = new Map<string, { color: string; label: string; teeth: string[] }>();
    Object.entries(chartData).forEach(([toothId, data]) => {
      (data.statuses || []).forEach((statusId) => {
        if (statusId === "healthy") return;
        const cat = getCategoryForStatus(statusId);
        if (!cat) return;
        const entry = seen.get(cat.id) || {
          color: cat.color,
          label: isAr ? cat.labelAr : cat.labelEn,
          teeth: [] as string[],
        };
        if (!entry.teeth.includes(toothId)) entry.teeth.push(toothId);
        seen.set(cat.id, entry);
      });
    });
    return Array.from(seen.values()).map((e) => ({
      ...e,
      teeth: e.teeth.sort((a, b) => Number(a) - Number(b)),
    }));
  }, [chartData, isAr]);

  const toggleTooth = (id: number) => {
    const value = String(id);
    onSelectedTeethChange(
      selectedTeeth.includes(value) ? selectedTeeth.filter((t) => t !== value) : [...selectedTeeth, value]
    );
  };

  const handleSelectArch = (arch: "upper" | "lower") => {
    const archTeeth =
      arch === "upper"
        ? [...UPPER_RIGHT_TEETH, ...UPPER_LEFT_TEETH]
        : [...LOWER_RIGHT_TEETH, ...LOWER_LEFT_TEETH];
    const allSelected = archTeeth.every((t) => selectedTeeth.includes(t));
    onSelectedTeethChange(
      allSelected
        ? selectedTeeth.filter((t) => !archTeeth.includes(t))
        : Array.from(new Set([...selectedTeeth, ...archTeeth]))
    );
  };

  const txt = {
    title: isAr ? "الأسنان التي تم العمل عليها" : "Teeth worked on",
    // Two versions on purpose: promising colours to someone whose chart is blank reads as a bug.
    hint: isAr
      ? "اضغط على الأسنان في المخطط، وبعدين املأ بيانات الإجراء تحت. الألوان هي التشخيص المسجل قبل كده."
      : "Click the teeth you treated, then fill in the procedure below. The colours are the diagnoses already on file.",
    hintNoDiagnoses: isAr
      ? "اضغط على الأسنان في المخطط، وبعدين املأ بيانات الإجراء تحت. مفيش تشخيص متسجل للمريض ده لسه — سجّله من صفحة التشخيص."
      : "Click the teeth you treated, then fill in the procedure below. Nothing has been charted for this patient yet — record diagnoses on the Diagnosis page.",
    none: isAr ? "لم يتم اختيار أي سن — الإجراء هيتسجل كإجراء عام" : "No tooth selected — this will be logged as a general procedure",
    clear: isAr ? "مسح الاختيار" : "Clear selection",
    selected: isAr ? "المحدد" : "Selected",
    editing: isAr ? "بتعدّل إجراء مسجل" : "Editing a saved procedure",
    cancelEdit: isAr ? "إلغاء التعديل" : "Cancel edit",
    newEntry: isAr ? "تسجيل إجراء جديد" : "Log a new procedure",
    onFile: isAr ? "التشخيصات المسجلة على المخطط" : "Diagnoses already charted",
    workDone: isAr ? "العلاج اللي اتعمل" : "Work done here",
  };

  return (
    // No `overflow-hidden`: the procedure combobox drops its list with `absolute`, not a portal,
    // so clipping this card to its rounded corners would cut the search results off mid-list.
    <div className="bg-white rounded-3xl border border-slate-100 shadow-sm">
      {/* --- Chart header --- */}
      <div className="flex flex-wrap items-start justify-between gap-4 p-5 md:p-6 border-b border-slate-100">
        <div className="min-w-0">
          <h3 className="text-base font-black text-slate-900 flex items-center gap-2">
            <Hand size={18} className="text-blue-600" />
            {txt.title}
          </h3>
          <p className="text-xs font-medium text-slate-500 mt-1 max-w-2xl">
            {presentCategories.length > 0 ? txt.hint : txt.hintNoDiagnoses}
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {editingNote && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-amber-50 border border-amber-200 text-amber-700 text-[11px] font-black">
              <Pencil size={12} />
              {txt.editing}
            </span>
          )}
          {selectedTeeth.length > 0 && (
            <button
              type="button"
              onClick={() => onSelectedTeethChange([])}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-600 text-[11px] font-bold transition-colors"
            >
              <Eraser size={12} />
              {txt.clear}
            </button>
          )}
        </div>
      </div>

      {/* --- The chart itself --- */}
      <div className="px-2 md:px-4 pt-4">
        {loading ? (
          <div className="flex justify-center items-center py-16 text-blue-500">
            <Loader2 className="animate-spin" size={32} />
          </div>
        ) : (
          <TeethChart
            data={chartData}
            treatments={treatments}
            selectionMode
            compactMode
            wide
            selectedTeeth={selectedNumbers}
            onToggleTooth={toggleTooth}
            onSelectArch={handleSelectArch}
          />
        )}
      </div>

      {/* --- What this clinic has actually DONE, which the chart could never show before --- */}
      {presentTreatments.length > 0 && (
        <div className="px-5 md:px-6 pb-1 pt-3">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">
            {txt.workDone}
          </p>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            {presentTreatments.map((t) => (
              <span key={t.label} className="inline-flex items-center gap-1.5 text-[11px] font-bold text-slate-600">
                <span className="w-2.5 h-2.5 rounded-sm shrink-0 border border-white shadow-sm" style={{ backgroundColor: t.color }} />
                {t.label}
                <span className="text-slate-400 font-semibold tabular-nums">
                  {isAr ? "أسنان" : "teeth"} {t.teeth.join(", ")}
                </span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* --- What is already diagnosed on this patient, and nothing else --- */}
      {presentCategories.length > 0 && (
        <div className="px-5 md:px-6 pb-4 pt-3">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">
            {txt.onFile}
          </p>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            {presentCategories.map((cat) => (
              <span key={cat.label} className="inline-flex items-center gap-1.5 text-[11px] font-bold text-slate-600">
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: cat.color }} />
                {cat.label}
                <span className="text-slate-400 font-semibold tabular-nums">
                  {isAr ? "أسنان" : "teeth"} {cat.teeth.join(", ")}
                </span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* --- What is currently selected --- */}
      <div className="px-5 md:px-6 py-4 border-t border-slate-100 bg-slate-50/60">
        {selectedTeeth.length === 0 ? (
          <p className="text-xs font-bold text-slate-400 italic">{txt.none}</p>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-black text-slate-500 uppercase tracking-widest">
              {txt.selected} ({selectedTeeth.length})
            </span>
            {selectedTeeth.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => onSelectedTeethChange(selectedTeeth.filter((x) => x !== t))}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-blue-600 text-white text-[11px] font-black tabular-nums hover:bg-blue-700 transition-colors"
                title={isAr ? "إزالة" : "Remove"}
              >
                {t}
                <X size={11} />
              </button>
            ))}
          </div>
        )}
      </div>

      {/* --- The form, inline. No pop-up on desktop. --- */}
      <div className="p-5 md:p-6 border-t border-slate-100">
        <div className="flex items-center justify-between gap-3 mb-1">
          <h4 className="text-sm font-black text-slate-800">
            {editingNote ? txt.editing : txt.newEntry}
          </h4>
          {editingNote && (
            <button
              type="button"
              onClick={onCancelEdit}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 text-[11px] font-bold transition-colors"
            >
              <X size={12} />
              {txt.cancelEdit}
            </button>
          )}
        </div>

        <ServiceEditorDrawer
          // Remounting on note change is what reloads the form fields: the editor seeds its state
          // from `initialNote` only while `isOpen` flips, which never happens in an always-open
          // inline form.
          key={formKey}
          isOpen
          inline
          compact
          hideTeethSelector
          selectedTeethOverride={selectedTeeth}
          onSelectedTeethChange={onSelectedTeethChange}
          onClose={onCancelEdit}
          patientId={patientId}
          patientName={patientName}
          appointmentId={appointmentId}
          initialNote={editingNote}
          servicesList={servicesList}
          doctors={doctors}
          onSaved={onSaved}
        />
      </div>
    </div>
  );
}
