import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebaseAdmin";
import { adminClinicDoc } from "@/lib/adminClinicDb";
import { requireStaffPermission } from "@/lib/apiStaffAuth";
import { clinicHasFeature } from "@/lib/clinicFeatures";
import { clinicTimeZone, ymdInTimeZone } from "@/lib/clinicDate";
import { findPayer, isInsurerFormat, parsePayers, PRIVATE_PAYER_ID } from "@/lib/payers";
import { isApprovalRow } from "@/lib/ledgerInsurer";
import { toYmd } from "@/lib/reports/patientStats";
import { reportServerError } from "@/lib/server/reportError";
import { logActivityServer } from "@/lib/server/systemLog";
import { loadCompanySheetInputs, sentDocId } from "@/lib/server/companySheetData";
import {
  buildCompanySheets,
  cardChildren,
  COMPANY_SHEET_START,
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

type Action = "send" | "unsend" | "finishDate" | "reopen" | "finish";
const ACTIONS: readonly Action[] = ["send", "unsend", "finishDate", "reopen", "finish"];
const TREATMENT_ACTIONS: readonly Action[] = ["finishDate", "reopen", "finish"];

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
 * A contract company's (GASCO's) monthly sheet: the sent lock on a whole month, and the three
 * things the patient drawer can do to one treatment's finish — the day that decides which
 * month's sheet it goes on.
 *
 * Body: { clinicId, action, payerId, month?, noteId?, date? }
 * - send / unsend { month }: freeze a month's list, or open it again;
 * - finishDate { noteId, date }: change the day a finished treatment was finished;
 * - reopen { noteId }: a treatment marked finished by mistake goes back to In progress;
 * - finish { noteId }: mark an unfinished treatment finished today.
 *
 * `noteId` is the card that speaks for the treatment (the newest of its chain). A treatment whose
 * charge is on a sent month is locked; a finish day inside a sent month is refused. Every answer
 * is computed on the server from the clinic's own rows; the browser's lists are never trusted.
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
    const month = typeof body.month === "string" ? body.month : "";
    let noteId = "";
    let date = "";
    if (onTreatment) {
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
      const sentIds = new Set(inputs.sent.flatMap((s) => s.chargeIds));
      if (owned.some((c) => sentIds.has(text(c.id)))) {
        return fail(409, "That treatment is on a month already sent.", { reason: "sent_locked" });
      }
      const sentMonths = new Set(inputs.sent.map((s) => s.month));

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

          const done = String(note.status ?? "") === "Completed";
          const was = toYmd(note.completedDate) || toYmd(note.date);
          let fields: Record<string, unknown>;
          let status: string | null = null;
          let entry: Record<string, unknown>;
          let to = "";
          if (action === "finishDate") {
            if (!done) throw new Refused("not_done");
            if (date < toYmd(note.date)) throw new Refused("before_visit", 400);
            if (sentMonths.has(date.slice(0, 7))) throw new Refused("month_sent");
            to = date;
            fields = { completedDate: date };
            entry = { kind: "date", from: was, to: date };
          } else if (action === "reopen") {
            if (!done) throw new Refused("not_done");
            status = "Ongoing";
            fields = { status, completedDate: FieldValue.delete() };
            entry = { kind: "reopened", from: was, to: "" };
          } else {
            if (done) throw new Refused("already_done");
            if (sentMonths.has(currentMonth)) throw new Refused("month_sent");
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
