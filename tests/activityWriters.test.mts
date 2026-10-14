/**
 * The activity-log v2 writers, against the Firestore emulator: the server event writer and the
 * ledger pair's `event` path. Same harness as branchMoneyRoutes.test.mts — only the login check is
 * stood in for.
 *
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8085 npm run test:activity-writers
 */

import { createServer } from "node:http";
import { generateKeyPairSync } from "node:crypto";

const PROJECT = "demo-activity-writers";
const CLINIC = "AW1";

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

const { adminDb } = await import("../src/lib/firebaseAdmin");
const { logEventServer } = await import("../src/lib/server/systemLog");
const { recordMoneyChange } = await import("../src/lib/server/ledgerAudit");
const { patientNameOf } = await import("../src/lib/server/patientName");

const db = adminDb();
const clinic = db.collection("clinics").doc(CLINIC);
await db.recursiveDelete(clinic);
await clinic.set({ name: "Writers Test", status: "Active" });
const logs = clinic.collection("system_logs");

let failed = 0;
function check(label: string, condition: boolean, detail: unknown = "") {
  if (condition) console.log(`  ok    ${label}`);
  else {
    console.log(`  FAIL  ${label}${detail !== "" ? ` — ${JSON.stringify(detail)}` : ""}`);
    failed += 1;
  }
}
type Json = Record<string, any>;
async function newest(): Promise<Json | undefined> {
  const snap = await logs.orderBy("timestamp", "desc").limit(1).get();
  return snap.docs[0]?.data() as Json | undefined;
}

console.log("logEventServer");
await logEventServer({
  clinicId: CLINIC,
  user: { uid: "u1", name: "Malak", role: "Assistant" },
  event: {
    event: "payment.received",
    amount: 800,
    patientName: "عمر",
    refs: { method: "Cash" },
    reason: undefined as any,
  },
});
const d = await newest();
check("a row was written", !!d);
check("v is 2", d?.v === 2, d?.v);
check("categories is [money]", JSON.stringify(d?.categories) === JSON.stringify(["money"]), d?.categories);
check("flag is false", d?.flag === false, d?.flag);
check("action is Payment Received", d?.action === "Payment Received", d?.action);
check("details mention 800 EGP", String(d?.details).includes("800 EGP"), d?.details);
check("userName is Malak", d?.userName === "Malak", d?.userName);
check("legacy user key matches", d?.user === "Malak");
check("userId and userRole kept", d?.userId === "u1" && d?.userRole === "Assistant");
check("event key kept", d?.event === "payment.received", d?.event);
check("amount and patientName kept", d?.amount === 800 && d?.patientName === "عمر");
check("refs kept", d?.refs?.method === "Cash", d?.refs);
check("undefined reason is not stored", ("reason" in (d ?? {})) === false);
check("date is YYYY-MM-DD", /^\d{4}-\d{2}-\d{2}$/.test(d?.date ?? ""), d?.date);
check("timestamp set", !!d?.timestamp);

console.log("logEventServer without a name");
for (const x of (await logs.get()).docs) await x.ref.delete();
await logEventServer({ clinicId: CLINIC, user: {}, event: { event: "payment.received", amount: 5 } });
const anon = await newest();
check("falls back to Unknown User", anon?.userName === "Unknown User" && anon?.user === "Unknown User", anon?.userName);
check("null userId", anon?.userId === null);

console.log("recordMoneyChange with an event");
for (const x of (await logs.get()).docs) await x.ref.delete();
const entry = {
  clinicId: CLINIC,
  action: "create" as const,
  collection: "ledger" as const,
  documentId: "L1",
  after: { amount: 800 },
  actor: { uid: "u1", name: "Malak", role: "Assistant" },
  via: "test:event",
};
await recordMoneyChange({ entry, action: "IGNORED", details: "ignored", event: { event: "payment.received", amount: 800 } });
const viaEvent = await newest();
check("activity line comes from the event", viaEvent?.v === 2 && viaEvent?.action === "Payment Received", viaEvent);
const audit = await clinic.collection("ledger_audit").where("documentId", "==", "L1").get();
check("ledger_audit still written", audit.size === 1);

console.log("recordMoneyChange without an event");
for (const x of (await logs.get()).docs) await x.ref.delete();
await recordMoneyChange({ entry: { ...entry, documentId: "L2" }, action: "Payment Received", details: "old style" });
const old = await newest();
check("legacy line unchanged", old?.action === "Payment Received" && old?.details === "old style" && old?.v === undefined, old);
check("legacy module is finance", old?.module === "finance", old?.module);

console.log("patientNameOf");
await clinic.collection("patients").doc("P1").set({ name: "Omar" });
check("returns the name", (await patientNameOf(CLINIC, "P1")) === "Omar");
check("missing patient is null", (await patientNameOf(CLINIC, "nope")) === null);
check("empty id is null", (await patientNameOf(CLINIC, "")) === null);
check("null id is null", (await patientNameOf(CLINIC, null)) === null);

await db.recursiveDelete(clinic);
authServer.close();
console.log(failed ? `\n${failed} check(s) FAILED` : "\nall checks passed");
process.exit(failed ? 1 : 0);
