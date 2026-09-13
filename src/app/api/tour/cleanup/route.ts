import { NextResponse } from "next/server";
import { requireStaffUser } from "@/lib/apiStaffAuth";
import { adminClinicCollection } from "@/lib/adminClinicDb";
import { forEachActiveClinic } from "@/lib/automation/forEachActiveClinic";
import { reportServerError } from "@/lib/server/reportError";
import { DEMO_RECORD_NAMES } from "@/lib/tourDemo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Clears the test records a half-finished tour left behind.
 *
 * Sara creates a patient, an appointment, a payment, a lead, an item and a treatment to teach
 * with, and her last chapter deletes every one of them. Someone who closes the tour in the middle
 * never reaches that chapter, and the clinic is left with "Test patient (Sara)" in its list for
 * ever. This is the other end of that: nightly, and from a button on Getting started.
 *
 * What makes it safe to delete rather than bin:
 *
 * - Only exact name matches against DEMO_RECORD_NAMES, in either language. Nothing fuzzy.
 * - Only records older than a day, so a tour in progress is never swept out from under someone.
 * - The patient must ALSO carry `isTourDemo`, the flag written the moment Sara saves it. A real
 *   patient who happens to be named after her test one is still not touched.
 * - The test dentist is reported, never deleted: it is a login, and removing an account is not
 *   something a nightly job should do behind anyone's back.
 *
 * Deleted outright rather than binned on purpose. These are the tour's own props; putting them in
 * Recently Deleted would trade a dirty patient list for a dirty bin, which is the same complaint.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

function isCronAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  return (request.headers.get("authorization") || "") === `Bearer ${secret}`;
}

/** Epoch millis for whatever shape this record's timestamp is in, or null when it has none. */
function ageOf(data: Record<string, unknown>): number | null {
  for (const key of ["createdAt", "date", "updatedAt"]) {
    const value = data[key] as { toDate?: () => Date } | string | undefined;
    if (!value) continue;
    if (typeof value === "string") {
      const t = Date.parse(value);
      if (!Number.isNaN(t)) return t;
      continue;
    }
    if (typeof value.toDate === "function") return value.toDate().getTime();
  }
  return null;
}

export interface TourCleanupResult {
  clinicId: string;
  deleted: Record<string, number>;
  /** Found, and deliberately left alone. */
  reported: string[];
}

export async function cleanTourRecords(clinicId: string, olderThanMs = DAY_MS): Promise<TourCleanupResult> {
  const cutoff = Date.now() - olderThanMs;
  const deleted: Record<string, number> = {};
  const reported: string[] = [];
  const bump = (key: string) => {
    deleted[key] = (deleted[key] || 0) + 1;
  };

  /** Docs of one collection whose `field` is one of these names and which are old enough. */
  const staleByName = async (collection: string, field: string, names: readonly string[]) => {
    const out: FirebaseFirestore.QueryDocumentSnapshot[] = [];
    for (const name of names) {
      const snap = await adminClinicCollection(clinicId, collection).where(field, "==", name).limit(50).get();
      for (const doc of snap.docs) {
        const at = ageOf(doc.data());
        // No timestamp at all: old enough by definition — these records are only ever made by her.
        if (at === null || at < cutoff) out.push(doc);
      }
    }
    return out;
  };

  // --- the patient, and everything hanging off it -------------------------------------------
  for (const doc of await staleByName("patients", "name", DEMO_RECORD_NAMES.patient)) {
    if (doc.data()?.isTourDemo !== true) continue; // not hers: leave it entirely alone
    for (const child of ["appointments", "ledger", "clinical_notes", "prescriptions", "treatment_plans", "diagnosis_chats"]) {
      const kids = await adminClinicCollection(clinicId, child).where("patientId", "==", doc.id).limit(200).get();
      for (const kid of kids.docs) {
        await kid.ref.delete();
        bump(child);
      }
    }
    await doc.ref.delete();
    bump("patients");
  }

  // --- the standalone props -------------------------------------------------------------------
  for (const [collection, field, names] of [
    ["leads", "name", DEMO_RECORD_NAMES.lead],
    ["inventory", "name", DEMO_RECORD_NAMES.item],
    ["services", "name", DEMO_RECORD_NAMES.service],
    ["ledger", "description", DEMO_RECORD_NAMES.expense],
  ] as const) {
    for (const doc of await staleByName(collection, field, names)) {
      await doc.ref.delete();
      bump(collection);
    }
  }

  // --- the test dentist: named, never removed --------------------------------------------------
  for (const name of DEMO_RECORD_NAMES.dentist) {
    const snap = await adminClinicCollection(clinicId, "staff").where("name", "==", name).limit(5).get();
    for (const doc of snap.docs) reported.push(`staff/${doc.id} (${name})`);
  }

  return { clinicId, deleted, reported };
}

export async function POST(request: Request) {
  try {
    if (isCronAuthorized(request)) {
      const results = await forEachActiveClinic((clinicId) => cleanTourRecords(clinicId));
      return NextResponse.json({ ok: true, clinics: results.length, results });
    }

    const body = await request.json().catch(() => ({}));
    const clinicId = typeof body?.clinicId === "string" ? body.clinicId : "";
    if (!clinicId) return NextResponse.json({ error: "clinicId is required." }, { status: 400 });

    const authz = await requireStaffUser(request, clinicId);
    if (!authz.ok) return authz.response;

    // Asked for by hand, so the day's grace does not apply: the person pressing the button is
    // looking at the leftovers and wants them gone now.
    const result = await cleanTourRecords(clinicId, 0);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    reportServerError("Tour cleanup failed:", error);
    return NextResponse.json({ error: "Could not clear the tour's test records." }, { status: 500 });
  }
}

/** Vercel's scheduler calls crons with GET. */
export async function GET(request: Request) {
  if (!isCronAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const results = await forEachActiveClinic((clinicId) => cleanTourRecords(clinicId));
    return NextResponse.json({ ok: true, clinics: results.length, results });
  } catch (error) {
    reportServerError("Tour cleanup cron failed:", error);
    return NextResponse.json({ error: "Cleanup failed." }, { status: 500 });
  }
}
