import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { requireStaffUser } from "@/lib/apiStaffAuth";
import { adminDb } from "@/lib/firebaseAdmin";
import { sendWhatsApp } from "@/lib/whatsapp";
import { mergeWhatsAppTemplate } from "@/lib/whatsappTemplateMerge";
import { pickPatientPhone } from "@/lib/patientPhone";
import { resolveWhatsappTemplateForPatient } from "@/lib/whatsappDefaultBodies";
import type { WhatsAppTemplateType } from "@/types/whatsapp";
import { parseLedgerProcedureDescription } from "@/lib/ledgerProcedureParse";
import { getClinicProfileAdmin } from "@/lib/clinicProfileServer";

type Kind = "invoice" | "treatment" | "receipt" | "appointment";

type AppointmentPatientTemplate = Extract<WhatsAppTemplateType, "new" | "edit" | "cancel">;

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

function isDeletedLedger(d: Record<string, unknown>) {
  return d.status === "deleted" || d.status === "cancelled";
}

async function getLedgerDocWithRetry(ledgerId: string, attempts = 4, delayMs = 150) {
  for (let i = 0; i < attempts; i++) {
    const snap = await adminDb().collection("ledger").doc(ledgerId).get();
    if (snap.exists) return snap;
    if (i < attempts - 1) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  return null;
}

async function computePatientBalance(patientId: string): Promise<number> {
  const snap = await adminDb().collection("ledger").where("patientId", "==", patientId).get();
  let billed = 0;
  let paid = 0;
  snap.forEach((doc) => {
    const d = doc.data();
    if (isDeletedLedger(d)) return;
    if (d.type === "procedure") billed += Number(d.cost) || 0;
    if (d.type === "payment") paid += Number(d.paid) || 0;
  });
  return billed - paid;
}

async function computeLedgerSummary(patientId: string): Promise<{
  billed: number;
  paid: number;
  balance: number;
  recentRows: LedgerSummaryRow[];
}> {
  const snap = await adminDb().collection("ledger").where("patientId", "==", patientId).get();
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
  const authz = await requireStaffUser(request);
  if (!authz.ok) return authz.response;

  // SUBSCRIPTION ENFORCEMENT
  const userSnap = await adminDb().collection("users").doc(authz.uid).get();
  const userData = userSnap.data();
  const clinicId = userData?.defaultClinicId || Object.keys(userData?.clinicRoles || {})[0];
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

      const patientSnap = await adminDb().collection("patients").doc(patientId).get();
      if (!patientSnap.exists) {
        return NextResponse.json({ ok: false, error: "Patient not found" }, { status: 404 });
      }
      const patient = patientSnap.data() as Record<string, unknown>;

      const settingsSnap = await adminDb().collection("settings").doc("whatsapp").get();
      const settings = settingsSnap.exists ? settingsSnap.data() : {};
      if (!Boolean(settings?.isPatientAutomationEnabled)) {
        return NextResponse.json({ ok: true, skipped: true, reason: "patient_automation_disabled" });
      }

      const tplText = resolveWhatsappTemplateForPatient(settings?.templates, appointmentTemplate);
      if (!tplText?.trim()) {
        return NextResponse.json({ ok: true, skipped: true, reason: "template_disabled" });
      }

      if (patient.whatsappOptOut === true) {
        return NextResponse.json({ ok: true, skipped: true, reason: "whatsapp_opt_out" });
      }

      const phone = pickPatientPhone(patient);
      if (!phone) {
        return NextResponse.json({ ok: true, skipped: true, reason: "missing_phone" });
      }

      const patientName = typeof patient.name === "string" ? patient.name : "Patient";
      const profile = await getClinicProfileAdmin();
      let clinicName = (profile?.clinicName && profile.clinicName.trim()) || "";
      if (!clinicName) {
        const ci = await adminDb().collection("settings").doc("clinic_info").get();
        const d = ci.data() as Record<string, unknown> | undefined;
        clinicName =
          (typeof d?.clinicName === "string" && d.clinicName.trim()) ||
          (typeof d?.name === "string" && d.name.trim()) ||
          "Alpha Dental";
      }
      const reviewUrl = String(profile?.googleReviewUrl || "").trim();
      const mapsUrl = String(profile?.googleMapsUrl || "").trim();
      const googleLink = reviewUrl || mapsUrl;

      const logType = `appointment_${appointmentTemplate}`;
      const merged = mergeWhatsAppTemplate(tplText, {
        patient_name: patientName,
        clinic_name: clinicName,
        doctor: apptDoctorRaw || "—",
        date: apptDateRaw || "—",
        time: apptTimeRaw || "—",
        google_link: googleLink,
      });

      try {
        await sendWhatsApp({ to: phone, text: merged });
        await adminDb().collection("whatsapp_logs").add({
          patientId,
          type: logType,
          message: merged,
          status: "success",
          createdAt: FieldValue.serverTimestamp(),
        });
        return NextResponse.json({ ok: true });
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Send failed";
        await adminDb().collection("whatsapp_logs").add({
          patientId,
          type: logType,
          message: merged,
          status: "failed",
          createdAt: FieldValue.serverTimestamp(),
        });
        return NextResponse.json({ ok: false, error: msg }, { status: 500 });
      }
    }

    if (kind !== "invoice" && kind !== "treatment" && kind !== "receipt") {
      return NextResponse.json({ ok: false, error: "Invalid kind" }, { status: 400 });
    }

    const patientSnap = await adminDb().collection("patients").doc(patientId).get();
    if (!patientSnap.exists) {
      return NextResponse.json({ ok: false, error: "Patient not found" }, { status: 404 });
    }
    const patient = patientSnap.data() as Record<string, unknown>;
    if (patient.whatsappOptOut === true) {
      if (automation) {
        return NextResponse.json({ ok: true, skipped: true, reason: "whatsapp_opt_out" });
      }
      return NextResponse.json({ ok: false, error: "Patient opted out of WhatsApp automation" }, { status: 400 });
    }

    const phone = pickPatientPhone(patient);
    if (!phone) {
      if (automation) {
        return NextResponse.json({ ok: true, skipped: true, reason: "missing_phone" });
      }
      return NextResponse.json({ ok: false, error: "Patient has no phone number" }, { status: 400 });
    }

    let clinicName = "Alpha Dental";
    try {
      const clinicSnap = await adminDb().collection("settings").doc("clinic_info").get();
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
        const summary = await computeLedgerSummary(patientId);
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
      const settingsSnap = await adminDb().collection("settings").doc("whatsapp").get();
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
        const ledgerSnap = automation
          ? await getLedgerDocWithRetry(ledgerId)
          : await adminDb().collection("ledger").doc(ledgerId).get();
        if (!ledgerSnap?.exists) {
          if (automation) {
            return NextResponse.json({ ok: true, skipped: true, reason: "ledger_not_ready" });
          }
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
        if (automation && typ !== "payment") {
          return NextResponse.json({ ok: true, skipped: true, reason: "not_a_payment" });
        }
        const amount =
          typ === "payment"
            ? Number(L.paid) || 0
            : typ === "procedure"
              ? Number(L.cost) || 0
              : Number(L.paid || L.amount || L.cost) || 0;

        const balance = await computePatientBalance(patientId);

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
        const noteSnap = await adminDb().collection("clinical_notes").doc(clinicalNoteId).get();
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
          const apptSnap = await adminDb().collection("appointments").doc(lastApptId).get();
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
      await sendWhatsApp({ to: phone, text: merged });
      await adminDb().collection("whatsapp_logs").add({
        patientId,
        type: kind,
        message: merged,
        status: "success",
        createdAt: FieldValue.serverTimestamp(),
      });
      return NextResponse.json({ ok: true });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Send failed";
      await adminDb().collection("whatsapp_logs").add({
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
