import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebaseAdmin";
import { adminClinicDoc } from "@/lib/adminClinicDb";
import { recordMoneyChange } from "@/lib/server/ledgerAudit";
import { requireStaffPermission } from "@/lib/apiStaffAuth";
import { holdsPermission, isFullAccessRole } from "@/lib/permissions";
import { assertRowBranchAllowed } from "@/lib/server/branchAccess";
import { clinicHasFeature } from "@/lib/clinicFeatures";
import { clinicTimeZone, ymdInTimeZone } from "@/lib/clinicDate";
import { findPayer, isInsurerFormat, parsePayers, PRIVATE_PAYER_ID } from "@/lib/payers";
import { isApprovalRow } from "@/lib/ledgerInsurer";
import { toYmd } from "@/lib/reports/patientStats";
import { reportServerError } from "@/lib/server/reportError";
import { logActivityServer } from "@/lib/server/systemLog";
import { loadCompanySheetInputs, monthsDocId, sentDocId } from "@/lib/server/companySheetData";
import {
  buildCompanySheets,
  cardChildren,
  COMPANY_SHEET_START,
  nextMonth,
  sendRefusal,
  sheetChargeIds,
  treatmentChain,
  unsendRefusal,
} from "@/lib/insurance/companySheet";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PERMISSION = "patients.edit";
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const DAY = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

type Action = "send" | "unsend" | "finishDate" | "reopen" | "finish" | "startDate" | "pickMonth";
const ACTIONS: readonly Action[] = ["send", "unsend", "finishDate", "reopen", "finish", "startDate", "pickMonth"];
/** On the treatment's speaking card. */
const TREATMENT_ACTIONS: readonly Action[] = ["finishDate", "reopen", "finish"];
/** On one procedure's charge. */
const CHARGE_ACTIONS: readonly Action[] = ["startDate", "pickMonth"];
/** How far ahead a procedure may be placed. */
const MONTHS_AHEAD = 12;

function fail(status: number, error: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ ok: false, error, ...extra }, { status });
}

/** One path segment as it arrived in the body: present, short, and unable to step out of its folder. */
function segment(v: unknown): string {
  const s = typeof v === "string" ? v.trim() : "";
  if (!s || s.length > 200) return "";
  if (s === "." || s === ".." || /[/\\]/.test(s) || /[\u0000-\u001f]/.test(s)) return "";
  return s;
}

function isAlreadyExists(err: unknown): boolean {
  const code = (err as { code?: unknown })?.code;
  return code === 6 || code === "already-exists" || code === "ALREADY_EXISTS";
}

/** A refusal decided inside the transaction, turned into a 409 with its reason. */
class Refused extends Error {
  constructor(readonly reason: string, readonly status = 409) {
    super(reason);
  }
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/**
 * A contract company's (GASCO's) monthly sheet: the sent lock on a whole month, and what the
 * Insurance page can do to one procedure — its month, its dates and its state.
 *
 * Body: { clinicId, action, payerId, month?, noteId?, chargeId?, date? }
 * - send / unsend { month }: freeze a month's list, or open it again;
 * - pickMonth { chargeId, month | null }: put one procedure on a month's sheet (null = automatic:
 *   the month it finished). An unfinished procedure may be placed; the screen warns first;
 * - startDate { chargeId, date }: change the day the procedure started — its charge and its first
 *   treatment card, so the patient's file and Finance follow;
 * - finishDate { noteId, date }: change the day a finished treatment was finished (its end date);
 * - reopen { noteId }: a treatment marked finished by mistake goes back to In progress;
 * - finish { noteId }: mark an unfinished treatment finished today.
 *
 * `noteId` is the card that speaks for the treatment (the newest of its chain).
 *
 * Who: the page's own permission (patients.edit), plus `insurance.send` to send or unsend and
 * `insurance.edit` for everything else — both on for everyone until switched off for a person —
 * and, for one procedure, the branch it belongs to. A procedure on a sent month is locked: only an
 * Owner or Admin may still change its dates or state, and only with `confirmSent: true`, which the
 * screen sends after warning that the sheet the company received will no longer match. Its month
 * cannot be picked at all (mark the month not sent), and nothing can be picked onto a sent month. Every answer is
 * computed on the server from the clinic's own rows; the browser's lists are never trusted.
 */
export async function POST(req: Request) {
  try {
    let body: Record<string, unknown>;
    try {
      const parsed = await req.json();
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return fail(400, "Send a JSON object.");
      body = parsed as Record<string, unknown>;
    } catch {
      return fail(400, "Send a JSON body.");
    }

    // --- shape ------------------------------------------------------------------------------
    const clinicId = segment(body.clinicId);
    const payerId = segment(body.payerId);
    const action = body.action as Action;
    if (!clinicId) return fail(400, "clinicId is required.");
    if (!ACTIONS.includes(action)) return fail(400, `action must be one of ${ACTIONS.join(", ")}.`);
    if (!payerId) return fail(400, "payerId is required.");
    const today = ymdInTimeZone(clinicTimeZone());
    const currentMonth = today.slice(0, 7);

    const onTreatment = TREATMENT_ACTIONS.includes(action);
    const onCharge = CHARGE_ACTIONS.includes(action);
    const month = typeof body.month === "string" ? body.month : "";
    let noteId = "";
    let chargeId = "";
    let date = "";
    if (onCharge) {
      chargeId = segment(body.chargeId);
      if (!chargeId) return fail(400, "chargeId is required.");
      if (action === "startDate") {
        date = typeof body.date === "string" ? body.date : "";
        if (!DAY.test(date)) return fail(400, "date must be yyyy-mm-dd.", { reason: "bad_date" });
        if (date > today) return fail(400, "A start date cannot be after today.", { reason: "future_date" });
        if (date < `${COMPANY_SHEET_START}-01`) return fail(400, "A start date cannot be before the sheet began.", { reason: "before_start" });
      } else if (body.month !== null) {
        let last = currentMonth;
        for (let i = 0; i < MONTHS_AHEAD; i++) last = nextMonth(last);
        if (!MONTH.test(month) || month < COMPANY_SHEET_START || month > last) {
          return fail(400, `month must be yyyy-mm between ${COMPANY_SHEET_START} and ${last}, or null.`, { reason: "bad_month" });
        }
      }
    } else if (onTreatment) {
      noteId = segment(body.noteId);
      if (!noteId) return fail(400, "noteId is required.");
      if (action === "finishDate") {
        date = typeof body.date === "string" ? body.date : "";
        if (!DAY.test(date)) return fail(400, "date must be yyyy-mm-dd.", { reason: "bad_date" });
        if (date > today) return fail(400, "A finish date cannot be after today.", { reason: "future_date" });
      }
    } else {
      if (!MONTH.test(month) || month < COMPANY_SHEET_START) return fail(400, `month must be yyyy-mm, ${COMPANY_SHEET_START} or later.`);
      if (month > currentMonth) return fail(400, "That month has not started yet.");
    }

    // --- who --------------------------------------------------------------------------------
    const authz = await requireStaffPermission(req, clinicId, PERMISSION);
    if (!authz.ok) return authz.response;
    const actor = { uid: authz.uid, name: authz.name, role: authz.role };
    const needs = action === "send" || action === "unsend" ? "insurance.send" : "insurance.edit";
    if (!holdsPermission(authz.role, authz.permissions, needs)) {
      return fail(403, `You do not have permission to do this (${needs}).`, { reason: "no_permission" });
    }
    /** A sent procedure: nobody but an Owner or Admin, and they only after the screen's warning. */
    const sentGate = (month: string) => {
      if (!isFullAccessRole(actor.role)) return fail(409, "That procedure is on a month already sent.", { reason: "sent_locked", month });
      if (body.confirmSent !== true) return fail(409, "That procedure is on a month already sent. Confirm to change it.", { reason: "sent_confirm", month });
      return null;
    };

    // --- add-on -----------------------------------------------------------------------------
    if (!(await clinicHasFeature(clinicId, "insurance"))) {
      return fail(403, "Insurance is not part of this clinic's subscription.", { reason: "feature_locked" });
    }

    // --- the company ------------------------------------------------------------------------
    const payersSnap = await adminClinicDoc(clinicId, "settings", "payers").get();
    const payer = findPayer(parsePayers(payersSnap.data()), payerId);
    if (!payer || !payer.active || payer.id === PRIVATE_PAYER_ID || isInsurerFormat(payer.format)) {
      return fail(400, "That is not a contract company set up in this clinic.");
    }

    // --- the sheets, as the server sees them now --------------------------------------------
    const inputs = await loadCompanySheetInputs(clinicId, payerId);

    if (onCharge) {
      const cards = new Map(inputs.cards.map((c) => [c.id, c]));
      const children = cardChildren(inputs.cards);
      const charge = inputs.charges.find((c) => text(c.id) === chargeId);
      const status = text(charge?.status).toLowerCase();
      if (!charge || charge.type !== "procedure" || text(charge.payerId) !== payerId || status === "deleted" || status === "cancelled") {
        return fail(404, "That procedure is not on this company's sheet.", { reason: "not_found" });
      }
      // Another branch's procedure is not this person's to change.
      const branchGate = await assertRowBranchAllowed({ clinicId, uid: actor.uid, role: actor.role, rowBranchId: charge.branchId });
      if (!branchGate.ok) return branchGate.response;
      const sentOn = inputs.sent.find((s) => s.chargeIds.includes(chargeId));
      if (sentOn) {
        // Its month is the sent list's: picking another would move nothing. Mark the month not sent.
        if (action === "pickMonth") return fail(409, "That procedure is on a month already sent.", { reason: "sent_locked", month: sentOn.month });
        const refused = sentGate(sentOn.month);
        if (refused) return refused;
      }
      const chain = treatmentChain(text(charge.clinicalNoteId), cards, children);
      const patient = text(charge.patientName) || text(charge.patientId);
      const procedure = text(charge.description) || "procedure";
      const stamp = { day: today, at: new Date().toISOString(), byUid: actor.uid, byName: actor.name || "" };

      if (action === "pickMonth") {
        const picked = body.month === null ? null : month;
        if (picked && inputs.sent.some((s) => s.month === picked)) {
          return fail(409, "That month is already sent.", { reason: "month_sent" });
        }
        const was = text(inputs.months[chargeId]);
        if ((picked ?? "") === was) return NextResponse.json({ ok: true });
        await adminClinicDoc(clinicId, "settings", monthsDocId(payerId)).set(
          { months: { [chargeId]: picked === null ? FieldValue.delete() : picked }, updatedAt: FieldValue.serverTimestamp(), updatedBy: actor.uid },
          { merge: true },
        );
        // The procedure's own history keeps the move too (a procedure with no card has none).
        if (chain) {
          await adminClinicDoc(clinicId, "clinical_notes", chain.latest.id)
            .update({ finishLog: FieldValue.arrayUnion({ ...stamp, kind: "month", from: was, to: picked ?? "" }) })
            .catch(() => {});
        }
        void logActivityServer({
          clinicId,
          user: actor,
          action: "Sheet Month Picked",
          details: `${payer.name}: ${patient} — ${procedure}, ${was || "automatic"} -> ${picked ?? "automatic"}`,
          severity: "LOW",
          module: "finance",
        });
        return NextResponse.json({ ok: true });
      }

      // startDate: the charge and the treatment's first card move together.
      const ledgerRef = adminClinicDoc(clinicId, "ledger", chargeId);
      const firstId = chain ? chain.chain[0].id : "";
      const firstRef = firstId ? adminClinicDoc(clinicId, "clinical_notes", firstId) : null;
      const latestRef = chain && chain.latest.id !== firstId ? adminClinicDoc(clinicId, "clinical_notes", chain.latest.id) : null;
      let moved: { from: string; before: Record<string, unknown> } | null;
      try {
        moved = await adminDb().runTransaction(async (tx) => {
          const ledgerSnap = await tx.get(ledgerRef);
          if (!ledgerSnap.exists) throw new Refused("not_found", 404);
          const row = ledgerSnap.data() ?? {};
          if (isApprovalRow(row)) throw new Refused("approval");
          const firstSnap = firstRef ? await tx.get(firstRef) : null;
          const first = firstSnap?.exists ? (firstSnap.data() ?? {}) : null;
          if (first && isApprovalRow(first)) throw new Refused("approval");
          const from = toYmd(row.date);
          if (from === date) return null;

          // The start cannot pass the next visit, nor the day it was finished.
          const nextVisit = chain && chain.chain.length > 1 ? toYmd(chain.chain[1].date) : "";
          if (nextVisit && date > nextVisit) throw new Refused("after_visit", 400);
          const one = chain && chain.chain.length === 1 ? first : null;
          const oneDone = one !== null && String(one.status ?? "") === "Completed";
          const finished = oneDone ? toYmd(one.completedDate) || toYmd(one.date) : "";
          if (finished && date > finished) throw new Refused("after_finish", 400);

          tx.update(ledgerRef, { date, updatedAt: FieldValue.serverTimestamp() });
          if (firstRef && first) {
            tx.update(firstRef, {
              date,
              // A card finished before the finish stamp existed reads its finish from its own date: keep that day.
              ...(oneDone && !toYmd(one?.completedDate) ? { completedDate: finished } : {}),
              ...(latestRef ? {} : { finishLog: FieldValue.arrayUnion({ ...stamp, kind: "start", from, to: date }) }),
              updatedByUid: actor.uid,
              updatedByName: actor.name || "",
              updatedAt: FieldValue.serverTimestamp(),
            });
          }
          if (latestRef) tx.update(latestRef, { finishLog: FieldValue.arrayUnion({ ...stamp, kind: "start", from, to: date }) });
          return { from, before: { date: row.date } };
        });
      } catch (err) {
        if (err instanceof Refused) return fail(err.status, "That change is not allowed.", { reason: err.reason });
        throw err;
      }
      if (moved) {
        await recordMoneyChange({
          entry: {
            clinicId, action: "update", collection: "ledger", documentId: chargeId,
            before: moved.before, after: { date }, actor, via: "insurance/company-sheet:startDate",
          },
          action: "Procedure Start Date Changed",
          details: `${payer.name}: ${patient} — ${procedure}, ${moved.from} -> ${date}`,
        });
      }
      return NextResponse.json({ ok: true });
    }

    if (onTreatment) {
      // The company's live charges whose treatment this card speaks for.
      const cards = new Map(inputs.cards.map((c) => [c.id, c]));
      const children = cardChildren(inputs.cards);
      const owned = inputs.charges.filter((c) => {
        const status = text(c.status).toLowerCase();
        if (c.type !== "procedure" || text(c.payerId) !== payerId || status === "deleted" || status === "cancelled") return false;
        return treatmentChain(text(c.clinicalNoteId), cards, children)?.latest.id === noteId;
      });
      if (owned.length === 0) return fail(404, "That treatment is not on this company's sheet.", { reason: "not_found" });
      for (const c of owned) {
        const branchGate = await assertRowBranchAllowed({ clinicId, uid: actor.uid, role: actor.role, rowBranchId: c.branchId });
        if (!branchGate.ok) return branchGate.response;
      }
      const sentOn = inputs.sent.find((s) => owned.some((c) => s.chargeIds.includes(text(c.id))));
      if (sentOn) {
        const refused = sentGate(sentOn.month);
        if (refused) return refused;
      }
      const noteRef = adminClinicDoc(clinicId, "clinical_notes", noteId);
      let result: { procedure: string; patient: string; from: string; to: string };
      try {
        result = await adminDb().runTransaction(async (tx) => {
          const snap = await tx.get(noteRef);
          if (!snap.exists) throw new Refused("not_found", 404);
          const note = snap.data() ?? {};
          if (isApprovalRow(note)) throw new Refused("approval");
          const appointmentId = text(note.appointmentId);
          const apptRef = appointmentId ? adminClinicDoc(clinicId, "appointments", appointmentId) : null;
          const apptSnap = apptRef ? await tx.get(apptRef) : null;

          // A card written before treatments carried a state counts as finished on its own day
          // (see chargeDone), so it is treated as finished here too and given the state it lacked.
          const stateless = String(note.status ?? "").trim() === "";
          const done = stateless || String(note.status) === "Completed";
          const was = toYmd(note.completedDate) || toYmd(note.date);
          let fields: Record<string, unknown>;
          let status: string | null = null;
          let entry: Record<string, unknown>;
          let to = "";
          if (action === "finishDate") {
            if (!done) throw new Refused("not_done");
            if (date < toYmd(note.date)) throw new Refused("before_visit", 400);
            to = date;
            fields = { completedDate: date, ...(stateless ? { status: "Completed" } : {}) };
            entry = { kind: "date", from: was, to: date };
          } else if (action === "reopen") {
            if (!done) throw new Refused("not_done");
            status = "Ongoing";
            fields = { status, completedDate: FieldValue.delete() };
            entry = { kind: "reopened", from: was, to: "" };
          } else {
            if (done) throw new Refused("already_done");
            status = "Completed";
            to = today;
            fields = { status, completedDate: today };
            entry = { kind: "finished", from: "", to: today };
          }

          tx.update(noteRef, {
            ...fields,
            finishLog: FieldValue.arrayUnion({ ...entry, day: today, at: new Date().toISOString(), byUid: actor.uid, byName: actor.name || "" }),
            updatedByUid: actor.uid,
            updatedByName: actor.name || "",
            updatedAt: FieldValue.serverTimestamp(),
          });

          // The visit's own list of treatments shows the state too; keep that one line in step.
          if (status && apptRef && apptSnap?.exists) {
            const services = apptSnap.get("services");
            if (Array.isArray(services) && services.some((s) => s && typeof s === "object" && s.clinicalNoteId === noteId)) {
              tx.update(apptRef, {
                services: services.map((s) => (s && typeof s === "object" && s.clinicalNoteId === noteId ? { ...s, status } : s)),
              });
            }
          }
          return { procedure: text(note.procedure) || "treatment", patient: text(owned[0].patientName) || text(owned[0].patientId), from: was, to };
        });
      } catch (err) {
        if (err instanceof Refused) return fail(err.status, "That change is not allowed.", { reason: err.reason });
        throw err;
      }

      const what =
        action === "finishDate"
          ? `finish date ${result.from} -> ${result.to}`
          : action === "reopen"
            ? `marked not finished (was finished ${result.from})`
            : `marked finished ${result.to}`;
      void logActivityServer({
        clinicId,
        user: actor,
        action: action === "finishDate" ? "Finish Date Changed" : action === "reopen" ? "Treatment Reopened" : "Treatment Finished",
        details: `${payer.name}: ${result.patient} — ${result.procedure}, ${what}`,
        severity: "LOW",
        module: "finance",
      });
      return NextResponse.json({ ok: true });
    }

    const sheets = buildCompanySheets({ ...inputs, payerId, through: currentMonth });
    const sheet = sheets.find((s) => s.month === month);
    const sentRef = adminClinicDoc(clinicId, "settings", sentDocId(payerId, month));

    if (action === "send") {
      const refusal = sendRefusal(sheets, month);
      if (refusal || !sheet) return fail(409, "That month cannot be marked sent.", { reason: refusal ?? "empty" });
      try {
        await sentRef.create({
          payerId,
          month,
          chargeIds: sheetChargeIds(sheet),
          cases: sheet.printed.length,
          total: round2(sheet.printed.reduce((sum, p) => sum + p.value, 0)),
          sentAt: FieldValue.serverTimestamp(),
          sentBy: actor.uid,
          sentByName: actor.name || "",
        });
      } catch (err) {
        if (isAlreadyExists(err)) return fail(409, "That month is already sent.", { reason: "already_sent" });
        throw err;
      }
      void logActivityServer({
        clinicId,
        user: actor,
        action: "Company Sheet Sent",
        details: `${payer.name} ${month}: ${sheet.printed.length} patients`,
        severity: "MEDIUM",
        module: "finance",
      });
      return NextResponse.json({ ok: true });
    }

    // unsend
    const refusal = unsendRefusal(sheets, month);
    if (refusal) return fail(409, "That month cannot be marked not sent.", { reason: refusal });
    await sentRef.delete();
    void logActivityServer({
      clinicId,
      user: actor,
      action: "Company Sheet Unsent",
      details: `${payer.name} ${month}`,
      severity: "MEDIUM",
      module: "finance",
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    reportServerError("Company sheet route failed:", err);
    return fail(500, "Could not save. Try again.");
  }
}
