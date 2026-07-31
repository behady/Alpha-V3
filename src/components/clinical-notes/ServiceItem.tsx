import { Edit2, ArrowRightLeft, Copy, Trash2, RefreshCcw } from "lucide-react";
import { Note } from "./types";
import { useLanguage } from "@/context/LanguageContext";
import Protect from "@/components/Protect";

interface Props {
  note: Note;
  onEdit: (note: Note) => void;
  onDelete: (note: Note) => void;
  onMove: (note: Note) => void;
  onContinue: (note: Note) => void;
}

export default function ServiceItem({ note, onEdit, onDelete, onMove, onContinue }: Props) {
  const { language } = useLanguage();

  const txt = {
    edit: language === "ar" ? "تعديل" : "Edit",
    move: language === "ar" ? "نقل إلى موعد آخر" : "Move to another appointment",
    continue: language === "ar" ? "استكمال في موعد آخر" : "Continue in another appointment",
    delete: language === "ar" ? "حذف" : "Delete",
  };

  const getStatusColor = (status: string | undefined) => {
    switch (status) {
      case "Completed":
        return "bg-emerald-100 text-emerald-700";
      case "Ongoing":
        return "bg-amber-100 text-amber-700";
      default:
        return "bg-slate-100 text-slate-700";
    }
  };

  const getContainerStyles = (status: string | undefined) => {
    switch (status) {
      case "Ongoing":
        return "bg-white border-amber-200 shadow-sm ring-1 ring-amber-400/20";
      case "Completed":
        return "bg-white border-slate-200 opacity-80";
      default:
        return "bg-white border-slate-200 hover:border-slate-300 shadow-sm";
    }
  };

  return (
    <div className={`flex items-center justify-between p-4 border rounded-xl transition-all group relative ${getContainerStyles(note.status)}`}>
      <div className="flex flex-col gap-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="font-bold text-slate-900 truncate text-sm">{note.procedure}</p>
          <span
            className={`flex items-center gap-1.5 text-[10px] font-bold px-2 py-0.5 rounded-md ${getStatusColor(note.status)}`}
          >
            {note.status === "Ongoing" && (
              <span className="relative flex h-2 w-2 shrink-0">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
              </span>
            )}
            {note.status || "Planned"}
          </span>
          {note.tooth && note.tooth !== "Gen" && (
            <span className="text-[10px] font-medium px-2 py-0.5 rounded-md bg-slate-50 text-slate-600 border border-slate-200">
              Tooth: {note.tooth}
            </span>
          )}
          {note.isContinued && (
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-blue-50 text-blue-600 border border-blue-200 uppercase tracking-widest flex items-center gap-1">
              <RefreshCcw size={10} /> {language === 'ar' ? 'متابعة' : 'Follow Up'}
            </span>
          )}
        </div>
        
        {note.note && (
          <p className="text-sm font-bold text-slate-500 line-clamp-2 mt-1">
            {note.note}
          </p>
        )}
        
        <div className="flex items-center gap-3 mt-2">
          {note.doctor && (
            <p className="text-xs font-bold text-slate-400">Dr. {note.doctor}</p>
          )}
          {Number(note.cost) > 0 && (
            <p className="text-xs font-black text-slate-600 bg-slate-100 px-2 py-0.5 rounded-md flex items-center justify-center">
              EGP {Number(note.cost).toLocaleString()}
            </p>
          )}
        </div>
      </div>

      {/* Inline Quick Actions */}
      <div className="flex items-center gap-1 sm:gap-1.5 ml-2 shrink-0">
        {!note.isContinued && (
          <Protect permission="clinical.edit">
            <button
              onClick={() => onEdit(note)}
              title={txt.edit}
              className="p-1.5 sm:p-2 rounded-lg text-violet-600 bg-violet-50 hover:bg-violet-100 transition-colors shadow-sm border border-violet-100"
            >
              <Edit2 size={14} />
            </button>
          </Protect>
        )}

        <Protect permission="clinical.delete">
          <button
            onClick={() => onDelete(note)}
            title={txt.delete}
            className="p-1.5 sm:p-2 rounded-lg text-rose-600 bg-rose-50 hover:bg-rose-100 transition-colors shadow-sm border border-rose-100"
          >
            <Trash2 size={14} />
          </button>
        </Protect>
      </div>
    </div>
  );
}
