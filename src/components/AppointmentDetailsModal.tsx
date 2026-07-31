"use client";

import { X, Calendar, Clock, User, Phone, Edit, Trash2, ArrowUpRight, Smile } from "lucide-react";
import { useLanguage } from "@/context/LanguageContext";
import { getAppointmentStatusStyles, APPOINTMENT_STAGES, getAppointmentStageLabel } from "@/lib/appointmentStages";
import { useState } from "react";
import Protect from "@/components/Protect";

interface Props {
  appointment: any;
  patients: any[];
  doctors: any[];
  onClose: () => void;
  onUpdateStatus: (id: string, status: string) => Promise<void>;
  onUpdateWaitingMood: (id: string, mood: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onEdit: () => void;
  onViewProfile: (id: string) => void;
}

export default function AppointmentDetailsModal({
  appointment,
  patients,
  doctors,
  onClose,
  onUpdateStatus,
  onUpdateWaitingMood,
  onDelete,
  onEdit,
  onViewProfile,
}: Props) {
  const { language } = useLanguage();
  const [updating, setUpdating] = useState(false);

  if (!appointment) return null;

  const isAr = language === "ar";
  
  // Find doctor name
  const docObj = doctors.find((d) => d.id === appointment.doctor || d.name === appointment.doctor);
  const doctorName = docObj ? (isAr ? docObj.nameAr || docObj.name : docObj.name) : appointment.doctor || (isAr ? "غير محدد" : "Unassigned");

  const handleStatusChange = async (newStatus: string) => {
    setUpdating(true);
    try {
      await onUpdateStatus(appointment.id, newStatus);
    } catch (e) {
      console.error(e);
    } finally {
      setUpdating(false);
    }
  };

  const handleMoodChange = async (newMood: string) => {
    setUpdating(true);
    try {
      await onUpdateWaitingMood(appointment.id, newMood);
    } catch (e) {
      console.error(e);
    } finally {
      setUpdating(false);
    }
  };

  const handleDelete = async () => {
    if (confirm(isAr ? "هل أنت متأكد من حذف هذا الحجز؟" : "Are you sure you want to delete this booking?")) {
      setUpdating(true);
      try {
        await onDelete(appointment.id);
        onClose();
      } catch (e) {
        console.error(e);
      } finally {
        setUpdating(false);
      }
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="w-full max-w-md bg-white rounded-3xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-slate-100 bg-slate-50/50">
          <h3 className="font-black text-slate-800 text-lg">
            {isAr ? "تفاصيل الموعد" : "Appointment Details"}
          </h3>
          <button
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-5 max-h-[70vh] overflow-y-auto">
          {/* Patient Card */}
          <div className="p-4 bg-teal-50/40 rounded-2xl border border-teal-100/50 flex justify-between items-start">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <User size={18} className="text-teal-600" />
                <span className="font-extrabold text-slate-800 text-base">{appointment.patientName}</span>
              </div>
              {appointment.patientPhone && (
                <div className="flex items-center gap-2 text-sm text-slate-500">
                  <Phone size={14} className="text-slate-400" />
                  <span>{appointment.patientPhone}</span>
                </div>
              )}
            </div>
            {appointment.patientId && (
              <button
                onClick={() => onViewProfile(appointment.patientId)}
                className="text-xs font-bold text-teal-700 hover:text-teal-800 hover:bg-teal-100/80 bg-teal-100/50 px-3 py-1.5 rounded-xl transition-all flex items-center gap-1"
              >
                <span>{isAr ? "الملف" : "Profile"}</span>
                <ArrowUpRight size={14} />
              </button>
            )}
          </div>

          {/* Date / Time */}
          <div className="grid grid-cols-2 gap-4">
            <div className="p-3 bg-slate-50 rounded-2xl space-y-1">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block">
                {isAr ? "التاريخ" : "Date"}
              </span>
              <div className="flex items-center gap-2 font-bold text-slate-800 text-sm">
                <Calendar size={16} className="text-slate-400" />
                <span>{appointment.date}</span>
              </div>
            </div>

            <div className="p-3 bg-slate-50 rounded-2xl space-y-1">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block">
                {isAr ? "الوقت" : "Time"}
              </span>
              <div className="flex items-center gap-2 font-bold text-slate-800 text-sm">
                <Clock size={16} className="text-slate-400" />
                <span>{appointment.time} ({appointment.duration} {isAr ? "دقائق" : "min"})</span>
              </div>
            </div>
          </div>

          <div className="p-3 bg-slate-50 rounded-2xl space-y-1">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block">
              {isAr ? "الطبيب المعالج" : "Assigned Dentist"}
            </span>
            <div className="font-bold text-slate-800 text-sm">
              {doctorName}
            </div>
          </div>

          {/* Treatment Notes */}
          {appointment.treatment && (
            <div className="p-3 bg-slate-50 rounded-2xl space-y-1">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block">
                {isAr ? "سبب الزيارة" : "Reason for Visit"}
              </span>
              <p className="text-sm text-slate-600 font-semibold">{appointment.treatment}</p>
            </div>
          )}

          {/* Status Picker */}
          <div className="space-y-2">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block">
              {isAr ? "الحالة" : "Status"}
            </span>
            <div className="flex flex-wrap gap-2">
              {APPOINTMENT_STAGES.map((stage) => {
                const isSelected = appointment.status === stage.value;
                const stageStyles = getAppointmentStatusStyles(stage.value);
                return (
                  <button
                    key={stage.value}
                    disabled={updating}
                    onClick={() => handleStatusChange(stage.value)}
                    className={`text-xs font-bold px-3 py-2 rounded-xl border transition-all ${
                      isSelected
                        ? `${stageStyles.pill} border-current ring-2 ring-offset-1`
                        : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    {getAppointmentStageLabel(stage.value, language as any)}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Waiting Mood Selector (only visible if status is Checked In or Waiting) */}
          {(appointment.status === "Checked In" || appointment.status === "Waiting") && (
            <div className="space-y-2">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block">
                {isAr ? "المزاج في الانتظار" : "Waiting Mood"}
              </span>
              <div className="grid grid-cols-4 gap-2">
                {[
                  { value: "happy", label: isAr ? "سعيد" : "Happy", color: "text-green-500 bg-green-50 border-green-200" },
                  { value: "neutral", label: isAr ? "عادي" : "Neutral", color: "text-slate-500 bg-slate-50 border-slate-200" },
                  { value: "anxious", label: isAr ? "قلق" : "Anxious", color: "text-amber-500 bg-amber-50 border-amber-200" },
                  { value: "pain", label: isAr ? "متألم" : "In Pain", color: "text-red-500 bg-red-50 border-red-200" },
                ].map((mood) => {
                  const isSelected = appointment.waitingMood === mood.value;
                  return (
                    <button
                      key={mood.value}
                      disabled={updating}
                      onClick={() => handleMoodChange(mood.value)}
                      className={`text-xs font-bold py-2 rounded-xl border transition-all flex flex-col items-center justify-center gap-1 ${
                        isSelected
                          ? `${mood.color} ring-2 ring-offset-1`
                          : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
                      }`}
                    >
                      <Smile size={18} />
                      <span>{mood.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="p-5 border-t border-slate-100 bg-slate-50/50 flex gap-3">
          <Protect permission="appointments.edit">
            <button
              disabled={updating}
              onClick={onEdit}
              className="flex-1 bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 font-bold py-3 px-4 rounded-2xl transition-all flex items-center justify-center gap-2 text-sm shadow-sm"
            >
              <Edit size={16} />
              <span>{isAr ? "تعديل" : "Edit"}</span>
            </button>
          </Protect>
          
          <Protect permission="appointments.delete">
            <button
              disabled={updating}
              onClick={handleDelete}
              className="bg-red-50 hover:bg-red-100 text-red-600 font-bold py-3 px-4 rounded-2xl transition-all flex items-center justify-center gap-2 text-sm border border-red-100"
            >
              <Trash2 size={16} />
              <span className="hidden sm:inline">{isAr ? "حذف" : "Delete"}</span>
            </button>
          </Protect>
        </div>
      </div>
    </div>
  );
}
