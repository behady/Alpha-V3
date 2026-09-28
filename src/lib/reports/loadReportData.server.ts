/**
 * The report's data, loaded on the server for the phone.
 *
 * The website loads the same datasets in the browser (components/reports/useReportData) with the
 * same windows — the period before, the same dates last year, twelve trailing months, two years
 * back for retention — so a report built here is built from the same rows the website would use.
 * Bounded by the range wherever the collection has a date to bound it on.
 *
 * Server only: reads with the Admin SDK, which bypasses Firestore rules, so the route that calls
 * this must have already established that the caller belongs to the clinic and may see reports.
 */

import { adminClinicCollection, adminClinicDoc } from "@/lib/adminClinicDb";
import { Timestamp } from "firebase-admin/firestore";
import type { DateRange } from "@/lib/reportHelpers";
import { addDays, lastYearRange, previousRange, trailingMonths } from "@/lib/reports/periods";
import { toYmd } from "@/lib/reports/patientStats";
import { parsePayers, type Payer } from "@/lib/payers";
import type { DatasetKey } from "@/lib/reports/catalog";
import type { Row } from "@/lib/reports/documents";

type Snap = { docs: { id: string; data: () => Record<string, unknown> }[] };

function rows(snap: Snap): Row[] {
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/** Live ledger rows with the date normalised once — the same filter the website applies. */
function ledgerRows(snap: Snap): Row[] {
  return rows(snap)
    .filter((r) => !["deleted", "cancelled"].includes(String(r.status || "").toLowerCase()))
    .map((r) => ({ ...r, normDate: toYmd(r.date || r.createdAt) }));
}

const ts = (ymd: string, endOfDay = false) => Timestamp.fromDate(new Date(`${ymd}T${endOfDay ? "23:59:59.999" : "00:00:00"}`));
const ms = (ymd: string, endOfDay = false) => new Date(`${ymd}T${endOfDay ? "23:59:59.999" : "00:00:00"}`).getTime();

export function windowFor(key: DatasetKey, range: DateRange): DateRange {
  switch (key) {
    case "ledgerPrev":
      return previousRange(range);
    case "ledgerLastYear":
      return lastYearRange(range);
    case "ledgerMonths12":
      return trailingMonths(range.end, 12).range;
    case "appointmentsWide":
      return { start: trailingMonths(range.end, 24).range.start, end: addDays(range.end, 366) };
    default:
      return range;
  }
}

async function fetchDataset(clinicId: string, key: DatasetKey, range: DateRange): Promise<Row[]> {
  const w = windowFor(key, range);
  const col = (name: string) => adminClinicCollection(clinicId, name);
  switch (key) {
    case "ledgerPrev":
    case "ledgerLastYear":
    case "ledgerMonths12":
      return ledgerRows(await col("ledger").where("date", ">=", w.start).where("date", "<=", w.end).get());
    case "ledgerAll":
      return ledgerRows(await col("ledger").get());
    case "appointments":
    case "appointmentsWide":
      return rows(await col("appointments").where("date", ">=", w.start).where("date", "<=", w.end).get());
    case "treatmentPlans":
      return rows(await col("treatment_plans").get());
    case "labCases":
      return rows(await col("lab_cases").where("createdAt", ">=", `${w.start}T00:00:00`).where("createdAt", "<=", `${w.end}T23:59:59.999`).get());
    case "labPayments":
      return rows(await col("lab_payments").where("date", ">=", w.start).where("date", "<=", w.end).get());
    case "inventory":
      return rows(await col("inventory").get());
    case "inventoryTx":
      return rows(await col("inventory_transactions").where("date", ">=", ts(w.start)).where("date", "<=", ts(w.end, true)).get());
    case "staff":
      return rows(await col("staff").get());
    case "punches":
      return rows(await col("attendance").where("checkIn", ">=", ts(w.start)).where("checkIn", "<=", ts(w.end, true)).get()).filter((r) => r.userId);
    case "conversations":
      return rows(await col("whatsapp_conversations").where("lastMessageAt", ">=", ms(w.start)).where("lastMessageAt", "<=", ms(w.end, true)).get());
    case "whatsappLogs":
      return rows(await col("whatsapp_logs").where("createdAt", ">=", ts(w.start)).where("createdAt", "<=", ts(w.end, true)).get());
    case "smsOutbox":
      return rows(await col("sms_outbox").where("createdAt", ">=", `${w.start}T00:00:00`).where("createdAt", "<=", `${w.end}T23:59:59.999`).get());
    case "recallSettings": {
      const [recall, whatsapp] = await Promise.all([adminClinicDoc(clinicId, "settings", "recall").get(), adminClinicDoc(clinicId, "settings", "whatsapp").get()]);
      const r = (recall.data() || {}) as Record<string, unknown>;
      const wa = (whatsapp.data() || {}) as Record<string, unknown>;
      const months = Number(r.intervalMonths) || Number(wa.recallAfterMonths) || 6;
      const configured = Boolean(Number(r.intervalMonths)) || wa.isRecallEnabled === true;
      return [{ id: "recall", intervalMonths: months, configured }];
    }
  }
}

export type BaseReportData = {
  procedures: Row[];
  payments: Row[];
  allPatients: Row[];
  leads: Row[];
  payers: Payer[];
};

/** What every report gets: the period's ledger, every patient, the period's leads, the payers. */
export async function loadBaseReportData(clinicId: string, range: DateRange): Promise<BaseReportData> {
  const col = (name: string) => adminClinicCollection(clinicId, name);
  const [ledgerSnap, patientsSnap, leadsSnap, payersSnap] = await Promise.all([
    col("ledger").where("date", ">=", range.start).where("date", "<=", range.end).get(),
    col("patients").get(),
    col("leads").where("createdAt", ">=", ts(range.start)).where("createdAt", "<=", ts(range.end, true)).get(),
    adminClinicDoc(clinicId, "settings", "payers").get(),
  ]);
  const ledger = ledgerRows(ledgerSnap).filter((r) => { const d = String(r.normDate || ""); return d >= range.start && d <= range.end; });
  return {
    procedures: ledger.filter((r) => r.type === "procedure"),
    payments: ledger.filter((r) => r.type === "payment" || r.type === "expense" || r.type === "income"),
    allPatients: rows(patientsSnap),
    leads: rows(leadsSnap).map((l) => ({ ...l, normDate: toYmd(l.createdAt) })),
    payers: parsePayers(payersSnap.data() ?? null),
  };
}

export async function loadReportDatasets(clinicId: string, needs: readonly DatasetKey[], range: DateRange): Promise<Partial<Record<DatasetKey, Row[]>>> {
  const out: Partial<Record<DatasetKey, Row[]>> = {};
  await Promise.all(needs.map(async (k) => { out[k] = await fetchDataset(clinicId, k, range); }));
  return out;
}
