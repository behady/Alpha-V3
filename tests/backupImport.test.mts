/**
 * End-to-end test for the BACKUP-FILE migration path, against the Firebase emulator suite.
 *
 *   npm run test:backup
 *
 * Plays the real story: a v2 clinic presses "Download backup" (the export pager is reproduced
 * here exactly as the v2 route does it — paged reads, subcollection discovery, tagged-type
 * encoding), the file is fed to the v3 importer in browser-sized chunks, staff logins are
 * rebuilt from the file, photos are FETCHED over plain HTTPS using the download URLs already in
 * the records, and verifyFromBackup passes — then catches a planted fault.
 *
 * The headline property this path buys: no credentials for the old project are used anywhere
 * after the export. Import, staff, and files all run with the file alone.
 */

import { createHash, generateKeyPairSync } from "node:crypto";
import { cert, initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";

const { privateKey: PEM } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});

const SOURCE_PROJECT = "old-clinic";
const TARGET_PROJECT = "v3-proj";
const CLINIC_ID = "CLINIC_B";
const SOURCE_BUCKET = `${SOURCE_PROJECT}.appspot.com`;
/** What Firebase actually names buckets on projects created since late 2024. */
const MODERN_BUCKET = `${SOURCE_PROJECT}.firebasestorage.app`;

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

const srcApp = initializeApp(creds(SOURCE_PROJECT), "bk-src");
const dstApp = initializeApp(creds(TARGET_PROJECT), "bk-dst");
const src = getFirestore(srcApp);
// The v3 database is literally named "default" — same binding as lib/firebaseAdmin.
const dst = getFirestore(dstApp, "default");

/**
 * Emulator-served download URL. In production the records hold
 * firebasestorage.googleapis.com URLs whose tokens the old app minted; here the emulator host
 * serves the same /v0/b/<bucket>/o/<path> shape, which is all the importer's parser needs.
 */
const emulatorUrl = (path: string) =>
  `${process.env.STORAGE_EMULATOR_HOST}/v0/b/${SOURCE_BUCKET}/o/${encodeURIComponent(path)}?alt=media&token=old`;

const ts = (iso: string) => Timestamp.fromDate(new Date(iso));

async function wipe() {
  for (const db of [src, dst]) {
    for (const col of await db.listCollections()) await db.recursiveDelete(col);
  }
  await getStorage(srcApp).bucket(SOURCE_BUCKET).deleteFiles({ force: true }).catch(() => {});
  await getStorage(dstApp).bucket(`${TARGET_PROJECT}.appspot.com`).deleteFiles({ force: true }).catch(() => {});
}

async function seed() {
  await src.doc("patients/p1").set({
    name: "Ahmed Hassan",
    createdAt: ts("2024-03-01T09:00:00Z"),
    balance: 1250.5,
    xrayUrl: emulatorUrl("xrays/p1/panoramic.jpg"),
    // Same file, addressed through the modern bucket domain. The backup file declares
    // <project>.appspot.com, so this only migrates if bucket names are NOT trusted.
    xrayUrlModern: emulatorUrl("xrays/p1/panoramic.jpg").replace(SOURCE_BUCKET, MODERN_BUCKET),
    attachments: [{ label: "consent", url: emulatorUrl("signatures/p1/consent.png") }],
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
  await src.doc("staff/s1").set({ name: "Dr. Sara", email: "Sara@ClinicB.test", role: "Admin", uid: "old-uid-sara" });
  await src.doc("staff/s2").set({ name: "No Email", role: "Assistant" });
  await src.doc("users/old-uid-sara").set({ email: "sara@clinicb.test", permissions: ["dashboard.view"] });
  await src.doc("settings/clinicProfile").set({ clinicName: "Clinic B" });
  await src.doc("settings/wapilot").set({ instanceId: "inst-1", token: "SUPER-SECRET" });
  await src.doc("team_chats/tc1").set({ title: "Front desk" });
  await src.doc("team_chats/tc1/messages/m1").set({ text: "Morning", at: ts("2024-06-01T07:55:00Z") });

  const bucket = getStorage(srcApp).bucket(SOURCE_BUCKET);
  await bucket.file("xrays/p1/panoramic.jpg").save(Buffer.from("xray-bytes"));
  // The same object, reachable through the modern bucket domain too.
  await getStorage(srcApp).bucket(MODERN_BUCKET).file("xrays/p1/panoramic.jpg").save(Buffer.from("xray-bytes"));
  // signatures/p1/consent.png deliberately NOT uploaded: already broken in v2.

  await dst.doc(`clinics/${CLINIC_ID}`).set({ name: "Clinic B", status: "Active" });
}

/**
 * The v2 Backup button, reproduced: page through every collection, discover subcollections as
 * they scroll past, encode special types. Mirrors src/app/api/backup/export/route.ts in the v2
 * repo — that file and encodeValue here are the same contract.
 */
async function exportLikeV2(encodeValue: (v: unknown) => unknown) {
  const docs: { path: string; data: unknown }[] = [];
  const queue = (await src.listCollections()).map((col) => col.id).sort();
  const seen = new Set(queue);

  while (queue.length) {
    const path = queue.shift() as string;
    let cursor: string | null = null;
    do {
      let query = src.collection(path).orderBy("__name__").limit(3); // tiny pages, on purpose
      if (cursor) query = query.startAfter(cursor);
      const page = await query.get();
      for (const doc of page.docs) {
        docs.push({ path: doc.ref.path, data: encodeValue(doc.data()) });
        for (const sub of await doc.ref.listCollections()) {
          const subPath = `${path}/${doc.id}/${sub.id}`;
          if (!seen.has(subPath)) {
            seen.add(subPath);
            queue.push(subPath);
          }
        }
      }
      cursor = page.size === 3 ? page.docs[page.docs.length - 1].id : null;
    } while (cursor);
  }

  return {
    format: "alpha-dental-v2-backup",
    version: 1,
    projectId: SOURCE_PROJECT,
    storageBucket: SOURCE_BUCKET,
    exportedAt: new Date().toISOString(),
    docs,
  };
}

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
  for (const col of (await src.listCollections()).sort((a, b) => a.id.localeCompare(b.id))) await walk(col);
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

  const { encodeValue, importChunk, initialFetchFilesState, runFetchFilesStep } = await import(
    "../src/lib/migration/backup.js"
  );
  const { mergeStaff, linkStaff } = await import("../src/lib/migration/staff.js");
  const { verifyFromBackup } = await import("../src/lib/migration/verify.js");
  const { SKIP_COLLECTIONS, DOCUMENT_REROUTES } = await import("../src/lib/migration/routing.js");

  const before = await fingerprintSource();

  console.log("\nExport (as the v2 Backup button does it)");
  const backup = await exportLikeV2(encodeValue);
  check("every record exported", backup.docs.length === 13, `got ${backup.docs.length}`);
  check("subcollection message exported", backup.docs.some((d) => d.path === "team_chats/tc1/messages/m1"));
  check(
    "timestamp encoded with tagged type",
    (backup.docs.find((d) => d.path === "clinical_notes/n1")?.data as Record<string, { __t?: string }>).createdAt?.__t === "ts"
  );
  check("file survives JSON round trip", JSON.parse(JSON.stringify(backup)).docs.length === backup.docs.length);
  const file = JSON.parse(JSON.stringify(backup)) as typeof backup; // what actually travels

  console.log("\nPractice run (must predict, not write)");
  const importable = file.docs.filter((d) => !SKIP_COLLECTIONS[d.path.split("/")[0]]);
  const dry = await importChunk(importable, CLINIC_ID, SOURCE_PROJECT, "dry", false, false);
  check(
    "practice run reports what WOULD be copied",
    dry.stats.written === importable.length,
    `said ${dry.stats.written}, should be ${importable.length}`
  );
  check(
    "practice run wrote nothing",
    (await dst.collection(`clinics/${CLINIC_ID}/patients`).count().get()).data().count === 0
  );

  // The trap this guards: steps 3-5 used to unlock after a practice run too, so the files step
  // would scan a clinic whose records were never copied and report "no images found" as if that
  // described the clinic rather than an empty target.
  const emptyScan = await runFetchFilesStep(CLINIC_ID, "test-salt", await initialFetchFilesState(CLINIC_ID), false);
  check(
    "after a practice run there is nothing for the files step to look at",
    emptyScan.state.scanned === 0,
    `scanned=${emptyScan.state.scanned}`
  );

  console.log("\nImport in chunks (no credentials from here on)");
  const stats = { read: 0, written: 0, conflicts: 0, rerouted: 0 };
  for (let i = 0; i < importable.length; i += 4) {
    const result = await importChunk(importable.slice(i, i + 4), CLINIC_ID, SOURCE_PROJECT, "run-1", true, false);
    stats.read += result.stats.read;
    stats.written += result.stats.written;
    stats.conflicts += result.stats.conflicts;
    stats.rerouted += result.stats.rerouted;
  }
  check("all importable records written", stats.written === importable.length, `wrote ${stats.written}/${importable.length}`);
  check("no conflicts on a fresh clinic", stats.conflicts === 0);

  const note = await dst.doc(`clinics/${CLINIC_ID}/clinical_notes/n1`).get();
  check("document id preserved", note.exists);
  check(
    "stored reference revived AND repointed into the clinic",
    note.get("patientRef")?.path === `clinics/${CLINIC_ID}/patients/p1`,
    note.get("patientRef")?.path
  );
  check(
    "timestamp survives to the exact millisecond",
    note.get("createdAt")?.toMillis() === new Date("2024-06-01T10:45:00Z").getTime()
  );
  check("subcollection landed", (await dst.doc(`clinics/${CLINIC_ID}/team_chats/tc1/messages/m1`).get()).exists);
  check(
    "whatsapp token moved to server-only secrets",
    (await dst.doc(`clinic_secrets/${CLINIC_ID}`).get()).get("wapilot")?.token === "SUPER-SECRET"
  );
  check(
    "whatsapp token NOT under the clinic's readable settings",
    !(await dst.doc(`clinics/${CLINIC_ID}/settings/wapilot`).get()).exists
  );

  console.log("\nConflict guard on re-import");
  await dst.doc(`clinics/${CLINIC_ID}/patients/p2`).set({ name: "Edited in v3 after cutover" });
  const rerun = await importChunk(importable, CLINIC_ID, SOURCE_PROJECT, "run-2", true, false);
  check("post-cutover edit is protected", rerun.stats.conflicts === 1, `conflicts=${rerun.stats.conflicts}`);
  check(
    "post-cutover edit not overwritten",
    (await dst.doc(`clinics/${CLINIC_ID}/patients/p2`).get()).get("name") === "Edited in v3 after cutover"
  );
  await importChunk(importable.filter((d) => d.path === "patients/p2"), CLINIC_ID, SOURCE_PROJECT, "run-3", true, true);

  console.log("\nStaff from the file");
  const staffDocs = file.docs
    .filter((d) => /^staff\/[^/]+$/.test(d.path))
    .map((d) => ({ id: d.path.split("/")[1], data: d.data as Record<string, unknown> }));
  const userDocs = file.docs.filter((d) => /^users\/[^/]+$/.test(d.path)).map((d) => d.data as Record<string, unknown>);
  const { people, noEmail } = mergeStaff(staffDocs, userDocs);
  check("staff merged from backup docs", people.length === 1 && noEmail.length === 1);
  check("email lower-cased", people[0].email === "sara@clinicb.test");
  const results = await linkStaff(SOURCE_PROJECT, CLINIC_ID, people, true);
  const sara = results[0];
  check("login created with reset link", Boolean(sara.uid && sara.resetLink));
  check(
    "clinicRoles is a real nested map",
    (await dst.doc(`users/${sara.uid}`).get()).get("clinicRoles")?.[CLINIC_ID] === "Admin"
  );
  check(
    "staff record repointed at the new account",
    (await dst.doc(`clinics/${CLINIC_ID}/staff/s1`).get()).get("uid") === sara.uid
  );

  console.log("\nFiles fetched by URL (still no credentials)");
  let fileState = await initialFetchFilesState(CLINIC_ID);
  let guard = 0;
  for (;;) {
    const result = await runFetchFilesStep(CLINIC_ID, "test-salt", fileState, true);
    fileState = result.state;
    if (result.done || guard++ > 50) break;
  }
  check("reachable file fetched and stored", fileState.copied === 1, `copied=${fileState.copied}`);
  check(
    "records really were examined, so a zero would mean something",
    fileState.scanned > 0,
    `scanned=${fileState.scanned}`
  );
  check("dead URL reported, not hidden", fileState.missing.length === 1);

  const p1 = await dst.doc(`clinics/${CLINIC_ID}/patients/p1`).get();
  const xray: string = p1.get("xrayUrl");
  check("x-ray URL repointed at the v3 bucket", xray.includes(`${TARGET_PROJECT}.appspot.com`));
  check("x-ray namespaced under this clinic", xray.includes(encodeURIComponent(`clinics/${CLINIC_ID}/`)));
  check("dead URL left pointing where it always did", p1.get("attachments")[0].url.includes(SOURCE_BUCKET));
  check(
    "URL naming a bucket the backup never declared is still migrated",
    p1.get("xrayUrlModern")?.includes(`${TARGET_PROJECT}.appspot.com`),
    p1.get("xrayUrlModern")
  );
  check(
    "the same object seen under two bucket names is copied once, not twice",
    fileState.copied === 1,
    `copied=${fileState.copied}`
  );
  check(
    "both spellings were reported so a wrong guess cannot pass silently",
    fileState.bucketsSeen.includes(SOURCE_BUCKET) && fileState.bucketsSeen.includes(MODERN_BUCKET),
    fileState.bucketsSeen.join(", ")
  );

  const [meta] = await getStorage(dstApp)
    .bucket(`${TARGET_PROJECT}.appspot.com`)
    .file(`clinics/${CLINIC_ID}/xrays/p1/panoramic.jpg`)
    .getMetadata();
  check(
    "download token in the URL matches the stored file",
    xray.split("token=")[1] === meta.metadata?.firebaseStorageDownloadTokens
  );
  const [copiedBytes] = await getStorage(dstApp)
    .bucket(`${TARGET_PROJECT}.appspot.com`)
    .file(`clinics/${CLINIC_ID}/xrays/p1/panoramic.jpg`)
    .download();
  check("file contents identical", copiedBytes.toString() === "xray-bytes");

  console.log("\nVerify against the file");
  const reroutedPaths = Object.keys(DOCUMENT_REROUTES);
  const counts = new Map<string, number>();
  const samples: { path: string; data: unknown }[] = [];
  for (const doc of file.docs) {
    if (reroutedPaths.includes(doc.path) || doc.path.startsWith("users/")) continue;
    const col = doc.path.split("/").slice(0, -1).join("/");
    counts.set(col, (counts.get(col) || 0) + 1);
    samples.push(doc);
  }
  const report = await verifyFromBackup(
    CLINIC_ID,
    [...counts.entries()].map(([path, count]) => ({ path, count })),
    samples,
    reroutedPaths.filter((path) => file.docs.some((doc) => doc.path === path))
  );
  check(
    "verify passes on a good migration",
    report.failures === 0,
    JSON.stringify([...report.counts, ...report.samples, ...report.links, ...report.staff].filter((r) => r.status === "fail"))
  );

  await dst.doc(`clinics/${CLINIC_ID}/patients/p2`).delete();
  const broken = await verifyFromBackup(
    CLINIC_ID,
    [...counts.entries()].map(([path, count]) => ({ path, count })),
    samples,
    []
  );
  check("verify catches a deleted record", broken.failures > 0);
  check("verify catches the dangling appointment link", broken.links.some((row) => row.status === "fail"));

  console.log("\nSource project");
  check("source database byte-for-byte unchanged", (await fingerprintSource()) === before);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
