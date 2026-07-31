/** Staff/user shape for role helpers */
export type StaffRoleFields = {
  role?: string;
  isDentist?: boolean;
};

/** True if this person should appear in dentist pickers and provider lists */
export function isDentistStaff(member: StaffRoleFields | null | undefined): boolean {
  if (!member?.role) return false;
  if (member.role === "Dentist") return true;
  return member.role === "Admin" && member.isDentist === true;
}

export function formatStaffRoleLabel(member: StaffRoleFields, isAr = false): string {
  if (member.role === "Admin" && member.isDentist) {
    return isAr ? "مدير · طبيب" : "Admin · Dentist";
  }
  return member.role || (isAr ? "غير معروف" : "Unknown");
}
