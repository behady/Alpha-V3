import { Plus, Clock } from "lucide-react";
import Protect from "@/components/Protect";
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

export default function TimelineCard({
  services,
  onAddService,
  onEditService,
  onDeleteService,
  onMoveService,
  onContinueService,
}: Props) {
  const { language } = useLanguage();

  const txt = {
    title: language === "ar" ? "التاريخ الطبي والإجراءات" : "Clinical History & Procedures",
    subtitle: language === "ar" ? "سجل زمني لجميع الإجراءات التي تمت للمريض" : "Chronological timeline of all procedures",
    addProcedure: language === "ar" ? "إضافة إجراء جديد" : "Add New Procedure",
    emptyList: language === "ar" ? "لا توجد إجراءات مسجلة بعد." : "No procedures recorded yet.",
  };

  // Sort services chronologically (newest first). 
  // We use createdAt if available, otherwise fallback to date
  const sortedServices = [...services].sort((a, b) => {
    const timeA = a.createdAt?.toMillis?.() || new Date(a.date || 0).getTime();
    const timeB = b.createdAt?.toMillis?.() || new Date(b.date || 0).getTime();
    return timeB - timeA; // Descending (newest on top)
  });

  return (
    <div className="bg-white border border-slate-200 rounded-2xl shadow-sm hover:border-slate-300 transition-colors overflow-hidden">
      {/* Header */}
      <div className="p-5 flex items-center justify-between border-b border-slate-100 bg-slate-50/50">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-white border border-slate-200 rounded-xl flex items-center justify-center text-teal-500 shadow-sm shrink-0">
            <Clock size={18} />
          </div>
          <div>
            <h3 className="font-bold text-slate-900 text-base">{txt.title}</h3>
            <p className="text-[11px] font-medium text-slate-500">{txt.subtitle}</p>
          </div>
        </div>
        <Protect permission="clinical.edit">
          <button
            onClick={onAddService}
            className="flex items-center gap-1.5 px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white font-bold text-sm rounded-xl transition-colors shadow-sm"
          >
            <Plus size={16} />
            <span className="hidden sm:inline">{txt.addProcedure}</span>
          </button>
        </Protect>
      </div>

      {/* Timeline Content */}
      <div className="p-5 sm:p-8">
        {sortedServices.length === 0 ? (
          <div className="text-center py-10 bg-slate-50/50 rounded-xl border border-slate-200 border-dashed">
            <p className="text-sm font-medium text-slate-400">{txt.emptyList}</p>
          </div>
        ) : (
          <div className="relative">
            {/* The continuous vertical line */}
            <div className="absolute top-2 bottom-2 left-6 md:left-[120px] w-px bg-slate-200" />
            
            <div className="space-y-6">
              {sortedServices.map((note, idx) => {
                // Extract formatted date and time
                let displayDate = note.date || "";
                let displayTime = "";
                
                if (note.createdAt && typeof note.createdAt.toDate === 'function') {
                  const dateObj = note.createdAt.toDate();
                  displayDate = dateObj.toLocaleDateString(language === 'ar' ? 'ar-EG' : 'en-US', { day: 'numeric', month: 'short', year: 'numeric' });
                  displayTime = dateObj.toLocaleTimeString(language === 'ar' ? 'ar-EG' : 'en-US', { hour: '2-digit', minute: '2-digit' });
                }

                return (
                  <div key={note.id} className="relative flex flex-col md:flex-row gap-4 md:gap-8 group">
                    {/* Timestamp Section (Left) */}
                    <div className="md:w-[100px] shrink-0 pt-2 pl-12 md:pl-0 md:text-right flex flex-col">
                      <span className="text-sm font-bold text-slate-800">{displayDate}</span>
                      {displayTime && <span className="text-xs font-semibold text-slate-500">{displayTime}</span>}
                    </div>

                    {/* Timeline Node (Center Dot) */}
                    <div className="absolute left-6 md:left-[120px] top-3 -translate-x-1/2 w-3 h-3 rounded-full border-2 border-white bg-teal-500 shadow-[0_0_0_2px_rgba(20,184,166,0.2)] group-hover:bg-teal-600 group-hover:scale-125 transition-all duration-300" />

                    {/* Content Section (Right) */}
                    <div className="flex-1 ml-12 md:ml-0 bg-white rounded-xl border border-slate-100 shadow-sm hover:shadow-md hover:border-slate-200 transition-all p-1">
                      <ServiceItem
                        note={note}
                        onEdit={onEditService}
                        onDelete={onDeleteService}
                        onMove={onMoveService}
                        onContinue={onContinueService}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
