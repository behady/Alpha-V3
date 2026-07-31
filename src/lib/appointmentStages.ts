/** Workflow stages shown in the stage picker (stored Firestore `status` values). */
export const APPOINTMENT_STAGES = [
  { value: "Scheduled" },
  { value: "Confirmed" },
  { value: "Delayed" },
  { value: "Cancelled" },
  { value: "Checked In" },
  { value: "In Chair" },
  { value: "Checking Out" },
  { value: "Completed" },
  { value: "No Show" },
] as const;

export type AppointmentStageValue = (typeof APPOINTMENT_STAGES)[number]["value"];

const STAGE_LABELS: Record<string, { en: string; ar: string }> = {
  Scheduled: { en: "Unconfirmed", ar: "غير مؤكد" },
  Confirmed: { en: "Confirmed", ar: "مؤكد" },
  Delayed: { en: "Delayed", ar: "مؤجل" },
  Cancelled: { en: "Canceled", ar: "ملغي" },
  "Checked In": { en: "Check in", ar: "تسجيل وصول" },
  "In Chair": { en: "In chair", ar: "بالكرسي" },
  "Checking Out": { en: "Check out", ar: "خروج" },
  Completed: { en: "Completed", ar: "مكتمل" },
  Late: { en: "Late", ar: "متأخر" },
  "No Show": { en: "No show", ar: "لم يحضر" },
  Emergency: { en: "Emergency", ar: "طوارئ" },
  Rescheduled: { en: "Rescheduled", ar: "معاد جدولته" },
  Unavailable: { en: "Unavailable", ar: "غير متاح" },
};

export function getAppointmentStageLabel(
  status: string | undefined,
  language: "en" | "ar"
): string {
  if (!status) return language === "ar" ? "غير مؤكد" : "Unconfirmed";
  const row = STAGE_LABELS[status];
  if (row) return language === "ar" ? row.ar : row.en;
  return status;
}

export type AppointmentStatusStyle = {
  card: string;
  accent: string;
  pill: string;
  dot: string;
};

export function getAppointmentStatusStyles(status?: string): AppointmentStatusStyle {
  switch (status) {
    case "Scheduled":
      return {
        card: "bg-slate-100 border-0 shadow-[0_4px_15px_rgba(0,0,0,0.05)] text-slate-800",
        accent: "bg-slate-400",
        pill: "bg-slate-200 text-slate-700 font-bold",
        dot: "bg-slate-400",
      };
    case "Confirmed":
      return {
        card: "bg-teal-50 border-0 shadow-[0_4px_15px_rgba(0,0,0,0.05)] text-slate-800",
        accent: "bg-teal-400",
        pill: "bg-teal-100 text-teal-700 font-bold",
        dot: "bg-teal-400",
      };
    case "Checked In":
      return {
        card: "bg-emerald-100 border-0 shadow-[0_4px_15px_rgba(0,0,0,0.05)] text-slate-800",
        accent: "bg-emerald-500",
        pill: "bg-emerald-200 text-emerald-800 font-bold",
        dot: "bg-emerald-500",
      };
    case "In Chair":
      return {
        card: "bg-sky-100 border-0 shadow-[0_4px_15px_rgba(0,0,0,0.05)] text-slate-800",
        accent: "bg-sky-500",
        pill: "bg-sky-200 text-sky-800 font-bold",
        dot: "bg-sky-500",
      };
    case "Checking Out":
      return {
        card: "bg-cyan-100 border-0 shadow-[0_4px_15px_rgba(0,0,0,0.05)] text-slate-800",
        accent: "bg-cyan-500",
        pill: "bg-cyan-200 text-cyan-800 font-bold",
        dot: "bg-cyan-500",
      };
    case "Completed":
      return {
        card: "bg-slate-200 border-0 shadow-[0_4px_15px_rgba(0,0,0,0.05)] text-slate-700",
        accent: "bg-slate-400",
        pill: "bg-slate-300 text-slate-600 font-bold",
        dot: "bg-slate-400",
      };
    case "Late":
      return {
        card: "bg-orange-100 border-0 shadow-[0_4px_15px_rgba(0,0,0,0.05)] text-slate-800",
        accent: "bg-orange-500",
        pill: "bg-orange-200 text-orange-800 font-bold",
        dot: "bg-orange-500",
      };
    case "Delayed":
      return {
        card: "bg-amber-100 border-0 shadow-[0_4px_15px_rgba(0,0,0,0.05)] text-slate-800",
        accent: "bg-amber-500",
        pill: "bg-amber-200 text-amber-800 font-bold",
        dot: "bg-amber-500",
      };
    case "Cancelled":
      return {
        card: "bg-rose-50 border-0 shadow-[0_4px_15px_rgba(0,0,0,0.05)] text-slate-700",
        accent: "bg-rose-300",
        pill: "bg-rose-100 text-rose-600 font-bold",
        dot: "bg-rose-300",
      };
    case "No Show":
      return {
        card: "bg-rose-100 border-0 shadow-[0_4px_15px_rgba(0,0,0,0.05)] text-slate-800",
        accent: "bg-rose-500",
        pill: "bg-rose-200 text-rose-800 font-bold",
        dot: "bg-rose-500",
      };
    default:
      return {
        card: "bg-slate-100 border-0 shadow-[0_4px_15px_rgba(0,0,0,0.05)] text-slate-800",
        accent: "bg-slate-400",
        pill: "bg-slate-200 text-slate-700 font-bold",
        dot: "bg-slate-400",
      };
  }
}
