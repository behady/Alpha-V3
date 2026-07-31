import { useState } from "react";
import { Calendar, Clock, Plus, ChevronDown, ChevronUp } from "lucide-react";
import { Note, RelatedAppointment } from "./types";
import ServiceItem from "./ServiceItem";
import { useLanguage } from "@/context/LanguageContext";

interface Props {
  appointment: RelatedAppointment;
  services: Note[];
  onAddService: (appointmentId: string) => void;
  onEditService: (note: Note) => void;
  onDeleteService: (note: Note) => void;
  onMoveService: (note: Note) => void;
  onContinueService: (note: Note) => void;
}

export default function AppointmentCard({
  appointment,
  services,
  onAddService,
  onEditService,
  onDeleteService,
  onMoveService,
  onContinueService,
}: Props) {
  const { language } = useLanguage();
  const [isExpanded, setIsExpanded] = useState(true);

  const txt = {
    addProcedure: language === "ar" ? "إضافة إجراء" : "Add Procedure",
    emptyList: language === "ar" ? "لا توجد إجراءات مسجلة في هذا الموعد." : "No procedures recorded in this appointment yet.",
  };

  let dateStr = appointment.date;
  if (!dateStr && appointment.createdAt?.toDate) {
    dateStr = appointment.createdAt.toDate().toISOString().split("T")[0];
  }

  const getStatusColor = (status: string | undefined) => {
    switch (status) {
      case "Checked In":
        return "bg-blue-100 text-blue-700";
      case "Checking Out":
      case "Completed":
        return "bg-emerald-100 text-emerald-700";
      case "Cancelled":
      case "No Show":
        return "bg-rose-100 text-rose-700";
      default:
        return "bg-slate-100 text-slate-700";
    }
  };

  return (
    <div className="bg-white border border-slate-200 rounded-2xl shadow-sm hover:border-slate-300 transition-colors">
      {/* Card Header (Collapsible) */}
      <div 
        className="flex items-center justify-between p-5 bg-slate-50/50 cursor-pointer hover:bg-slate-50 transition-colors rounded-t-2xl"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-white text-slate-500 border border-slate-200 flex flex-col items-center justify-center shrink-0 shadow-sm">
            <Calendar size={14} className="mb-0.5" />
            <span className="text-[11px] font-black text-slate-700 leading-none">
              {dateStr ? new Date(dateStr).getDate() : "-"}
            </span>
          </div>
          
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-bold text-slate-900 text-base whitespace-nowrap">
                {dateStr ? new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : "Unknown Date"}
              </h3>
              {appointment.status && (
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md ${getStatusColor(appointment.status)} whitespace-nowrap`}>
                  {appointment.status}
                </span>
              )}
            </div>
            
            <div className="flex items-center gap-2 mt-1 text-xs font-medium text-slate-500 flex-wrap">
              {appointment.time && (
                <span className="flex items-center gap-1 whitespace-nowrap">
                  <Clock size={12} className="text-slate-400" />
                  {language === 'ar' ? appointment.time?.replace('AM', 'ص').replace('PM', 'م') : appointment.time}
                </span>
              )}
              {appointment.doctor && (
                <span className="text-slate-500 whitespace-nowrap">Dr. {appointment.doctor}</span>
              )}
              {appointment.treatment && (
                <span className="text-slate-600 bg-slate-100 px-2 py-0.5 rounded-md">
                  {appointment.treatment}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <span className="text-xs font-bold text-slate-500 bg-white px-3 py-1 rounded-full border border-slate-200 shadow-sm">
            {services.length} {services.length === 1 ? 'Service' : 'Services'}
          </span>
          <button className="p-2 text-slate-400 hover:text-slate-600 bg-white rounded-full border border-slate-200 shadow-sm hover:border-slate-300 transition-colors">
            {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
        </div>
      </div>

      {/* Card Body */}
      {isExpanded && (
        <div className="p-5 border-t border-slate-100 bg-white space-y-4">
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
            onClick={() => onAddService(appointment.id)}
            className="w-full flex items-center justify-center gap-2 py-2.5 bg-white hover:bg-slate-50 text-slate-600 font-bold text-sm rounded-xl border border-slate-200 hover:border-slate-300 transition-colors shadow-sm"
          >
            <Plus size={16} />
            {txt.addProcedure}
          </button>
        </div>
      )}
    </div>
  );
}
