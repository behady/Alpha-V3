/**
 * Per-service done dates on an insurance approval, through the real claims route (and the clinical
 * editor's route, which marks services done too), against the Firestore emulator.
 *
 * DENT INN bills each insurer monthly. An approval issued 20/10 and finished 5/11 belongs on
 * November's closing sheet, while the service done on 20/10 is still October's pay for its dentist.
 *
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8085 npx tsx tests/insuranceLineDatesRoute.test.mts
 *
 * Same harness as approvalDateRoute.test.mts: only the login check is stood in for.
 */

import { createServer } from "node:http";
import { generateKeyPairSync } from "node:crypto";

const PROJECT = "demo-line-dates";
const CLINIC = "C1";
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
const clinical = await import("../src/app/api/clinical/procedures/route");
const { parseClaim } = await import("../src/lib/insurance/claims");
const { ymdInTimeZone, clinicTimeZone } = await import("../src/lib/clinicDate");

const db = adminDb();
const clinic = db.collection("clinics").doc(CLINIC);
const claims = clinic.collection("insurance_claims");
const ledger = clinic.collection("ledger");
const notes = clinic.collection("clinical_notes");
const as = idToken(UID);
const TODAY = ymdInTimeZone(clinicTimeZone());

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
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

type Json = Record<string, any>;
async function patch(claimId: string, p: Json): Promise<{ status: number; json: Json }> {
  const res = await route.PATCH(
    new Request("http://localhost/api/insurance/claims", {
      method: "PATCH",
      headers: { authorization: `Bearer ${as}`, "content-type": "application/json" },
      body: JSON.stringify({ clinicId: CLINIC, claimId, patch: p }),
    }),
  );
  return { status: res.status, json: (await res.json()) as Json };
}
/** The clinical editor saving a treatment an approval wrote (the dentist marks it done there). */
async function clinicalUpdate(noteId: string, body: Json): Promise<{ status: number; json: Json }> {
  const res = await clinical.POST(
    new Request("http://localhost/api/clinical/procedures", {
      method: "POST",
      headers: { authorization: `Bearer ${as}`, "content-type": "application/json" },
      body: JSON.stringify({ action: "update", clinicId: CLINIC, noteId, patientId: "P1", doctorId: null, note: "", ...body }),
    }),
  );
  return { status: res.status, json: (await res.json()) as Json };
}

const line = (code: string, description: string, amount: number) => ({
  code, description, unitsRequested: 1, grossPerUnit: amount, grossTotal: amount,
  unitsApproved: 1, patientShare: 0, approvedAmount: amount, comment: "", confidence: 1,
});
const metlife = { policyNumber: "6480600000", employer: "", certificateNumber: "124", dependentCode: "1", paperPatientNameAr: "مصطفى سيد" };
const LINES = [line("D0120", "EXAMINATION / ORAL EVALUATION", 60), line("D2391", "COMPOSITE ONE SURFACE", 400), line("D2740", "CROWN PORCELAIN", 1500)];

/** An approval of 20/10 with three services and their treatment rows, all dated 20/10. */
async function seed(id: string, extra: Json = {}) {
  await claims.doc(id).set({
    insurer: "metlife", payerId: "metlife", status: "treated", approvalNumber: id.toUpperCase(), approvalDate: "2026-10-20", treatedDate: "2026-10-20",
    patientId: "P1", patientName: "مصطفى سيد", paperPatientName: "MOSTAFA SAYED", metlife,
    lines: LINES,
    totals: { requested: 1960, approved: 1960, patientShare: 0 },
    ledgerIds: Object.fromEntries([0, 1, 2].map((i) => [i, { ledgerId: `${id}-L${i}`, noteId: `${id}-N${i}` }])),
    dentists: {}, lineStatus: {},
    ...extra,
  });
  for (const i of [0, 1, 2]) {
    const status = (extra.lineStatus as Json | undefined)?.[i] ?? "Completed";
    const date = (extra.lineDates as Json | undefined)?.[i] ?? "2026-10-20";
    await ledger.doc(`${id}-L${i}`).set({ patientId: "P1", type: "procedure", claimId: id, date, amount: LINES[i].approvedAmount, cost: LINES[i].approvedAmount, paid: 0, description: LINES[i].description });
    await notes.doc(`${id}-N${i}`).set({ patientId: "P1", claimId: id, date, status, procedure: LINES[i].description, cost: LINES[i].approvedAmount, note: "", doctorId: null, tooth: "Gen", payerId: "metlife", ledgerId: `${id}-L${i}` });
  }
}
const raw = async (id: string) => (await claims.doc(id).get()).data() as Json;
const claimOf = async (id: string) => parseClaim(id, await raw(id))!;
const rowDates = async (id: string) =>
  Promise.all([0, 1, 2].map(async (i) => [(await ledger.doc(`${id}-L${i}`).get()).data()?.date ?? null, (await notes.doc(`${id}-N${i}`).get()).data()?.date ?? null]));
/** Everything a refusal must leave alone: the claim as stored and the dates on its rows. */
const frozen = async (id: string) => JSON.stringify([await raw(id), await rowDates(id)]);
const D20 = ["2026-10-20", "2026-10-20"];

await db.recursiveDelete(clinic);
await clinic.set({ name: "Line Dates Test", status: "Active", subscriptionTier: "Premium", features: { insurance: true } });
await db.collection("users").doc(UID).set({ name: "Dr Tester", clinicRoles: { [CLINIC]: "Admin" } });
await clinic.collection("patients").doc("P1").set({ name: "مصطفى سيد" });

console.log("the last service was done on 5/11");
{
  await seed("metlife_a1");
  const r = await patch("metlife_a1", { lineDates: { 2: "2026-11-05" } });
  check("the date is accepted", r.status === 200, r.json);
  const c = await claimOf("metlife_a1");
  check("the service carries its own day", same(c.lineDates, { 2: "2026-11-05" }), c.lineDates);
  check("its charge and note moved to 5/11, the others stayed on 20/10", same(await rowDates("metlife_a1"), [D20, D20, ["2026-11-05", "2026-11-05"]]), await rowDates("metlife_a1"));
  check("the approval is finished on 5/11", c.finishedDate === "2026-11-05", c.finishedDate);
  check("work was done in October and November", same(c.workMonths, ["2026-10", "2026-11"]), c.workMonths);
  check("the approval's own dates did not move", c.approvalDate === "2026-10-20" && c.treatedDate === "2026-10-20", c);
  const audit = await clinic.collection("ledger_audit").where("documentId", "==", "metlife_a1-L2").get();
  check("the move is in the money audit", audit.size === 1, audit.size);
  const quiet = await clinic.collection("ledger_audit").where("documentId", "==", "metlife_a1-L0").get();
  check("and only that service's charge was touched", quiet.size === 0, quiet.size);
}

console.log("the service goes back to Planned, then is marked done by hand");
{
  const back = await patch("metlife_a1", { lineStatus: { 2: "Planned" } });
  check("accepted", back.status === 200, back.json);
  let c = await claimOf("metlife_a1");
  check("its day is gone", same(c.lineDates, {}), c.lineDates);
  check("its rows are back on the approval's treated day", same(await rowDates("metlife_a1"), [D20, D20, D20]), await rowDates("metlife_a1"));
  check("the approval is not finished any more", c.finishedDate === null && same(c.workMonths, ["2026-10"]), c);
  const done = await patch("metlife_a1", { lineStatus: { 2: "Completed" } });
  check("marked done", done.status === 200, done.json);
  c = await claimOf("metlife_a1");
  check("done by hand means done today", c.lineDates[2] === TODAY, c.lineDates);
  check("its rows are dated today", same((await rowDates("metlife_a1"))[2], [TODAY, TODAY]), await rowDates("metlife_a1"));
  check("and the approval is finished today", c.finishedDate === TODAY, c.finishedDate);
}

console.log("what is refused");
{
  await seed("metlife_b1", { lineStatus: { 2: "Planned" } });
  const before = await frozen("metlife_b1");
  const early = await patch("metlife_b1", { lineDates: { 0: "2026-10-19" } });
  check("a day before the approval date is a 400", early.status === 400, early.json);
  const tomorrow = new Date(`${TODAY}T00:00:00Z`);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const late = await patch("metlife_b1", { lineDates: { 0: tomorrow.toISOString().slice(0, 10) } });
  check("a day after today is a 400", late.status === 400, late.json);
  const junk = await patch("metlife_b1", { lineDates: { 0: "5/11/2026" } });
  check("a day not in yyyy-mm-dd is a 400", junk.status === 400, junk.json);
  const noLine = await patch("metlife_b1", { lineDates: { 7: "2026-10-21" } });
  check("a service that is not on the approval is a 400", noLine.status === 400, noLine.json);
  const open = await patch("metlife_b1", { lineDates: { 2: "2026-10-21" } });
  check("a service that is not done cannot be dated", open.status === 400, open.json);
  check("and nothing changed", (await frozen("metlife_b1")) === before);
  const both = await patch("metlife_b1", { lineStatus: { 2: "Completed" }, lineDates: { 2: "2026-10-28" } });
  check("done and dated in one save (what a finished visit sends) is accepted", both.status === 200, both.json);
  check("with the visit's day, not today", (await claimOf("metlife_b1")).lineDates[2] === "2026-10-28");
  const cleared = await patch("metlife_b1", { lineDates: { 2: null } });
  check("null clears a day", cleared.status === 200 && same((await claimOf("metlife_b1")).lineDates, {}), cleared.json);
}

console.log("the approval's own treated day moves only the services without a day of their own");
{
  await seed("metlife_c1", { lineDates: { 2: "2026-11-05" } });
  const r = await patch("metlife_c1", { treatedDate: "2026-10-22" });
  check("accepted", r.status === 200, r.json);
  const D22 = ["2026-10-22", "2026-10-22"];
  check("two services moved, the dated one stayed", same(await rowDates("metlife_c1"), [D22, D22, ["2026-11-05", "2026-11-05"]]), await rowDates("metlife_c1"));
  check("still finished on 5/11", (await claimOf("metlife_c1")).finishedDate === "2026-11-05");
}

console.log("not treated after all");
{
  const r = await patch("metlife_c1", { status: "approved" });
  check("accepted", r.status === 200, r.json);
  const c = await claimOf("metlife_c1");
  check("nothing is finished and no month has work", c.finishedDate === null && same(c.workMonths, []), c);
  check("the services' days went with the work", same(c.lineDates, {}), c.lineDates);
  const again = await patch("metlife_c1", { status: "treated" });
  check("treated again", again.status === 200, again.json);
  const c2 = await claimOf("metlife_c1");
  check("it is today's work now, as before per-service dates", c2.treatedDate === TODAY && c2.finishedDate === TODAY, c2);
  const rows = await Promise.all(Object.values(c2.ledgerIds).map(async (l) => (await ledger.doc(l.ledgerId).get()).data()?.date));
  check("its new rows are dated today", rows.length === 3 && rows.every((d) => d === TODAY), rows);
}

console.log("an approval saved before per-service dates existed");
{
  await seed("metlife_old1");
  const before = await raw("metlife_old1");
  check("it has none of the new fields", !("lineDates" in before) && !("finishedDate" in before));
  const r = await patch("metlife_old1", { lineStatus: { 0: "Completed" } });
  check("re-saving a service that was already done is accepted", r.status === 200, r.json);
  const c = await claimOf("metlife_old1");
  check("nothing is stamped today: the service keeps the treated day", same(c.lineDates, {}), c.lineDates);
  check("it is finished on its treated day, the month it was always in", c.finishedDate === "2026-10-20" && same(c.workMonths, ["2026-10"]), c);
  check("no row moved", same(await rowDates("metlife_old1"), [D20, D20, D20]), await rowDates("metlife_old1"));
}

console.log("an approval already sent to the company keeps its month");
{
  await seed("metlife_s1", { status: "sent", lineDates: { 2: "2026-10-25" } });
  const sameMonth = await patch("metlife_s1", { lineDates: { 2: "2026-10-27" } });
  check("a change inside the same month is accepted", sameMonth.status === 200 && (await claimOf("metlife_s1")).finishedDate === "2026-10-27", sameMonth.json);
  const before = await frozen("metlife_s1");
  const moved = await patch("metlife_s1", { lineDates: { 2: "2026-11-03" } });
  check("moving it to another month is a 409", moved.status === 409 && moved.json.reason === "sent_locked", moved.json);
  const reopened = await patch("metlife_s1", { lineStatus: { 2: "Planned" } });
  check("reopening it is a 409", reopened.status === 409 && reopened.json.reason === "sent_locked", reopened.json);
  check("the refusals changed nothing", (await frozen("metlife_s1")) === before);
  const unsent = await patch("metlife_s1", { status: "treated" });
  check("Mark not sent is accepted", unsent.status === 200 && (await claimOf("metlife_s1")).status === "treated", unsent.json);
  check("and touched no row", same(await rowDates("metlife_s1"), [D20, D20, ["2026-10-27", "2026-10-27"]]), await rowDates("metlife_s1"));
  const after = await patch("metlife_s1", { lineDates: { 2: "2026-11-03" } });
  check("then the move goes through", after.status === 200 && (await claimOf("metlife_s1")).finishedDate === "2026-11-03", after.json);
}

console.log("the dentist marks a service done from the clinical tab");
{
  await seed("metlife_k1", { lineStatus: { 2: "Planned" } });
  const done = await clinicalUpdate("metlife_k1-N2", { status: "Completed" });
  check("the save is accepted", done.status === 200, done.json);
  let c = await claimOf("metlife_k1");
  check("the approval's service is Completed", c.lineStatus[2] === "Completed", c.lineStatus);
  check("done today", c.lineDates[2] === TODAY, c.lineDates);
  check("its rows are dated today", same((await rowDates("metlife_k1"))[2], [TODAY, TODAY]), await rowDates("metlife_k1"));
  check("the approval is finished today", c.finishedDate === TODAY && same(c.workMonths, [...new Set(["2026-10", TODAY.slice(0, 7)])].sort()), c);
  const back = await clinicalUpdate("metlife_k1-N2", { status: "Planned" });
  check("back to Planned is accepted", back.status === 200, back.json);
  c = await claimOf("metlife_k1");
  check("its day is gone and the approval is open again", same(c.lineDates, {}) && c.finishedDate === null, c);
  check("its rows are back on the treated day", same((await rowDates("metlife_k1"))[2], D20), await rowDates("metlife_k1"));

  await seed("metlife_k2", { status: "sent" });
  const locked = await clinicalUpdate("metlife_k2-N2", { status: "Planned" });
  check("reopening a sent approval from the clinical tab is refused", locked.status === 409, locked.json);
  check("and its service is still Completed", (await notes.doc("metlife_k2-N2").get()).data()?.status === "Completed" && (await claimOf("metlife_k2")).lineStatus[2] !== "Planned");
}

console.log("the paper is edited to fewer services");
{
  await seed("metlife_r1", { approvalNumber: "D7000009", lineDates: { 1: "2026-10-22", 2: "2026-11-05" } });
  const r = await patch("metlife_r1", { lines: [LINES[0], LINES[1]], metlife: { requestedTotal: 460, approvedTotal: 460, patientShareTotal: 0 } });
  check("the edit is accepted", r.status === 200, r.json);
  const c = await claimOf("metlife_r1");
  check("two services are left", c.lines.length === 2, c.lines.length);
  check("the day of the service that left went with it; the other is kept", same(c.lineDates, { 1: "2026-10-22" }), c.lineDates);
  check("it is finished on the last day left", c.finishedDate === "2026-10-22", c.finishedDate);
  const rows = await Promise.all(Object.values(c.ledgerIds).map(async (l) => (await ledger.doc(l.ledgerId).get()).data()?.date));
  check("the rebuilt rows carry each service's day", same(rows, ["2026-10-20", "2026-10-22"]), rows);
}

console.log("a new approval is saved");
{
  await clinic.collection("settings").doc("payers").set({ payers: [{ id: "metlife", name: "MetLife", format: "metlife", active: true }] });
  const save = async (approvalNumber: string, docId: string, lines?: Json) => {
    const res = await route.POST(
      new Request("http://localhost/api/insurance/claims", {
        method: "POST",
        headers: { authorization: `Bearer ${as}`, "content-type": "application/json" },
        body: JSON.stringify({
          clinicId: CLINIC, docId, payerId: "metlife", patient: { id: "P1" }, status: "treated", ...(lines ? { lines } : {}),
          extraction: {
            header: { ...metlife, approvalNumber, approvalDate: "2026-10-20", paperPatientName: "MOSTAFA SAYED", requestedTotal: 1960, approvedTotal: 1960, patientShareTotal: 0, confidence: 1 },
            lines: LINES,
          },
        }),
      }),
    );
    return { status: res.status, json: (await res.json()) as Json };
  };
  const open = await save("D7000001", "doc-1", { 2: { status: "Planned" } });
  check("saved with one service still planned", open.status === 201, open.json);
  const c = await claimOf(String(open.json.claimId));
  check("not finished yet, and this month has work", c.finishedDate === null && same(c.workMonths, [TODAY.slice(0, 7)]), [c.finishedDate, c.workMonths]);
  const done = await save("D7000002", "doc-2");
  check("saved with every service done", done.status === 201, done.json);
  const c2 = await claimOf(String(done.json.claimId));
  check("finished on the day it was treated", c2.finishedDate === TODAY && c2.treatedDate === TODAY, [c2.finishedDate, c2.treatedDate]);
}

console.log("a service the patient will not come back for is deleted");
{
  await seed("metlife_x1", { lineStatus: { 2: "Planned" } });
  const mixed = await patch("metlife_x1", { removeLine: 2, lineStatus: { 1: "Planned" } });
  check("a delete travels alone", mixed.status === 400, mixed.json);
  const done = await patch("metlife_x1", { removeLine: 0 });
  check("a service that was done cannot be deleted", done.status === 409 && done.json.reason === "line_done", done.json);
  const none = await patch("metlife_x1", { removeLine: 7 });
  check("a service that is not on the approval is a 400", none.status === 400, none.json);
  check("nothing was deleted by the refusals", (await ledger.doc("metlife_x1-L2").get()).exists && (await ledger.doc("metlife_x1-L0").get()).exists);

  const r = await patch("metlife_x1", { removeLine: 2 });
  check("the planned service is deleted", r.status === 200 && r.json.creditKept === 0, r.json);
  check("its charge and note left the patient's file", !(await ledger.doc("metlife_x1-L2").get()).exists && !(await notes.doc("metlife_x1-N2").get()).exists);
  check("the other services' rows are untouched", same((await rowDates("metlife_x1")).slice(0, 2), [D20, D20]));
  const c = await claimOf("metlife_x1");
  check("the approval remembers who deleted it and when", c.removedLines[2]?.at === TODAY && c.removedLines[2]?.by === UID, c.removedLines);
  check("it no longer links to a row", !(2 in c.ledgerIds) && Object.keys(c.ledgerIds).length === 2, c.ledgerIds);
  check("the paper still lists the service", c.lines.length === 3);
  check("the approval is finished on its last done day", c.finishedDate === "2026-10-20", c.finishedDate);
  check("its totals leave the deleted service out", c.totals.approved === 460, c.totals);
  const audit = await clinic.collection("ledger_audit").where("documentId", "==", "metlife_x1-L2").get();
  check("the deletion is in the money audit", audit.docs.some((d) => d.data().action === "delete"), audit.size);
  const twice = await patch("metlife_x1", { removeLine: 2 });
  check("deleting it twice is refused", twice.status === 409, twice.json);
}

console.log("a deleted service is restored");
{
  const r = await patch("metlife_x1", { restoreLine: 2 });
  check("accepted", r.status === 200, r.json);
  const c = await claimOf("metlife_x1");
  check("it is on the approval again", same(c.removedLines, {}), c.removedLines);
  check("the approval is open again", c.finishedDate === null, c.finishedDate);
  const link = c.ledgerIds[2];
  const charge = link ? (await ledger.doc(link.ledgerId).get()).data() : undefined;
  const note = link ? (await notes.doc(link.noteId).get()).data() : undefined;
  check("its treatment row is back, as a Planned service on the treated day", charge?.date === "2026-10-20" && charge?.cost === 1500 && note?.status === "Planned" && note?.date === "2026-10-20", [charge, note]);
  check("the other services kept their own rows", c.ledgerIds[0]?.ledgerId === "metlife_x1-L0" && c.ledgerIds[1]?.ledgerId === "metlife_x1-L1", c.ledgerIds);
  const again = await patch("metlife_x1", { restoreLine: 2 });
  check("restoring a service that is not deleted is refused", again.status === 409, again.json);
}

console.log("a service with the patient's money on it is deleted (the owner's rule: allowed, the money stays)");
{
  await seed("metlife_x2", { lineStatus: { 2: "Planned" } });
  await ledger.doc("metlife_x2-L2").update({ paid: 50 });
  await ledger.doc("metlife_x2-PAY").set({
    patientId: "P1", type: "payment", procedureId: "metlife_x2-L2", claimId: "metlife_x2", paid: 50, amount: 50, cost: 0, date: "2026-10-21", method: "Cash",
    category: "Insurance patient share", description: "Patient share - CROWN PORCELAIN", payerId: "metlife", payerName: "MetLife",
    doctorId: "s1", doctorName: "Dr A", doctorCommissionPercentage: 10, doctorCommissionAmount: 5, clinicProfit: 45, receiptNumber: "R-7",
  });
  const r = await patch("metlife_x2", { removeLine: 2 });
  check("the delete is accepted", r.status === 200, r.json);
  check("and says how much stays with the patient", r.json.creditKept === 50, r.json);
  check("the charge left the file", !(await ledger.doc("metlife_x2-L2").get()).exists);
  const pay = (await ledger.doc("metlife_x2-PAY").get()).data() ?? {};
  check("the payment is still there, to the piastre, on its own day", pay.paid === 50 && pay.amount === 50 && pay.date === "2026-10-21" && pay.method === "Cash" && pay.receiptNumber === "R-7", pay);
  check("it settles no treatment now: money on the patient's account", pay.procedureId === null && !("claimId" in pay) && pay.category === "Advance Payment", pay);
  check("and earns no dentist commission", pay.doctorId === null && pay.doctorCommissionPercentage === 0 && pay.doctorCommissionAmount === 0 && pay.clinicProfit === 50, pay);
  const audit = await clinic.collection("ledger_audit").where("documentId", "==", "metlife_x2-PAY").get();
  check("the payment's change is in the money audit", audit.size === 1, audit.size);
}

console.log("the insurer's own payment is not the patient's credit");
{
  await seed("metlife_x3", { lineStatus: { 2: "Planned" } });
  await ledger.doc("metlife_x3-PAY").set({ patientId: "P1", type: "payment", procedureId: "metlife_x3-L2", claimId: "metlife_x3", paid: 1500, amount: 1500, date: "2026-10-21", method: "Insurance", category: "Insurance Payment" });
  const before = await frozen("metlife_x3");
  const r = await patch("metlife_x3", { removeLine: 2 });
  check("deleting a service the insurer already paid is refused", r.status === 409 && r.json.reason === "insurer_paid_line", r.json);
  check("and nothing changed", (await frozen("metlife_x3")) === before && (await ledger.doc("metlife_x3-PAY").get()).data()?.procedureId === "metlife_x3-L2");
}

console.log("deleted services and an approval already sent");
{
  await seed("metlife_x4", { status: "sent", lineStatus: { 1: "Planned" }, removedLines: { 1: { at: "2026-10-30", by: UID } }, ledgerIds: { 0: { ledgerId: "metlife_x4-L0", noteId: "metlife_x4-N0" }, 2: { ledgerId: "metlife_x4-L2", noteId: "metlife_x4-N2" } } });
  const before = await frozen("metlife_x4");
  const r = await patch("metlife_x4", { restoreLine: 1 });
  check("restoring a service would reopen a sent approval: refused", r.status === 409 && r.json.reason === "sent_locked", r.json);
  check("and nothing changed", (await frozen("metlife_x4")) === before);
}

console.log("a deleted service stays deleted when the approval is treated again");
{
  await seed("metlife_x5", { lineStatus: { 2: "Planned" } });
  await patch("metlife_x5", { removeLine: 2 });
  const off = await patch("metlife_x5", { status: "approved" });
  check("marked not treated", off.status === 200, off.json);
  const bare = await patch("metlife_x5", { restoreLine: 2 });
  check("restoring on an approval with no rows is accepted", bare.status === 200 && same((await claimOf("metlife_x5")).ledgerIds, {}), bare.json);
  await patch("metlife_x5", { removeLine: 2 });
  check("and deleting there needs no rows either", (await claimOf("metlife_x5")).removedLines[2]?.by === UID);
  const on = await patch("metlife_x5", { status: "treated" });
  check("marked treated", on.status === 200, on.json);
  const c = await claimOf("metlife_x5");
  check("rows are written for the two services left, none for the deleted one", same(Object.keys(c.ledgerIds), ["0", "1"]), c.ledgerIds);
  check("and it is finished today", c.finishedDate === TODAY, c.finishedDate);
}

authServer.close();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
