import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { requireStaffUser } from "@/lib/apiStaffAuth";
import { adminDb } from "@/lib/firebaseAdmin";
import { adminClinicCollection, adminClinicDoc, resolveUserClinicId } from "@/lib/adminClinicDb";
import { deliverWhatsAppMessage } from "@/lib/whatsappDelivery";
import { mergeWhatsAppTemplate } from "@/lib/whatsappTemplateMerge";
import { patientSendablePhone } from "@/lib/patientPhone";
import { resolveWhatsappTemplateForPatient } from "@/lib/whatsappDefaultBodies";
import type { WhatsAppTemplateType } from "@/types/whatsapp";
import { parseLedgerProcedureDescription } from "@/lib/ledgerProcedureParse";
import { sendClinicPush } from "@/lib/push";
import {
  type AppointmentPatientTemplate,
  type PatientMessageOutcome,
  computePatientBalance,
  isDeletedLedger,
  outboxKey,
  queuePaymentSms,
  sendAppointmentPatientMessage,
  sendPaymentReceiptMessage,
} from "@/lib/patientNotifications";

type Kind = "invoice" | "treatment" | "receipt" | "appointment";

/**
 * The composition and gating for appointment and receipt messages live in
 * lib/patientNotifications, shared with the AI assistant's approved actions; this translates the
 * shared outcome back into the HTTP shapes the fire-and-forget client helpers already understand.
 */
function outcomeResponse(outcome: PatientMessageOutcome): NextResponse {
  if (outcome.status === "skipped" && outcome.reason === "patient_not_found") {
    return NextResponse.json({ ok: false, error: "Patient not found" }, { status: 404 });
  }
  if (outcome.status === "skipped") {
    return NextResponse.json({ ok: true, skipped: true, reason: outcome.reason });
  }
  if (outcome.status === "manual") {
    return NextResponse.json({ ok: true, manual: true, phone: outcome.phone, text: outcome.text });
  }
  if (outcome.status === "queued") {
    return NextResponse.json({ ok: true, queued: true });
  }
  if (outcome.status === "failed") {
    return NextResponse.json({ ok: false, error: outcome.error }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

type LedgerSummaryRow = {
  date: string;
  description: string;
  type: string;
  amount: number;
  method: string;
};

/** Left-to-right isolate for digits/dates in Arabic WhatsApp bubbles (reduces bidi “jumping”). */
const LRM = "\u200E";

function formatReceiptLedgerRow(row: LedgerSummaryRow, amountFmt: (n: number) => string): string {
  const isPayment = row.type === "payment";
  const kindAr = isPayment ? "دفعة" : row.type === "procedure" ? "إجراء" : "معاملة";
  const prefix = isPayment ? "+" : "−";
  const { procedureLine, teeth, pricingBreakdown } = parseLedgerProcedureDescription(row.description);

  const lines: string[] = ["", `${LRM}──────────`];
  lines.push(`${LRM}📅 ${row.date || "—"}`);
  lines.push(`📋 *النوع:* ${kindAr}`);

  if (isPayment) {
    lines.push(`📝 *البيان:* ${row.description || "—"}`);
    lines.push(`${LRM}💰 *المبلغ:* ${prefix}${amountFmt(row.amount)} ج.م`);
    if (row.method && row.method !== "—") {
      lines.push(`💳 *طريقة الدفع:* ${row.method}`);
    }
    return lines.join("\n");
  }

  if (procedureLine && procedureLine !== "—") {
    lines.push(`🦷 *الإجراء:* ${procedureLine}`);
  }
  if (teeth) {
    lines.push(`${LRM}🔢 *الأسنان:* ${teeth}`);
  }
  if (pricingBreakdown) {
    lines.push(`${LRM}📐 *التسعير:* ${pricingBreakdown}`);
  }
  lines.push(`${LRM}💰 *المبلغ:* ${prefix}${amountFmt(row.amount)} ج.م`);

  return lines.join("\n");
}

async function computeLedgerSummary(clinicId: string, patientId: string): Promise<{
  billed: number;
  paid: number;
  balance: number;
  recentRows: LedgerSummaryRow[];
}> {
  const snap = await adminClinicCollection(clinicId, "ledger").where("patientId", "==", patientId).get();
  let billed = 0;
  let paid = 0;
  const rows: LedgerSummaryRow[] = [];

  snap.forEach((doc) => {
    const d = doc.data() as Record<string, unknown>;
    if (isDeletedLedger(d)) return;

    const typ = String(d.type || "");
    const date = String(d.date || "");
    const description = String(d.description || d.category || "—");
    const method = String(d.method || "—");

    let amount = 0;
    if (typ === "payment") {
      amount = Number(d.paid) || 0;
      paid += amount;
    } else if (typ === "procedure") {
      amount = Number(d.cost) || 0;
      billed += amount;
    } else {
      amount = Number(d.paid || d.amount || d.cost) || 0;
    }

    rows.push({ date, description, type: typ, amount, method });
  });

  rows.sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
  return {
    billed,
    paid,
    balance: billed - paid,
    recentRows: rows.slice(0, 8),
  };
}

export async function POST(request: Request) {
  // Read before auth so membership is checked against the clinic being acted on. Callers that
  // predate this send nothing and still fall back to the user's default clinic.
  const requestedClinicId = await request
    .clone()
    .json()
    .then((b) => (typeof b?.clinicId === "string" ? b.clinicId.trim() : ""))
    .catch(() => "");

  const authz = await requireStaffUser(request, requestedClinicId || undefined);
  if (!authz.ok) return authz.response;

  // SUBSCRIPTION ENFORCEMENT
  const userSnap = await adminDb().collection("users").doc(authz.uid).get();
  const userData = userSnap.data();
  // Was derived loosely from the user doc and used only for the plan check. It now also
  // scopes every data read below, so resolve it through the membership-checking helper.
  const clinicId = requestedClinicId || (await resolveUserClinicId(authz.uid));
  if (clinicId) {
    const clinicSnap = await adminDb().collection("clinics").doc(clinicId).get();
    const clinic = clinicSnap.data();
    if (clinic && (clinic.status !== 'Active' || (clinic.expiresAt && clinic.expiresAt.toDate() < new Date()))) {
      return NextResponse.json({ ok: false, error: "Subscription expired or suspended. Read-only mode active." }, { status: 403 });
    }
  }

  try {
    const body = (await request.json().catch(() => ({}))) as {
      kind?: Kind;
      appointmentTemplate?: AppointmentPatientTemplate;
      patientId?: string;
      ledgerId?: string;
      clinicalNoteId?: string;
      /** For `kind: "appointment"` — values shown in the patient template. */
      date?: string;
      time?: string;
      doctor?: string;
      /** Pre-formatted Arabic receipt text from Patient Finance (Eastern Arabic numerals). */
      message?: string;
      /** When true (post-payment automation), respects Settings → patient automation toggle. */
      automation?: boolean;
    };

    const kind = body.kind;
    const patientId = typeof body.patientId === "string" ? body.patientId.trim() : "";
    const ledgerIdBody = typeof body.ledgerId === "string" ? body.ledgerId.trim() : "";
    const clinicalNoteIdBody = typeof body.clinicalNoteId === "string" ? body.clinicalNoteId.trim() : "";
    const receiptMessageBody = typeof body.message === "string" ? body.message : "";
    const automation = body.automation === true;
    const appointmentTemplate = body.appointmentTemplate;
    const apptDateRaw = typeof body.date === "string" ? body.date.trim() : "";
    const apptTimeRaw = typeof body.time === "string" ? body.time.trim() : "";
    const apptDoctorRaw = typeof body.doctor === "string" ? body.doctor.trim() : "";

    if (!patientId) {
      return NextResponse.json({ ok: false, error: "patientId required" }, { status: 400 });
    }

    if (kind === "appointment") {
      if (appointmentTemplate !== "new" && appointmentTemplate !== "edit" && appointmentTemplate !== "cancel") {
        return NextResponse.json({ ok: false, error: "appointmentTemplate must be new, edit, or cancel" }, { status: 400 });
      }

      return outcomeResponse(
        await sendAppointmentPatientMessage({
          clinicId,
          patientId,
          template: appointmentTemplate as AppointmentPatientTemplate,
          date: apptDateRaw,
          time: apptTimeRaw,
          doctor: apptDoctorRaw,
        })
      );
    }

    if (kind !== "invoice" && kind !== "treatment" && kind !== "receipt") {
      return NextResponse.json({ ok: false, error: "Invalid kind" }, { status: 400 });
    }

    // The post-payment receipt automation shares its whole flow — SMS leg included — with the
    // assistant's approved payments. The manual "send this row" button below keeps its own path
    // because a person pressing it deserves errors, not silent skips.
    if (kind === "invoice" && automation) {
      if (!ledgerIdBody) {
        return NextResponse.json({ ok: false, error: "ledgerId required for invoice" }, { status: 400 });
      }
      return outcomeResponse(
        await sendPaymentReceiptMessage({ clinicId, patientId, ledgerId: ledgerIdBody })
      );
    }

    const patientSnap = await adminClinicDoc(clinicId, "patients", patientId).get();
    if (!patientSnap.exists) {
      return NextResponse.json({ ok: false, error: "Patient not found" }, { status: 404 });
    }
    const patient = patientSnap.data() as Record<string, unknown>;

    // Above the WhatsApp opt-out check on purpose. The two opt-outs are separate settings, and a
    // patient who asked for no WhatsApp but explicitly kept SMS on would otherwise be dropped here
    // by a check that has nothing to do with their SMS preference. Reads the ledger again rather
    // than borrowing the WhatsApp branch's copy further down, so a disabled WhatsApp template can
    // never silently switch the texts off too — one extra document read per payment.
    if (kind === "invoice" && ledgerIdBody) {
      await queuePaymentSms({ clinicId, patient, patientId, ledgerId: ledgerIdBody });
    }

    if (patient.whatsappOptOut === true) {
      if (automation) {
        return NextResponse.json({ ok: true, skipped: true, reason: "whatsapp_opt_out" });
      }
      return NextResponse.json({ ok: false, error: "Patient opted out of WhatsApp automation" }, { status: 400 });
    }

    const phone = patientSendablePhone(patient);
    if (!phone) {
      if (automation) {
        return NextResponse.json({ ok: true, skipped: true, reason: "missing_phone" });
      }
      return NextResponse.json({ ok: false, error: "Patient has no phone number" }, { status: 400 });
    }

    let clinicName = "Alpha Dental";
    try {
      const clinicSnap = await adminClinicDoc(clinicId, "settings", "clinic_info").get();
      const c = clinicSnap.data();
      if (c && typeof c.clinicName === "string" && c.clinicName.trim()) clinicName = c.clinicName.trim();
      else if (c && typeof c.name === "string" && c.name.trim()) clinicName = c.name.trim();
    } catch {
      /* ignore */
    }

    const patientName = typeof patient.name === "string" ? patient.name : "Patient";

    let merged = "";

    if (kind === "receipt") {
      const clientMsg = receiptMessageBody.trim();
      if (clientMsg) {
        merged = clientMsg;
      } else {
        const summary = await computeLedgerSummary(clinicId, patientId);
        const now = new Date();
        const dateLabel = now.toLocaleDateString("ar-EG");
        const amountFmt = (n: number) => n.toLocaleString("en-US");
        const recentLines = summary.recentRows.length
          ? summary.recentRows.map((row) => formatReceiptLedgerRow(row, amountFmt)).join("\n")
          : `${LRM}• لا توجد معاملات مسجلة حتى الآن.`;

        merged = [
          `🧾 *كشف حساب العيادة*`,
          `🏥 *العيادة:* ${clinicName}`,
          `👤 *المريض:* ${patientName}`,
          `📅 *التاريخ:* ${dateLabel}`,
          "",
          `*إجمالي العلاج:* ${LRM}${amountFmt(summary.billed)} ج.م`,
          `*إجمالي المدفوع:* ${LRM}${amountFmt(summary.paid)} ج.م`,
          `*المتبقي المطلوب:* ${LRM}${amountFmt(summary.balance)} ج.م`,
          "",
          `*آخر التفاصيل:*`,
          recentLines,
        ].join("\n");
      }
    } else if (kind === "invoice" || kind === "treatment") {
      const settingsSnap = await adminClinicDoc(clinicId, "settings", "whatsapp").get();
      const settings = settingsSnap.exists ? settingsSnap.data() : {};

      if (automation && !Boolean(settings?.isPatientAutomationEnabled)) {
        return NextResponse.json({ ok: true, skipped: true, reason: "patient_automation_disabled" });
      }

      const templateType: WhatsAppTemplateType = kind;
      const tplText = resolveWhatsappTemplateForPatient(settings?.templates, templateType);
      if (!tplText?.trim()) {
        if (automation) {
          return NextResponse.json({ ok: true, skipped: true, reason: "template_disabled" });
        }
        return NextResponse.json(
          { ok: false, error: `WhatsApp template "${kind}" is disabled in Settings → WhatsApp` },
          { status: 400 }
        );
      }

      if (kind === "invoice") {
        const ledgerId = ledgerIdBody;
        if (!ledgerId) {
          return NextResponse.json({ ok: false, error: "ledgerId required for invoice" }, { status: 400 });
        }
        const ledgerSnap = await adminClinicDoc(clinicId, "ledger", ledgerId).get();
        if (!ledgerSnap.exists) {
          return NextResponse.json({ ok: false, error: "Ledger entry not found" }, { status: 404 });
        }
        const L = ledgerSnap.data() as Record<string, unknown>;
        if (String(L.patientId) !== patientId) {
          return NextResponse.json(
            { ok: false, error: "Ledger entry does not belong to this patient" },
            { status: 403 }
          );
        }
        if (isDeletedLedger(L)) {
          return NextResponse.json({ ok: false, error: "Cannot send deleted ledger row" }, { status: 400 });
        }

        const typ = String(L.type || "");
        const amount =
          typ === "payment"
            ? Number(L.paid) || 0
            : typ === "procedure"
              ? Number(L.cost) || 0
              : Number(L.paid || L.amount || L.cost) || 0;

        const balance = await computePatientBalance(clinicId, patientId);

        merged = mergeWhatsAppTemplate(tplText, {
          patient_name: patientName,
          description: String(L.description || L.category || typ || "—"),
          amount: amount.toLocaleString(),
          date: String(L.date || "—"),
          type: typ || "—",
          method: String(L.method || "—"),
          balance: balance.toLocaleString(),
          clinic_name: clinicName,
          doctor: String(L.doctorName || L.doctor || "—"),
        });
      } else {
        const clinicalNoteId = clinicalNoteIdBody;
        if (!clinicalNoteId) {
          return NextResponse.json({ ok: false, error: "clinicalNoteId required for treatment" }, { status: 400 });
        }
        const noteSnap = await adminClinicDoc(clinicId, "clinical_notes", clinicalNoteId).get();
        if (!noteSnap.exists) {
          return NextResponse.json({ ok: false, error: "Clinical note not found" }, { status: 404 });
        }
        const N = noteSnap.data() as Record<string, unknown>;
        if (String(N.patientId) !== patientId) {
          return NextResponse.json(
            { ok: false, error: "Clinical note does not belong to this patient" },
            { status: 403 }
          );
        }

        let appointment_date = String(N.lastScheduledDate || "");
        let appointment_time = String(N.lastScheduledTime || "");
        let appointment_doctor = "";
        let appointment_status = "";

        const lastApptId = typeof N.lastAppointmentId === "string" ? N.lastAppointmentId : "";
        if (lastApptId) {
          const apptSnap = await adminClinicDoc(clinicId, "appointments", lastApptId).get();
          if (apptSnap.exists) {
            const A = apptSnap.data() as Record<string, unknown>;
            appointment_date = String(A.date || appointment_date);
            appointment_time = String(A.time || appointment_time);
            appointment_doctor = String(A.doctor || A.doctorName || "");
            appointment_status = String(A.status || "");
          }
        }

        if (!appointment_date && !appointment_time) {
          const apptQ = await adminDb()
            .collection("appointments")
            .where("clinicalNoteId", "==", clinicalNoteId)
            .limit(1)
            .get();
          if (!apptQ.empty) {
            const A = apptQ.docs[0].data() as Record<string, unknown>;
            appointment_date = String(A.date || "");
            appointment_time = String(A.time || "");
            appointment_doctor = String(A.doctor || A.doctorName || "");
            appointment_status = String(A.status || "");
          }
        }

        const procedure = String(N.procedure || N.title || "—");
        merged = mergeWhatsAppTemplate(tplText, {
          patient_name: patientName,
          procedure,
          tooth: String(N.tooth || "—"),
          cost: String(Number(N.cost) || 0),
          date: String(N.date || "—"),
          doctor: String(N.doctor || "—"),
          notes: String(N.note || ""),
          status: String(N.status || "—"),
          appointment_date: appointment_date || "—",
          appointment_time: appointment_time || "—",
          appointment_doctor: appointment_doctor || "—",
          appointment_status: appointment_status || "—",
          clinic_name: clinicName,
        });
      }
    }

    try {
      // Queued only when nobody is watching. `automation` means this fired off the back of a save,
      // so there is no one to press send and the message belongs in the clinic's list. When a staff
      // member pressed a button, they are looking at the screen — opening WhatsApp there and then
      // is faster and more use than adding a row to a list they have to come back to.
      const unattendedKey =
        automation && (ledgerIdBody || clinicalNoteIdBody)
          ? outboxKey(ledgerIdBody || clinicalNoteIdBody, kind)
          : "";

      const delivery = await deliverWhatsAppMessage({
        clinicId,
        to: phone,
        text: merged,
        audience: "patient",
        queue: unattendedKey ? { key: unattendedKey, type: kind, patientId, patientName } : undefined,
      });
      await adminClinicCollection(clinicId, "whatsapp_logs").add({
        patientId,
        type: kind,
        message: merged,
        status: delivery.mode === "auto" ? "success" : delivery.mode,
        createdAt: FieldValue.serverTimestamp(),
      });
      if (delivery.mode === "manual") {
        return NextResponse.json({ ok: true, manual: true, phone: delivery.phone, text: delivery.text });
      }
      if (delivery.mode === "queued") {
        void sendClinicPush(clinicId, {
          title: "رسالة واتساب في الانتظار",
          body: "رسالة جاهزة للإرسال من التطبيق — a WhatsApp message is waiting in the app.",
        });
        return NextResponse.json({ ok: true, queued: true });
      }
      return NextResponse.json({ ok: true });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Send failed";
      await adminClinicCollection(clinicId, "whatsapp_logs").add({
        patientId,
        type: kind,
        message: merged,
        status: "failed",
        createdAt: FieldValue.serverTimestamp(),
      });
      return NextResponse.json({ ok: false, error: msg }, { status: 500 });
    }
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Request failed";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
