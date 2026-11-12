/**
 * The treatment cards behind "planned, in progress, done", read in the browser.
 *
 * One loader for the two screens that count them — the Reports tab and the owner's home — so the
 * three numbers on the home are the same three numbers the report opens to.
 */

import { documentId, getDocs, query, where } from "firebase/firestore";
import { getClinicCollection } from "@/lib/db-utils";
import type { DateRange } from "@/lib/reportHelpers";
import { inheritBranch } from "@/lib/reports/treatmentStatus";

type Row = Record<string, unknown> & { id: string };

/**
 * A treatment card carries no branch; its charge does. Looked up by id, thirty at a time, so a
 * screen can show one branch's treatments the way it shows one branch's money.
 */
async function withChargeBranch(notes: Row[]): Promise<Row[]> {
  const ids = [...new Set(notes.map((n) => String(n.ledgerId || "")).filter(Boolean))];
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += 30) chunks.push(ids.slice(i, i + 30));
  const branchOf = new Map<string, unknown>();
  await Promise.all(
    chunks.map(async (chunk) => {
      const snap = await getDocs(query(getClinicCollection("ledger"), where(documentId(), "in", chunk)));
      for (const d of snap.docs) branchOf.set(d.id, d.data().branchId);
    }),
  );
  return notes.map((n) => {
    const branchId = branchOf.get(String(n.ledgerId || ""));
    return branchId ? { ...n, branchId } : n;
  });
}

/**
 * Four small reads, merged: cards dated in the period, cards still open from any time, cards
 * finished in the period, and continuations (few, and they decide a treatment's real state).
 *
 * `branches: false` skips the charge lookup, for a screen showing every branch at once.
 */
export async function loadTreatmentNotes(range: DateRange, { branches = true }: { branches?: boolean } = {}): Promise<Row[]> {
  const notes = getClinicCollection("clinical_notes");
  const snaps = await Promise.all([
    getDocs(query(notes, where("date", ">=", range.start), where("date", "<=", range.end))),
    getDocs(query(notes, where("status", "in", ["Planned", "Ongoing"]))),
    getDocs(query(notes, where("completedDate", ">=", range.start), where("completedDate", "<=", range.end))),
    getDocs(query(notes, where("isContinued", "==", true))),
  ]);
  const byId = new Map<string, Row>();
  for (const snap of snaps) for (const d of snap.docs) byId.set(d.id, { id: d.id, ...d.data() });
  const rows = [...byId.values()];
  return branches ? inheritBranch(await withChargeBranch(rows)) : rows;
}
