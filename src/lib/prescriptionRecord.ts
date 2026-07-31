import type { PrescriptionPdfPayload, RxItem } from "@/lib/prescriptionPdfHtml";

export function normalizeRxItemsFromRecord(raw: unknown): RxItem[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((x: { id?: string; name?: string; dose?: string; note?: string }, i) => ({
    id: typeof x?.id === "string" ? x.id : `rx_${i}`,
    name: String(x?.name ?? "—"),
    dose: String(x?.dose ?? ""),
    note: String(x?.note ?? ""),
  }));
}

type PrescriptionTimestampRow = {
  createdAt?: {
    toMillis?: () => number;
    toDate?: () => Date;
  };
};

export function prescriptionCreatedMs(row: unknown): number {
  if (!row || typeof row !== "object") return 0;
  const createdAt = (row as PrescriptionTimestampRow).createdAt;
  const ms = createdAt?.toMillis?.();
  if (typeof ms === "number" && !Number.isNaN(ms)) return ms;
  const dt = createdAt?.toDate?.();
  return dt instanceof Date && !Number.isNaN(dt.getTime()) ? dt.getTime() : 0;
}

export function prescriptionPreviewText(record: Record<string, unknown>): string {
  const dx =
    typeof record?.diagnosis === "string" ? record.diagnosis.replace(/\s+/g, " ").trim() : "";
  const items = normalizeRxItemsFromRecord(record?.drugs);
  const names = items.slice(0, 4).map((i) => i.name);
  const suffix = items.length > 4 ? "…" : "";
  const drugPart = names.length ? names.join(" · ") + suffix : "";
  if (dx && drugPart) return `${dx} — ${drugPart}`;
  return dx || drugPart || "—";
}

export function formatPrescriptionCardDate(record: Record<string, unknown>): string {
  const createdAt = record?.createdAt as { toDate?: () => Date } | undefined;
  const dt = createdAt?.toDate?.() ?? null;
  if (dt) {
    return dt.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  if (typeof record?.date === "string" && record.date.trim()) {
    return record.date.trim();
  }
  const ms = prescriptionCreatedMs(record);
  if (ms) {
    return new Date(ms).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  return "—";
}

function calculateAge(dob: string) {
  if (!dob) return "";
  const diff = Date.now() - new Date(dob).getTime();
  return Math.abs(new Date(diff).getUTCFullYear() - 1970).toString();
}

export type PrescriptionClinicInfo = Record<string, unknown>;
export type PrescriptionPatientInfo = {
  name?: string;
  dateOfBirth?: string;
  age?: string | number;
  gender?: string;
};

export function buildPrescriptionPayloadFromRecord(
  record: Record<string, unknown>,
  patient: PrescriptionPatientInfo,
  clinicInfo: PrescriptionClinicInfo
): PrescriptionPdfPayload {
  const rxItems = normalizeRxItemsFromRecord(record?.drugs);
  const doctor = String(record?.doctor || "");
  const agePart =
    patient.dateOfBirth != null && String(patient.dateOfBirth).trim() !== ""
      ? calculateAge(String(patient.dateOfBirth))
      : patient.age != null && String(patient.age).trim() !== ""
        ? String(patient.age)
        : "?";
  const ageSex = `${agePart} Y / ${String(patient.gender || "U").charAt(0) || "U"}`;
  const clinicName =
    (typeof clinicInfo.name === "string" && clinicInfo.name.trim()) ||
    (typeof clinicInfo.clinicName === "string" && clinicInfo.clinicName.trim()) ||
    "Dental Clinic";
  const dateLabel =
    typeof record?.date === "string" && record.date.trim()
      ? record.date.trim()
      : prescriptionCreatedMs(record) > 0
        ? new Date(prescriptionCreatedMs(record)).toLocaleDateString("en-GB")
        : new Date().toLocaleDateString("en-GB");

  return {
    clinicName,
    rxHeader:
      (typeof clinicInfo.rxHeader === "string" && clinicInfo.rxHeader.trim()) ||
      (doctor ? `Dr. ${doctor}` : ""),
    dateLabel,
    patientName: String(record?.patientName || patient.name || "Patient"),
    ageSex,
    diagnosis: String(record?.diagnosis || ""),
    doctor,
    address: typeof clinicInfo.address === "string" ? clinicInfo.address : "",
    phone: typeof clinicInfo.phone === "string" ? clinicInfo.phone : "",
    rxItems,
  };
}

/** Open PDF in a new tab for printing; falls back to download if pop-up is blocked. */
export function openPrescriptionPdf(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const opened = window.open(url, "_blank");
  if (!opened) {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
  window.setTimeout(() => URL.revokeObjectURL(url), 120_000);
}
