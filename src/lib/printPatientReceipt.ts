import { collection, doc, getDoc, getDocs, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { getClinicCollection, getClinicDoc } from "@/lib/db-utils";
import {
  buildDentalReceiptPayloadFromLedger,
  downloadDentalReceiptPdf,
} from "@/lib/receiptPdfHtml";

type LedgerRow = {
  id: string;
  date: string;
  description: string;
  type: string;
  cost: number;
  paid: number;
  method?: string;
  doctorName?: string;
  doctor?: string;
  discountAmount?: number;
  status?: string;
};

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

export type PrintReceiptFailureReason = "no_records" | "patient_not_found";

export type PrintReceiptResult =
  | { ok: true }
  | { ok: false; reason: PrintReceiptFailureReason; message: string };

export async function printPatientReceipt(
  patientId: string,
  options?: { fallbackName?: string; language?: "en" | "ar" }
): Promise<PrintReceiptResult> {
  const language = options?.language ?? "en";
  const patientLabel = options?.fallbackName?.trim() || (language === "ar" ? "هذا المريض" : "this patient");

  const [patientSnap, clinicSnap, ledgerSnap] = await Promise.all([
    getDoc(getClinicDoc("patients", patientId)),
    getDoc(getClinicDoc("settings", "clinic_info")),
    getDocs(query(getClinicCollection("ledger"), where("patientId", "==", patientId))),
  ]);

  const patient = patientSnap.exists() ? patientSnap.data() : {};
  const clinic = clinicSnap.exists() ? clinicSnap.data() : {};

  const rows: LedgerRow[] = ledgerSnap.docs
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
        discountAmount:
          typeof data.discountAmount === "number" ? data.discountAmount : undefined,
        status: typeof data.status === "string" ? data.status : undefined,
      };
    })
    .filter((t) => t.status !== "deleted" && t.status !== "cancelled");

  if (!patientSnap.exists()) {
    return {
      ok: false,
      reason: "patient_not_found",
      message:
        language === "ar"
          ? "لم يتم العثور على ملف المريض. افتح المريض من قائمة المرضى أولاً."
          : "Patient record not found. Open the patient from the Patients list first.",
    };
  }

  if (rows.length === 0) {
    return {
      ok: false,
      reason: "no_records",
      message:
        language === "ar"
          ? `لا يوجد إيصال لـ ${patientLabel} بعد — لا توجد علاجات أو دفعات في المالية. افتح ملف المريض → المالية لإضافة فاتورة أو دفعة.`
          : `No receipt for ${patientLabel} yet — no treatments or payments on file. Open the patient profile → Finance to add billing.`,
    };
  }

  const totalTreatment = rows.reduce(
    (s, t) => s + (t.type === "procedure" ? t.cost : 0),
    0
  );
  const totalPaid = rows.reduce((s, t) => s + (t.type === "payment" ? t.paid : 0), 0);

  const clinicName =
    (typeof clinic.name === "string" && clinic.name.trim()) ||
    (typeof clinic.clinicName === "string" && clinic.clinicName.trim()) ||
    "Alpha Dental";
  const clinicPhone = typeof clinic.phone === "string" ? clinic.phone : "";
  const clinicAddress = typeof clinic.address === "string" ? clinic.address : "";
  const leadDoctorName =
    typeof clinic.doctorName === "string" ? clinic.doctorName : undefined;

  const payload = buildDentalReceiptPayloadFromLedger({
    clinicName,
    clinicPhone,
    clinicAddress,
    leadDoctorName,
    patientName:
      (typeof patient.name === "string" && patient.name) ||
      options?.fallbackName ||
      "Patient",
    patientPhone: typeof patient.phone === "string" ? patient.phone : "",
    patientAddress: typeof patient.address === "string" ? patient.address : "",
    patientAgeSex: patientAgeSex(
      typeof patient.dateOfBirth === "string" ? patient.dateOfBirth : undefined,
      patient.age as string | number | undefined,
      typeof patient.gender === "string" ? patient.gender : undefined,
      language
    ),
    patientId,
    transactions: rows.map((t) => ({
      id: t.id,
      date: t.date,
      description: t.description,
      type: t.type,
      cost: t.cost,
      paid: t.paid,
      method: t.method,
      doctorName: t.doctorName,
      discountAmount: t.discountAmount,
      status: t.status,
    })),
    totals: {
      totalTreatment,
      totalPaid,
      balance: totalTreatment - totalPaid,
    },
  });

  downloadDentalReceiptPdf(payload, `Receipt-${patientId.slice(0, 8)}.pdf`);
  return { ok: true };
}
