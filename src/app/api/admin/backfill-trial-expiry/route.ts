import { reportServerError } from "@/lib/server/reportError";
import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import { requireSuperAdmin } from "@/lib/apiStaffAuth";
import { expiryDate } from "@/lib/clinicStatus";
import {
  PLATFORM_SETTINGS_COLLECTION,
  TRIAL_POLICY_DOC,
  DEFAULT_TRIAL_POLICY,
  normalizeTrialPolicy,
  trialExpiryFrom,
} from "@/lib/trialPolicy";

/**
 * Gives an end date to the trial clinics that never got one.
 *
 * Every clinic created before signup started stamping `expiresAt` has no expiry date, and every
 * layer reads that as "never expires" — correctly, because that is what it meant when they were
 * created. Turning trial expiry on does not reach them, and it must not: some of these are real
 * customers who have been working in the system for months on a tier nobody ever changed.
 *
 * So this is a deliberate, superadmin-only action with the shape that fact demands:
 *
 *  - **Preview by default.** A POST with no `apply` lists exactly which clinics would be given
 *    which date, and changes nothing. Applying is a second, explicit request.
 *  - **Dated from signup, not from today** — with a floor. Backdating `createdAt + trialDays` for
 *    a clinic created a year ago produces a date in the past, which would take a working clinic
 *    read-only the instant this ran. `graceDays` (default 7) is the floor: nobody loses access
 *    with less than that much notice, whatever their signup date says. The preview says which
 *    clinics hit the floor, because "these eleven would have expired immediately" is the single
 *    most important thing to know before pressing the button.
 *  - **Only Free Trial, only with no expiry, only Active.** A clinic already carrying a date has
 *    been decided about by a human and is never overwritten. A paying tier is not a trial.
 *  - **Never scheduled.** There is no cron behind this. Expiry itself needs none — the rules and
 *    `clinicStatus` evaluate `expiresAt` at the moment of each write — and a job that silently
 *    ends customers' access is not something that should be able to run without somebody
 *    deciding to run it.
 *
 * POST { apply?: boolean, graceDays?: number } → preview (default) or write
 */

const BATCH_LIMIT = 400; // Firestore caps a batch at 500.

/** Nobody is expired with less notice than this, however old their signup date is. */
const DEFAULT_GRACE_DAYS = 7;
const MAX_GRACE_DAYS = 365;

type PlanRow = {
  clinicId: string;
  name: string;
  createdAt: string | null;
  /** The date this clinic would be given, ISO. */
  expiresAt: string;
  /** True when `createdAt + trialDays` was already in the past and the grace floor applied. */
  flooredToGrace: boolean;
};

export async function POST(request: Request) {
  try {
    const authCheck = await requireSuperAdmin(request);
    if (!authCheck.ok) return authCheck.response;

    const body = await request.json().catch(() => ({}));
    const apply = body?.apply === true;

    const rawGrace = Number(body?.graceDays);
    const graceDays = Number.isFinite(rawGrace) && rawGrace >= 0
      ? Math.min(MAX_GRACE_DAYS, Math.round(rawGrace))
      : DEFAULT_GRACE_DAYS;

    const db = adminDb();

    const policySnap = await db.collection(PLATFORM_SETTINGS_COLLECTION).doc(TRIAL_POLICY_DOC).get();
    const policy = policySnap.exists ? normalizeTrialPolicy(policySnap.data()) : DEFAULT_TRIAL_POLICY;

    // Refused rather than quietly doing nothing: "backfill ran, changed 0 clinics" reads as a bug
    // in the backfill, when the real answer is that expiry is switched off platform-wide.
    if (!policy.expireTrials) {
      return NextResponse.json({
        ok: false,
        error:
          "Trial expiry is switched off in the platform settings. Turn it on before backfilling, " +
          "or these clinics would be given a date that nothing enforces.",
      }, { status: 409 });
    }

    const now = Date.now();
    const graceFloor = now + graceDays * 86400000;

    /**
     * Every clinic, filtered here rather than by `where("subscriptionTier", "==", "Free Trial")`.
     *
     * An equality filter would miss the clinics whose tier field is absent entirely — and the
     * rest of the app treats those as trials: `hasFeature` and `getAiCreditLimit` both read
     * `clinic.subscriptionTier || 'Free Trial'`. Being invisible to this tool is precisely the
     * state those clinics are already in, so a query that silently skipped them would leave the
     * oldest records — the ones most likely to lack the field — immortal, and the preview would
     * say the job was done. The collection is small enough that the superadmin dashboard already
     * loads all of it on every visit.
     */
    const snap = await db.collection("clinics").get();

    const plan: PlanRow[] = [];
    for (const doc of snap.docs) {
      const data = doc.data() ?? {};

      const tier = typeof data.subscriptionTier === "string" && data.subscriptionTier
        ? data.subscriptionTier
        : "Free Trial";
      if (tier !== "Free Trial") continue;

      // A date already set is a human's decision. Never overwritten, in preview or in apply.
      if (expiryDate(data.expiresAt)) continue;
      // Suspended or already marked Expired: read-only for another reason, and dating a
      // suspension would confuse two different conversations with the customer.
      if ((typeof data.status === "string" ? data.status : "Active") !== "Active") continue;

      const createdAt = expiryDate(data.createdAt);
      // The same "start + trialDays" signup itself uses, so a backfilled clinic and a freshly
      // created one are dated by one piece of arithmetic rather than two that can drift.
      // No readable signup date means the only fair start is now. Non-null here: the policy is
      // known to expire trials (checked above) and the start date is always valid.
      const natural = trialExpiryFrom(createdAt ?? new Date(now), policy);
      if (!natural) continue;

      const flooredToGrace = natural.getTime() < graceFloor;
      const expiresAt = flooredToGrace ? new Date(graceFloor) : natural;

      plan.push({
        clinicId: doc.id,
        name: typeof data.name === "string" ? data.name : "(unnamed)",
        createdAt: createdAt ? createdAt.toISOString() : null,
        expiresAt: expiresAt.toISOString(),
        flooredToGrace,
      });
    }

    // Soonest first: the clinics closest to losing access are the ones worth reading.
    plan.sort((a, b) => a.expiresAt.localeCompare(b.expiresAt));

    if (!apply) {
      return NextResponse.json({
        ok: true,
        applied: false,
        policy,
        graceDays,
        total: plan.length,
        flooredCount: plan.filter((r) => r.flooredToGrace).length,
        plan,
      });
    }

    let written = 0;
    for (let i = 0; i < plan.length; i += BATCH_LIMIT) {
      const batch = db.batch();
      for (const row of plan.slice(i, i + BATCH_LIMIT)) {
        batch.update(db.collection("clinics").doc(row.clinicId), {
          expiresAt: new Date(row.expiresAt),
        });
        written += 1;
      }
      await batch.commit();
    }

    return NextResponse.json({
      ok: true,
      applied: true,
      policy,
      graceDays,
      total: plan.length,
      flooredCount: plan.filter((r) => r.flooredToGrace).length,
      written,
      plan,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Backfill failed";
    reportServerError("Backfill Trial Expiry Error:", error);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
