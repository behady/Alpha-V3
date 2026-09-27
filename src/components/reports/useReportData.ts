"use client";

/**
 * The extra data a report needs, fetched when that report is opened and not before.
 *
 * The reports page loads three things for every tab — the period's ledger, every patient, the
 * period's leads — and that was enough for seven tabs. Twenty-seven tabs need the appointment
 * book, the lab, the stockroom, the roster, the WhatsApp line, treatment plans, and the ledger
 * over other periods. Loading all of it on every visit would make the page slow for the owner who
 * only wanted this month's income.
 *
 * So each report DECLARES what it needs (see registry.tsx), and this hook fetches exactly those
 * datasets for the range on screen, remembering what it has already fetched for this clinic and
 * range so switching tabs back and forth costs nothing. Every query is bounded by the range on
 * screen where the collection has a date to bound it on; the few that are not ("all patients",
 * "the whole ledger" for balances that span years) say so in their key.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { getDocs, query, where, Timestamp, getDoc } from "firebase/firestore";
import { getClinicCollection, getClinicDoc } from "@/lib/db-utils";
import type { DateRange } from "@/lib/reportHelpers";
import { addDays, lastYearRange, previousRange, trailingMonths } from "@/lib/reports/periods";
import { toYmd } from "@/lib/reports/patientStats";

export type Row = Record<string, unknown> & { id: string };

export type DatasetKey =
  | "ledgerPrev"
  | "ledgerLastYear"
  | "ledgerMonths12"
  | "ledgerAll"
  | "appointments"
  | "appointmentsWide"
  | "treatmentPlans"
  | "labCases"
  | "labPayments"
  | "inventory"
  | "inventoryTx"
  | "staff"
  | "punches"
  | "conversations"
  | "whatsappLogs"
  | "smsOutbox"
  | "recallSettings";

export type ReportData = Partial<Record<DatasetKey, Row[]>>;

/** Rows the reports page keeps: live ones, with the date normalised once. */
function ledgerRows(docs: { id: string; data: () => Record<string, unknown> }[]): Row[] {
  return docs
    .map((d): Row => ({ id: d.id, ...d.data() }))
    .filter((r) => !["deleted", "cancelled"].includes(String(r.status || "").toLowerCase()))
    .map((r) => ({ ...r, normDate: toYmd(r.date || r.createdAt) }));
}

function rows(docs: { id: string; data: () => Record<string, unknown> }[]): Row[] {
  return docs.map((d): Row => ({ id: d.id, ...d.data() }));
}

const ts = (ymd: string, endOfDay = false) => Timestamp.fromDate(new Date(`${ymd}T${endOfDay ? "23:59:59.999" : "00:00:00"}`));
const ms = (ymd: string, endOfDay = false) => new Date(`${ymd}T${endOfDay ? "23:59:59.999" : "00:00:00"}`).getTime();

/** The window each dataset is bounded by, so the cache key can say which range it holds. */
function windowFor(key: DatasetKey, range: DateRange): DateRange | null {
  switch (key) {
    case "ledgerPrev":
      return previousRange(range);
    case "ledgerLastYear":
      return lastYearRange(range);
    case "ledgerMonths12":
      return trailingMonths(range.end, 12).range;
    case "appointmentsWide":
      // Two years back for "when were they last seen", a year ahead for "already booked".
      return { start: trailingMonths(range.end, 24).range.start, end: addDays(range.end, 366) };
    case "ledgerAll":
    case "treatmentPlans":
    case "inventory":
    case "staff":
    case "recallSettings":
      return null;
    default:
      return range;
  }
}

async function fetchDataset(key: DatasetKey, range: DateRange): Promise<Row[]> {
  const w = windowFor(key, range) || range;
  switch (key) {
    case "ledgerPrev":
    case "ledgerLastYear":
    case "ledgerMonths12":
      return ledgerRows((await getDocs(query(getClinicCollection("ledger"), where("date", ">=", w.start), where("date", "<=", w.end)))).docs);
    case "ledgerAll":
      return ledgerRows((await getDocs(getClinicCollection("ledger"))).docs);
    case "appointments":
    case "appointmentsWide":
      return rows((await getDocs(query(getClinicCollection("appointments"), where("date", ">=", w.start), where("date", "<=", w.end)))).docs);
    case "treatmentPlans":
      return rows((await getDocs(getClinicCollection("treatment_plans"))).docs);
    case "labCases":
      // createdAt is an ISO string on lab cases; a string range is a real range.
      return rows((await getDocs(query(getClinicCollection("lab_cases"), where("createdAt", ">=", `${w.start}T00:00:00`), where("createdAt", "<=", `${w.end}T23:59:59.999`)))).docs);
    case "labPayments":
      return rows((await getDocs(query(getClinicCollection("lab_payments"), where("date", ">=", w.start), where("date", "<=", w.end)))).docs);
    case "inventory":
      return rows((await getDocs(getClinicCollection("inventory"))).docs);
    case "inventoryTx":
      return rows((await getDocs(query(getClinicCollection("inventory_transactions"), where("date", ">=", ts(w.start)), where("date", "<=", ts(w.end, true))))).docs);
    case "staff":
      return rows((await getDocs(getClinicCollection("staff"))).docs);
    case "punches":
      return rows((await getDocs(query(getClinicCollection("attendance"), where("checkIn", ">=", ts(w.start)), where("checkIn", "<=", ts(w.end, true))))).docs).filter((r) => r.userId);
    case "conversations":
      return rows((await getDocs(query(getClinicCollection("whatsapp_conversations"), where("lastMessageAt", ">=", ms(w.start)), where("lastMessageAt", "<=", ms(w.end, true))))).docs);
    case "whatsappLogs":
      return rows((await getDocs(query(getClinicCollection("whatsapp_logs"), where("createdAt", ">=", ts(w.start)), where("createdAt", "<=", ts(w.end, true))))).docs);
    case "smsOutbox":
      return rows((await getDocs(query(getClinicCollection("sms_outbox"), where("createdAt", ">=", `${w.start}T00:00:00`), where("createdAt", "<=", `${w.end}T23:59:59.999`)))).docs);
    case "recallSettings": {
      // Two settings docs decide the recall interval; the scan's wins, the cron's is the fallback.
      const [recall, whatsapp] = await Promise.all([getDoc(getClinicDoc("settings", "recall")), getDoc(getClinicDoc("settings", "whatsapp"))]);
      const r = recall.exists() ? recall.data() : {};
      const wa = whatsapp.exists() ? whatsapp.data() : {};
      const months = Number(r.intervalMonths) || Number(wa.recallAfterMonths) || 6;
      const configured = Boolean(Number(r.intervalMonths)) || wa.isRecallEnabled === true;
      return [{ id: "recall", intervalMonths: months, configured }];
    }
  }
}

export function useReportData(needs: readonly DatasetKey[], range: DateRange, clinicId: string | null) {
  const cache = useRef(new Map<string, Row[]>());
  const [data, setData] = useState<ReportData>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const needsKey = needs.join(",");

  const keyFor = useMemo(
    () => (k: DatasetKey) => {
      const w = windowFor(k, range);
      return `${clinicId}|${k}|${w ? `${w.start}..${w.end}` : "all"}`;
    },
    [clinicId, range],
  );

  useEffect(() => {
    if (!clinicId || needs.length === 0) {
      setData({});
      return;
    }
    let cancelled = false;
    const missing = needs.filter((k) => !cache.current.has(keyFor(k)));
    const deliver = () => {
      const out: ReportData = {};
      for (const k of needs) out[k] = cache.current.get(keyFor(k)) || [];
      if (!cancelled) setData(out);
    };
    if (missing.length === 0) {
      deliver();
      return;
    }
    setLoading(true);
    setError(null);
    Promise.all(missing.map(async (k) => cache.current.set(keyFor(k), await fetchDataset(k, range))))
      .then(deliver)
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // `needsKey` stands in for the array so a re-rendered caller with the same needs does not refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsKey, range.start, range.end, clinicId, keyFor]);

  /** Drop everything, for the Refresh button. */
  const invalidate = () => cache.current.clear();

  return { data, loading, error, invalidate };
}
