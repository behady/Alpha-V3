import { Plus, Pin } from "lucide-react";
import { Note } from "./types";
import ServiceItem from "./ServiceItem";
import { useLanguage } from "@/context/LanguageContext";

interface Props {
  services: Note[];
  onAddService: () => void;
  onEditService: (note: Note) => void;
  onDeleteService: (note: Note) => void;
  onMoveService: (note: Note) => void;
  onContinueService: (note: Note) => void;
}

export default function GeneralCard({
  services,
  onAddService,
  onEditService,
  onDeleteService,
  onMoveService,
  onContinueService,
}: Props) {
  const { language } = useLanguage();

  const txt = {
    title: language === "ar" ? "إجراءات عامة (غير مرتبطة بموعد)" : "General Services",
    subtitle: language === "ar" ? "الخدمات السابقة أو غير المربوطة بموعد محدد" : "Legacy or unlinked procedures",
    addProcedure: language === "ar" ? "إضافة إجراء عام" : "Add General Procedure",
    emptyList: language === "ar" ? "لا توجد إجراءات عامة." : "No general procedures.",
  };

  return (
    <div className="bg-white border border-slate-200 rounded-2xl shadow-sm hover:border-slate-300 transition-colors">
      <div className="p-5 flex items-center justify-between border-b border-slate-100 bg-slate-50/50 rounded-t-2xl">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-white border border-slate-200 rounded-xl flex items-center justify-center text-slate-500 shadow-sm shrink-0">
            <Pin size={16} />
          </div>
          <div>
            <h3 className="font-bold text-slate-900 text-base">{txt.title}</h3>
            <p className="text-[11px] font-medium text-slate-500">{txt.subtitle}</p>
          </div>
        </div>
      </div>

      <div className="p-5 space-y-4">
        {services.length === 0 ? (
          <div className="text-center py-6 bg-slate-50/50 rounded-xl border border-slate-200 border-dashed">
            <p className="text-sm font-medium text-slate-400">{txt.emptyList}</p>
          </div>
        ) : (
          <div className="space-y-3">
            {services.map(note => (
              <ServiceItem
                key={note.id}
                note={note}
                onEdit={onEditService}
                onDelete={onDeleteService}
                onMove={onMoveService}
                onContinue={onContinueService}
              />
            ))}
          </div>
        )}

        <button
          onClick={onAddService}
          className="w-full flex items-center justify-center gap-2 py-2.5 bg-white hover:bg-slate-50 text-slate-600 font-bold text-sm rounded-xl border border-slate-200 hover:border-slate-300 transition-colors shadow-sm"
        >
          <Plus size={16} />
          {txt.addProcedure}
        </button>
      </div>
    </div>
  );
}
