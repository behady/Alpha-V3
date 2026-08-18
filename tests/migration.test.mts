/**
 * End-to-end test for the clinic migration, against the Firebase emulator suite.
 *
 *   npm run test:migration
 *
 * Seeds a v2-shaped source project, runs the same library functions the Super Admin screen calls,
 * and asserts on the result. Covers the things that would be expensive to discover in production:
 * that document ids and cross-record links survive, that the WhatsApp token does not land
 * somewhere clinic staff can read it, that a re-run does not overwrite work done in v3 after
 * cutover, and that the source project is not modified at all.
 */

import { createHash } from "node:crypto";
import { cert, initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { getStorage } from "firebase-admin/storage";
import { generateKeyPairSync } from "node:crypto";

const { privateKey: PEM } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});

const SOURCE_PROJECT = "old-clinic";
const TARGET_PROJECT = "v3-proj";
const CLINIC_ID = "CLINIC_A";
const SOURCE_BUCKET = `${SOURCE_PROJECT}.appspot.com`;

// The v3 admin helpers read these at import time, so they must be set before the dynamic import.
process.env.FIREBASE_PROJECT_ID = TARGET_PROJECT;
process.env.FIREBASE_CLIENT_EMAIL = `sa@${TARGET_PROJECT}.iam.gserviceaccount.com`;
process.env.FIREBASE_PRIVATE_KEY = PEM;
process.env.FIREBASE_STORAGE_BUCKET = `${TARGET_PROJECT}.appspot.com`;
process.env.STORAGE_TOKEN_SALT = "test-salt";
process.env.FIRESTORE_EMULATOR_HOST ||= "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST ||= "127.0.0.1:9099";
process.env.STORAGE_EMULATOR_HOST ||= "http://127.0.0.1:9199";

let passed = 0;
let failed = 0;

function check(label: string, condition: boolean, detail = "") {
  if (condition) {
    console.log(`  ok    ${label}`);
    passed += 1;
  } else {
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
    failed += 1;
  }
}

const creds = (projectId: string) => ({
  credential: cert({
    projectId,
    clientEmail: `sa@${projectId}.iam.gserviceaccount.com`,
    privateKey: PEM,
  }),
  storageBucket: `${projectId}.appspot.com`,
});

const srcApp = initializeApp(creds(SOURCE_PROJECT), "test-src");
const dstApp = initializeApp(creds(TARGET_PROJECT), "test-dst");
const src = getFirestore(srcApp);
/**
 * The v3 project's Firestore database is literally named "default", not the conventional
 * "(default)", and lib/firebaseAdmin binds to it explicitly. The test must read the same one —
 * pointing at "(default)" here made every write appear to succeed and every read come back empty,
 * which is exactly the failure this naming causes in production.
 */
const dst = getFirestore(dstApp, "default");

const SOURCE_CREDENTIALS = {
  projectId: SOURCE_PROJECT,
  clientEmail: `sa@${SOURCE_PROJECT}.iam.gserviceaccount.com`,
  privateKey: PEM,
  storageBucket: SOURCE_BUCKET,
  databaseId: "(default)",
};

const url = (path: string) =>
  `https://firebasestorage.googleapis.com/v0/b/${SOURCE_BUCKET}/o/${encodeURIComponent(path)}?alt=media&token=old`;

const ts = (iso: string) => Timestamp.fromDate(new Date(iso));

async function wipe() {
  for (const db of [src, dst]) {
    for (const col of await db.listCollections()) {
      await db.recursiveDelete(col);
    }
  }
  const bucket = getStorage(srcApp).bucket(SOURCE_BUCKET);
  await bucket.deleteFiles({ force: true }).catch(() => {});
  await getStorage(dstApp).bucket(`${TARGET_PROJECT}.appspot.com`).deleteFiles({ force: true }).catch(() => {});
}

async function seed() {
  await src.doc("patients/p1").set({
    name: "Ahmed Hassan",
    createdAt: ts("2024-03-01T09:00:00Z"),
    balance: 1250.5,
    xrayUrl: url("xrays/p1/panoramic.jpg"),
    attachments: [{ label: "consent", url: url("signatures/p1/consent.png") }],
  });
  await src.doc("patients/p2").set({ name: "Mona Adel", balance: 0 });

  await src.doc("appointments/a1").set({ patientId: "p1", date: "2024-06-01", treatment: "Root canal" });
  await src.doc("appointments/a2").set({ patientId: "p2", date: "2024-06-02", treatment: "Cleaning" });
  await src.doc("clinical_notes/n1").set({
    patientId: "p1",
    appointmentId: "a1",
    patientRef: src.doc("patients/p1"),
    createdAt: ts("2024-06-01T10:45:00Z"),
  });
  await src.doc("ledger/l1").set({ patientId: "p1", amount: 1500 });
  await src.doc("ledger/l2").set({ patientId: "p2", amount: 300 });

  await src.doc("staff/s1").set({
    name: "Dr. Sara", email: "Sara@Clinic.test", role: "Admin", uid: "old-uid-sara", isDentist: true,
  });
  await src.doc("staff/s2").set({ name: "Nour", email: "nour@clinic.test", role: "Receptionist", uid: "old-uid-nour" });
  await src.doc("staff/s3").set({ name: "No Email Person", role: "Assistant" });

  await src.doc("users/old-uid-sara").set({ email: "sara@clinic.test", permissions: ["dashboard.view"] });
  await src.doc("users/old-uid-nour").set({ email: "nour@clinic.test" });

  await src.doc("settings/clinicProfile").set({ clinicName: "Alpha Dental", logoUrl: url("branding/logo.png") });
  await src.doc("settings/wapilot").set({ instanceId: "inst-1", token: "SUPER-SECRET" });

  await src.doc("team_chats/tc1").set({ title: "Front desk" });
  await src.doc("team_chats/tc1/messages/m1").set({ text: "Morning" });
  await src.doc("legacy_widgets/w1").set({ note: "unknown collection" });

  const bucket = getStorage(srcApp).bucket(SOURCE_BUCKET);
  await bucket.file("xrays/p1/panoramic.jpg").save(Buffer.from("xray-bytes"));
  await bucket.file("branding/logo.png").save(Buffer.from("logo-bytes"));
  // signatures/p1/consent.png is deliberately NOT uploaded: a file already missing in v2.

  await dst.doc(`clinics/${CLINIC_ID}`).set({ name: "Alpha Dental", status: "Active" });
}

/** SHA-256 over every document and object in the source, to prove it is never modified. */
async function fingerprintSource(): Promise<string> {
  const lines: string[] = [];

  const stable = (value: unknown): string => {
    if (value === null || value === undefined) return String(value);
    const v = value as { toMillis?: () => number; path?: string };
    if (typeof v.toMillis === "function") return `ts:${v.toMillis()}`;
    if (typeof v.path === "string") return `ref:${v.path}`;
    if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
    if (typeof value === "object") {
      const obj = value as Record<string, unknown>;
      return `{${Object.keys(obj).sort().map((k) => `${k}:${stable(obj[k])}`).join(",")}}`;
    }
    return `${typeof value}:${String(value)}`;
  };

  const walk = async (ref: FirebaseFirestore.CollectionReference) => {
    const snap = await ref.orderBy("__name__").get();
    for (const doc of snap.docs) {
      lines.push(`${doc.ref.path}\t${stable(doc.data())}`);
      for (const sub of await doc.ref.listCollections()) await walk(sub);
    }
  };
  for (const col of (await src.listCollections()).sort((a, b) => a.id.localeCompare(b.id))) {
    await walk(col);
  }

  const [files] = await getStorage(srcApp).bucket(SOURCE_BUCKET).getFiles();
  for (const file of files.sort((a, b) => a.name.localeCompare(b.name))) {
    const [contents] = await file.download();
    lines.push(`gs://${file.name}\t${createHash("sha256").update(contents).digest("hex")}`);
  }

  return createHash("sha256").update(lines.join("\n")).digest("hex");
}

async function main() {
  await wipe();
  await seed();

  const { buildPlan, initialState, runStep } = await import("../src/lib/migration/engine.js");
  const { collectStaff, linkStaff } = await import("../src/lib/migration/staff.js");
  const { initialStorageState, runStorageStep } = await import("../src/lib/migration/storage.js");
  const { verifyMigration } = await import("../src/lib/migration/verify.js");
  const { sourceDb } = await import("../src/lib/migration/sourceApp.js");

  const before = await fingerprintSource();

  console.log("\nRead-only guard");
  const guarded = sourceDb(SOURCE_CREDENTIALS);
  for (const [label, fn] of [
    ["set", () => guarded.doc("patients/p1").set({ x: 1 })],
    ["delete", () => guarded.doc("patients/p1").delete()],
    ["bulkWriter", () => guarded.bulkWriter()],
  ] as [string, () => unknown][]) {
    try {
      await fn();
      check(`${label} is blocked`, false, "the write was NOT blocked");
    } catch (e) {
      check(`${label} is blocked`, /read-only/.test((e as Error).message));
    }
  }
  check("reads still work", (await guarded.collection("patients").get()).size === 2);

  console.log("\nPlan");
  const plan = await buildPlan(SOURCE_CREDENTIALS, CLINIC_ID);
  const byName = Object.fromEntries(plan.map((entry) => [entry.name, entry]));
  check("users is skipped", byName.users?.action === "skip");
  check("patients counted", byName.patients?.count === 2);
  check("unknown collection flagged", byName.legacy_widgets?.known === false);
  check("team_chats flagged as unread by v3", Boolean(byName.team_chats?.noConsumer));

  console.log("\nCopy");
  const collections = plan.filter((e) => e.action === "copy").map((e) => e.name);
  let state = initialState(collections);
  let guard = 0;
  for (;;) {
    const result = await runStep(SOURCE_CREDENTIALS, CLINIC_ID, state, true, false);
    state = result.state;
    if (result.done || guard++ > 100) break;
  }
  check("no conflicts on a fresh target", state.stats.conflicts === 0);
  check("one reference remapped", state.stats.refsRemapped === 1);
  check("three storage URLs seen", state.stats.storageUrls === 3);

  const note = await dst.doc(`clinics/${CLINIC_ID}/clinical_notes/n1`).get();
  check("document id preserved", note.exists);
  check(
    "stored reference repointed into the clinic",
    note.get("patientRef")?.path === `clinics/${CLINIC_ID}/patients/p1`,
    note.get("patientRef")?.path
  );
  check(
    "timestamp preserved exactly",
    note.get("createdAt")?.toMillis() === new Date("2024-06-01T10:45:00Z").getTime()
  );
  check(
    "subcollection copied",
    (await dst.doc(`clinics/${CLINIC_ID}/team_chats/tc1/messages/m1`).get()).exists
  );

  const secret = await dst.doc(`clinic_secrets/${CLINIC_ID}`).get();
  check("whatsapp token moved to server-only secrets", secret.get("wapilot")?.token === "SUPER-SECRET");
  check(
    "whatsapp token NOT left where clinic staff can read it",
    !(await dst.doc(`clinics/${CLINIC_ID}/settings/wapilot`).get()).exists
  );

  console.log("\nConflict guard");
  await dst.doc(`clinics/${CLINIC_ID}/patients/p1`).set({ name: "Edited in v3 after cutover" });
  let state2 = initialState(collections);
  guard = 0;
  for (;;) {
    const result = await runStep(SOURCE_CREDENTIALS, CLINIC_ID, state2, true, false);
    state2 = result.state;
    if (result.done || guard++ > 100) break;
  }
  check("post-cutover edit is protected", state2.stats.conflicts === 1, `conflicts=${state2.stats.conflicts}`);
  check(
    "post-cutover edit not overwritten",
    (await dst.doc(`clinics/${CLINIC_ID}/patients/p1`).get()).get("name") === "Edited in v3 after cutover"
  );
  // Restore so later checks compare against the real record.
  let state3 = initialState(["patients"]);
  guard = 0;
  for (;;) {
    const result = await runStep(SOURCE_CREDENTIALS, CLINIC_ID, state3, true, true);
    state3 = result.state;
    if (result.done || guard++ > 100) break;
  }

  console.log("\nStaff logins");
  const { people, noEmail } = await collectStaff(SOURCE_CREDENTIALS);
  check("two staff have emails", people.length === 2);
  check("staff without an email is reported", noEmail.length === 1);
  check("email lower-cased for matching", people.some((p) => p.email === "sara@clinic.test"));
  const results = await linkStaff(SOURCE_CREDENTIALS.projectId, CLINIC_ID, people, true);
  check("reset links produced", results.every((r) => Boolean(r.resetLink)));
  const sara = results.find((r) => r.email === "sara@clinic.test");
  const saraUser = await dst.doc(`users/${sara?.uid}`).get();
  check(
    "clinicRoles written as a real nested map, not a dotted key",
    saraUser.get("clinicRoles")?.[CLINIC_ID] === "Admin",
    JSON.stringify(saraUser.get("clinicRoles"))
  );
  check(
    "staff record repointed at the new account",
    (await dst.doc(`clinics/${CLINIC_ID}/staff/s1`).get()).get("uid") === sara?.uid
  );

  console.log("\nFiles");
  let fileState = await initialStorageState(CLINIC_ID);
  guard = 0;
  for (;;) {
    const result = await runStorageStep(SOURCE_CREDENTIALS, CLINIC_ID, "test-salt", fileState, true);
    fileState = result.state;
    if (result.done || guard++ > 100) break;
  }
  check("two files copied", fileState.copied === 2, `copied=${fileState.copied}`);
  check("missing file reported", fileState.missing.length === 1);

  const p1 = await dst.doc(`clinics/${CLINIC_ID}/patients/p1`).get();
  const xray: string = p1.get("xrayUrl");
  check("x-ray URL repointed at the v3 bucket", xray.includes(`${TARGET_PROJECT}.appspot.com`));
  check("x-ray namespaced under this clinic", xray.includes(encodeURIComponent(`clinics/${CLINIC_ID}/`)));
  check(
    "already-missing file keeps its old URL",
    p1.get("attachments")[0].url.includes(SOURCE_BUCKET)
  );

  const [meta] = await getStorage(dstApp)
    .bucket(`${TARGET_PROJECT}.appspot.com`)
    .file(`clinics/${CLINIC_ID}/xrays/p1/panoramic.jpg`)
    .getMetadata();
  check(
    "download token in the URL matches the file",
    xray.split("token=")[1] === meta.metadata?.firebaseStorageDownloadTokens,
    `${xray.split("token=")[1]} vs ${meta.metadata?.firebaseStorageDownloadTokens}`
  );

  console.log("\nVerify");
  const report = await verifyMigration(SOURCE_CREDENTIALS, CLINIC_ID, 25);
  check("verify passes on a good migration", report.failures === 0, JSON.stringify(
    [...report.counts, ...report.samples, ...report.links, ...report.staff].filter((r) => r.status === "fail")
  ));

  await dst.doc(`clinics/${CLINIC_ID}/patients/p2`).delete();
  const broken = await verifyMigration(SOURCE_CREDENTIALS, CLINIC_ID, 25);
  check("verify catches a deleted record", broken.failures > 0);
  check(
    "verify catches the now-dangling appointment link",
    broken.links.some((row) => row.status === "fail")
  );

  console.log("\nSource project");
  const after = await fingerprintSource();
  check("source database is byte-for-byte unchanged", before === after);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
