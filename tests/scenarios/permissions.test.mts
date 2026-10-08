/**
 * Scenarios R76–R100: PERMISSIONS, ROLES & CLINIC ISOLATION, end to end against the Firestore emulator.
 *
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8085 npx tsx tests/scenarios/permissions.test.mts
 *
 * Two halves:
 *  - API routes (project demo-scn-perms): the real route handlers run with nothing mocked but the
 *    login check — a tiny fake Auth server answers the one lookup verifyIdToken makes in emulator
 *    mode, and ID tokens are unsigned emulator tokens (same harness as recycleBinCascade.test.mts).
 *  - Browser rules (project demo-scn-rules): firestore.rules loaded into the same emulator through
 *    @firebase/rules-unit-testing, writing as signed-in browser users.
 *
 * Every refused write is followed by a read proving nothing landed. Nothing here talks to
 * WhatsApp/SMS/email: the PDF senders are only driven down their refusal path.
 *
 * A check that FAILS here is a finding, not a flaky test — each scenario says what it expects.
 */

import { createServer } from "node:http";
import { generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import { SAMPLE_RAW } from "../fixtures/insuranceMetlife.fixture";

const PROJECT = "demo-scn-perms";
const RULES_PROJECT = "demo-scn-rules";
const A = "scnA"; // the victim / main clinic
const B = "scnB"; // another tenant
const X = "scnX"; // a clinic whose trial has run out
const Z = "scnZ"; // a clinic an attacker created for themselves through self-signup

const { privateKey: PEM } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});

// verifyIdToken in emulator mode asks the Auth emulator whether the account exists / is disabled.
const DISABLED = new Set<string>(["disabledA"]);
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
    res.end(JSON.stringify({ users: ids.map((localId) => ({ localId, disabled: DISABLED.has(localId), validSince: "0" })) }));
  });
});
await new Promise<void>((resolve) => authServer.listen(0, "127.0.0.1", resolve));
const authPort = (authServer.address() as { port: number }).port;

process.env.FIREBASE_PROJECT_ID = PROJECT;
process.env.FIREBASE_CLIENT_EMAIL = `sa@${PROJECT}.iam.gserviceaccount.com`;
process.env.FIREBASE_PRIVATE_KEY = PEM;
process.env.FIRESTORE_EMULATOR_HOST ||= "127.0.0.1:8085";
process.env.FIREBASE_AUTH_EMULATOR_HOST = `127.0.0.1:${authPort}`;
// Belt and braces: nothing in here may reach a real messaging provider.
delete process.env.WAPILOT_TOKEN;
delete process.env.WHATSAPP_TOKEN;

function idToken(uid: string, project = PROJECT): string {
  const now = Math.floor(Date.now() / 1000);
  const enc = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${enc({ alg: "none", typ: "JWT" })}.${enc({
    iss: `https://securetoken.google.com/${project}`,
    aud: project,
    sub: uid,
    user_id: uid,
    iat: now,
    exp: now + 3600,
    auth_time: now,
    firebase: { sign_in_provider: "password", identities: {} },
  })}.`;
}

const { adminDb } = await import("../../src/lib/firebaseAdmin");
const { Timestamp } = await import("firebase-admin/firestore");
const { ROLE_BASELINE } = await import("../../src/lib/permissions");
const { mintMcpKey } = await import("../../src/lib/mcp/keys");
const { handleMcpPost } = await import("../../src/lib/mcp/handler");
const ledgerRoute = await import("../../src/app/api/finance/ledger/route");
const proceduresRoute = await import("../../src/app/api/clinical/procedures/route");
const settlementsRoute = await import("../../src/app/api/staff/settlements/route");
const payrollRoute = await import("../../src/app/api/payroll/route");
const reportsRoute = await import("../../src/app/api/reports/route");
const deleteRoute = await import("../../src/app/api/records/delete/route");
const binRoute = await import("../../src/app/api/records/bin/route");
const restoreRoute = await import("../../src/app/api/records/restore/route");
const purgeRoute = await import("../../src/app/api/records/purge/route");
const claimsRoute = await import("../../src/app/api/insurance/claims/route");
const updateUserRoute = await import("../../src/app/api/admin/update-user/route");
const staffCreateRoute = await import("../../src/app/api/staff/create/route");
const resetPasswordRoute = await import("../../src/app/api/staff/reset-password/route");
const deleteUserRoute = await import("../../src/app/api/delete-user/route");
const rxPdfRoute = await import("../../src/app/api/whatsapp/send-prescription-pdf/route");
const planPdfRoute = await import("../../src/app/api/whatsapp/send-treatment-plan-pdf/route");
const mcpKeysRoute = await import("../../src/app/api/admin/mcp-keys/route");

const db = adminDb();
const clinicRef = (id: string) => db.collection("clinics").doc(id);
const col = (clinic: string, name: string) => clinicRef(clinic).collection(name);
const userRef = (uid: string) => db.collection("users").doc(uid);

// ------------------------------------------------------------------------------------------------
// reporting
// ------------------------------------------------------------------------------------------------
let passed = 0;
let failed = 0;
let current = "";
const verdicts = new Map<string, { title: string; fails: string[] }>();
function check(label: string, condition: boolean, detail: unknown = "") {
  const v = verdicts.get(current)!;
  if (condition) {
    console.log(`  ok    ${label}`);
    passed += 1;
  } else {
    const d = detail !== "" ? ` — ${typeof detail === "string" ? detail : JSON.stringify(detail).slice(0, 300)}` : "";
    console.log(`  FAIL  ${label}${d}`);
    failed += 1;
    v.fails.push(label);
  }
}
async function scenario(id: string, title: string, fn: () => Promise<void>) {
  current = id;
  verdicts.set(id, { title, fails: [] });
  console.log(`\n${id} ${title}`);
  try {
    await fn();
  } catch (e) {
    check(`${id} threw`, false, e instanceof Error ? `${e.message}\n${e.stack?.split("\n").slice(1, 4).join("\n")}` : String(e));
  }
}

// ------------------------------------------------------------------------------------------------
// calling routes
// ------------------------------------------------------------------------------------------------
type Json = Record<string, any>;
type Handler = (r: Request, ...rest: any[]) => Promise<Response>;
async function call(as: string | null, handler: Handler, method: "POST" | "GET" | "DELETE", path: string, body?: unknown): Promise<{ status: number; json: Json }> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (as !== null) headers.authorization = `Bearer ${as}`;
  const res = await handler(
    new Request(`http://localhost${path}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }),
  );
  const text = await res.text();
  let json: Json = {};
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text.slice(0, 200) };
  }
  return { status: res.status, json };
}
const T = (uid: string) => idToken(uid);
const ledger = (uid: string, body: Json) => call(T(uid), ledgerRoute.POST, "POST", "/api/finance/ledger", body);
const procedures = (uid: string, body: Json) => call(T(uid), proceduresRoute.POST, "POST", "/api/clinical/procedures", body);
const settlements = (uid: string, body: Json) => call(T(uid), settlementsRoute.POST, "POST", "/api/staff/settlements", body);
const payroll = (uid: string, qs = "") => call(T(uid), payrollRoute.GET, "GET", `/api/payroll${qs}`);
const reports = (uid: string, qs = "") => call(T(uid), reportsRoute.GET, "GET", `/api/reports${qs}`);
const recordsDelete = (uid: string, body: Json) => call(T(uid), deleteRoute.POST, "POST", "/api/records/delete", body);
const recordsBin = (uid: string, clinic: string) => call(T(uid), binRoute.GET, "GET", `/api/records/bin?clinicId=${clinic}`);
const recordsRestore = (uid: string, body: Json) => call(T(uid), restoreRoute.POST, "POST", "/api/records/restore", body);
const recordsPurge = (uid: string, body: Json) => call(T(uid), purgeRoute.POST, "POST", "/api/records/purge", body);
const claims = (uid: string, body: Json) => call(T(uid), claimsRoute.POST, "POST", "/api/insurance/claims", body);
const updateUser = (uid: string, body: Json) => call(T(uid), updateUserRoute.POST, "POST", "/api/admin/update-user", body);
const staffCreate = (uid: string, body: Json) => call(T(uid), staffCreateRoute.POST, "POST", "/api/staff/create", body);
const resetPassword = (uid: string, body: Json) => call(T(uid), resetPasswordRoute.POST, "POST", "/api/staff/reset-password", body);
const deleteUser = (uid: string, body: Json) => call(T(uid), deleteUserRoute.POST, "POST", "/api/delete-user", body);
const mcpKeys = (uid: string, body: Json) => call(T(uid), mcpKeysRoute.POST, "POST", "/api/admin/mcp-keys", body);

const exists = async (clinic: string, collection: string, id: string) => (await col(clinic, collection).doc(id).get()).exists;
const count = async (clinic: string, collection: string) => (await col(clinic, collection).count().get()).data().count;
const today = new Date().toISOString().slice(0, 10);

// ------------------------------------------------------------------------------------------------
// seed
// ------------------------------------------------------------------------------------------------
const ALL_UIDS = [
  "ownerA", "adminA", "dentA", "asstA", "recA", "customA", "mgrA", "revokedA", "mapOnlyA", "leaverA",
  "escRecA", "adminB", "superP", "recX", "attackerZ", "outsider", "disabledA", "noProfile",
];

async function wipe() {
  for (const c of [A, B, X, Z]) {
    for (const d of (await db.collection("deleted_records").where("clinicId", "==", c).get()).docs) await db.recursiveDelete(d.ref);
    for (const d of (await db.collection("mcp_keys").where("clinicId", "==", c).get()).docs) await d.ref.delete();
    await db.recursiveDelete(clinicRef(c));
  }
  for (const u of ALL_UIDS) await db.recursiveDelete(userRef(u));
}

const base = (role: string) => [...new Set(ROLE_BASELINE[role] ?? [])].sort();
/** What an invite/acceptance writes for a staff member (see invites/accept + clinicPermissions.ts). */
function staffUser(clinic: string, role: string, perms: string[] = base(role), extra: Json = {}) {
  return {
    name: `${role} ${clinic}`,
    email: `${role.toLowerCase()}@${clinic}.test`,
    clinicRoles: { [clinic]: role },
    clinicPermissions: { [clinic]: perms },
    defaultClinicId: clinic,
    role,
    permissions: perms,
    isDentist: role === "Dentist",
    ...extra,
  };
}

await wipe();
const premium = { status: "Active", subscriptionTier: "Premium", features: { insurance: true, clinicalPdfs: true } };
await clinicRef(A).set({ name: "Victim Dental", ownerId: "ownerA", ...premium });
await clinicRef(B).set({ name: "Other Tenant", ownerId: "adminB", ...premium });
await clinicRef(X).set({ name: "Lapsed Trial", ownerId: "nobody", status: "Active", subscriptionTier: "Free Trial", expiresAt: Timestamp.fromDate(new Date(Date.now() - 86_400_000)) });
await clinicRef(Z).set({ name: "Attacker's own trial", ownerId: "attackerZ", status: "Active", subscriptionTier: "Free Trial", expiresAt: Timestamp.fromDate(new Date(Date.now() + 14 * 86_400_000)) });

await userRef("ownerA").set(staffUser(A, "Owner", []));
await userRef("adminA").set(staffUser(A, "Admin", []));
await userRef("dentA").set(staffUser(A, "Dentist", base("Dentist"), { staffId: "st-dent" }));
await userRef("asstA").set(staffUser(A, "Assistant"));
await userRef("recA").set(staffUser(A, "Receptionist", base("Receptionist"), { staffId: "st-rec" }));
// A receptionist an admin has trusted with deleting money (one extra switch).
await userRef("customA").set(staffUser(A, "Receptionist", [...base("Receptionist"), "finance.delete"].sort()));
// A front-desk manager trusted with settings (the switch the AI-connector screen asks for).
await userRef("mgrA").set(staffUser(A, "Receptionist", [...base("Receptionist"), "access.settings"].sort()));
// Admin unticked everything in the enforced map; the stale flat copy still lists the baseline.
await userRef("revokedA").set({ ...staffUser(A, "Receptionist"), clinicPermissions: { [A]: [] } });
// The enforced map grants; the flat copy the browser reads is empty (never re-saved).
await userRef("mapOnlyA").set({ ...staffUser(A, "Receptionist"), permissions: [] });
// Someone about to be removed from the clinic by the admin (R87).
await userRef("leaverA").set(staffUser(A, "Receptionist", base("Receptionist"), { staffId: "st-leaver" }));
// A receptionist who has used the browser SDK to rewrite the flat `role` on their own profile
// (firestore.rules used to let them; R100 now proves it cannot — seeded anyway, for accounts
// that did it before the fix). Their per-clinic role is untouched.
await userRef("escRecA").set({ ...staffUser(A, "Receptionist"), role: "Admin" });
await userRef("adminB").set(staffUser(B, "Admin", []));
await userRef("superP").set({ name: "Platform", isSuperAdmin: true });
await userRef("recX").set(staffUser(X, "Receptionist"));
// Self-signup: owns their own clinic Z, then pointed `defaultClinicId` at the victim (self-writable).
await userRef("attackerZ").set({ ...staffUser(Z, "Owner", []), defaultClinicId: A });
// A brand-new account with no clinic at all, that self-provisioned its profile from the browser
// with role "Admin" and defaultClinicId = victim (the create rule used to check only three other
// fields; R100 proves it now refuses this too).
await userRef("outsider").set({ name: "Nobody", clinicRoles: {}, role: "Admin", permissions: [], defaultClinicId: A });
await userRef("disabledA").set(staffUser(A, "Admin", []));

await col(A, "staff").doc("st-dent").set({ name: "Dr Dent", uid: "dentA", role: "Dentist", isDentist: true, commissionPercentage: 40, salary: 9999 });
await col(A, "staff").doc("st-rec").set({ name: "Desk Rec", uid: "recA", role: "Receptionist", salary: 4321 });
await col(A, "staff").doc("st-leaver").set({ name: "Leaving Soon", uid: "leaverA", role: "Receptionist" });
await col(A, "staff").doc("st-secret").set({ name: "Payroll Marker 55501", role: "Assistant", salary: 55501, uid: "asstA" });
await col(A, "patients").doc("pA1").set({ name: "Victim Patient", phone: "+201000000101" });
await col(A, "patients").doc("pA2").set({ name: "Second Patient", phone: "+201000000102" });
await col(A, "patients").doc("pA3").set({ name: "Third Patient", phone: "+201000000103" });
await col(A, "ledger").doc("procA1").set({ type: "procedure", patientId: "pA1", patientName: "Victim Patient", description: "Crown", amount: 1000, cost: 1000, paid: 0, doctorId: "st-dent", doctorName: "Dr Dent", doctor: "Dr Dent", date: today });
const INC_A1 = { type: "income", amount: 77777, paid: 77777, cost: 0, description: "Marker income", category: "General", date: today, patientId: null };
await col(A, "ledger").doc("incA1").set(INC_A1);
await col(A, "ledger").doc("incA2").set({ type: "income", amount: 150, paid: 150, cost: 0, description: "Deletable income", category: "General", date: today, patientId: null });
await col(A, "settings").doc("payers").set({ payers: [{ id: "metlife", name: "MetLife", format: "metlife", providerCode: "DNC0001", active: true }] });
await col(B, "patients").doc("pB1").set({ name: "B Patient", phone: "+201000000201" });
await col(B, "staff").doc("st-b").set({ name: "B Staff", uid: "adminB", role: "Admin" });
await col(X, "patients").doc("pX1").set({ name: "X Patient", phone: "+201000000301" });
await col(X, "ledger").doc("procX1").set({ type: "procedure", patientId: "pX1", description: "Filling", amount: 300, cost: 300, paid: 0, doctorId: "st-x", doctorName: "Dr X", date: today });

// ================================================================================================
// API SCENARIOS
// ================================================================================================

let recPaymentId = "";

await scenario("R76", "Receptionist takes a payment for a treatment (finance.add) — allowed, row lands in clinic A", async () => {
  const r = await ledger("recA", { clinicId: A, action: "create-payment", patientId: "pA1", procedureId: "procA1", amount: 400, date: today, method: "Cash" });
  check("create-payment → 200", r.status === 200 && r.json.ok === true, r);
  recPaymentId = String(r.json.id || r.json.paymentId || "");
  if (!recPaymentId) {
    const q = await col(A, "ledger").where("procedureId", "==", "procA1").where("type", "==", "payment").get();
    recPaymentId = q.docs[0]?.id || "";
  }
  check("payment row exists in A", recPaymentId !== "" && (await exists(A, "ledger", recPaymentId)), recPaymentId);
  const audit = await col(A, "ledger_audit").where("documentId", "==", recPaymentId).count().get();
  check("audit trail names the change", audit.data().count >= 1);
});

await scenario("R77", "Receptionist tries to delete / edit the payment she just took — refused, row untouched", async () => {
  const before = (await col(A, "ledger").doc(recPaymentId).get()).data();
  const del = await ledger("recA", { clinicId: A, action: "delete", id: recPaymentId });
  check("delete → 403", del.status === 403, del);
  const upd = await ledger("recA", { clinicId: A, action: "update", id: recPaymentId, patch: { paid: 1 } });
  check("update → 403", upd.status === 403, upd);
  const after = (await col(A, "ledger").doc(recPaymentId).get()).data();
  check("payment still there, amount unchanged", !!after && after.paid === before?.paid, { before: before?.paid, after: after?.paid });
  // And the recycle-bin door for the same row.
  const bin = await recordsDelete("recA", { clinicId: A, items: [{ collection: "ledger", documentId: recPaymentId }] });
  check("records/delete on the ledger row → refused (4xx)", bin.status >= 400 && bin.status < 500, bin);
  check("still there after the bin attempt", await exists(A, "ledger", recPaymentId));
});

await scenario("R78", "Receptionist with the custom 'finance.delete' switch may delete a clinic income row", async () => {
  const r = await ledger("customA", { clinicId: A, action: "delete", id: "incA2" });
  check("delete → 200", r.status === 200 && r.json.ok === true, r);
  check("row gone", !(await exists(A, "ledger", "incA2")));
  const same = await ledger("recA", { clinicId: A, action: "delete", id: "incA1" });
  check("…while a plain receptionist still gets 403 on another row", same.status === 403, same);
  check("that row survives", await exists(A, "ledger", "incA1"));
});

await scenario("R79", "Receptionist cannot see payroll or record staff payouts", async () => {
  const p = await payroll("recA", `?clinicId=${A}`);
  check("payroll → 403", p.status === 403, p);
  check("no salary in the refusal", !JSON.stringify(p.json).includes("55501"));
  const before = await count(A, "staff_settlements");
  const s = await settlements("recA", { clinicId: A, action: "create", staffId: "st-rec", kind: "payout", amount: 500, date: today });
  check("settlement create → 403", s.status === 403, s);
  check("no settlement written", (await count(A, "staff_settlements")) === before);
  const rep = await reports("recA", `?clinicId=${A}&report=attendance&from=${today.slice(0, 8)}01&to=${today}`);
  check("attendance report may load (access.reports) but carries no salary", !JSON.stringify(rep.json).includes("55501"), rep.status);
});

await scenario("R80", "Dentist tries to record a payout to himself, or wipe a deduction against him", async () => {
  const ledgerBefore = await count(A, "ledger");
  const s = await settlements("dentA", { clinicId: A, action: "create", staffId: "st-dent", kind: "payout", amount: 5000, date: today, note: "me" });
  check("payout → 403", s.status === 403, s);
  check("no settlement row", (await count(A, "staff_settlements")) === 0);
  check("no Salary expense on the ledger", (await count(A, "ledger")) === ledgerBefore);
  // The admin does record a deduction; the dentist then tries to delete it.
  const ded = await settlements("adminA", { clinicId: A, action: "create", staffId: "st-dent", kind: "deduction", amount: 300, date: today, note: "broken handpiece" });
  check("admin deduction → 200", ded.status === 200 && ded.json.ok === true, ded);
  const dedId = String(ded.json.id || "");
  const del = await settlements("dentA", { clinicId: A, action: "delete", id: dedId });
  check("dentist delete of the deduction → 403", del.status === 403, del);
  check("deduction still there", dedId !== "" && (await exists(A, "staff_settlements", dedId)), dedId);
});

await scenario("R81", "Dentist tries to raise his own commission % on a payment (and edit his staff card)", async () => {
  const before = (await col(A, "ledger").doc(recPaymentId).get()).data() || {};
  const r = await ledger("dentA", { clinicId: A, action: "set-commission", id: recPaymentId, commissionPercentage: 90 });
  check("set-commission → 403", r.status === 403, r);
  const after = (await col(A, "ledger").doc(recPaymentId).get()).data() || {};
  check("split unchanged", after.doctorCommissionPercentage === before.doctorCommissionPercentage && after.commissionSetManually !== true, { before: before.doctorCommissionPercentage, after: after.doctorCommissionPercentage });
  const u = await updateUser("dentA", { clinicId: A, userDocId: "dentA", patch: { commissionPercentage: 90, role: "Admin" } });
  check("update-user on himself → 403", u.status === 403, u);
  check("staff card commission still 40", (await col(A, "staff").doc("st-dent").get()).get("commissionPercentage") === 40);
  const ok = await ledger("adminA", { clinicId: A, action: "set-commission", id: recPaymentId, commissionPercentage: 35 });
  check("…the admin can (sanity) → 200", ok.status === 200, ok);
});

await scenario("R82", "Clinic B's admin names clinicId=A on every route — refused everywhere, nothing written in A", async () => {
  const counts = async () => ({
    ledger: await count(A, "ledger"), notes: await count(A, "clinical_notes"), settl: await count(A, "staff_settlements"),
    patients: await count(A, "patients"), claims: await count(A, "insurance_claims"),
  });
  const before = await counts();
  const results: Record<string, number> = {};
  results.ledgerEntry = (await ledger("adminB", { clinicId: A, action: "create-entry", type: "expense", amount: 999, description: "x", date: today })).status;
  results.ledgerDelete = (await ledger("adminB", { clinicId: A, action: "delete", id: "incA1" })).status;
  results.procedure = (await procedures("adminB", { clinicId: A, action: "create", patientId: "pA1", procedures: ["Scaling"], cost: 300 })).status;
  results.settlement = (await settlements("adminB", { clinicId: A, action: "create", staffId: "st-dent", kind: "payout", amount: 1, date: today })).status;
  results.payroll = (await payroll("adminB", `?clinicId=${A}`)).status;
  results.reports = (await reports("adminB", `?clinicId=${A}&report=clinic`)).status;
  results.recordsDelete = (await recordsDelete("adminB", { clinicId: A, items: [{ collection: "patients", documentId: "pA3" }] })).status;
  results.bin = (await recordsBin("adminB", A)).status;
  results.claims = (await claims("adminB", { clinicId: A, docId: "doc-1", payerId: "metlife", extraction: SAMPLE_RAW, patient: { id: "pA1" } })).status;
  results.updateUser = (await updateUser("adminB", { clinicId: A, userDocId: "recA", patch: { role: "Admin" } })).status;
  results.staffCreate = (await staffCreate("adminB", { clinicId: A, email: "spy@b.test", password: "x1234567", role: "Admin", createDbRecords: true })).status;
  results.resetPassword = (await resetPassword("adminB", { clinicId: A, uid: "recA", newPassword: "hacked123" })).status;
  results.deleteUser = (await deleteUser("adminB", { clinicId: A, userId: "recA", staffId: "st-rec" })).status;
  results.mcpKey = (await mcpKeys("adminB", { clinicId: A, scope: "full", label: "spy" })).status;
  for (const [k, s] of Object.entries(results)) check(`${k} → 403`, s === 403, s);
  const after = await counts();
  check("nothing written in A", JSON.stringify(after) === JSON.stringify(before), { before, after });
  check("recA keeps Receptionist", (await userRef("recA").get()).get(`clinicRoles.${A}`) === "Receptionist");
  check("st-rec staff card still there", await exists(A, "staff", "st-rec"));
});

await scenario("R83", "Admin unticked everything for a receptionist; the stale flat list still says finance.add", async () => {
  const before = await count(A, "ledger");
  const r = await ledger("revokedA", { clinicId: A, action: "create-entry", type: "income", amount: 10, description: "revoked", date: today });
  check("create-entry → 403 (map wins over flat)", r.status === 403, r);
  check("no row written", (await count(A, "ledger")) === before);
});

await scenario("R84", "Vice versa: enforced map grants finance.add, flat copy empty — legit user not locked out", async () => {
  const r = await ledger("mapOnlyA", { clinicId: A, action: "create-entry", type: "income", amount: 11, description: "map only", date: today });
  check("create-entry → 200", r.status === 200 && r.json.ok === true, r);
  check("row exists", !!r.json.id && (await exists(A, "ledger", String(r.json.id))));
});

await scenario("R85", "Cross-tenant WRITE: self-signup owner of Z points defaultClinicId at A and omits clinicId", async () => {
  // attackerZ really is the Owner of Z, so a request naming no clinic is about Z: a defaultClinicId
  // naming a clinic they hold no role in is ignored (adminClinicDb.fallbackClinicIdFor). Being
  // refused would also be safe; what must never happen is the write landing in A.
  const before = await count(A, "ledger");
  const beforeZ = await count(Z, "ledger");
  const r = await ledger("attackerZ", { action: "create-entry", type: "expense", amount: 12345, description: "planted by Z", date: today });
  check("create-entry without clinicId → refused, or written to the caller's own clinic Z", r.status === 403 || r.status === 400 || (r.status === 200 && !!r.json.id && (await exists(Z, "ledger", String(r.json.id)))), r);
  check("nothing planted in A's ledger", (await count(A, "ledger")) === before, { before, after: await count(A, "ledger") });
  check("Z's ledger grew by at most the one row", (await count(Z, "ledger")) - beforeZ <= 1);
  const d = await ledger("attackerZ", { action: "delete", id: "incA1" });
  // Resolved to Z, where no row incA1 exists — a 404 about Z is the right answer.
  check("delete of A's row without clinicId → refused (4xx)", d.status >= 400 && d.status < 500, d);
  check("A's income row survives", await exists(A, "ledger", "incA1"));
  // Not even a clinic of their own: a bare self-provisioned profile with role "Admin".
  const o = await ledger("outsider", { action: "create-entry", type: "expense", amount: 54321, description: "planted by outsider", date: today });
  check("outsider (no clinic at all) → refused", o.status === 403 || o.status === 400, o);
  const planted = await col(A, "ledger").where("description", "in", ["planted by Z", "planted by outsider"]).get();
  check("no planted rows in A", planted.empty, planted.docs.map((x) => ({ id: x.id, by: x.get("createdBy") })));
  for (const x of planted.docs) await x.ref.delete();
  // put A's marker row back so later scenarios start from the same books
  if (!(await exists(A, "ledger", "incA1"))) await col(A, "ledger").doc("incA1").set(INC_A1);
});

await scenario("R86", "Cross-tenant READ: the same outsiders pull A's reports and payroll by omitting clinicId", async () => {
  // As in R85: attackerZ owns Z, so these answer for Z (200, Z's own empty books) — never for A.
  const p = await payroll("attackerZ");
  check("payroll without clinicId → 403, or Z's own payroll", p.status === 403 || p.status === 200, p.status);
  check("A's salary marker not disclosed", !JSON.stringify(p.json).includes("55501") && !JSON.stringify(p.json).includes("Payroll Marker"));
  const rep = await reports("attackerZ", `?report=clinic`);
  check("reports without clinicId → 403, or Z's own report", rep.status === 403 || rep.status === 200, rep.status);
  check("A's income marker 77777 not disclosed", !JSON.stringify(rep.json).includes("77777"), JSON.stringify(rep.json).slice(0, 200));
  const o = await payroll("outsider");
  check("outsider payroll → 403", o.status === 403, o.status);
  check("outsider sees no salary", !JSON.stringify(o.json).includes("55501"));
});

await scenario("R87", "Admin removes a receptionist; her old token keeps working by omitting clinicId", async () => {
  const rm = await deleteUser("adminA", { clinicId: A, userId: "leaverA", staffId: "st-leaver" });
  check("admin removes her → 200", rm.status === 200, rm);
  const u = (await userRef("leaverA").get()).data() || {};
  check("clinicRoles[A] gone", !(u.clinicRoles || {})[A]);
  // A was her only clinic and her default: the default and the flat copies go with the role.
  check("defaultClinicId no longer names A", u.defaultClinicId === undefined, u.defaultClinicId);
  check("flat role / permissions cleared", u.role === undefined && u.permissions === undefined, { role: u.role, permissions: u.permissions });
  const named = await ledger("leaverA", { clinicId: A, action: "create-payment", patientId: "pA1", procedureId: "procA1", amount: 1, date: today });
  check("with clinicId=A → 403", named.status === 403, named);
  const before = await count(A, "ledger");
  const sneaky = await ledger("leaverA", { action: "create-entry", type: "expense", amount: 2500, description: "after removal", date: today });
  check("without clinicId → refused", sneaky.status === 403 || sneaky.status === 400, sneaky);
  check("no row written after removal", (await count(A, "ledger")) === before);
  const rep = await reports("leaverA", "?report=clinic");
  check("reports without clinicId → 403", rep.status === 403, rep.status);
  check("no A figures to the leaver", !JSON.stringify(rep.json).includes("77777"));
  const leftover = await col(A, "ledger").where("description", "==", "after removal").get();
  for (const x of leftover.docs) await x.ref.delete();
});

await scenario("R88", "Receptionist rewrites her own flat role to 'Admin' then pays herself via settlements (no clinicId)", async () => {
  const named = await settlements("escRecA", { clinicId: A, action: "create", staffId: "st-rec", kind: "payout", amount: 2000, date: today });
  check("with clinicId=A → 403 (per-clinic role is Receptionist)", named.status === 403, named);
  const before = await count(A, "staff_settlements");
  const sneaky = await settlements("escRecA", { action: "create", staffId: "st-rec", kind: "payout", amount: 2000, date: today, note: "self" });
  check("without clinicId → 403", sneaky.status === 403 || sneaky.status === 400, sneaky);
  check("no payout written", (await count(A, "staff_settlements")) === before, { before, after: await count(A, "staff_settlements") });
  const del = await ledger("escRecA", { action: "delete", id: "incA1" });
  check("ledger delete without clinicId → 403", del.status === 403 || del.status === 400, del);
  check("income row survives", await exists(A, "ledger", "incA1"));
  const pay = await payroll("escRecA");
  check("payroll without clinicId → 403", pay.status === 403, pay.status);
  // undo whatever got through so later scenarios see a clean slate
  for (const x of (await col(A, "staff_settlements").where("note", "==", "self").get()).docs) {
    await x.ref.delete();
    for (const l of (await col(A, "ledger").where("settlementId", "==", x.id).get()).docs) await l.ref.delete();
  }
  if (!(await exists(A, "ledger", "incA1"))) await col(A, "ledger").doc("incA1").set(INC_A1);
});

await scenario("R89", "Expired trial: writes blocked, reads allowed — and the no-clinicId door", async () => {
  const before = await count(X, "ledger");
  const named = await ledger("recX", { clinicId: X, action: "create-entry", type: "income", amount: 50, description: "after expiry", date: today });
  check("create-entry with clinicId=X → 403 CLINIC_INACTIVE", named.status === 403 && named.json.reason !== undefined, named);
  const bin = await recordsBin("recX", X);
  check("bin list (read) still 200", bin.status === 200, bin.status);
  const sneaky = await ledger("recX", { action: "create-entry", type: "income", amount: 51, description: "after expiry, no clinicId", date: today });
  check("same write with clinicId omitted → 403", sneaky.status === 403, sneaky);
  check("no row written in X", (await count(X, "ledger")) === before, { before, after: await count(X, "ledger") });
  for (const x of (await col(X, "ledger").where("description", "==", "after expiry, no clinicId").get()).docs) await x.ref.delete();
});

await scenario("R90", "No token, garbage token, wrong-project token, disabled account, token with no profile", async () => {
  const body = { clinicId: A, action: "create-entry", type: "expense", amount: 1, description: "anon", date: today };
  const before = await count(A, "ledger");
  const none = await call(null, ledgerRoute.POST, "POST", "/api/finance/ledger", body);
  check("no token → 401", none.status === 401, none);
  const garbage = await call("not-a-jwt", ledgerRoute.POST, "POST", "/api/finance/ledger", body);
  check("garbage → 401", garbage.status === 401, garbage);
  const wrongProj = await call(idToken("adminA", "some-other-project"), ledgerRoute.POST, "POST", "/api/finance/ledger", body);
  check("token for another Firebase project → 401", wrongProj.status === 401, wrongProj);
  const disabled = await call(T("disabledA"), ledgerRoute.POST, "POST", "/api/finance/ledger", body);
  check("disabled Admin account → 401", disabled.status === 401, disabled);
  const noProfile = await call(T("noProfile"), ledgerRoute.POST, "POST", "/api/finance/ledger", body);
  check("valid token, no users/ doc → 403", noProfile.status === 403, noProfile);
  const s = await call(null, settlementsRoute.POST, "POST", "/api/staff/settlements", { clinicId: A, action: "create" });
  check("settlements no token → 401", s.status === 401, s.status);
  const p = await call("garbage", payrollRoute.GET, "GET", `/api/payroll?clinicId=${A}`);
  check("payroll garbage → 401", p.status === 401, p.status);
  check("nothing written", (await count(A, "ledger")) === before);
});

await scenario("R91", "Superadmin can act on any clinic, including an expired one", async () => {
  const b = await ledger("superP", { clinicId: B, action: "create-entry", type: "income", amount: 5, description: "support fix", date: today });
  check("superadmin write in B → 200", b.status === 200, b);
  const x = await ledger("superP", { clinicId: X, action: "create-entry", type: "income", amount: 6, description: "support fix", date: today });
  check("superadmin write in expired X → 200 (exempt)", x.status === 200, x);
  const p = await payroll("superP", `?clinicId=${A}`);
  check("superadmin payroll for A → 200", p.status === 200, p.status);
  const bin = await recordsBin("superP", B);
  check("superadmin bin for B → 200", bin.status === 200, bin.status);
});

let binnedEntry = "";
await scenario("R92", "Recycle-bin delete: receptionist and dentist cannot bin a patient; admin can", async () => {
  const r = await recordsDelete("recA", { clinicId: A, items: [{ collection: "patients", documentId: "pA3" }] });
  check("receptionist → 403", r.status === 403, r);
  const d = await recordsDelete("dentA", { clinicId: A, items: [{ collection: "patients", documentId: "pA3" }] });
  check("dentist → 403", d.status === 403, d);
  check("patient still there", await exists(A, "patients", "pA3"));
  const a = await recordsDelete("adminA", { clinicId: A, items: [{ collection: "patients", documentId: "pA3" }] });
  check("admin → 200", a.status === 200, a);
  check("patient moved to the bin", !(await exists(A, "patients", "pA3")));
  const list = await recordsBin("adminA", A);
  const entry = (list.json.entries || list.json.items || []).find((e: Json) => e.documentId === "pA3");
  binnedEntry = String(entry?.id || entry?.entryId || "");
  check("bin lists it", binnedEntry !== "", list.json);
});

await scenario("R93", "Recycle-bin purge/restore by the wrong people", async () => {
  const p1 = await recordsPurge("dentA", { clinicId: A, entryId: binnedEntry });
  check("dentist purge → 403", p1.status === 403, p1);
  const p2 = await recordsPurge("customA", { clinicId: A, entryId: binnedEntry });
  check("receptionist with finance.delete purge → 403 (admin-only)", p2.status === 403, p2);
  const p3 = await recordsPurge("adminB", { clinicId: B, entryId: binnedEntry });
  check("B admin purging A's entry under clinicId=B → 403", p3.status === 403, p3);
  const p4 = await recordsPurge("adminB", { clinicId: A, entryId: binnedEntry });
  check("B admin naming clinicId=A → 403", p4.status === 403, p4);
  check("bin entry intact", (await db.collection("deleted_records").doc(binnedEntry).get()).exists);
  const r1 = await recordsRestore("adminB", { clinicId: B, entryId: binnedEntry });
  check("B admin restoring A's entry into B → 403", r1.status === 403, r1);
  check("B did not receive A's patient", !(await exists(B, "patients", "pA3")));
  const r2 = await recordsRestore("asstA", { clinicId: A, entryId: binnedEntry });
  // By design (lib/recycleBin.ts checkRestoreAllowed): restoring needs the DELETE switch as well as create.
  check("assistant (patients.add, no patients.delete) restore → 403 by design", r2.status === 403, r2);
  check("still in the bin", !(await exists(A, "patients", "pA3")));
  const r3 = await recordsRestore("adminA", { clinicId: A, entryId: binnedEntry });
  check("admin restore → 200", r3.status === 200, r3);
  check("patient back in A", await exists(A, "patients", "pA3"));
});

await scenario("R94", "Promotions: non-admins cannot make anyone Admin; an Admin cannot demote the Owner", async () => {
  const self = await updateUser("recA", { clinicId: A, userDocId: "recA", patch: { role: "Admin" } });
  check("receptionist promoting herself → 403", self.status === 403, self);
  const other = await updateUser("dentA", { clinicId: A, userDocId: "asstA", patch: { role: "Admin" } });
  check("dentist promoting the assistant → 403", other.status === 403, other);
  const owner = await updateUser("adminA", { clinicId: A, userDocId: "ownerA", patch: { role: "Receptionist" } });
  check("admin demoting the owner → 403", owner.status === 403, owner);
  const toOwner = await updateUser("adminA", { clinicId: A, userDocId: "asstA", patch: { role: "Owner" } });
  check("admin handing out Owner via update-user → refused", toOwner.status >= 400 && toOwner.status < 500, toOwner);
  const roles = async (u: string) => (await userRef(u).get()).get(`clinicRoles.${A}`);
  check("roles unchanged", (await roles("recA")) === "Receptionist" && (await roles("asstA")) === "Assistant" && (await roles("ownerA")) === "Owner");
  const perms = await updateUser("recA", { clinicId: A, userDocId: "recA", patch: { permissions: ["finance.delete"] } });
  check("receptionist ticking her own boxes → 403", perms.status === 403, perms);
  check("her enforced map unchanged", !((await userRef("recA").get()).get(`clinicPermissions.${A}`) as string[]).includes("finance.delete"));
});

await scenario("R95", "Staff accounts: non-admins cannot create staff or reset passwords; owner cannot be removed", async () => {
  const c = await staffCreate("recA", { clinicId: A, email: "ghost@a.test", password: "pass12345", role: "Admin", createDbRecords: true });
  check("receptionist staff/create → 403", c.status === 403, c);
  const c2 = await staffCreate("adminA", { email: "ghost2@a.test", password: "pass12345", role: "Dentist" });
  check("staff/create without clinicId → 400", c2.status === 400, c2);
  const rp = await resetPassword("dentA", { clinicId: A, uid: "adminA", newPassword: "hijack123" });
  check("dentist resetting the admin's password → 403", rp.status === 403, rp);
  const rmOwner = await deleteUser("adminA", { clinicId: A, userId: "ownerA" });
  check("admin removing the owner → 403", rmOwner.status === 403, rmOwner);
  const rmByRec = await deleteUser("recA", { clinicId: A, userId: "dentA", staffId: "st-dent" });
  check("receptionist removing a dentist → 403", rmByRec.status === 403, rmByRec);
  check("dentist still in A", (await userRef("dentA").get()).get(`clinicRoles.${A}`) === "Dentist" && (await exists(A, "staff", "st-dent")));
  const ghosts = await col(A, "staff").where("email", "in", ["ghost@a.test", "ghost2@a.test"]).get();
  check("no ghost staff cards", ghosts.empty);
});

await scenario("R96", "Clinical PDFs to WhatsApp: receptionist / other clinic refused before anything is sent", async () => {
  const outboxBefore = await count(A, "whatsapp_outbox");
  const pdf = Buffer.from("%PDF-1.4 test").toString("base64");
  const rx = await call(T("recA"), rxPdfRoute.POST, "POST", "/api/whatsapp/send-prescription-pdf", { clinicId: A, patientId: "pA1", pdfBase64: pdf });
  check("receptionist prescription PDF → 403", rx.status === 403, rx);
  const plan = await call(T("recA"), planPdfRoute.POST, "POST", "/api/whatsapp/send-treatment-plan-pdf", { clinicId: A, patientId: "pA1", pdfBase64: pdf });
  check("receptionist treatment-plan PDF → 403", plan.status === 403, plan);
  const cross = await call(T("adminB"), rxPdfRoute.POST, "POST", "/api/whatsapp/send-prescription-pdf", { clinicId: A, patientId: "pA1", pdfBase64: pdf });
  check("B admin naming A → refused (not 200)", cross.status !== 200, cross);
  const crossNoId = await call(T("attackerZ"), planPdfRoute.POST, "POST", "/api/whatsapp/send-treatment-plan-pdf", { patientId: "pA1", pdfBase64: pdf });
  // Resolves to attackerZ's own clinic Z (A is ignored as a default they hold no role in), where
  // this junk PDF / A's patient id goes nowhere. Refused either way; A's outbox is checked below.
  check("outsider with defaultClinicId=A, no clinicId → refused (4xx)", crossNoId.status >= 400 && crossNoId.status < 500, crossNoId);
  const anon = await call(null, rxPdfRoute.POST, "POST", "/api/whatsapp/send-prescription-pdf", { clinicId: A, patientId: "pA1", pdfBase64: pdf });
  check("no token → 401", anon.status === 401, anon.status);
  check("nothing queued in A's WhatsApp outbox", (await count(A, "whatsapp_outbox")) === outboxBefore);
});

await scenario("R97", "Clinical procedures: receptionist cannot log a treatment; dentist can; dentist cannot delete it", async () => {
  const notesBefore = await count(A, "clinical_notes");
  const r = await procedures("recA", { clinicId: A, action: "create", patientId: "pA2", procedures: ["Scaling"], cost: 300 });
  check("receptionist create → 403", r.status === 403, r);
  check("no note written", (await count(A, "clinical_notes")) === notesBefore);
  const d = await procedures("dentA", { clinicId: A, action: "create", patientId: "pA2", procedures: ["Scaling"], cost: 300, doctorId: "st-dent" });
  check("dentist create → 200", d.status === 200 && d.json.ok === true, d);
  const noteId = String(d.json.noteId || "");
  const del = await procedures("dentA", { clinicId: A, action: "delete", noteId, id: noteId });
  check("dentist delete (no clinical.delete) → 403", del.status === 403, del);
  check("note still there", noteId !== "" && (await exists(A, "clinical_notes", noteId)));
  const cross = await procedures("dentA", { clinicId: B, action: "create", patientId: "pB1", procedures: ["Scaling"], cost: 300 });
  check("dentist of A logging into B → 403", cross.status === 403, cross);
  check("B has no clinical notes", (await count(B, "clinical_notes")) === 0);
});

await scenario("R98", "Insurance approvals: switch removed / expired clinic / other tenant all refused", async () => {
  // Strip patients.edit from a copy of the receptionist (custom switches) — the claims gate.
  await userRef("customA").update({ [`clinicPermissions.${A}`]: base("Receptionist").filter((p) => p !== "patients.edit") });
  const before = await count(A, "insurance_claims");
  const r = await claims("customA", { clinicId: A, docId: "doc-1", payerId: "metlife", extraction: SAMPLE_RAW, patient: { id: "pA1" } });
  check("receptionist without patients.edit → 403", r.status === 403, r);
  check("no claim written", (await count(A, "insurance_claims")) === before);
  const x = await claims("recX", { clinicId: X, docId: "doc-1", payerId: "metlife", extraction: SAMPLE_RAW, patient: { id: "pX1" } });
  check("expired clinic → 403", x.status === 403, x);
  await userRef("customA").update({ [`clinicPermissions.${A}`]: [...base("Receptionist"), "finance.delete"].sort() });
});

await scenario("R99", "AI connector (MCP): a removed member's key dies; a full key held by a settings-trusted receptionist", async () => {
  // The key a receptionist-with-settings mints for herself, scope full.
  const minted = await mcpKeys("mgrA", { clinicId: A, scope: "full", label: "desk" });
  check("mgrA (access.settings) may mint → 200", minted.status === 200 && typeof minted.json.secret === "string", minted.status);
  const secret = String(minted.json.secret || "");
  const rpc = (key: string, name: string, args: Json) =>
    handleMcpPost(new Request("http://localhost/api/mcp", { method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) }));
  const out = async (res: Response) => { const j = (await res.json()) as Json; return { status: res.status, isError: Boolean(j.result?.isError), text: String(j.result?.content?.[0]?.text || j.error?.message || "") }; };

  // Server-only collections the browser may never write: the key must not reach them either.
  for (const [collection, data] of [
    ["staff_settlements", { staffId: "st-rec", kind: "payout", amount: 9000, date: today }],
    ["ai_usage", { credits: 1_000_000 }],
    ["staff", { name: "Desk Rec", salary: 99999 }],
    ["settings", { discountsAllowed: true }],
  ] as const) {
    const id = collection === "staff" ? "st-rec" : collection === "settings" ? "discounts" : undefined;
    const r = await out(await rpc(secret, "write_document", { collection, ...(id ? { id } : {}), data }));
    check(`receptionist key write to ${collection} → refused`, r.isError, r.text.slice(0, 120));
  }
  check("st-rec salary not raised", (await col(A, "staff").doc("st-rec").get()).get("salary") === 4321);
  const del = await out(await rpc(secret, "delete_document", { collection: "ledger", id: "incA1" }));
  check("receptionist key hard-deleting a ledger row → refused", del.isError, del.text.slice(0, 120));
  check("income row survives", await exists(A, "ledger", "incA1"));

  // Ordinary writes keep working, and an Admin's key keeps what the rules give an Admin.
  const okPatient = await out(await rpc(secret, "write_document", { collection: "patients", data: { name: "Booked via assistant" } }));
  check("receptionist key may still create a patient", !okPatient.isError, okPatient.text.slice(0, 120));
  const adminKey = await mintMcpKey({ clinicId: A, uid: "adminA", label: "admin", scope: "full", createdByName: "Admin A" });
  const adminStaff = await out(await rpc(adminKey.secret, "write_document", { collection: "staff", id: "st-secret", data: { note: "admin edit" } }));
  check("admin key may edit a staff card (admin-writable in rules)", !adminStaff.isError, adminStaff.text.slice(0, 120));
  const adminLedger = await out(await rpc(adminKey.secret, "write_document", { collection: "ledger", data: { type: "income", amount: 1 } }));
  check("admin key raw ledger write → refused (money goes through the ledger route)", adminLedger.isError, adminLedger.text.slice(0, 120));
  const adminSettle = await out(await rpc(adminKey.secret, "write_document", { collection: "staff_settlements", data: { amount: 1 } }));
  check("admin key raw staff_settlements write → refused", adminSettle.isError, adminSettle.text.slice(0, 120));
  for (const d of (await col(A, "patients").where("name", "==", "Booked via assistant").get()).docs) await d.ref.delete();

  // The R88 receptionist (flat role self-set to "Admin") asks for a FULL key, naming no clinic.
  const esc = await mcpKeys("escRecA", { scope: "full", label: "mine" });
  check("escalated receptionist minting a full key without clinicId → 403", esc.status === 403, { status: esc.status, ok: esc.json.ok });
  if (typeof esc.json.secret === "string") {
    const w = await out(await rpc(esc.json.secret, "write_document", { collection: "staff", id: "st-rec", data: { salary: 88888 } }));
    check("…and that key cannot raise her own salary", w.isError, w.text.slice(0, 120));
  }
  check("st-rec salary still 4321 after the escalated key", (await col(A, "staff").doc("st-rec").get()).get("salary") === 4321, (await col(A, "staff").doc("st-rec").get()).get("salary"));
  await col(A, "staff").doc("st-rec").set({ salary: 4321 }, { merge: true });

  // Removed from the clinic → the key is dead by consequence.
  const leaverKey = await mintMcpKey({ clinicId: A, uid: "leaverA", label: "old", scope: "read", createdByName: "Leaving Soon" });
  const dead = await rpc(leaverKey.secret, "query_collection", { collection: "patients" });
  check("removed member's key → 401", dead.status === 401, dead.status);
  // Revoke-by-permission: a key cannot read money once finance access is gone.
  const recKey = await mintMcpKey({ clinicId: A, uid: "dentA", label: "dent", scope: "read", createdByName: "Dr Dent" });
  const money = await out(await rpc(recKey.secret, "query_collection", { collection: "ledger" }));
  check("dentist key (no access.finance) reading ledger → refused", money.isError, money.text.slice(0, 120));
  // tidy what got through
  for (const c of ["staff_settlements", "ai_usage"]) for (const d of (await col(A, c).get()).docs) if (d.get("updatedVia") === "mcp") await d.ref.delete();
  await col(A, "staff").doc("st-rec").set({ salary: 4321 }, { merge: true });
});

// ================================================================================================
// BROWSER RULES (R100)
// ================================================================================================

await scenario("R100", "Browser SDK under firestore.rules: money/clinical/settlement writes, cross-clinic reads, self-escalation", async () => {
  const { initializeTestEnvironment, assertFails, assertSucceeds } = await import("@firebase/rules-unit-testing");
  const fs = await import("firebase/firestore");
  fs.setLogLevel("error");
  const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8085").split(":");
  const env = await initializeTestEnvironment({
    projectId: RULES_PROJECT,
    firestore: { rules: readFileSync(new URL("../../firestore.rules", import.meta.url), "utf8"), host, port: Number(port) },
  });
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const d = ctx.firestore();
    await fs.setDoc(fs.doc(d, `clinics/${A}`), { name: "Victim", status: "Active" });
    await fs.setDoc(fs.doc(d, `clinics/${B}`), { name: "Other", status: "Active" });
    await fs.setDoc(fs.doc(d, `clinics/${X}`), { name: "Lapsed", status: "Active", expiresAt: fs.Timestamp.fromDate(new Date(Date.now() - 86_400_000)) });
    for (const [uid, data] of [
      ["adminA", staffUser(A, "Admin", [])],
      ["dentA", staffUser(A, "Dentist")],
      ["recA", staffUser(A, "Receptionist")],
      ["recX", staffUser(X, "Receptionist")],
      ["adminB", staffUser(B, "Admin", [])],
    ] as const) await fs.setDoc(fs.doc(d, `users/${uid}`), data);
    await fs.setDoc(fs.doc(d, `clinics/${A}/patients/pA1`), { name: "Victim Patient" });
    await fs.setDoc(fs.doc(d, `clinics/${B}/patients/pB1`), { name: "B Patient" });
    await fs.setDoc(fs.doc(d, `clinics/${A}/ledger/L1`), { type: "income", amount: 100 });
    await fs.setDoc(fs.doc(d, `clinics/${A}/staff/st-dent`), { name: "Dr Dent", uid: "dentA", commissionPercentage: 40 });
    await fs.setDoc(fs.doc(d, `clinics/${A}/staff_settlements/ded1`), { staffId: "st-dent", kind: "deduction", amount: 300, date: today });
  });
  const as = (uid: string) => env.authenticatedContext(uid).firestore();
  const expect = async (label: string, p: Promise<unknown>, want: "allow" | "deny") => {
    try {
      if (want === "allow") await assertSucceeds(p);
      else await assertFails(p);
      check(label, true);
    } catch (e) {
      check(label, false, `expected ${want}: ${e instanceof Error ? e.message.slice(0, 160) : e}`);
    }
  };
  const admin = as("adminA"), dent = as("dentA"), rec = as("recA"), recX = as("recX"), adminB = as("adminB");

  await expect("receptionist creates a ledger row → deny", fs.setDoc(fs.doc(rec, `clinics/${A}/ledger/evil`), { type: "payment", paid: 1 }), "deny");
  await expect("admin edits a ledger row from the browser → deny", fs.updateDoc(fs.doc(admin, `clinics/${A}/ledger/L1`), { amount: 1 }), "deny");
  await expect("dentist creates a clinical note → deny", fs.setDoc(fs.doc(dent, `clinics/${A}/clinical_notes/n1`), { procedure: "x", cost: 0 }), "deny");
  await expect("admin creates an insurance claim → deny", fs.setDoc(fs.doc(admin, `clinics/${A}/insurance_claims/c1`), { amount: 1 }), "deny");
  await expect("dentist writes himself a payout in staff_settlements → deny", fs.setDoc(fs.doc(dent, `clinics/${A}/staff_settlements/mine`), { staffId: "st-dent", kind: "payout", amount: 5000, date: today }), "deny");
  await expect("receptionist edits a settlement amount → deny", fs.updateDoc(fs.doc(rec, `clinics/${A}/staff_settlements/ded1`), { amount: 1 }), "deny");
  await expect("dentist deletes the deduction against him → deny", fs.deleteDoc(fs.doc(dent, `clinics/${A}/staff_settlements/ded1`)), "deny");
  await expect("dentist raises his own commission on the staff card → deny", fs.updateDoc(fs.doc(dent, `clinics/${A}/staff/st-dent`), { commissionPercentage: 90 }), "deny");
  await expect("admin of A reads B's patient → deny", fs.getDoc(fs.doc(admin, `clinics/${B}/patients/pB1`)), "deny");
  await expect("admin of B reads A's patient → deny", fs.getDoc(fs.doc(adminB, `clinics/${A}/patients/pA1`)), "deny");
  await expect("admin of A reads A's patient (sanity) → allow", fs.getDoc(fs.doc(admin, `clinics/${A}/patients/pA1`)), "allow");
  await expect("unauthenticated reads A's patient → deny", fs.getDoc(fs.doc(env.unauthenticatedContext().firestore(), `clinics/${A}/patients/pA1`)), "deny");
  await expect("expired clinic: receptionist adds a patient → deny", fs.setDoc(fs.doc(recX, `clinics/${X}/patients/new`), { name: "late" }), "deny");
  await expect("receptionist edits own clinicRoles → deny", fs.updateDoc(fs.doc(rec, "users/recA"), { [`clinicRoles.${A}`]: "Admin" }), "deny");
  await expect("receptionist edits own clinicPermissions → deny", fs.updateDoc(fs.doc(rec, "users/recA"), { [`clinicPermissions.${A}`]: ["finance.delete"] }), "deny");
  // The fields the server falls back to when a request names no clinic (see R85–R88).
  await expect("receptionist rewrites own flat role to Admin → deny", fs.updateDoc(fs.doc(rec, "users/recA"), { role: "Admin" }), "deny");
  await expect("receptionist rewrites own flat permissions → deny", fs.updateDoc(fs.doc(rec, "users/recA"), { permissions: ["finance.delete", "finance.edit"] }), "deny");
  await expect("brand-new account self-provisions role Admin + defaultClinicId=A → deny",
    fs.setDoc(fs.doc(as("newbie"), "users/newbie"), { clinicRoles: {}, role: "Admin", defaultClinicId: A }), "deny");
  await expect("receptionist rewrites own isDentist → deny", fs.updateDoc(fs.doc(rec, "users/recA"), { isDentist: true }), "deny");
  await expect("receptionist points own defaultClinicId at B (no role there) → deny", fs.updateDoc(fs.doc(rec, "users/recA"), { defaultClinicId: B }), "deny");
  // What the app itself writes on a person's own profile must keep working.
  await expect("receptionist sets defaultClinicId to her own clinic → allow", fs.updateDoc(fs.doc(rec, "users/recA"), { defaultClinicId: A }), "allow");
  await expect("receptionist saves her own uiPreferences / mutes → allow",
    fs.setDoc(fs.doc(rec, "users/recA"), { uiPreferences: { androidHome: "today" }, notificationMutes: { [A]: ["x"] }, tourIntroSeen: true }, { merge: true }), "allow");
  await expect("first-login provisioning (uid, email, name, createdAt) → allow",
    fs.setDoc(fs.doc(as("fresh"), "users/fresh"), { uid: "fresh", email: "fresh@x.test", name: "Fresh", createdAt: fs.serverTimestamp() }, { merge: true }), "allow");
  await expect("dentist reads the settlements the Team page shows → allow", fs.getDoc(fs.doc(dent, `clinics/${A}/staff_settlements/ded1`)), "allow");
  await env.clearFirestore();
  await env.cleanup();
});

// ------------------------------------------------------------------------------------------------
await wipe();
authServer.close();
console.log(`\n${passed} passed, ${failed} failed`);
console.log("\nSUMMARY");
for (const [id, v] of verdicts) console.log(`  ${id}  ${v.fails.length ? `FAIL (${v.fails.length})` : "PASS"}  ${v.title}`);
process.exit(failed ? 1 : 0);
