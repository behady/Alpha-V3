// Cloud Storage security rules, asked of the rules engine itself, on the local emulator.
//
// Usage:
//   npm run test:storage-rules
//
// This file exists because storage.rules was wrong for three days and nothing in the repository
// could tell. It was written on 2026-08-24 with a Firestore membership lookup in it, was never
// deployed, and the lookup could never have worked: Storage rules may only read the (default)
// Firestore database, and this project's database is NAMED default, which is a different one.
// Meanwhile the bucket was still governed by the console's starter template, which expired on
// 2026-08-27 and turned every upload in the app into "Upload failed".
//
// tests/storagePaths.test.mjs reads the ruleset as text — it can check that a line is present, not
// that the line does anything. This one uploads, reads, lists and deletes for real.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { ref, uploadBytes, getMetadata, listAll, deleteObject } from "firebase/storage";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rulesPath = join(__dirname, "..", "storage.rules");
const [host, port] = (process.env.FIREBASE_STORAGE_EMULATOR_HOST || "127.0.0.1:9199").split(":");

const CLINIC = "clinicA";
// Firebase uids are alphanumeric, and staff_profiles keys on fileName.split("_")[0], so a uid with
// an underscore in it would be a test artefact rather than a case that can happen.
const ALICE = "aliceUid";
const BOB = "bobUid";

const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const IMG = { contentType: "image/png" };
const LOGO = "clinics/" + CLINIC + "/clinic_profile/logo_seed.png";

let passed = 0;
let failed = 0;

async function allowed(name, run) {
  try {
    await run();
    console.log("  ok    " + name);
    passed++;
  } catch (e) {
    console.error("  FAIL  " + name + " -- expected to succeed, got " + (e.code || e.message));
    failed++;
  }
}

async function denied(name, run) {
  try {
    await run();
    console.error("  FAIL  " + name + " -- expected to be denied, but it succeeded");
    failed++;
  } catch (e) {
    // Insisting on the permission error matters: a connection refused or a wrong bucket name would
    // otherwise read as a rule doing its job, and every case in this file would pass with the
    // emulator switched off.
    if (String(e && e.code).indexOf("unauthorized") >= 0) {
      console.log("  ok    " + name);
      passed++;
    } else {
      console.error("  FAIL  " + name + " -- denied for the wrong reason: " + (e.code || e.message));
      failed++;
    }
  }
}

const testEnv = await initializeTestEnvironment({
  projectId: "demo-alpha-storage-rules",
  storage: { rules: readFileSync(rulesPath, "utf8"), host, port: Number(port) },
});

// Seed with the rules switched off, so the read, list and delete cases aim at something real.
await testEnv.withSecurityRulesDisabled(async (ctx) => {
  const s = ctx.storage();
  await uploadBytes(ref(s, LOGO), PNG, IMG);
  await uploadBytes(ref(s, "clinics/" + CLINIC + "/patients/p1/media/seed.png"), PNG, IMG);
  await uploadBytes(ref(s, "clinical_notes/tooth_11_legacy.jpg"), PNG, IMG);
  await uploadBytes(ref(s, "staff_profiles/" + ALICE + "_seed"), PNG, IMG);
});

const anon = testEnv.unauthenticatedContext().storage();
const alice = testEnv.authenticatedContext(ALICE).storage();

console.log("a visitor who is not signed in");
await denied("cannot upload a clinic logo", () =>
  uploadBytes(ref(anon, "clinics/" + CLINIC + "/clinic_profile/logo_anon.png"), PNG, IMG)
);
await denied("cannot read a clinic file by path", () => getMetadata(ref(anon, LOGO)));

console.log("a signed-in user, on a clinic folder");
// The case in the screenshot: Settings > Clinic > Logo > Save. Under the expired console template
// this was denied outright; under the never-deployed first draft of storage.rules it would have
// been denied too, because the Firestore lookup in it returns nothing for everybody.
await allowed("can upload a clinic logo", () =>
  uploadBytes(ref(alice, "clinics/" + CLINIC + "/clinic_profile/logo_1724.png"), PNG, IMG)
);
// getDownloadURL(), which the app calls moments after every upload, is a get.
await allowed("can read a clinic file by path", () => getMetadata(ref(alice, LOGO)));
// Alice has no membership of this clinic anywhere — there is no Firestore data in this test at all.
// That the two cases above pass IS the gap documented at the top of storage.rules: the rule cannot
// tell a member from a stranger who knows the clinic id. When custom claims or signed upload URLs
// land, these two turn into denials for a non-member and this test has to be rewritten.
await denied("cannot list a clinic folder", () =>
  listAll(ref(alice, "clinics/" + CLINIC + "/patients/p1/media"))
);
await denied("cannot delete a clinic file", () => deleteObject(ref(alice, LOGO)));
await denied("cannot upload more than 20 MB", () =>
  uploadBytes(ref(alice, "clinics/" + CLINIC + "/patients/p1/media/huge.png"), new Uint8Array(21 * 1024 * 1024), IMG)
);

console.log("a signed-in user, on staff_profiles");
await allowed("can upload a picture named for their own uid", () =>
  uploadBytes(ref(alice, "staff_profiles/" + ALICE + "_1724"), PNG, IMG)
);
await denied("cannot upload a picture named for somebody else", () =>
  uploadBytes(ref(alice, "staff_profiles/" + BOB + "_1724"), PNG, IMG)
);
await denied("cannot upload a non-image", () =>
  uploadBytes(ref(alice, "staff_profiles/" + ALICE + "_doc"), PNG, { contentType: "application/pdf" })
);

console.log("the frozen legacy prefixes");
await denied("cannot be read", () => getMetadata(ref(alice, "clinical_notes/tooth_11_legacy.jpg")));
await denied("cannot be listed", () => listAll(ref(alice, "clinical_notes")));
await denied("cannot be written", () =>
  uploadBytes(ref(alice, "clinical_notes/tooth_11_new.jpg"), PNG, IMG)
);

console.log("anything the ruleset does not name");
await denied("cannot be written", () => uploadBytes(ref(alice, "scratch/anything.png"), PNG, IMG));

await testEnv.cleanup();

console.log("");
console.log(failed === 0 ? "PASS " + passed + " storage rule cases" : "FAIL " + failed + " of " + (passed + failed));
process.exit(failed === 0 ? 0 : 1);
