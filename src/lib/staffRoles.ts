import { isFullAccessRole } from "@/lib/permissions";

/** Staff/user shape for role helpers */
export type StaffRoleFields = {
  role?: string;
  isDentist?: boolean;
};

/** True if this person should appear in dentist pickers and provider lists */
export function isDentistStaff(member: StaffRoleFields | null | undefined): boolean {
  if (!member?.role) return false;
  if (member.role === "Dentist") return true;
  // Owner and Admin both carry the "also a dentist" flag: in a solo practice the person who runs
  // the clinic is usually the one holding the handpiece.
  return isFullAccessRole(member.role) && member.isDentist === true;
}

export function formatStaffRoleLabel(member: StaffRoleFields, isAr = false): string {
  if (isFullAccessRole(member.role) && member.isDentist) {
    const base = member.role === "Owner" ? (isAr ? "المالك" : "Owner") : (isAr ? "مدير" : "Admin");
    return `${base} · ${isAr ? "طبيب" : "Dentist"}`;
  }
  if (member.role === "Owner") return isAr ? "المالك" : "Owner";
  /**
   * The other roles were returned in English even in Arabic, so an Arabic screen labelled its own
   * team "Dentist", "Receptionist", "Assistant" — the roles are stored in English on purpose (they
   * are data), but the label on screen is not data.
   */
  if (isAr) {
    const ar: Record<string, string> = {
      Admin: "مدير",
      Dentist: "طبيب",
      Receptionist: "استقبال",
      Assistant: "مساعد",
      Nurse: "تمريض",
      Hygienist: "أخصائي تنظيف",
      Accountant: "حسابات",
      Manager: "مدير عام",
      Staff: "موظف",
    };
    if (member.role && ar[member.role]) return ar[member.role];
  }
  return member.role || (isAr ? "غير معروف" : "Unknown");
}
