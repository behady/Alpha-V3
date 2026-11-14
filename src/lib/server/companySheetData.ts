import { FieldPath, type DocumentSnapshot } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebaseAdmin";
import { adminClinicCollection, adminClinicDoc } from "@/lib/adminClinicDb";
import { toYmd } from "@/lib/reports/patientStats";
import { clinicTimeZone, ymdInTimeZone } from "@/lib/clinicDate";
import { COMPANY_SHEET_START, marksDocId, sentDocId, type SentMonth, type SheetCard, type SheetCharge, type SheetChoice, type SheetInputs } from "@/lib/insurance/companySheet";

export { marksDocId, sentDocId };

const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const MAX_ROUNDS = 20; // safety cap, same as the hop limit in chargeDone

function chunks<T>(list: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

function cardOf(snap: DocumentSnapshot): SheetCard {
  const d = snap.data() ?? {};
  return { id: snap.id, status: d.status, date: d.date, completedDate: d.completedDate, continuedFromNoteId: d.continuedFromNoteId };
}

function sentAtOf(v: unknown): string | undefined {
  const at = (v as { toDate?: () => Date } | null | undefined)?.toDate?.();
  return at ? ymdInTimeZone(clinicTimeZone(), at) : undefined; // the clinic's day, not the UTC day
}

/** Everything the walk needs for one company, read with the Admin SDK. */
export async function loadCompanySheetInputs(clinicId: string, payerId: string): Promise<SheetInputs> {
  const db = adminDb();

  // Charges: the same two-equality query the insurer tab uses; the start date is cut in memory.
  const chargeSnap = await adminClinicCollection(clinicId, "ledger").where("payerId", "==", payerId).where("type", "==", "procedure").get();
  const charges: SheetCharge[] = chargeSnap.docs
    .map((d) => ({ ...(d.data() as Record<string, unknown>), id: d.id }) as SheetCharge)
    .filter((c) => toYmd(c.date) >= `${COMPANY_SHEET_START}-01`);

  // Cards: each charge's own card, then every card that continues one we already hold.
  const notes = adminClinicCollection(clinicId, "clinical_notes");
  const cards = new Map<string, SheetCard>();
  const noteIds = [...new Set(charges.map((c) => text(c.clinicalNoteId)).filter(Boolean))];
  for (const part of chunks(noteIds, 100)) {
    const snaps = await db.getAll(...part.map((id) => notes.doc(id)));
    for (const s of snaps) if (s.exists) cards.set(s.id, cardOf(s));
  }
  let frontier = [...cards.keys()];
  for (let round = 0; round < MAX_ROUNDS && frontier.length; round++) {
    const found: string[] = [];
    for (const part of chunks(frontier, 30)) {
      const snap = await notes.where("continuedFromNoteId", "in", part).get();
      for (const s of snap.docs) {
        if (cards.has(s.id)) continue;
        cards.set(s.id, cardOf(s));
        found.push(s.id);
      }
    }
    frontier = found;
  }

  // Marks: the dentist's per-patient, per-month switch.
  const marksSnap = await adminClinicDoc(clinicId, "settings", marksDocId(payerId)).get();
  const rawMarks = (marksSnap.data()?.marks ?? {}) as Record<string, unknown>;
  const marks: Record<string, SheetChoice> = {};
  for (const [k, v] of Object.entries(rawMarks)) if (v === "include" || v === "hold") marks[k] = v;

  // Sent months: every settings document of this company's sent range, by document id.
  const sentSnap = await adminClinicCollection(clinicId, "settings")
    .where(FieldPath.documentId(), ">=", sentDocId(payerId, "0000-00"))
    .where(FieldPath.documentId(), "<=", sentDocId(payerId, "9999-99"))
    .get();
  const sent: SentMonth[] = [];
  for (const d of sentSnap.docs) {
    const data = d.data();
    if (data.payerId !== payerId) continue; // a payer id that is a prefix of another
    const month = text(data.month);
    if (!/^\d{4}-\d{2}$/.test(month)) continue;
    const chargeIds = Array.isArray(data.chargeIds) ? data.chargeIds.filter((x): x is string => typeof x === "string") : [];
    const s: SentMonth = { month, chargeIds };
    const at = sentAtOf(data.sentAt);
    if (at) s.sentAt = at;
    const by = text(data.sentByName);
    if (by) s.sentByName = by;
    sent.push(s);
  }

  return { charges, cards: [...cards.values()], marks, sent };
}
