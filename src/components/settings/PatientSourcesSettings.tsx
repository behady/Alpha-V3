"use client";

import { Network } from "lucide-react";
import NamedList from "@/components/settings/NamedList";
import { useSettingsText } from "@/lib/useSettingsText";
import { useLanguage } from "@/context/LanguageContext";
import { patientSourceLabel } from "@/lib/patientSourceLabel";

/** The document and field the patient form reads its source list from. */
export const PATIENT_SOURCES_DOC = "patient_sources";

/**
 * The channels a clinic here actually gets patients through. Seeded rather than left empty because
 * "how did you hear about us" is asked from the first day, and an empty dropdown gets skipped —
 * after which no marketing report can ever say where anyone came from.
 */
const DEFAULT_SOURCES = [
  "Walk-in",
  "Social Media",
  "Friend / Family",
  "Other Doctor",
  "Google",
  "Instagram",
  "Online Booking",
];

export default function PatientSourcesSettings({ canEdit }: { canEdit: boolean }) {
  const txt = useSettingsText("patientSources");
  const { isRTL } = useLanguage();

  return (
    <NamedList
      sectionId="sources"
      docId={PATIENT_SOURCES_DOC}
      field="sources"
      defaults={DEFAULT_SOURCES}
      icon={Network}
      canEdit={canEdit}
      displayLabel={(s) => patientSourceLabel(s, isRTL)}
      text={{
        ...txt,
        countLabel: (n) => `${n} ${n === 1 ? txt.countOne : txt.countMany}`,
      }}
    />
  );
}
