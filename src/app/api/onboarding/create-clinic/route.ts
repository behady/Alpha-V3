import { reportServerError } from "@/lib/server/reportError";
import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import { requireAuthedUser } from "@/lib/apiStaffAuth";
import { FieldValue } from "firebase-admin/firestore";
import { OWNER_ROLE } from "@/lib/permissions";
import {
  PLATFORM_SETTINGS_COLLECTION,
  TRIAL_POLICY_DOC,
  DEFAULT_TRIAL_POLICY,
  normalizeTrialPolicy,
  trialExpiryFrom,
  type TrialPolicy,
} from "@/lib/trialPolicy";

/**
 * Creates a Free Trial clinic and grants the caller Admin on it, atomically, server-side.
 * Firestore rules lock direct client writes to `clinics` and `users.clinicRoles` down to
 * superadmin-only, so self-signup must go through Admin SDK here instead.
 */

/**
 * The platform trial policy, or the default if it has never been saved.
 *
 * Read here with the Admin SDK, which bypasses rules — `platform_settings` is superadmin-only and
 * the person signing up is, by definition, nobody yet.
 *
 * A failure to read it falls back rather than aborting. Signup is the one request in the system
 * that must not fail for a reason the person can neither understand nor act on, and the fallback
 * is the same fourteen days the platform has always meant by "free trial". The alternative — a
 * 500 on "Create clinic" because a settings document is unreachable — costs a customer.
 */
async function readTrialPolicy(db: ReturnType<typeof adminDb>): Promise<TrialPolicy> {
  try {
    const snap = await db.collection(PLATFORM_SETTINGS_COLLECTION).doc(TRIAL_POLICY_DOC).get();
    return snap.exists ? normalizeTrialPolicy(snap.data()) : DEFAULT_TRIAL_POLICY;
  } catch (error) {
    reportServerError("Trial policy read failed; using the default", error);
    return DEFAULT_TRIAL_POLICY;
  }
}
export async function POST(request: Request) {
  try {
    const authCheck = await requireAuthedUser(request);
    if (!authCheck.ok) return authCheck.response;
    const uid = authCheck.uid;

    const body = await request.json();
    const clinicName = typeof body?.clinicName === "string" ? body.clinicName.trim() : "";
    if (!clinicName) {
      return NextResponse.json({ ok: false, error: "Clinic name is required" }, { status: 400 });
    }

    const db = adminDb();
    const userRef = db.collection("users").doc(uid);

    /**
     * If this caller already owns a clinic they hold no role in, repair that one instead of
     * making another. Someone whose grant failed sees "you're not part of a clinic yet" and
     * presses Create again — without this, each press leaves behind one more orphan clinic that
     * only a superadmin can clean up. Clinics they *can* already reach are left alone, so
     * deliberately starting a second clinic still works.
     */
    const owned = await db.collection("clinics").where("ownerId", "==", uid).get();
    if (!owned.empty) {
      const existingRoles = ((await userRef.get()).data()?.clinicRoles || {}) as Record<string, unknown>;
      const orphan = owned.docs.find((d) => typeof existingRoles[d.id] !== "string" || !existingRoles[d.id]);
      if (orphan) {
        // Deliberately does NOT stamp or refresh `expiresAt`. This branch hands back a clinic that
        // already exists; re-dating it here would restart the trial of a clinic that may have been
        // running for weeks, every time its owner pressed Create. Orphans from before signup wrote
        // the field are the backfill tool's job, not this one's.
        await userRef.set(
          { clinicRoles: { [orphan.id]: OWNER_ROLE }, defaultClinicId: orphan.id },
          { merge: true }
        );
        return NextResponse.json({ ok: true, clinicId: orphan.id, repaired: true });
      }
    }

    const clinicRef = db.collection("clinics").doc();
    const clinicId = clinicRef.id;

    /**
     * When this trial ends.
     *
     * Computed here rather than left absent, which is the whole reason a free trial used to run
     * forever: `firestore.rules` has refused writes past `expiresAt` since before this route was
     * touched, and `lib/clinicStatus.ts` mirrors that for every Admin SDK route — but both were
     * reading a field nothing ever wrote.
     *
     * A real Date, not `FieldValue.serverTimestamp()`. The sentinel resolves at commit time and
     * cannot be added to, so there is no way to express "fourteen days after that" with it; and
     * `createdAt` beside it is the sentinel, so the two are within milliseconds of each other
     * anyway. The clock that matters is Firestore's at read time, which is what `request.time`
     * in the rules compares against.
     *
     * Null when the policy has expiry switched off, and then the field is not written at all —
     * an absent `expiresAt` is exactly what every layer already reads as "no expiry", which is
     * the behaviour every clinic had until now.
     */
    const policy = await readTrialPolicy(db);
    const expiresAt = trialExpiryFrom(new Date(), policy);

    await db.runTransaction(async (tx) => {
      tx.set(clinicRef, {
        name: clinicName,
        ownerId: uid,
        subscriptionTier: "Free Trial",
        status: "Active",
        createdAt: FieldValue.serverTimestamp(),
        ...(expiresAt ? { expiresAt } : {}),
      });
      /**
       * The role has to be written as a NESTED OBJECT, not a dotted key.
       *
       * Firestore only interprets `"clinicRoles.<id>"` as a path to a nested field in `update()`.
       * In `set()` — even with merge — a dot in a key is part of the field NAME. So this used to
       * create a top-level field literally called `clinicRoles.abc123` and leave the real
       * `clinicRoles` map empty.
       *
       * The result was a signup that looked like it worked and wasn't: the clinic document was
       * created (so it appeared in the Super Admin list), but the owner had no role in it, so
       * ClinicContext saw zero clinics and bounced them straight back to "create a clinic".
       *
       * set+merge is still the right call over update(): it works whether or not the user document
       * exists yet, which matters because a first-time Google sign-in races with AuthContext
       * creating that document. Merge is a deep merge for maps, so roles in other clinics survive.
       */
      tx.set(
        userRef,
        {
          clinicRoles: { [clinicId]: OWNER_ROLE },
          defaultClinicId: clinicId,
        },
        { merge: true }
      );

      /**
       * The clinic's own details, seeded with the two facts signup already knows.
       *
       * Nothing used to create this document at all, so a brand-new clinic's settings screens read
       * from a document that did not exist and fell back to defaults buried in code — which is why
       * lib/clinicSchedule.ts and lib/priceLists.ts both carry warnings about clinics that never
       * opened the Schedule screen.
       *
       * Deliberately only the name and the currency. Seeding opening hours or a price list would
       * make "never configured" indistinguishable from "deliberately set to this", which is the
       * distinction `schedule.configuredAt` exists to preserve — the settings screens need to be
       * able to say what is still untouched.
       *
       * `name` AND `clinicName`: Android reads `snap.getString("name")` with no fallback.
       */
      tx.set(clinicRef.collection("settings").doc("clinic_info"), {
        name: clinicName,
        clinicName,
        currency: "EGP",
        createdAt: new Date().toISOString(),
      });
    });

    return NextResponse.json({ ok: true, clinicId });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to create clinic";
    reportServerError("Create Clinic Error:", error);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
