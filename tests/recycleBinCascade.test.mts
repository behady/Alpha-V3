/**
 * End-to-end test for deleting a patient with their whole file, against the Firestore emulator.
 *
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8085 npm run test:bin-cascade
 *
 * Runs the real route handlers — delete, bin list, restore, purge, and the insurance save — with
 * nothing mocked but the login check: the Auth emulator is replaced by a tiny server that answers
 * the one lookup verifyIdToken makes, so this needs the Firestore emulator alone.
 *
 * The story it plays is the one that went wrong on 2026-10-04: a patient with charges, payments,
 * visits and an insurance approval is deleted, and Finance and the Insurance page kept showing
 * all of it; then the same approval was saved again from the paper, and deleting it a second time
 * failed with "An earlier version of this record is already in Recently Deleted".
 */

import { createServer } from "node:http";
import { generateKeyPairSync } from "node:crypto";
import { SAMPLE_RAW } from "./fixtures/insuranceMetlife.fixture";

const PROJECT = "demo-bin-cascade";
const CLINIC = "C1";
const UID = "admin-1";
const ASSISTANT = "assistant-1";

const { privateKey: PEM } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});

// The login check: verifyIdToken, in emulator mode, skips the signature and asks the Auth emulator
// whether the account still exists. This answers that one question.
const authServer = createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    res.setHeader("content-type", "application/json");
    if (!req.url?.includes("accounts:lookup")) {
      res.statusCode = 404;
      res.end("{}");
      return;
    }
    const ids = (JSON.parse(body || "{}").localId as string[] | undefined) ?? [];
    res.end(JSON.stringify({ users: ids.map((localId) => ({ localId, disabled: false, validSince: "0" })) }));
  });
});
await new Promise<void>((resolve) => authServer.listen(0, "127.0.0.1", resolve));
const authPort = (authServer.address() as { port: number }).port;

process.env.FIREBASE_PROJECT_ID = PROJECT;
process.env.FIREBASE_CLIENT_EMAIL = `sa@${PROJECT}.iam.gserviceaccount.com`;
process.env.FIREBASE_PRIVATE_KEY = PEM;
process.env.FIRESTORE_EMULATOR_HOST ||= "127.0.0.1:8085";
process.env.FIREBASE_AUTH_EMULATOR_HOST = `127.0.0.1:${authPort}`;

/** An unsigned emulator ID token: what the Auth emulator itself hands out. */
function idToken(uid: string): string {
  const now = Math.floor(Date.now() / 1000);
  const enc = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${enc({ alg: "none", typ: "JWT" })}.${enc({
    iss: `https://securetoken.google.com/${PROJECT}`,
    aud: PROJECT,
    sub: uid,
    user_id: uid,
    iat: now,
    exp: now + 3600,
    auth_time: now,
    firebase: { sign_in_provider: "password", identities: {} },
  })}.`;
}

const { adminDb } = await import("../src/lib/firebaseAdmin");
const { liveEntryId } = await import("../src/lib/server/recycleBinStore");
const deleteRoute = await import("../src/app/api/records/delete/route");
const binRoute = await import("../src/app/api/records/bin/route");
const restoreRoute = await import("../src/app/api/records/restore/route");
const purgeRoute = await import("../src/app/api/records/purge/route");
const claimsRoute = await import("../src/app/api/insurance/claims/route");

const db = adminDb();
const clinic = db.collection("clinics").doc(CLINIC);
const col = (name: string) => clinic.collection(name);
const bin = db.collection("deleted_records");
const TOKEN = idToken(UID);
let as = TOKEN;

let passed = 0;
let failed = 0;
function check(label: string, condition: boolean, detail: unknown = "") {
  if (condition) {
    console.log(`  ok    ${label}`);
    passed += 1;
  } else {
    console.log(`  FAIL  ${label}${detail !== "" ? ` — ${typeof detail === "string" ? detail : JSON.stringify(detail)}` : ""}`);
    failed += 1;
  }
}

type Json = Record<string, any>;
async function call(handler: (r: Request) => Promise<Response>, method: "POST" | "GET", path: string, body?: unknown): Promise<{ status: number; json: Json }> {
  const res = await handler(
    new Request(`http://localhost${path}`, {
      method,
      headers: { authorization: `Bearer ${as}`, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  );
  return { status: res.status, json: (await res.json()) as Json };
}
const deletePatient = (id: string, acknowledgeOrphans?: boolean) =>
  call(deleteRoute.POST, "POST", "/api/records/delete", { clinicId: CLINIC, items: [{ collection: "patients", documentId: id }], ...(acknowledgeOrphans ? { acknowledgeOrphans } : {}) });
const deleteOne = (collection: string, id: string) =>
  call(deleteRoute.POST, "POST", "/api/records/delete", { clinicId: CLINIC, items: [{ collection, documentId: id }] });
const listBin = () => call(binRoute.GET, "GET", `/api/records/bin?clinicId=${CLINIC}`);
const restore = (entryId: string) => call(restoreRoute.POST, "POST", "/api/records/restore", { clinicId: CLINIC, entryId });
const purge = (entryId: string) => call(purgeRoute.POST, "POST", "/api/records/purge", { clinicId: CLINIC, entryId });
const saveClaim = (patient: Json) =>
  call(claimsRoute.POST, "POST", "/api/insurance/claims", { clinicId: CLINIC, docId: "doc-1", payerId: "metlife", extraction: SAMPLE_RAW, patient });

const entryOf = (collection: string, id: string) => liveEntryId(CLINIC, collection, id);
const exists = async (collection: string, id: string) => (await col(collection).doc(id).get()).exists;
const countFor = async (collection: string, patientId: string) => (await col(collection).where("patientId", "==", patientId).count().get()).data().count;

async function wipe() {
  for (const d of (await bin.where("clinicId", "==", CLINIC).get()).docs) await db.recursiveDelete(d.ref);
  await db.recursiveDelete(clinic);
  await db.recursiveDelete(db.collection("users").doc(UID));
  await db.recursiveDelete(db.collection("users").doc(ASSISTANT));
}

// --- the clinic, one admin, one insurer, two patients ----------------------------------------------
await wipe();
await clinic.set({ name: "Cascade Test", status: "Active", subscriptionTier: "Premium", features: { insurance: true } });
await db.collection("users").doc(UID).set({ name: "Tester", clinicRoles: { [CLINIC]: "Admin" } });
// May delete a patient card, but not money or visit notes on their own.
await db.collection("users").doc(ASSISTANT).set({ name: "Desk", clinicRoles: { [CLINIC]: "Assistant" }, clinicPermissions: { [CLINIC]: ["patients.delete", "patients.add", "patients.edit"] } });
await col("settings").doc("payers").set({ payers: [{ id: "metlife", name: "MetLife", format: "metlife", providerCode: "DNC0001", active: true }] });

await col("patients").doc("P1").set({ name: "EXAMPLE PATIENT NAME", phone: "+201000000001" });
await col("patients").doc("P2").set({ name: "Somebody Else", phone: "+201000000002" });
await col("patients").doc("P3").set({ name: "Nothing Linked", phone: "+201000000003" });
await col("ledger").doc("L1").set({ patientId: "P1", type: "procedure", description: "Crown", amount: 500, paid: 500 });
await col("ledger").doc("L2").set({ patientId: "P1", type: "payment", description: "Cash", paid: 500, procedureId: "L1" });
await col("ledger").doc("L9").set({ patientId: "P2", type: "procedure", description: "Filling", amount: 300 });
await col("appointments").doc("A1").set({ patientId: "P1", date: "2026-10-05", time: "19:00" });
await col("clinical_notes").doc("N1").set({ patientId: "P1", procedure: "Crown", ledgerId: "L1" });
await col("prescriptions").doc("RX1").set({ patientId: "P1", drugName: "Amoxicillin" });
await col("patient_media").doc("M1").set({ patientId: "P1", fileName: "pa.jpg", storagePath: `clinics/${CLINIC}/patients/P1/pa.jpg` });
await col("treatment_plans").doc("TP1").set({ patientId: "P1", title: "Full mouth", status: "accepted" });
await col("lab_cases").doc("LC1").set({ patientId: "P1", code: "LAB-0001" });
// Filed under the patient's own id, with no patientId field: written before the field existed.
await col("ortho_cases").doc("P1").set({ startedAt: "2026-01-01" });

console.log("insurance approval saved for the patient");
{
  const { status, json } = await saveClaim({ id: "P1" });
  check("the paper saves as a treated approval", status === 201, json);
  check("its five treatment charges are in the patient's ledger", (await countFor("ledger", "P1")) === 7);
}
const CLAIM = "metlife_d6000001";

console.log("deleting the patient: first the counts");
{
  const { status, json } = await deletePatient("P1");
  check("the first call stops with what would go", status === 409 && json.reason === "HAS_CHILDREN", json);
  check("the counts name the money, the visit, the approval", json.counts?.ledger === 7 && json.counts?.appointments === 1 && json.counts?.insurance_claims === 1, json.counts);
  check("the ortho case filed under the patient's id is counted", json.counts?.ortho_cases === 1, json.counts);
  check("the message says they go to Recently Deleted", /Recently Deleted/.test(json.error), json.error);
  check("nothing moved yet", await exists("patients", "P1") && await exists("ledger", "L1"));
}

console.log("deleting the patient without permission to delete money");
{
  as = idToken(ASSISTANT);
  const { status, json } = await deletePatient("P1", true);
  as = TOKEN;
  check("is refused before anything moves", status === 403 && json.reason === "CASCADE_NO_PERMISSION", json);
  check("and names what is missing", /finance\.delete/.test(json.error ?? "") && /clinical\.delete/.test(json.error ?? ""), json.error);
  check("nothing moved", (await exists("patients", "P1")) && (await countFor("ledger", "P1")) === 7);
}

const LINKED = 7 + 6 + 1 + 1 + 1 + 1 + 1 + 1; // ledger, notes, appointment, rx, media, plan, ortho, approval
console.log("deleting the patient: confirmed");
{
  const { status, json } = await deletePatient("P1", true);
  const item = json.results?.[0];
  check("the patient is deleted", status === 200 && item?.status === "deleted", json);
  check("and says how many records went with them", item?.linked === LINKED, item);
  check("the patient's charges and payments are gone from the books", (await countFor("ledger", "P1")) === 0);
  check("the approval is gone from the Insurance page", !(await exists("insurance_claims", CLAIM)));
  check("the visit, notes, image, plan and ortho case are gone",
    !(await exists("appointments", "A1")) && (await countFor("clinical_notes", "P1")) === 0 && !(await exists("patient_media", "M1")) &&
    !(await exists("treatment_plans", "TP1")) && !(await exists("ortho_cases", "P1")));
  check("the lab case stays: it is what the clinic owes the lab", await exists("lab_cases", "LC1"));
  check("another patient's money is untouched", await exists("ledger", "L9"));
  const children = await bin.where("cascadeOf", "==", entryOf("patients", "P1")).get();
  check("every linked record is in the bin as the patient's child", children.size === LINKED, children.size);
  check("children carry the patient's name for the restore hint", children.docs.every((d) => d.data().cascadeParentLabel === "EXAMPLE PATIENT NAME"));
  const media = children.docs.find((d) => d.data().collection === "patient_media");
  check("the image's file path is kept on its entry", media?.data().storagePaths?.[0] === `clinics/${CLINIC}/patients/P1/pa.jpg`);
  const audits = await col("ledger_audit").where("via", "==", "records/delete:patient").get();
  check("each charge and payment leaves an audit row", audits.size === 7, audits.size);
}

console.log("Recently Deleted");
{
  const { json } = await listBin();
  const rows = json.entries as Json[];
  check("lists the patient once, not every record", rows.length === 1 && rows[0].collection === "patients", rows.map((r) => r.label));
  check("with the linked count on the row", rows[0]?.linked === LINKED, rows[0]);
  const child = await restore(entryOf("ledger", "L1"));
  check("a charge cannot be restored without its patient", child.status === 409 && child.json.reason === "CASCADE_CHILD", child.json);
  check("and the refusal names the patient", /EXAMPLE PATIENT NAME/.test(child.json.error ?? ""), child.json.error);
  const childPurge = await purge(entryOf("insurance_claims", CLAIM));
  check("an approval cannot be purged without its patient", childPurge.status === 409 && childPurge.json.reason === "CASCADE_CHILD", childPurge.json);
}

console.log("saving the same paper while the patient is deleted");
{
  const { status, json } = await saveClaim({ create: { name: "EXAMPLE PATIENT NAME" } });
  check("the save is refused, pointing at Recently Deleted", status === 409 && !!json.inBin, json);
  check("and names the patient it was deleted with", json.inBin?.withParent === "EXAMPLE PATIENT NAME", json.inBin);
  const created = await col("patients").where("name", "==", "EXAMPLE PATIENT NAME").get();
  check("no second patient was created by the refused save", created.empty);
}

console.log("restoring the patient");
{
  const { status, json } = await restore(entryOf("patients", "P1"));
  check("the patient comes back", status === 200 && json.ok === true, json);
  check("with every charge and payment", (await countFor("ledger", "P1")) === 7);
  check("with the approval, the visit and the ortho case", (await exists("insurance_claims", CLAIM)) && (await exists("appointments", "A1")) && (await exists("ortho_cases", "P1")));
  const l1 = (await col("ledger").doc("L1").get()).data();
  check("money comes back exactly as it was", l1?.amount === 500 && l1?.paid === 500 && l1?.description === "Crown", l1);
  check("an accepted plan comes back as a draft, so it texts nobody", (await col("treatment_plans").doc("TP1").get()).data()?.status === "draft");
  check("the bin is empty again", (await bin.where("clinicId", "==", CLINIC).where("status", "==", "deleted").get()).empty);
  const audits = await col("ledger_audit").where("via", "==", "records/restore").get();
  check("money coming back is audited too", audits.size === 7, audits.size);
}

console.log("an approval deleted on its own, then the paper saved again");
{
  const del = await deleteOne("insurance_claims", CLAIM);
  check("the approval goes, with its treatment rows", del.json.results?.[0]?.status === "deleted" && (await countFor("ledger", "P1")) === 2, del.json);
  const { json } = await listBin();
  check("the bin lists the approval once, with its 10 rows counted", json.entries.length === 1 && json.entries[0].linked === 10, json.entries);
  const again = await saveClaim({ id: "P1" });
  check("saving the same paper is refused", again.status === 409 && !!again.json.inBin, again.json);
  check("as an approval of its own, not a patient's", again.json.inBin?.withParent === null, again.json.inBin);
}

console.log("the trap from before this change: a second copy saved while the first is in the bin");
{
  // What the old save allowed: the same approval id, live again, while its first copy is binned.
  await col("insurance_claims").doc(CLAIM).set({ patientId: "P1", approvalNumber: "D6000001", patientName: "EXAMPLE PATIENT NAME" });
  const { json } = await deletePatient("P1", true);
  const item = json.results?.[0];
  check("deleting the patient is refused, not half-done", item?.status === "alreadyInBin", json);
  check("the refusal names the approval in the way", /Approval D6000001/.test(item?.error ?? ""), item?.error);
  check("and says to delete the old copy permanently", /permanently/.test(item?.error ?? ""));
  check("nothing moved", (await exists("patients", "P1")) && (await countFor("ledger", "P1")) === 2 && (await exists("insurance_claims", CLAIM)));

  const cleared = await purge(entryOf("insurance_claims", CLAIM));
  check("an admin clears the old copy", cleared.status === 200, cleared.json);
  check("its treatment rows leave the bin with it", (await bin.where("cascadeOf", "==", entryOf("insurance_claims", CLAIM)).get()).empty);
  const retry = await deletePatient("P1", true);
  check("then the patient deletes", retry.json.results?.[0]?.status === "deleted", retry.json);
}

console.log("a patient and their own paid approval named in one request");
{
  await col("patients").doc("P4").set({ name: "Fourth Patient", phone: "+201000000004" });
  await col("ledger").doc("L41").set({ patientId: "P4", type: "procedure", description: "Crown", amount: 400, paid: 100 });
  await col("clinical_notes").doc("N41").set({ patientId: "P4", procedure: "Crown", ledgerId: "L41" });
  await col("insurance_claims").doc("metlife_d6000009").set({ patientId: "P4", approvalNumber: "D6000009", ledgerIds: { 0: { ledgerId: "L41", noteId: "N41" } } });
  const { json } = await call(deleteRoute.POST, "POST", "/api/records/delete", {
    clinicId: CLINIC,
    acknowledgeOrphans: true,
    items: [{ collection: "patients", documentId: "P4" }, { collection: "insurance_claims", documentId: "metlife_d6000009" }],
  });
  const byId = Object.fromEntries((json.results ?? []).map((r: Json) => [r.documentId, r.status]));
  check("both are deleted — the paid approval is not left behind", byId.P4 === "deleted" && byId.metlife_d6000009 === "deleted", json);
  check("nothing of the patient is left live", !(await exists("insurance_claims", "metlife_d6000009")) && !(await exists("ledger", "L41")) && !(await exists("clinical_notes", "N41")));
  const claimEntry = (await bin.doc(entryOf("insurance_claims", "metlife_d6000009")).get()).data();
  check("the approval went as the patient's child", claimEntry?.cascadeOf === entryOf("patients", "P4"), claimEntry);
}

console.log("records imported with a number for the patient id");
{
  await col("patients").doc("900001").set({ name: "Imported Patient", phone: "+201000000005" });
  await col("ledger").doc("L51").set({ patientId: 900001, type: "procedure", description: "Old charge", amount: 50 });
  const { json } = await deletePatient("900001", true);
  check("are found and go with the patient", json.results?.[0]?.status === "deleted" && json.results?.[0]?.linked === 1 && !(await exists("ledger", "L51")), json);
}

console.log("a patient with nothing linked");
{
  const { status, json } = await deletePatient("P3");
  check("deletes on the first call", status === 200 && json.results?.[0]?.status === "deleted", json);
  check("with no linked count", json.results?.[0]?.linked === undefined, json.results?.[0]);
}

await wipe();
authServer.close();
console.log(`\nrecycleBinCascade: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
