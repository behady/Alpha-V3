/**
 * A discount on the patient's share of an approval service, through the real claims route,
 * against the Firestore emulator (owner's decisions, 2026-11-16).
 *
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8085 npx tsx tests/shareDiscountRoute.test.mts
 *
 * Same harness as approvalDateRoute.test.mts: only the login check is stood in for.
 */

import { createServer } from "node:http";
import { generateKeyPairSync } from "node:crypto";

const PROJECT = "demo-share-discount";
const CLINIC = "C1";
const ADMIN = "admin-1";
const DENTIST = "dent-1";
const RECEPTION = "recep-1";

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
const route = await import("../src/app/api/insurance/claims/route");
const { parseClaim } = await import("../src/lib/insurance/claims");
const { patientPortion } = await import("../src/lib/ledgerInsurer");

const db = adminDb();
const clinic = db.collection("clinics").doc(CLINIC);
const claims = clinic.collection("insurance_claims");
const ledger = clinic.collection("ledger");
const notes = clinic.collection("clinical_notes");

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
async function patch(uid: string, claimId: string, p: Json): Promise<{ status: number; json: Json }> {
  const res = await route.PATCH(
    new Request("http://localhost/api/insurance/claims", {
      method: "PATCH",
      headers: { authorization: `Bearer ${idToken(uid)}`, "content-type": "application/json" },
      body: JSON.stringify({ clinicId: CLINIC, claimId, patch: p }),
    }),
  );
  return { status: res.status, json: (await res.json()) as Json };
}
const discount = (uid: string, claimId: string, amount: number, reason = "Friend") =>
  patch(uid, claimId, { shareDiscount: { ledgerId: `${claimId}-L0`, amount, reason } });

// A crown asked at 2,700; MetLife approves 500 and the patient pays 100.
const crown = (approved = 500, share = 100) => ({
  code: "D2740", description: "CROWN", unitsRequested: 1, grossPerUnit: 2700, grossTotal: 2700,
  unitsApproved: 1, patientShare: share, approvedAmount: approved, comment: "", confidence: 1,
});
const metlife = { policyNumber: "6480600000", employer: "", certificateNumber: "124", dependentCode: "1", paperPatientNameAr: "مريض تجربة" };
const NEW_RULE = { staffId: "D1", name: "Dr Test", rate: 25, share: 150, basis: "charge" };
const OLD_RULE = { staffId: "D1", name: "Dr Test", rate: 25, share: 125 };

/** A treated approval with one treatment row, as the route writes it. */
async function seed(id: string, dentist: Json, approvalNumber = id.toUpperCase()) {
  await claims.doc(id).set({
    insurer: "metlife", payerId: "metlife", status: "treated", approvalNumber, approvalDate: "2026-11-10", treatedDate: "2026-11-10",
    patientId: "P1", patientName: "مريض تجربة", paperPatientName: "TEST PATIENT", metlife,
    lines: [crown()], totals: { requested: 2700, approved: 500, patientShare: 100 },
    ledgerIds: { 0: { ledgerId: `${id}-L0`, noteId: `${id}-N0` } },
    dentists: { 0: dentist }, lineStatus: {},
  });
  const base = {
    patientId: "P1", claimId: id, date: "2026-11-10", cost: 600, unitCost: 600, unitsCount: 1, pricingFormula: "1 x 600",
    listPrice: 2700, discountMode: "fixed", discountFixed: 2100, discountValue: 2100, discountAmount: 2100,
    discountReason: "MetLife approved 500 of 2700", payerId: "metlife", payerName: "MetLife", insurerCovered: 500, patientShare: 100,
    doctorId: "D1", serviceName: "CROWN",
  };
  await ledger.doc(`${id}-L0`).set({ ...base, type: "procedure", amount: 600, paid: 0, doctorCommissionAmount: dentist.share, clinicProfit: 600 - dentist.share });
  await notes.doc(`${id}-N0`).set({ ...base, status: "Completed" });
}
const claimOf = async (id: string) => parseClaim(id, (await claims.doc(id).get()).data())!;
const rowOf = async (id: string) => (await ledger.doc(`${id}-L0`).get()).data() ?? {};
const noteOf = async (id: string) => (await notes.doc(`${id}-N0`).get()).data() ?? {};

await db.recursiveDelete(clinic);
await clinic.set({ name: "Share Discount Test", status: "Active", subscriptionTier: "Premium", features: { insurance: true } });
await clinic.collection("settings").doc("discounts").set({ reasons: ["Friend", "Staff family"] });
await clinic.collection("patients").doc("P1").set({ name: "مريض تجربة" });
await clinic.collection("staff").doc("D1").set({ name: "Dr Test", role: "Dentist", isDentist: true, uid: DENTIST, commissionPercentage: 25 });
await db.collection("users").doc(ADMIN).set({ name: "Owner", clinicRoles: { [CLINIC]: "Admin" } });
await db.collection("users").doc(DENTIST).set({ name: "Dr Test", clinicRoles: { [CLINIC]: "Dentist" }, clinicPermissions: { [CLINIC]: ["patients.edit", "clinical.edit", "finance.add"] } });
await db.collection("users").doc(RECEPTION).set({ name: "Desk", clinicRoles: { [CLINIC]: "Receptionist" }, clinicPermissions: { [CLINIC]: ["patients.edit", "finance.add", "finance.edit"] } });

console.log("who may give it");
{
  await seed("c_who", NEW_RULE);
  const r = await discount(RECEPTION, "c_who", 40);
  check("reception (no clinical.edit) is refused", r.status === 403, r);
  check("and nothing moved", (await rowOf("c_who")).cost === 600);
  const a = await discount(ADMIN, "c_who", 10);
  check("an admin may", a.status === 200, a.json);
}

console.log("a dentist assigned under the new rule");
{
  await seed("c_new", NEW_RULE);
  const r = await discount(DENTIST, "c_new", 40);
  check("the dentist's discount is accepted", r.status === 200, r.json);
  const row = await rowOf("c_new");
  const claim = await claimOf("c_new");
  check("row price 600 → 560", row.cost === 560 && row.amount === 560, row);
  check("the insurer's part is untouched", row.insurerCovered === 500 && claim.lines[0].approvedAmount === 500 && claim.totals.approved === 500, { row: row.insurerCovered, line: claim.lines[0].approvedAmount });
  check("the paper's share is still 100", claim.lines[0].patientShare === 100 && claim.totals.patientShare === 100);
  check("the patient now owes 60", patientPortion(row) === 60, patientPortion(row));
  check("the discount is on the row with its reason", row.shareDiscount === 40 && row.shareDiscountReason === "Friend", row);
  check("total discount = insurer's gap 2,100 + 40", row.discountAmount === 2140, row.discountAmount);
  check("both reasons are named", row.discountReason === "MetLife approved 500 of 2700; Patient share discount 40: Friend", row.discountReason);
  check("the clinical note agrees", (await noteOf("c_new")).cost === 560);
  check("kept on the approval", claim.shareDiscounts[0]?.amount === 40 && claim.shareDiscounts[0]?.reason === "Friend", claim.shareDiscounts);
  check("dentist 25% of 560 = 140 on the approval", claim.dentists[0].share === 140, claim.dentists[0]);
  check("and on the row, with the clinic's profit", row.doctorCommissionAmount === 140 && row.clinicProfit === 420, row);
  const audit = await clinic.collection("ledger_audit").where("documentId", "==", "c_new-L0").get();
  check("in the money audit", audit.size >= 1, audit.size);
}

console.log("a dentist assigned before the new rule");
{
  await seed("c_old", OLD_RULE);
  const r = await discount(DENTIST, "c_old", 100, "Staff family");
  check("accepted", r.status === 200, r.json);
  const row = await rowOf("c_old");
  check("the whole share off: price = the insurer's 500", row.cost === 500, row.cost);
  check("the old stamp keeps its 125", (await claimOf("c_old")).dentists[0].share === 125 && row.doctorCommissionAmount === 125, row);
  const off = await discount(DENTIST, "c_old", 0, "");
  check("0 removes it", off.status === 200, off.json);
  const back = await rowOf("c_old");
  check("price back to 600, no discount field", back.cost === 600 && back.shareDiscount === null, back);
  check("only the insurer's reason is left", back.discountReason === "MetLife approved 500 of 2700", back.discountReason);
  check("gone from the approval", (await claimOf("c_old")).shareDiscounts[0] === undefined);
}

console.log("what is refused");
{
  await seed("c_no", NEW_RULE);
  const big = await discount(DENTIST, "c_no", 150);
  check("more than the share is a 400", big.status === 400, big.json);
  const noReason = await discount(DENTIST, "c_no", 20, "");
  check("no reason is a 400", noReason.status === 400, noReason.json);
  const oddReason = await discount(DENTIST, "c_no", 20, "Because");
  check("a reason the clinic does not offer is a 400", oddReason.status === 400, oddReason.json);
  const mixed = await patch(DENTIST, "c_no", { shareDiscount: { ledgerId: "c_no-L0", amount: 20, reason: "Friend" }, lineStatus: { 0: "Ongoing" } });
  check("mixed with another change is a 400", mixed.status === 400, mixed.json);
  const stranger = await patch(DENTIST, "c_no", { shareDiscount: { ledgerId: "someone-else", amount: 20, reason: "Friend" } });
  check("a row that is not this approval's is a 404", stranger.status === 404, stranger.json);
  check("nothing moved", (await rowOf("c_no")).cost === 600);

  // The patient already paid 80 of the 100 at the counter.
  await ledger.doc("c_no-P1").set({ patientId: "P1", type: "payment", procedureId: "c_no-L0", paid: 80, amount: 80, method: "Cash", date: "2026-11-10" });
  const tooLate = await discount(DENTIST, "c_no", 40);
  check("a discount below what was already paid is a 409 (no silent refund)", tooLate.status === 409, tooLate.json);
  const fits = await discount(DENTIST, "c_no", 20);
  check("one that still leaves 80 owing is fine", fits.status === 200 && (await rowOf("c_no")).cost === 580, fits.json);
}

console.log("an edit of the approval keeps the discount");
{
  // A real-looking MetLife number, and the paper's totals with the edit, as the Insurance tab sends them.
  await seed("c_edit", NEW_RULE, "D7000123");
  check("discount applied", (await discount(DENTIST, "c_edit", 30)).status === 200);
  const r = await patch(ADMIN, "c_edit", { lines: [crown(400, 100)], metlife: { requestedTotal: 2700, approvedTotal: 400, patientShareTotal: 100 } });
  check("the paper edit is accepted", r.status === 200, r.json);
  const claim = await claimOf("c_edit");
  const link = claim.ledgerIds[0];
  const row = link ? (await ledger.doc(link.ledgerId).get()).data() ?? {} : {};
  check("the rebuilt row: 400 + 100 − 30 = 470", row.cost === 470, row.cost);
  check("the rebuilt row still names the discount", row.shareDiscount === 30, row.shareDiscount);
  check("dentist re-worked on the new price: 25% of 470", claim.dentists[0].share === 117.5, claim.dentists[0]);
}

authServer.close();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
