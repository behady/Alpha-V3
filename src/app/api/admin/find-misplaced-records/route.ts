import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import { requireSuperAdmin } from "@/lib/apiStaffAuth";
import {
  classifyRecord,
  countVerdict,
  emptySummary,
  verdictHeadline,
} from "@/lib/misplacedRecords";

/**
 * Which ledger rows and clinical notes are sitting in the wrong clinic's books.
 *
 * Six of the seven money and clinical write paths never told the server which clinic they meant, so
 * the routes fell back to the caller's `defaultClinicId`. Somebody working at their second clinic
 * had writes resolved against their first.
 *
 * Most of those writes failed rather than landing wrong — a procedure verifies the patient inside
 * its transaction and the dentist before that, and a payment against a procedure verifies the
 * procedure row. What has no such anchor is a payment NOT tied to a procedure, and a clinic income
 * or expense line. The first leaves a fingerprint: a row naming a patient who does not exist in the
 * clinic holding it, while another clinic has exactly that patient. Firestore ids are random, so
 * that is not coincidence.
 *
 * SUPERADMIN ONLY, and not because it writes — it writes nothing. It reads every clinic's patient
 * list at once, because "then whose patient is this?" cannot be answered from inside one clinic.
 * That is a cross-tenant read, and a clinic Admin must never have one: the answer names other
 * clinics and counts their records.
 *
 * There is no repair endpoint beside this, deliberately. Moving a payment between clinics changes
 * two clinics' revenue, two dentists' commission and a patient's balance on both sides. That is an
 * accounting decision with a paper trail behind it, made row by row by somebody who can see both,
 * not a button.
 */

/** Where a misfiled write could actually have landed. Both carry a patientId. */
const COLLECTIONS = ["ledger", "clinical_notes"] as const;

export async function GET(request: Request) {
  const authz = await requireSuperAdmin(request);
  if (!authz.ok) return authz.response;

  try {
    const db = adminDb();
    const clinicsSnap = await db.collection("clinics").get();
    const clinics = clinicsSnap.docs.map((d) => ({
      id: d.id,
      name: String(d.data()?.name || "") || d.id,
    }));

    // Every clinic's patient list, whatever the scan scope. The question a flagged row asks is
    // "then whose patient is this?", and only the full picture answers it.
    const patientHomes = new Map<string, string[]>();
    for (const clinic of clinics) {
      const snap = await db.collection(`clinics/${clinic.id}/patients`).select().get();
      for (const doc of snap.docs) {
        const list = patientHomes.get(doc.id) || [];
        list.push(clinic.id);
        patientHomes.set(doc.id, list);
      }
    }

    const nameOf = new Map(clinics.map((c) => [c.id, c.name]));
    const summary = emptySummary();
    const findings: Array<Record<string, unknown>> = [];

    for (const clinic of clinics) {
      for (const collection of COLLECTIONS) {
        const snap = await db.collection(`clinics/${clinic.id}/${collection}`).get();
        for (const doc of snap.docs) {
          const data = doc.data() || {};
          const verdict = classifyRecord(
            {
              clinicId: clinic.id,
              collection,
              documentId: doc.id,
              patientId: typeof data.patientId === "string" ? data.patientId : null,
              type: typeof data.type === "string" ? data.type : null,
            },
            patientHomes
          );
          countVerdict(summary, verdict);
          // Only the ones needing a human. A list of everything that is fine is not a report.
          if (verdict.kind === "ok" || verdict.kind === "unjudgeable") continue;

          findings.push({
            verdict: verdict.kind,
            heldByClinicId: clinic.id,
            heldByClinicName: nameOf.get(clinic.id),
            belongsToClinicIds: verdict.kind === "misplaced" ? verdict.homeClinicIds : [],
            belongsToClinicNames:
              verdict.kind === "misplaced" ? verdict.homeClinicIds.map((id) => nameOf.get(id) || id) : [],
            collection,
            documentId: doc.id,
            patientId: String(data.patientId || ""),
            type: String(data.type || ""),
            date: String(data.date || ""),
            amount:
              typeof data.amount === "number" ? data.amount
              : typeof data.cost === "number" ? data.cost
              : null,
          });
        }
      }
    }

    findings.sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));

    return NextResponse.json({
      ok: true,
      headline: verdictHeadline(summary),
      summary,
      clinics: clinics.length,
      findings,
    });
  } catch (error) {
    console.error("find-misplaced-records failed", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Could not complete the check." },
      { status: 500 }
    );
  }
}
