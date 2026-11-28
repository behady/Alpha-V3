/**
 * End-to-end: a paid-daily dentist's automatic day's share, against the Firestore emulator.
 *
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8085 npm run test:daily-pay-route
 *
 * Runs the real route handlers (payments, payouts, the switch, the nightly check) with nothing
 * mocked but the login check. Plays: payments taken, edited and deleted for a dentist who is paid
 * daily; a dentist who is not; the switch turned on and off; a hand edit refused; the nightly check
 * repairing a damaged line; and a second clinic that must come out byte-for-byte untouched.
 */

import { createServer } from "node:http";
import { generateKeyPairSync } from "node:crypto";

const PROJECT = "demo-daily-pay";
const CLINIC = "C1";
const OTHER = "C2";
const UID = "admin-1";

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
process.env.CRON_SECRET = "test-cron-secret";

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
const { clinicTimeZone, ymdInTimeZone } = await import("../src/lib/clinicDate");
const ledgerRoute = await import("../src/app/api/finance/ledger/route");
const settlementsRoute = await import("../src/app/api/staff/settlements/route");
const switchRoute = await import("../src/app/api/staff/daily-pay/route");
const nightlyRoute = await import("../src/app/api/automation/daily-pay-check/route");

const db = adminDb();
const clinicRef = (id: string) => db.collection("clinics").doc(id);
const col = (name: string, clinic = CLINIC) => clinicRef(clinic).collection(name);
const TOKEN = idToken(UID);
const TODAY = ymdInTimeZone(clinicTimeZone());

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
async function call(handler: (r: Request) => Promise<Response>, method: "POST" | "GET", path: string, body?: unknown, auth = `Bearer ${TOKEN}`): Promise<{ status: number; json: Json }> {
  const res = await handler(
    new Request(`http://localhost${path}`, {
      method,
      headers: { authorization: auth, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  );
  return { status: res.status, json: (await res.json()) as Json };
}
const pay = (procedureId: string, amount: number) =>
  call(ledgerRoute.POST, "POST", "/api/finance/ledger", { clinicId: CLINIC, action: "create-payment", patientId: "P1", procedureId, amount, date: TODAY, method: "Cash" });
const editPay = (id: string, amount: number) =>
  call(ledgerRoute.POST, "POST", "/api/finance/ledger", { clinicId: CLINIC, action: "update", id, patch: { paid: amount } });
const deletePay = (id: string) => call(ledgerRoute.POST, "POST", "/api/finance/ledger", { clinicId: CLINIC, action: "delete", id });
const dayId = (staff: string) => `daily_${staff}_${TODAY}_all`;
const dayRow = (staff: string) => `dailypay_${staff}_${TODAY}_all`;
const get = async (name: string, id: string, clinic = CLINIC) => {
  const s = await col(name, clinic).doc(id).get();
  return s.exists ? (s.data() as Json) : null;
};

async function snapshotClinic(clinic: string): Promise<string> {
  const parts: string[] = [];
  for (const name of ["ledger", "staff_settlements", "staff"]) {
    const snap = await col(name, clinic).get();
    for (const d of snap.docs.sort((a, b) => a.id.localeCompare(b.id))) {
      const data = { ...d.data() };
      parts.push(`${name}/${d.id}=${JSON.stringify(data, Object.keys(data).sort())}`);
    }
  }
  return parts.join("\n");
}

// --- seed ------------------------------------------------------------------------------------------
for (const id of [CLINIC, OTHER]) await db.recursiveDelete(clinicRef(id));
await db.recursiveDelete(db.collection("users").doc(UID));
await db.collection("users").doc(UID).set({ name: "Owner", clinicRoles: { [CLINIC]: "Admin", [OTHER]: "Admin" } });

for (const id of [CLINIC, OTHER]) {
  await clinicRef(id).set({ name: `Clinic ${id}`, status: "Active", subscriptionTier: "Premium" });
  await col("patients", id).doc("P1").set({ name: "Test Patient", phone: "+201000000001" });
}
// C1: Ehab is paid daily, Yahia is not.
await col("staff").doc("ehab").set({ name: "Ehab", role: "Dentist", isDentist: true, commissionPercentage: 50, paidDaily: true, paidDailyFrom: "2026-01-01" });
await col("staff").doc("yahia").set({ name: "Yahia", role: "Dentist", isDentist: true, commissionPercentage: 40 });
for (const [id, doctorId, doctorName, cost] of [["T1", "ehab", "Ehab", 1000], ["T2", "ehab", "Ehab", 600], ["T3", "yahia", "Yahia", 500]] as const) {
  await col("ledger").doc(id).set({ type: "procedure", patientId: "P1", description: `Work ${id}`, amount: cost, cost, paid: 0, doctorId, doctorName, date: TODAY, payerId: "private" });
}
// C2: a dentist with the switch OFF and money on the books; nothing here may change.
await col("staff", OTHER).doc("ehab").set({ name: "Ehab", role: "Dentist", isDentist: true, commissionPercentage: 50 });
await col("ledger", OTHER).doc("X1").set({ type: "procedure", patientId: "P1", description: "Other", amount: 800, cost: 800, paid: 800, doctorId: "ehab", doctorName: "Ehab", date: TODAY });
await col("ledger", OTHER).doc("X2").set({ type: "payment", patientId: "P1", description: "Payment for Other", amount: 800, paid: 800, procedureId: "X1", doctorId: "ehab", doctorName: "Ehab", doctorCommissionAmount: 400, doctorCommissionPercentage: 50, date: TODAY });
const otherBefore = await snapshotClinic(OTHER);

// --- a payment for the paid-daily dentist writes the day's share ------------------------------------
console.log("payments for a paid-daily dentist");
const p1 = await pay("T1", 400);
check("payment 1 saved", p1.status === 200, p1.json);
let day = await get("staff_settlements", dayId("ehab"));
check("the day's share exists", day !== null);
check("…equal to his half of it (200)", day?.amount === 200, day?.amount);
check("…and names that payment", JSON.stringify(day?.paymentIds) === JSON.stringify([p1.json.id]), day?.paymentIds);
check("…marked automatic", day?.auto === "daily" && day?.kind === "payout");
let row = await get("ledger", dayRow("ehab"));
check("its Salary row is on Finance", row?.type === "expense" && row?.category === "Salary" && row?.cost === 200 && row?.dailyPay === true, row);
check("…linked to the day's share", row?.settlementId === dayId("ehab") && row?.staffId === "ehab");
check("…named as the day's share", row?.description === "Day's share – Ehab", row?.description);
check("…with no dentist of its own (it is not his work)", !row?.doctorId);
const p1row = await get("ledger", p1.json.id);
check("the payment reads as paid to him", p1row?.doctorCommissionPaid === 200, p1row?.doctorCommissionPaid);

const p2 = await pay("T2", 600);
day = await get("staff_settlements", dayId("ehab"));
check("a second payment adds to the same day (200 + 300)", day?.amount === 500, day?.amount);
check("…naming both payments", day?.paymentIds?.length === 2);
row = await get("ledger", dayRow("ehab"));
check("…and the Salary row follows", row?.cost === 500 && row?.amount === 500, row);

// --- a dentist with the switch off gets nothing ----------------------------------------------------
console.log("a dentist who is not paid daily");
const p3 = await pay("T3", 500);
check("payment saved", p3.status === 200, p3.json);
check("no day's share for him", (await get("staff_settlements", dayId("yahia"))) === null);
check("no Salary row for him", (await get("ledger", dayRow("yahia"))) === null);
const yahiaSettlements = await col("staff_settlements").where("staffId", "==", "yahia").get();
check("nothing at all written to his payouts", yahiaSettlements.empty);

// --- edits and deletes move the line --------------------------------------------------------------
console.log("edits and deletes");
const e1 = await editPay(p1.json.id, 200);
check("payment 1 edited to 200", e1.status === 200, e1.json);
const p1edited = await get("ledger", p1.json.id);
check("…its share is now 100", p1edited?.doctorCommissionAmount === 100, { amount: p1edited?.amount, paid: p1edited?.paid, share: p1edited?.doctorCommissionAmount });
day = await get("staff_settlements", dayId("ehab"));
check("the day's share follows the edit (100 + 300)", day?.amount === 400, day?.amount);
const d2 = await deletePay(p2.json.id);
check("payment 2 deleted", d2.status === 200, d2.json);
day = await get("staff_settlements", dayId("ehab"));
check("the day's share drops to 100", day?.amount === 100, day?.amount);
check("…and names only payment 1", JSON.stringify(day?.paymentIds) === JSON.stringify([p1.json.id]), day?.paymentIds);

// --- nobody edits the automatic line by hand ---------------------------------------------------------
console.log("hand edits are refused");
const u = await call(settlementsRoute.POST, "POST", "/api/staff/settlements", { clinicId: CLINIC, action: "update", id: dayId("ehab"), amount: 5 });
check("editing it is refused", u.status === 409, u);
const del = await call(settlementsRoute.POST, "POST", "/api/staff/settlements", { clinicId: CLINIC, action: "delete", id: dayId("ehab") });
check("deleting it is refused", del.status === 409, del);
check("…and it is untouched", (await get("staff_settlements", dayId("ehab")))?.amount === 100);
const rowEdit = await call(ledgerRoute.POST, "POST", "/api/finance/ledger", { clinicId: CLINIC, action: "update", id: dayRow("ehab"), patch: { amount: 5 } });
check("its Salary row cannot be edited on Finance either", rowEdit.status >= 400, rowEdit);

// --- the last payment of the day goes: the line goes ------------------------------------------------
const d1 = await deletePay(p1.json.id);
check("payment 1 deleted", d1.status === 200, d1.json);
check("no payments left that day: the share is removed", (await get("staff_settlements", dayId("ehab"))) === null);
check("…and its Salary row too", (await get("ledger", dayRow("ehab"))) === null);

// --- the switch ----------------------------------------------------------------------------------------
console.log("turning the switch on and off");
const on = await call(switchRoute.POST, "POST", "/api/staff/daily-pay", { clinicId: CLINIC, staffId: "yahia", paidDaily: true });
check("switched on", on.status === 200 && on.json.paidDaily === true, on.json);
check("…from today", (await get("staff", "yahia"))?.paidDailyFrom === TODAY);
day = await get("staff_settlements", dayId("yahia"));
check("today's earlier payment is covered at once (40% of 500)", day?.amount === 200, day?.amount);
const off = await call(switchRoute.POST, "POST", "/api/staff/daily-pay", { clinicId: CLINIC, staffId: "yahia", paidDaily: false });
check("switched off", off.status === 200 && off.json.paidDaily === false, off.json);
await col("ledger").doc("T4").set({ type: "procedure", patientId: "P1", description: "Work T4", amount: 300, cost: 300, paid: 0, doctorId: "yahia", doctorName: "Yahia", date: TODAY, payerId: "private" });
await pay("T4", 300);
check("switched off, a new payment leaves the old line frozen", (await get("staff_settlements", dayId("yahia")))?.amount === 200);

// --- the nightly check ---------------------------------------------------------------------------------
console.log("the nightly check");
const p5 = await pay("T1", 1000);
check("a fresh payment for the paid-daily dentist", (await get("staff_settlements", dayId("ehab")))?.amount === 500);
await col("staff_settlements").doc(dayId("ehab")).update({ amount: 999 });
await col("ledger").doc(dayRow("ehab")).update({ amount: 999, cost: 999 });
const unauth = await call(nightlyRoute.GET, "GET", "/api/automation/daily-pay-check", undefined, "Bearer wrong");
check("the nightly check refuses a caller without the secret", unauth.status === 401);
const night = await call(nightlyRoute.GET, "GET", "/api/automation/daily-pay-check", undefined, "Bearer test-cron-secret");
check("the nightly check ran", night.status === 200 && night.json.ok === true, night.json);
check("…and put the damaged line right", (await get("staff_settlements", dayId("ehab")))?.amount === 500);
check("…and its Salary row", (await get("ledger", dayRow("ehab")))?.cost === 500);
check("…and left the switched-off dentist's line alone", (await get("staff_settlements", dayId("yahia")))?.amount === 200);
check("payment 5 reads as paid", (await get("ledger", p5.json.id))?.doctorCommissionPaid === 500);

// --- the other clinic ---------------------------------------------------------------------------------
console.log("the other clinic");
const otherAfter = await snapshotClinic(OTHER);
check("clinic C2 is exactly as it was", otherAfter === otherBefore, otherAfter === otherBefore ? "" : "changed");

console.log(`\n${passed} passed, ${failed} failed`);
authServer.close();
process.exit(failed === 0 ? 0 : 1);
