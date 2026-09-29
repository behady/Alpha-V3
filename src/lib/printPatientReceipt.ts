import { getDoc, getDocs, query, where } from "firebase/firestore";
import { getClinicCollection, getClinicDoc } from "@/lib/db-utils";
import {
  buildDentalReceiptPayloadFromLedger,
  buildPaymentReceiptPayload,
  downloadDentalReceiptPdf,
  type ReceiptLedgerTransaction,
} from "@/lib/receiptPdfHtml";
import { loadReceiptSettings } from "@/lib/receiptSettingsClient";

function patientAgeSex(
  dateOfBirth?: string,
  age?: string | number,
  gender?: string,
  language: "en" | "ar" = "en"
): string | undefined {
  let ageSex = "";
  if (dateOfBirth) {
    const birth = new Date(dateOfBirth);
    if (!Number.isNaN(birth.getTime())) {
      const yrs = Math.abs(new Date(Date.now() - birth.getTime()).getUTCFullYear() - 1970);
      ageSex = `${yrs} ${language === "ar" ? "سنة" : "yr"}`;
      if (gender) ageSex += ` · ${gender}`;
    }
  } else if (age != null && String(age).trim()) {
    ageSex = `${String(age).trim()} ${language === "ar" ? "سنة" : "yr"}`;
    if (gender) ageSex += ` · ${gender}`;
  } else if (gender) {
    ageSex = gender;
  }
  return ageSex || undefined;
}

export type PrintReceiptFailureReason = "no_records" | "patient_not_found" | "payment_not_found";

export type PrintReceiptResult =
  | { ok: true }
  | { ok: false; reason: PrintReceiptFailureReason; message: string };

type ReceiptContext = {
  patientExists: boolean;
  rows: ReceiptLedgerTransaction[];
  clinic: {
    clinicName: string;
    clinicPhone: string;
    clinicAddress: string;
    clinicEmail?: string;
    leadDoctorName?: string;
    currency?: string;
  };
  patient: {
    patientName: string;
    patientPhone: string;
    patientAddress?: string;
    patientAgeSex?: string;
    patientFileNumber?: string;
  };
};

/**
 * Everything both receipts need, in three reads: the patient, the clinic's letterhead, and every
 * ledger row on the account. The settings are read alongside by the callers.
 */
async function loadReceiptContext(
  patientId: string,
  fallbackName: string | undefined,
  language: "en" | "ar"
): Promise<ReceiptContext> {
  const [patientSnap, clinicSnap, ledgerSnap] = await Promise.all([
    getDoc(getClinicDoc("patients", patientId)),
    getDoc(getClinicDoc("settings", "clinic_info")),
    getDocs(query(getClinicCollection("ledger"), where("patientId", "==", patientId))),
  ]);

  const patient = patientSnap.exists() ? patientSnap.data() : {};
  const clinic = clinicSnap.exists() ? clinicSnap.data() : {};

  const rows: ReceiptLedgerTransaction[] = ledgerSnap.docs
    .map((d) => {
      const data = d.data();
      return {
        id: d.id,
        date: String(data.date ?? ""),
        description: String(data.description ?? ""),
        type: String(data.type ?? ""),
        cost: Number(data.cost) || 0,
        paid: Number(data.paid) || 0,
        method: typeof data.method === "string" ? data.method : undefined,
        doctorName:
          typeof data.doctorName === "string"
            ? data.doctorName
            : typeof data.doctor === "string"
              ? data.doctor
              : undefined,
        listPrice: typeof data.listPrice === "number" ? data.listPrice : undefined,
        discountAmount: typeof data.discountAmount === "number" ? data.discountAmount : undefined,
        status: typeof data.status === "string" ? data.status : undefined,
        procedureId: typeof data.procedureId === "string" ? data.procedureId : null,
        receiptNumber: typeof data.receiptNumber === "string" ? data.receiptNumber : null,
        addedBy:
          typeof data.receivedBy === "string"
            ? data.receivedBy
            : typeof data.addedBy === "string"
              ? data.addedBy
              : null,
      };
    })
    .filter((t) => t.status !== "deleted" && t.status !== "cancelled");

  return {
    patientExists: patientSnap.exists(),
    rows,
    clinic: {
      clinicName:
        (typeof clinic.name === "string" && clinic.name.trim()) ||
        (typeof clinic.clinicName === "string" && clinic.clinicName.trim()) ||
        "Alpha Dental",
      clinicPhone: typeof clinic.phone === "string" ? clinic.phone : "",
      clinicAddress: typeof clinic.address === "string" ? clinic.address : "",
      clinicEmail: typeof clinic.email === "string" ? clinic.email : undefined,
      leadDoctorName: typeof clinic.doctorName === "string" ? clinic.doctorName : undefined,
      currency: typeof clinic.currency === "string" && clinic.currency.trim() ? clinic.currency : "EGP",
    },
    patient: {
      patientName: (typeof patient.name === "string" && patient.name) || fallbackName || "Patient",
      patientPhone: typeof patient.phone === "string" ? patient.phone : "",
      patientAddress: typeof patient.address === "string" ? patient.address : "",
      patientAgeSex: patientAgeSex(
        typeof patient.dateOfBirth === "string" ? patient.dateOfBirth : undefined,
        patient.age as string | number | undefined,
        typeof patient.gender === "string" ? patient.gender : undefined,
        language
      ),
      patientFileNumber: typeof patient.fileId === "string" ? patient.fileId : undefined,
    },
  };
}

function notFound(language: "en" | "ar"): PrintReceiptResult {
  return {
    ok: false,
    reason: "patient_not_found",
    message:
      language === "ar"
        ? "لم يتم العثور على ملف المريض. افتح المريض من قائمة المرضى أولاً."
        : "Patient record not found. Open the patient from the Patients list first.",
  };
}

/** The whole-account statement. */
export async function printPatientReceipt(
  patientId: string,
  options?: { fallbackName?: string; language?: "en" | "ar" }
): Promise<PrintReceiptResult> {
  const language = options?.language ?? "en";
  const patientLabel = options?.fallbackName?.trim() || (language === "ar" ? "هذا المريض" : "this patient");

  const [ctx, settings] = await Promise.all([
    loadReceiptContext(patientId, options?.fallbackName, language),
    loadReceiptSettings(),
  ]);

  if (!ctx.patientExists) return notFound(language);

  if (ctx.rows.length === 0) {
    return {
      ok: false,
      reason: "no_records",
      message:
        language === "ar"
          ? `لا يوجد إيصال لـ ${patientLabel} بعد — لا توجد علاجات أو دفعات في المالية. افتح ملف المريض → المالية لإضافة فاتورة أو دفعة.`
          : `No receipt for ${patientLabel} yet — no treatments or payments on file. Open the patient profile → Finance to add billing.`,
    };
  }

  const totalTreatment = ctx.rows.reduce((s, t) => s + (t.type === "procedure" ? t.cost : 0), 0);
  const totalPaid = ctx.rows.reduce((s, t) => s + (t.type === "payment" ? t.paid : 0), 0);

  const payload = buildDentalReceiptPayloadFromLedger({
    ...ctx.clinic,
    ...ctx.patient,
    patientId,
    transactions: ctx.rows,
    totals: { totalTreatment, totalPaid, balance: totalTreatment - totalPaid },
  });

  await downloadDentalReceiptPdf(payload, settings);
  return { ok: true };
}

/**
 * The receipt for one payment — the document a patient is handed at the desk.
 *
 * Reads the account fresh rather than trusting whatever list the calling screen holds, because
 * the receipt number is stamped by the server when the payment is created and a screen that has
 * not re-rendered yet would print without it.
 */
export async function printPaymentReceipt(
  patientId: string,
  paymentId: string,
  options?: { fallbackName?: string; language?: "en" | "ar" }
): Promise<PrintReceiptResult> {
  const language = options?.language ?? "en";

  const [ctx, settings] = await Promise.all([
    loadReceiptContext(patientId, options?.fallbackName, language),
    loadReceiptSettings(),
  ]);

  if (!ctx.patientExists) return notFound(language);

  const payload = buildPaymentReceiptPayload({
    ...ctx.clinic,
    ...ctx.patient,
    patientId,
    paymentId,
    transactions: ctx.rows,
  });

  if (!payload) {
    return {
      ok: false,
      reason: "payment_not_found",
      message:
        language === "ar"
          ? "لم يتم العثور على هذه الدفعة في حساب المريض."
          : "That payment is not on the patient's account.",
    };
  }

  await downloadDentalReceiptPdf(payload, settings);
  return { ok: true };
}
