import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { adminClinicDoc } from "@/lib/adminClinicDb";
import { requireStaffPermission } from "@/lib/apiStaffAuth";
import { clinicHasFeature } from "@/lib/clinicFeatures";
import { clinicTimeZone, ymdInTimeZone } from "@/lib/clinicDate";
import { findPayer, isInsurerFormat, parsePayers, PRIVATE_PAYER_ID } from "@/lib/payers";
import { reportServerError } from "@/lib/server/reportError";
import { logActivityServer } from "@/lib/server/systemLog";
import { loadCompanySheetInputs, marksDocId, sentDocId } from "@/lib/server/companySheetData";
import {
  buildCompanySheets,
  COMPANY_SHEET_START,
  markKey,
  sendRefusal,
  sheetChargeIds,
  unsendRefusal,
} from "@/lib/insurance/companySheet";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PERMISSION = "patients.edit";
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

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

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * The dentist's per-patient "this month / next month" switch on a contract company's (GASCO's)
 * monthly sheet, and the sent lock on a whole month.
 *
 * Body: { clinicId, action: "mark" | "send" | "unsend", payerId, month, patientId?, choice? }.
 * Every answer is computed on the server from the clinic's own rows; the browser's list of
 * charges is never trusted.
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
    const month = typeof body.month === "string" ? body.month : "";
    const action = body.action;
    if (!clinicId) return fail(400, "clinicId is required.");
    if (action !== "mark" && action !== "send" && action !== "unsend") return fail(400, 'action must be "mark", "send" or "unsend".');
    if (!payerId) return fail(400, "payerId is required.");
    if (!MONTH.test(month) || month < COMPANY_SHEET_START) return fail(400, `month must be yyyy-mm, ${COMPANY_SHEET_START} or later.`);
    const currentMonth = ymdInTimeZone(clinicTimeZone()).slice(0, 7);
    if (month > currentMonth) return fail(400, "That month has not started yet.");

    let patientId = "";
    let choice: "include" | "hold" | null = null;
    if (action === "mark") {
      patientId = segment(body.patientId);
      if (!patientId) return fail(400, "patientId is required.");
      if (!("choice" in body) || (body.choice !== null && body.choice !== "include" && body.choice !== "hold")) {
        return fail(400, 'choice must be "include", "hold" or null.');
      }
      choice = body.choice as "include" | "hold" | null;
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
    const sheets = buildCompanySheets({ ...inputs, payerId, through: currentMonth });
    const sheet = sheets.find((s) => s.month === month);
    const sentRef = adminClinicDoc(clinicId, "settings", sentDocId(payerId, month));

    if (action === "mark") {
      if (sheet?.sent) return fail(409, "That month is already sent.", { reason: "sent_locked" });
      if (choice === "include") {
        // Is he unfinished? Ask with this patient's own switch for the month taken off, so a
        // "hold" tick cannot hide the reason.
        const rest = { ...inputs.marks };
        delete rest[markKey(patientId, month)];
        const bare = buildCompanySheets({ ...inputs, marks: rest, payerId, through: currentMonth });
        const entry = bare.find((s) => s.month === month)?.held.find((h) => h.patientId === patientId);
        if (entry?.reason === "not_finished") {
          return fail(409, "That patient still has treatment waiting.", { reason: "not_finished" });
        }
      }
      await adminClinicDoc(clinicId, "settings", marksDocId(payerId)).set(
        {
          marks: { [markKey(patientId, month)]: choice === null ? FieldValue.delete() : choice },
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: actor.uid,
        },
        { merge: true },
      );
      // Name the patient the way the sheet does; the id only when no charge of his carries a name.
      const named = inputs.charges.find((c) => String(c.patientId ?? "").trim() === patientId && String(c.patientName ?? "").trim());
      void logActivityServer({
        clinicId,
        user: actor,
        action: "Company Sheet Switch",
        details: `${payer.name} ${month}: patient ${named ? String(named.patientName).trim() : patientId} -> ${choice ?? "automatic"}`,
        severity: "LOW",
        module: "finance",
      });
      return NextResponse.json({ ok: true });
    }

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
