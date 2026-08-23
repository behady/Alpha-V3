/**
 * Fills in `users/{uid}.clinicPermissions` — the field firestore.rules reads and nothing ever wrote.
 *
 *   node scripts/backfill-clinic-permissions.mjs                    # dry run, every clinic
 *   node scripts/backfill-clinic-permissions.mjs --clinic <id>      # dry run, one clinic
 *   node scripts/backfill-clinic-permissions.mjs --apply            # write
 *
 * WHY THIS HAS TO RUN BEFORE THE RULES CHANGE
 *
 * The rules grant a write when `clinicPermissions[clinicId]` is missing, on the theory that an
 * account predating the permission system should not be locked out mid-shift. Since nothing ever
 * wrote the field, that escape hatch was the only branch anyone ever took: every permission check
 * in firestore.rules passed, for everyone, always. Closing it without filling the field first
 * would deny every write by every non-Admin in every clinic.
 *
 * WHY IT DOES NOT SIMPLY COPY THE EXISTING ARRAY
 *
 * The flat `users/{uid}.permissions` array is not the whole of what someone may do today. The
 * browser's guards also let people through on their *role* — PermissionGuard's `allowedRoles`, and
 * a dozen ad-hoc `user?.role === "Dentist"` checks — so a dentist whose stored array is the single
 * permission the invite seeds can still edit a treatment chart. Store only that array and enforce
 * it, and that dentist is locked out of their own job the moment the rules change.
 *
 * So each person gets their role's baseline UNION whatever was explicitly granted. Nobody loses
 * anything they demonstrably had. The baselines live in src/lib/permissions.ts, which is where to
 * argue with them; this file makes no policy of its own.
 *
 * Admins get an empty list, deliberately. `isClinicAdmin(clinicId)` short-circuits ahead of the
 * permission lookup in both firestore.rules and apiStaffAuth, so nothing ever consults a list for
 * them — and materialising one would leave a stale copy behind the next time the catalogue changed.
 */

import fs from "node:fs";
import path from "node:path";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { expandPermissions } from "../src/lib/permissions.ts";

const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const valueOf = (flag) => {
  const i = args.indexOf(flag);
  return i === -1 ? null : args[i + 1] || null;
};

const APPLY = has("--apply");
const ONLY_CLINIC = valueOf("--clinic");
const OUT_DIR = valueOf("--out") || process.cwd();

function loadEnvLocal() {
  const file = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(file)) throw new Error("Missing .env.local — run this from the project root.");
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    if (process.env[key]) continue;
    process.env[key] = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
  }
}

function adminDb() {
  if (getApps().length === 0) {
    const privateKey = (process.env.FIREBASE_PRIVATE_KEY || "")
      .replace(/^["']|["']$/g, "").replace(/\\n/g, "\n").trim();
    initializeApp({
      credential: cert({
        projectId: process.env.FIREBASE_PROJECT_ID?.trim(),
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL?.trim(),
        privateKey,
      }),
    });
  }
  return getFirestore(getApps()[0], "default");
}

const sameList = (a, b) =>
  Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => v === b[i]);

function csvCell(value) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

async function main() {
  loadEnvLocal();
  const db = adminDb();

  const usersSnap = await db.collection("users").get();
  const rows = [];
  let unchanged = 0;

  for (const docSnap of usersSnap.docs) {
    const data = docSnap.data() || {};
    const roles = (data.clinicRoles || {});
    const existing = (data.clinicPermissions || {});

    for (const [clinicId, role] of Object.entries(roles)) {
      if (ONLY_CLINIC && clinicId !== ONLY_CLINIC) continue;

      const proposed = expandPermissions(role, data.permissions);
      const current = existing[clinicId];

      if (Array.isArray(current) && sameList(current, proposed)) {
        unchanged++;
        continue;
      }

      rows.push({
        uid: docSnap.id,
        name: data.name || data.email || "(no name)",
        email: data.email || "",
        clinicId,
        role: String(role),
        // What they were explicitly granted, before the role baseline was folded in.
        granted: Array.isArray(data.permissions) ? data.permissions : [],
        proposed,
        // A person already carrying a map for this clinic that disagrees with the expansion is
        // worth seeing separately: it means something wrote the field with different reasoning.
        hadValue: Array.isArray(current) ? current : null,
      });
    }
  }

  const stamp = new Date().toISOString().slice(0, 10);
  const base = path.join(OUT_DIR, `clinic-permissions-backfill-${ONLY_CLINIC || "all"}-${stamp}`);

  fs.writeFileSync(
    `${base}.json`,
    JSON.stringify({ generatedAt: new Date().toISOString(), applied: APPLY, unchanged, rows }, null, 2)
  );

  const header = ["uid", "name", "email", "clinicId", "role", "explicitlyGranted", "willStore", "previousValue"];
  fs.writeFileSync(
    `${base}.csv`,
    [
      header.join(","),
      ...rows.map((r) =>
        [
          r.uid, r.name, r.email, r.clinicId, r.role,
          r.granted.join(" "), r.proposed.join(" "),
          r.hadValue === null ? "(absent)" : r.hadValue.join(" "),
        ].map(csvCell).join(",")
      ),
    ].join("\n")
  );

  const byRole = {};
  for (const r of rows) byRole[r.role] = (byRole[r.role] || 0) + 1;

  console.log(`\nScanned ${usersSnap.size} user documents.`);
  console.log(`  ${rows.length} clinic memberships to write, ${unchanged} already correct.`);
  console.log(`  by role: ${JSON.stringify(byRole)}`);
  console.log(`  report: ${base}.csv`);

  const overwrites = rows.filter((r) => r.hadValue !== null);
  if (overwrites.length) {
    console.log(
      `\n  ${overwrites.length} already hold a map for their clinic that differs from the expansion.` +
        ` Read those rows before applying — something wrote them with different reasoning.`
    );
  }

  if (!APPLY) {
    console.log(`\nDry run. Nothing written. Re-run with --apply once the report reads correctly.\n`);
    return;
  }

  // Firestore caps a batch at 500 writes.
  let written = 0;
  for (let i = 0; i < rows.length; i += 400) {
    const batch = db.batch();
    for (const r of rows.slice(i, i + 400)) {
      batch.update(db.collection("users").doc(r.uid), {
        [`clinicPermissions.${r.clinicId}`]: r.proposed,
      });
    }
    await batch.commit();
    written += Math.min(400, rows.length - i);
    console.log(`  written ${written}/${rows.length}`);
  }

  console.log(`\nDone. ${written} clinic memberships now carry a permission map.`);
  console.log(`Publish firestore.rules next — the fallback that let everyone through can now close.\n`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
