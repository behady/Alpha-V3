import { reportServerError } from "@/lib/server/reportError";
import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { adminDb } from "@/lib/firebaseAdmin";
import { requireSuperAdmin } from "@/lib/apiStaffAuth";
import { buildPlan, initialState, runStep } from "@/lib/migration/engine";
import { collectStaff, linkStaff, mergeStaff } from "@/lib/migration/staff";
import { initialStorageState, runStorageStep } from "@/lib/migration/storage";
import { verifyMigration, verifyFromBackup } from "@/lib/migration/verify";
import { parseCredentials } from "@/lib/migration/sourceApp";
import {
  importChunk,
  initialFetchFilesState,
  runFetchFilesStep,
  type BackupDoc,
  type FetchFilesState,
} from "@/lib/migration/backup";
import {
  DOCUMENT_REROUTES,
  KNOWN_CLINIC_COLLECTIONS,
  NO_V3_CONSUMER,
  SKIP_COLLECTIONS,
  targetPathFor,
  type MigrationState,
} from "@/lib/migration/routing";
import type { StorageState } from "@/lib/migration/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Each call does one time-boxed slice of work; the browser loops until done. */
export const maxDuration = 60;

/**
 * Back end for the Super Admin "Migrate a clinic" screen.
 *
 * Two ways in, same landing:
 *
 *  - BACKUP FILE (the normal path): the clinic presses "Download backup" in their old v2 app
 *    and hands the file over. The browser parses it and feeds documents up here in chunks. No
 *    credentials for the old project ever exist outside it — the file is the thing that travels.
 *    Photos and x-rays are then fetched over HTTPS using the download URLs already stored in
 *    the records, which is how the old app itself loads them.
 *
 *  - KEY FILE (the fallback): a service-account key for the old project, for a clinic whose v2
 *    app never got the Backup button, or whose files are stored as gs:// references that carry
 *    no fetchable URL. The old project is opened strictly read-only.
 *
 * Whichever way the data arrives, it lands identically: same routing, same preserved ids, same
 * wapilot-to-secrets re-route, same conflict guard, same stamp. One standard, two doors.
 *
 * Superadmin only: this endpoint writes into an arbitrary tenant (and in key-file mode accepts
 * credentials for an arbitrary project), so a clinic Admin must not reach it.
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
       * app shows an empty screen. Checked before anything is copied.
       */
      return NextResponse.json(
        { ok: false, error: "That clinic does not exist yet. Create it in the Clinics tab first." },
        { status: 400 }
      );
    }

    /** Key-file actions only; backup actions must work with no credentials at all. */
    const getCreds = () => {
      const creds = parseCredentials(body?.credentials);
      if (creds.projectId === process.env.FIREBASE_PROJECT_ID?.trim()) {
        // Source and target being the same project would copy a clinic onto itself, and the
        // read-only guard would not catch it because the write side is legitimate.
        throw new Error("Those credentials are for this v3 project, not the clinic's old one.");
      }
      return creds;
    };

    switch (action) {
      // ------------------------------------------------------------------ backup-file path

      case "plan-backup": {
        const collections = (body?.collections || []) as { path: string; count: number }[];
        const plan = collections
          .sort((a, b) => a.path.localeCompare(b.path))
          .map(({ path, count }) => {
            const rootName = path.split("/")[0];
            if (SKIP_COLLECTIONS[rootName]) {
              return { name: path, action: "skip" as const, reason: SKIP_COLLECTIONS[rootName], count, known: true };
            }
            return {
              name: path,
              action: "copy" as const,
              target: targetPathFor(clinicId, rootName).join("/"),
              count,
              known: KNOWN_CLINIC_COLLECTIONS.has(rootName),
              noConsumer: NO_V3_CONSUMER[rootName],
            };
          });
        return NextResponse.json({
          ok: true,
          plan,
          reroutedPaths: Object.keys(DOCUMENT_REROUTES),
          runId: randomUUID(),
        });
      }

      case "import": {
        const docs = (body?.docs || []) as BackupDoc[];
        const result = await importChunk(
          docs,
          clinicId,
          String(body?.sourceProject || "v2-backup"),
          String(body?.runId || randomUUID()),
          Boolean(body?.commit),
          Boolean(body?.overwrite)
        );
        return NextResponse.json({ ok: true, ...result });
      }

      case "staff-preview-backup":
      case "staff-link-backup": {
        const staffDocs = (body?.staffDocs || []) as { id: string; data: Record<string, unknown> }[];
        const userDocs = (body?.userDocs || []) as Record<string, unknown>[];
        const { people, noEmail } = mergeStaff(staffDocs, userDocs, body?.adminEmail);

        if (action === "staff-preview-backup") {
          return NextResponse.json({ ok: true, people, noEmail });
        }
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
        const results = await linkStaff(
          String(body?.sourceProject || "v2-backup"),
          clinicId,
          people,
          Boolean(body?.resetLinks)
        );
        return NextResponse.json({ ok: true, results, noEmail });
      }

      case "fetch-files": {
        const salt = requireSalt();
        if (typeof salt !== "string") return salt;
        const state: FetchFilesState = body?.state
          ? (body.state as FetchFilesState)
          : await initialFetchFilesState(clinicId);
        // No source bucket is needed: any image link not already in this project's bucket is
        // one to bring across, which avoids trusting a guessed bucket name.
        const result = await runFetchFilesStep(clinicId, salt, state, Boolean(body?.commit));
        return NextResponse.json({ ok: true, ...result });
      }

      case "verify-backup": {
        const report = await verifyFromBackup(
          clinicId,
          (body?.counts || []) as { path: string; count: number }[],
          (body?.samples || []) as BackupDoc[],
          (body?.reroutesPresent || []) as string[]
        );
        return NextResponse.json({ ok: true, report });
      }

      // -------------------------------------------------------------------- key-file path

      case "plan": {
        const creds = getCreds();
        const plan = await buildPlan(creds, clinicId);
        return NextResponse.json({
          ok: true,
          plan,
          clinicName: clinicSnap.get("name") || clinicId,
          sourceProject: creds.projectId,
        });
      }

      case "copy": {
        const creds = getCreds();
        const state: MigrationState = body?.state
          ? (body.state as MigrationState)
          : initialState((body?.collections || []) as string[]);
        const result = await runStep(creds, clinicId, state, Boolean(body?.commit), Boolean(body?.overwrite));
        return NextResponse.json({ ok: true, ...result });
      }

      case "staff-preview": {
        const { people, noEmail } = await collectStaff(getCreds(), body?.adminEmail);
        return NextResponse.json({ ok: true, people, noEmail });
      }

      case "staff-link": {
        const creds = getCreds();
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
        const results = await linkStaff(creds.projectId, clinicId, people, Boolean(body?.resetLinks));
        return NextResponse.json({ ok: true, results, noEmail });
      }

      case "storage": {
        const salt = requireSalt();
        if (typeof salt !== "string") return salt;
        const creds = getCreds();
        const state: StorageState = body?.state
          ? (body.state as StorageState)
          : await initialStorageState(clinicId);
        const result = await runStorageStep(creds, clinicId, salt, state, Boolean(body?.commit));
        return NextResponse.json({ ok: true, ...result });
      }

      case "verify": {
        const report = await verifyMigration(getCreds(), clinicId, Number(body?.sample) || 25);
        return NextResponse.json({ ok: true, report });
      }

      default:
        return NextResponse.json({ ok: false, error: `Unknown action "${action}"` }, { status: 400 });
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Migration step failed";
    reportServerError("Migration error:", error);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

function requireSalt(): string | NextResponse {
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
  return salt;
}
