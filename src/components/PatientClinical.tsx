"use client";

import { useRouter } from "next/navigation";
import ClinicalNotes from "@/components/clinical-notes";

export default function PatientClinical({ patient }: { patient: any }) {
  const router = useRouter();
  const p = patient || {};

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
      <ClinicalNotes patientId={p.id} onWriteRx={() => router.push(`/patients/${p.id}/rx`)} />
    </div>
  );
}
