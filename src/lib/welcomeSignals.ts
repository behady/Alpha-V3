// src/lib/welcomeSignals.ts
"use client";

import { getDocs, getDoc, limit, query, where } from "firebase/firestore";
import { getClinicCollection, getClinicDoc } from "@/lib/db-utils";
import { parseClinicSchedule } from "@/lib/clinicSchedule";
import type { MissionSignal, MissionSignals } from "@/lib/welcomeJourney";

/**
 * Does this clinic actually have the thing yet?
 *
 * The welcome guide ticks a step off because the clinic DID it, not because somebody watched a
 * lesson about it. That distinction is the whole reason this file exists: a clinic that has been
 * registering patients for a fortnight before anyone opened the guide should find "register your
 * first patient" already crossed out, and a clinic that clicked through the walkthrough without
 * pressing Save should not.
 *
 * Cost discipline, because this runs on every dashboard load for a clinic still in its trial:
 *
 *  - `limit(1)` and nothing else. The question is "is there one", never "how many", so each probe
 *    is a single document read. Thirteen probes is thirteen reads, once per session.
 *  - `staff` is the one exception at `limit(2)`: "the owner is the only person here" and "somebody
 *    else has been added" are different answers, and one row cannot tell them apart.
 *  - Every probe is independently caught. A collection this member cannot read, or a query a
 *    missing index rejects, costs that one signal — it must never take the whole guide down, which
 *    would show a fully-set-up clinic a blank checklist.
 *  - Results are cached per clinic for the tab's lifetime by the caller (see WelcomeContext), and
 *    re-read on demand when a lesson finishes.
 *
 * A `false` here means "no evidence found", never "definitely not". That asymmetry is deliberate:
 * the cost of a false negative is one extra suggestion, and the cost of a false positive is a
 * clinic told it has finished something it has not.
 */

/** One probe: a name, and a promise for whether the clinic has it. */
type Probe = { key: MissionSignal; run: () => Promise<boolean> };

async function anyDoc(path: string): Promise<boolean> {
  const snap = await getDocs(query(getClinicCollection(path), limit(1)));
  return !snap.empty;
}

/**
 * A ledger row of one kind. `type` is written by `buildPaymentRow` ("payment") and
 * `buildManualEntryRow` ("income" | "expense"), so a single equality filter separates money taken
 * from a patient from money the clinic spent. Equality on one field needs only the automatic
 * single-field index — no composite index to deploy.
 */
async function anyLedgerRow(type: "payment" | "expense"): Promise<boolean> {
  const snap = await getDocs(query(getClinicCollection("ledger"), where("type", "==", type), limit(1)));
  return !snap.empty;
}

function probes(): Probe[] {
  return [
    {
      key: "clinicProfile",
      run: async () => {
        const snap = await getDoc(getClinicDoc("settings", "clinic_info"));
        const data = snap.data() ?? {};
        // Deliberately NOT the name: signup seeds `clinic_info` with the name and currency, so a
        // clinic that has never opened the profile screen already has one. Phone, address and
        // logo are only ever written by a human on that screen, which is what is being asked.
        return ["phone", "address", "logoUrl"].some(
          (k) => typeof data[k] === "string" && data[k].trim() !== "",
        );
      },
    },
    {
      key: "schedule",
      run: async () => {
        const snap = await getDoc(getClinicDoc("settings", "clinic_info"));
        // Same reader the calendar and the assistant use, so "configured" means here exactly what
        // it means to them — including the pre-`configuredAt` clinics it forgives.
        return parseClinicSchedule(snap.data()).isConfigured;
      },
    },
    {
      key: "team",
      run: async () => {
        const snap = await getDocs(query(getClinicCollection("staff"), limit(2)));
        return snap.size >= 2;
      },
    },
    { key: "services", run: () => anyDoc("services") },
    { key: "patients", run: () => anyDoc("patients") },
    { key: "appointments", run: () => anyDoc("appointments") },
    { key: "treatments", run: () => anyDoc("clinical_notes") },
    { key: "prescriptions", run: () => anyDoc("prescriptions") },
    { key: "leads", run: () => anyDoc("leads") },
    { key: "inventory", run: () => anyDoc("inventory") },
    { key: "labCases", run: () => anyDoc("lab_cases") },
    { key: "payments", run: () => anyLedgerRow("payment") },
    { key: "expenses", run: () => anyLedgerRow("expense") },
  ];
}

/**
 * Read every signal at once.
 *
 * `allSettled`, not `all`: one rejected probe must not discard the twelve that answered. The
 * caller gets whatever could be established and treats the rest as "not yet".
 */
export async function readWelcomeSignals(): Promise<MissionSignals> {
  const list = probes();
  const results = await Promise.allSettled(list.map((p) => p.run()));

  const signals: MissionSignals = {};
  results.forEach((result, i) => {
    signals[list[i].key] = result.status === "fulfilled" ? result.value : false;
  });
  return signals;
}
