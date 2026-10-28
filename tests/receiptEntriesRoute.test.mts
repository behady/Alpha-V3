/**
 * Scanned receipts through the real routes, against the Firestore emulator: the ledger route's
 * `create-receipt-entries` (all rows or none, this clinic's file only) and the receipt-scan route's
 * gates (add-on off, wrong folder). Also pins `create-entry`, which this feature must not change.
 *
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8085 npm run test:receipt-entries-route
 *
 * Same harness as branchMoneyRoutes.test.mts: only the login check is stood in for. The model is
 * never called — every scan request here is refused before it.
 */

import { createServer } from "node:http";
import { generateKeyPairSync } from "node:crypto";

const PROJECT = "demo-receipt-scan";
const CLINIC = "R1";
const OTHER = "R2";
// Switched on from the start: the server caches a clinic's switches for a minute, so one clinic
// cannot be tested both off and on in one run.
const SCANNING = "R3";
const OWNER = "owner-1";
const DESK = "desk-1";
const NURSE = "nurse-1";

const { privateKey: PEM } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});

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
const ledgerRoute = await import("../src/app/api/finance/ledger/route");
const scanRoute = await import("../src/app/api/ai/receipt-scan/route");

const db = adminDb();
const clinic = db.collection("clinics").doc(CLINIC);
const other = db.collection("clinics").doc(OTHER);
const scanning = db.collection("clinics").doc(SCANNING);
const ledger = clinic.collection("ledger");

let passed = 0;
let failed = 0;
function check(label: string, condition: boolean, detail: unknown = "") {
  if (condition) {
    console.log(`  ok    ${label}`);
    passed += 1;
  } else {
    console.log(`  FAIL  ${label}${detail !== "" ? ` — ${JSON.stringify(detail)}` : ""}`);
    failed += 1;
  }
}

type Json = Record<string, any>;
async function post(route: { POST: (r: Request) => Promise<Response> }, uid: string, body: Json) {
  const res = await route.POST(
    new Request("http://localhost/api/test", {
      method: "POST",
      headers: { authorization: `Bearer ${idToken(uid)}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
  return { status: res.status, json: (await res.json()) as Json };
}

const path = (clinicId: string, receiptId: string) => `clinics/${clinicId}/expense_receipts/${receiptId}/bill.jpg`;
const urlFor = (p: string) => `https://firebasestorage.googleapis.com/v0/b/demo.appspot.com/o/${encodeURIComponent(p)}?alt=media&token=t`;
const receipt = (uid: string, extra: Json = {}) =>
  post(ledgerRoute, uid, {
    clinicId: CLINIC,
    action: "create-receipt-entries",
    branchId: "hel",
    receiptId: "rcpt1",
    receiptPath: path(CLINIC, "rcpt1"),
    receiptImageUrl: urlFor(path(CLINIC, "rcpt1")),
    date: "2026-10-27",
    method: "Cash",
    lines: [
      { category: "Supplies", description: "Al Amal — composite, gloves", amount: 1850 },
      { category: "Cleaning", description: "Al Amal — disinfectant", amount: 320 },
    ],
    ...extra,
  });
const count = async () => (await ledger.get()).size;

for (const c of [clinic, other, scanning]) {
  await db.recursiveDelete(c);
  await c.set({ name: "Receipt Test", status: "Active", subscriptionTier: "Premium" });
}
await scanning.set({ features: { aiReceipts: true } }, { merge: true });
await clinic.collection("settings").doc("locations").set({
  branches: [
    { id: "hel", name: "Heliopolis", rooms: [] },
    { id: "tag", name: "Tagamoa", rooms: [] },
  ],
});
await db.collection("users").doc(OWNER).set({ name: "Owner", clinicRoles: { [CLINIC]: "Owner", [SCANNING]: "Owner" } });
await db.collection("users").doc(DESK).set({
  name: "Desk",
  clinicRoles: { [CLINIC]: "Receptionist" },
  clinicPermissions: { [CLINIC]: ["finance.add", "access.appointments"] },
});
await db.collection("users").doc(NURSE).set({
  name: "Nurse",
  clinicRoles: { [CLINIC]: "Assistant" },
  clinicPermissions: { [CLINIC]: ["access.appointments"] },
});
await clinic.collection("staff").doc("desk").set({ uid: DESK, name: "Desk", role: "Receptionist", branchIds: ["hel"] });

console.log("create-entry is exactly as before");
{
  const r = await post(ledgerRoute, DESK, { clinicId: CLINIC, action: "create-entry", type: "expense", amount: 100, description: "Rent", category: "Rent", date: "2026-10-01", branchId: "hel" });
  const stored = (await ledger.doc(r.json.id).get()).data() as Json;
  const keys = Object.keys(stored).sort().join(",");
  check("a typed expense saves", r.status === 200, r);
  check(
    "it carries the same fields it always did, and no receipt fields",
    keys === "addedBy,amount,branchId,category,cost,createdAt,createdBy,date,description,doctor,isRecurring,method,paid,patientId,type",
    keys,
  );
  await ledger.doc(r.json.id).delete();
}

console.log("a checked receipt saves as one expense per category");
{
  const r = await receipt(DESK);
  check("200 with two ids", r.status === 200 && r.json.ids?.length === 2 && r.json.total === 2170, r);
  const rows = await Promise.all((r.json.ids as string[]).map(async (id) => (await ledger.doc(id).get()).data() as Json));
  const supplies = rows.find((x) => x.category === "Supplies");
  const cleaning = rows.find((x) => x.category === "Cleaning");
  check("Supplies row: expense, cost 1850, paid 0", supplies?.type === "expense" && supplies.cost === 1850 && supplies.amount === 1850 && supplies.paid === 0, supplies);
  check("Cleaning row: cost 320", cleaning?.cost === 320, cleaning);
  check(
    "both rows: same date, method, branch, receipt id, photo",
    rows.every((x) => x.date === "2026-10-27" && x.method === "Cash" && x.branchId === "hel" && x.receiptGroupId === "rcpt1" && x.receiptPath === path(CLINIC, "rcpt1") && x.receiptImageUrl === urlFor(path(CLINIC, "rcpt1"))),
    rows,
  );
  check("added by the person who saved", rows.every((x) => x.addedBy === "Desk" && x.createdBy === DESK && x.patientId === null));
  check("each row is in the audit trail", (await clinic.collection("ledger_audit").where("documentId", "in", r.json.ids).get()).size === 2);
}

console.log("one bad line refuses the whole receipt");
{
  const before = await count();
  const zero = await receipt(DESK, { receiptId: "rcpt2", receiptPath: path(CLINIC, "rcpt2"), receiptImageUrl: urlFor(path(CLINIC, "rcpt2")), lines: [{ category: "Supplies", description: "ok", amount: 50 }, { category: "Cleaning", description: "bad", amount: 0 }] });
  check("a zero amount is a 400", zero.status === 400, zero);
  const salary = await receipt(DESK, { receiptId: "rcpt2", receiptPath: path(CLINIC, "rcpt2"), receiptImageUrl: urlFor(path(CLINIC, "rcpt2")), lines: [{ category: "Salary", description: "x", amount: 50 }] });
  check("Salary is not a receipt category: 400", salary.status === 400, salary);
  const none = await receipt(DESK, { lines: [] });
  check("no lines: 400", none.status === 400, none);
  const many = await receipt(DESK, { lines: Array.from({ length: 13 }, () => ({ category: "Supplies", description: "x", amount: 1 })) });
  check("13 lines: 400", many.status === 400, many);
  check("nothing was written", (await count()) === before);
}

console.log("only this clinic's file can be attached");
{
  const before = await count();
  const foreign = await receipt(DESK, { receiptPath: path(OTHER, "rcpt1"), receiptImageUrl: urlFor(path(OTHER, "rcpt1")) });
  check("another clinic's folder: 400", foreign.status === 400, foreign);
  const mismatch = await receipt(DESK, { receiptImageUrl: urlFor(path(CLINIC, "someone-else")) });
  check("a link to a different file: 400", mismatch.status === 400, mismatch);
  const outside = await receipt(DESK, { receiptImageUrl: "https://example.com/bill.jpg" });
  check("a link outside our storage: 400", outside.status === 400, outside);
  check("nothing was written", (await count()) === before);
}

console.log("same people and branches as a typed expense");
{
  const before = await count();
  const nurse = await receipt(NURSE);
  check("no finance.add: 403", nurse.status === 403, nurse);
  const wrongBranch = await receipt(DESK, { branchId: "tag" });
  check("a branch the desk may not use: 403", wrongBranch.status === 403, wrongBranch);
  check("nothing was written", (await count()) === before);
}

console.log("the scan route is shut until the add-on is switched on");
{
  const off = await post(scanRoute, OWNER, { clinicId: CLINIC, receiptId: "rcpt1", path: path(CLINIC, "rcpt1") });
  check("add-on off (the default on every plan): 403 feature_locked", off.status === 403 && off.json.reason === "feature_locked", off);
  const foreign = await post(scanRoute, OWNER, { clinicId: SCANNING, receiptId: "rcpt1", path: path(OTHER, "rcpt1") });
  check("add-on on, another clinic's file: 400", foreign.status === 400, foreign);
  const nurse = await post(scanRoute, NURSE, { clinicId: CLINIC, receiptId: "rcpt1", path: path(CLINIC, "rcpt1") });
  check("no finance.add: 403", nurse.status === 403, nurse);
  const usage = [...(await clinic.collection("ai_usage").get()).docs, ...(await scanning.collection("ai_usage").get()).docs];
  check("no credits were charged for any refusal", usage.length === 0);
}

for (const c of [clinic, other, scanning]) await db.recursiveDelete(c);
authServer.close();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
