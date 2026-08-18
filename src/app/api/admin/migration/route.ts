import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import { requireSuperAdmin } from "@/lib/apiStaffAuth";
import { buildPlan, initialState, runStep } from "@/lib/migration/engine";
import { collectStaff, linkStaff } from "@/lib/migration/staff";
import { initialStorageState, runStorageStep } from "@/lib/migration/storage";
import { verifyMigration } from "@/lib/migration/verify";
import { parseCredentials } from "@/lib/migration/sourceApp";
import type { MigrationState } from "@/lib/migration/routing";
import type { StorageState } from "@/lib/migration/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Each call does one time-boxed slice of work; the browser loops until done. */
export const maxDuration = 60;

/**
 * Back end for the Super Admin "Migrate a clinic" screen.
 *
 * Moves one clinic from its own v2 Firebase project into this one as a tenant. The work is cut
 * into steps because a clinic with tens of thousands of records cannot be migrated inside one
 * HTTP request — each call does what it can within a time budget and returns the state needed to
 * continue, which also means a dropped connection costs one step rather than the whole run.
 *
 * The source project's credentials arrive with each request and are never persisted. Storing an
 * admin key for someone's live patient database at rest, to save resending it, is not a trade
 * worth making — and the alternative would be a plaintext key sitting in Firestore.
 *
 * Superadmin only. This endpoint accepts credentials for an arbitrary Firebase project and
 * writes into an arbitrary tenant, so a clinic Admin must not be able to reach it.
 */
export async function POST(request: Request) {
  const authz = await requireSuperAdmin(request);
  if (!authz.ok) return authz.response;

  try {
    const body = await request.json();
    const action = String(body?.action || "");
    const clinicId = String(body?.clinicId || "").trim();

    if (!clinicId) {
      return NextResponse.json({ ok: false, error: "Pick a clinic first." }, { status: 400 });
    }

    const clinicSnap = await adminDb().collection("clinics").doc(clinicId).get();
    if (!clinicSnap.exists) {
      /**
       * Writing patient data under a clinic id with no clinic document produces a subtree nobody
       * can read: the rules hang authorisation off `clinics/{id}`, so the data is there and the
       * app shows an empty screen. That is the most confusing possible failure, so it is checked
       * before anything is copied.
       */
      return NextResponse.json(
        { ok: false, error: "That clinic does not exist yet. Create it in the Clinics tab first." },
        { status: 400 }
      );
    }

    const creds = parseCredentials(body?.credentials);

    if (creds.projectId === process.env.FIREBASE_PROJECT_ID?.trim()) {
      // Source and target being the same project would have the engine copy a clinic onto
      // itself, and the read-only guard would not catch it because the write side is legitimate.
      return NextResponse.json(
        { ok: false, error: "Those credentials are for this v3 project, not the clinic's old one." },
        { status: 400 }
      );
    }

    switch (action) {
      case "plan": {
        const plan = await buildPlan(creds, clinicId);
        return NextResponse.json({
          ok: true,
          plan,
          clinicName: clinicSnap.get("name") || clinicId,
          sourceProject: creds.projectId,
        });
      }

      case "copy": {
        const state: MigrationState = body?.state
          ? (body.state as MigrationState)
          : initialState((body?.collections || []) as string[]);

        const result = await runStep(
          creds,
          clinicId,
          state,
          Boolean(body?.commit),
          Boolean(body?.overwrite)
        );
        return NextResponse.json({ ok: true, ...result });
      }

      case "staff-preview": {
        const { people, noEmail } = await collectStaff(creds, body?.adminEmail);
        return NextResponse.json({ ok: true, people, noEmail });
      }

      case "staff-link": {
        const { people, noEmail } = await collectStaff(creds, body?.adminEmail);
        if (!people.some((person) => person.role === "Admin")) {
          return NextResponse.json(
            {
              ok: false,
              error:
                "No staff member would be an Admin, so nobody could manage this clinic. " +
                "Choose an owner before continuing.",
            },
            { status: 400 }
          );
        }
        const results = await linkStaff(creds, clinicId, people, Boolean(body?.resetLinks));
        return NextResponse.json({ ok: true, results, noEmail });
      }

      case "storage": {
        const salt = process.env.STORAGE_TOKEN_SALT?.trim();
        if (!salt) {
          return NextResponse.json(
            {
              ok: false,
              error:
                "STORAGE_TOKEN_SALT is not set on the server. Add it to the environment " +
                "variables and redeploy — file links are built from it.",
            },
            { status: 500 }
          );
        }

        const state: StorageState = body?.state
          ? (body.state as StorageState)
          : await initialStorageState(clinicId);

        const result = await runStorageStep(creds, clinicId, salt, state, Boolean(body?.commit));
        return NextResponse.json({ ok: true, ...result });
      }

      case "verify": {
        const report = await verifyMigration(creds, clinicId, Number(body?.sample) || 25);
        return NextResponse.json({ ok: true, report });
      }

      default:
        return NextResponse.json({ ok: false, error: `Unknown action "${action}"` }, { status: 400 });
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Migration step failed";
    console.error("Migration error:", error);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
