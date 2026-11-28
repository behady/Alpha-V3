/**
 * The reads behind the assistant's ready-made answers.
 *
 * Each function loads what one answer needs with the Admin SDK and hands it to the pure builder
 * in this folder. The caller (the chat route) has already checked that the person may see it.
 *
 * Server only.
 */

import { adminClinicCollection, adminClinicDoc } from "@/lib/adminClinicDb";
import { rowInScope } from "@/lib/branchAccess";
import { LOCATIONS_DOC, parseClinicBranches } from "@/lib/clinicLocations";
import { isFullAccessRole } from "@/lib/permissions";
import { allowedFor } from "@/lib/server/branchAccess";
import { LEDGER_AUDIT_COLLECTION } from "@/lib/server/ledgerAuditWrite";
import { buildMoneyDay, type MoneyDay } from "./cashAnswer";
import { buildDebts, type DebtFilter, type Debts } from "./debts";
import { paymentChanges, type PaymentChange } from "./paymentChanges";

type Row = Record<string, unknown> & { id: string };
type Snap = { docs: { id: string; data: () => Record<string, unknown> }[] };

const rows = (snap: Snap): Row[] => snap.docs.map((d) => ({ id: d.id, ...d.data() }));
const live = (list: Row[]) => list.filter((r) => !["deleted", "cancelled"].includes(String(r.status || "").toLowerCase()));

export type MoneyAnswer = { ok: true; money: MoneyDay; branchLabel: string; hasBranches: boolean } | { ok: false; error: string };

/**
 * Money for a period, for the branch on screen.
 *
 * `branchId` is what the chat sent ("" = all branches). Someone limited to certain branches gets
 * only those, whatever was sent: asking the assistant is not a way round the branch ticks.
 */
export async function answerMoney(args: { clinicId: string; uid: string; role: string | null | undefined; startDate: string; endDate: string; branchId?: unknown }): Promise<MoneyAnswer> {
  const { clinicId, startDate, endDate } = args;
  const [ledgerSnap, locations] = await Promise.all([
    adminClinicCollection(clinicId, "ledger").where("date", ">=", startDate).where("date", "<=", endDate).get(),
    adminClinicDoc(clinicId, "settings", LOCATIONS_DOC).get(),
  ]);
  const branches = parseClinicBranches(locations.exists ? locations.data() : null);
  let ledger = live(rows(ledgerSnap));
  let branchLabel = "";

  const sent = typeof args.branchId === "string" ? args.branchId : "";
  if (branches.length > 0) {
    const allowed = isFullAccessRole(args.role) ? branches : await allowedFor(clinicId, args.uid, branches);
    if (sent) {
      const branch = allowed.find((b) => b.id === sent);
      if (!branch) return { ok: false, error: "This person cannot see that branch's money. Tell them so plainly." };
      ledger = ledger.filter((r) => rowInScope(r, sent));
      branchLabel = branch.name;
    } else if (allowed.length < branches.length) {
      const ids = new Set(allowed.map((b) => b.id));
      ledger = ledger.filter((r) => typeof r.branchId === "string" && ids.has(r.branchId));
      branchLabel = allowed.map((b) => b.name).join(", ");
    }
  }

  return { ok: true, money: buildMoneyDay({ rows: ledger, startDate, endDate, branches: branches.map((b) => ({ id: b.id, name: b.name })) }), branchLabel, hasBranches: branches.length > 0 };
}

/** Who owes, always clinic-wide: one patient is one account whichever branch they visit. */
export async function answerWhoOwes(args: { clinicId: string; today: string; filter: DebtFilter; days?: number; limit?: number; patientId?: string }): Promise<Debts> {
  const { clinicId, today, filter } = args;
  const col = (name: string) => adminClinicCollection(clinicId, name);

  if (filter === "patient") {
    const patientId = String(args.patientId || "").trim();
    if (!patientId) return buildDebts({ ledger: [], patients: [], today, filter, patientId: "" });
    const [ledgerSnap, patientSnap] = await Promise.all([col("ledger").where("patientId", "==", patientId).get(), col("patients").doc(patientId).get()]);
    const file = patientSnap.exists ? [{ id: patientId, ...(patientSnap.data() as Record<string, unknown>) }] : [];
    return buildDebts({ ledger: live(rows(ledgerSnap)), patients: file, today, filter, patientId });
  }

  const [ledgerSnap, patientsSnap, extraSnap] = await Promise.all([
    col("ledger").get(),
    col("patients").select("name", "phone", "whatsappOptOut").get(),
    filter === "today"
      ? col("appointments").where("date", "==", today).select("patientId").get()
      : filter === "finished"
        ? col("clinical_notes").where("status", "in", ["Planned", "Ongoing"]).select("patientId").get()
        : Promise.resolve({ docs: [] } as Snap),
  ]);
  const ids = new Set(rows(extraSnap as Snap).map((r) => String(r.patientId || "")).filter(Boolean));

  return buildDebts({
    ledger: live(rows(ledgerSnap)),
    patients: rows(patientsSnap as Snap),
    today,
    filter,
    days: args.days,
    limit: args.limit,
    ...(filter === "today" ? { todayPatientIds: ids } : {}),
    ...(filter === "finished" ? { openTreatmentPatientIds: ids } : {}),
  });
}

/** Payments deleted or edited in a period, from the audit trail. */
export async function answerPaymentChanges(args: { clinicId: string; startDate: string; endDate: string }): Promise<PaymentChange[]> {
  const snap = await adminClinicCollection(args.clinicId, LEDGER_AUDIT_COLLECTION).where("date", ">=", args.startDate).where("date", "<=", args.endDate).get();
  return paymentChanges(rows(snap));
}
