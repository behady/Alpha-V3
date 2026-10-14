/**
 * Activity log v2: the shape of an event, as the writers (server routes and client helpers) hand it
 * to the catalogue, and of a `system_logs` row read back. Pure types, no runtime.
 */

export type Category =
  | "money" | "discount" | "insurance" | "appointment" | "patient"
  | "clinical" | "lab" | "team" | "settings" | "system";

export type Scalar = string | number | boolean | null;
export type Change = { field: string; from: Scalar; to: Scalar };

export type EventKey =
  | "procedure.added" | "procedure.edited" | "procedure.deleted" | "procedure.moved" | "procedure.continued"
  | "payment.received" | "payment.edited" | "payment.deleted"
  | "expense.added" | "expense.edited" | "expense.deleted" | "income.added" | "income.edited" | "income.deleted"
  | "commission.changed" | "labfee.corrected"
  | "staff.paid" | "staff.payout.edited" | "staff.payout.deleted"
  | "staff.deduction.added" | "staff.deduction.edited" | "staff.deduction.removed" | "staff.edited"
  | "discount.given" | "discount.changed" | "discount.removed"
  | "insurance.created" | "insurance.status" | "insurance.edited" | "insurer.collected"
  | "appointment.created" | "appointment.edited" | "appointment.status" | "appointment.moved" | "appointment.deleted"
  | "patient.created" | "patient.edited" | "patient.deleted" | "patient.restored"
  | "record.deleted" | "record.restored" | "record.purged"
  | "plan.created" | "plan.edited" | "plan.deleted" | "plan.status" | "media.uploaded"
  | "lab.created" | "lab.edited" | "lab.status" | "lab.remake" | "lab.deleted" | "lab.paid" | "lab.payment.deleted"
  | "settings.branches" | "settings.services" | "settings.insurers" | "settings.labs";

export type Refs = Partial<Record<
  | "appointmentId" | "ledgerId" | "noteId" | "claimId" | "labCaseId" | "staffId" | "staffName" | "payerName"
  | "receiptNumber" | "method" | "procedure" | "date" | "time" | "doctor" | "approvalNumber" | "labName"
  | "status" | "count" | "listPrice" | "branchName",
  string | number>>;

export interface ActivityEvent {
  event: EventKey;
  patientId?: string | null;
  patientName?: string | null;
  amount?: number | null;
  /** readonly so an `as const` event literal is accepted; a plain Change[] is assignable too. */
  changes?: readonly Change[];
  reason?: string | null;
  branchId?: string | null;
  groupId?: string | null;
  refs?: Refs;
}

export type AuditUser = { uid?: string | null; name?: string | null; role?: string | null };

/** Any system_logs doc as read back: a v2 entry or a legacy one. */
export type ActivityLogDoc = Partial<ActivityEvent> & {
  id: string;
  v?: 2;
  categories?: Category[];
  flag?: boolean;
  userId?: string | null;
  userName?: string;
  user?: string;
  userRole?: string | null;
  action?: string;
  details?: string;
  severity?: string;
  module?: string;
  actor?: string;
  date?: string;
  timestamp?: { toDate?: () => Date } | Date | null;
};
