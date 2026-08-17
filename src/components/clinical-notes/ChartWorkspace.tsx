"use client";

import { useMemo } from "react";
import { Eraser, Hand, Loader2, Pencil, X } from "lucide-react";
import TeethChart from "@/components/TeethChart";
import { useLanguage } from "@/context/LanguageContext";
import { normalizeToothData, type ToothData } from "@/lib/diagnosisCatalog";
import ServiceEditorDrawer from "./ServiceEditorDrawer";
import { Note, Service, Staff } from "./types";
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

  const selectedNumbers = useMemo(
    () => selectedTeeth.map((t) => parseInt(t, 10)).filter((n) => !Number.isNaN(n)),
    [selectedTeeth]
  );

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
    hint: isAr
      ? "اضغط على الأسنان في المخطط، وبعدين املأ بيانات الإجراء تحت. الألوان هي التشخيص المسجل قبل كده."
      : "Click the teeth you treated, then fill in the procedure below. The colours are the diagnoses already on file.",
    none: isAr ? "لم يتم اختيار أي سن — الإجراء هيتسجل كإجراء عام" : "No tooth selected — this will be logged as a general procedure",
    clear: isAr ? "مسح الاختيار" : "Clear selection",
    selected: isAr ? "المحدد" : "Selected",
    editing: isAr ? "بتعدّل إجراء مسجل" : "Editing a saved procedure",
    cancelEdit: isAr ? "إلغاء التعديل" : "Cancel edit",
    newEntry: isAr ? "تسجيل إجراء جديد" : "Log a new procedure",
  };

  return (
    <div className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden">
      {/* --- Chart header --- */}
      <div className="flex flex-wrap items-start justify-between gap-4 p-5 md:p-6 border-b border-slate-100">
        <div className="min-w-0">
          <h3 className="text-base font-black text-slate-900 flex items-center gap-2">
            <Hand size={18} className="text-blue-600" />
            {txt.title}
          </h3>
          <p className="text-xs font-medium text-slate-500 mt-1 max-w-2xl">{txt.hint}</p>
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
            selectionMode
            selectedTeeth={selectedNumbers}
            onToggleTooth={toggleTooth}
            onSelectArch={handleSelectArch}
          />
        )}
      </div>

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
