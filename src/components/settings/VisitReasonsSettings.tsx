"use client";

import { Stethoscope } from "lucide-react";
import NamedList from "@/components/settings/NamedList";
import { useSettingsText } from "@/lib/useSettingsText";

/** The document and field the booking screen reads its reason list from. */
export const VISIT_REASONS_DOC = "visit_reasons";

/**
 * Seeded with the one reason every clinic here books: a check-up. A clinic that has never opened
 * this screen still gets a working list rather than an empty dropdown.
 */
const DEFAULT_REASONS = ["كشف"];

export default function VisitReasonsSettings({ canEdit }: { canEdit: boolean }) {
  const txt = useSettingsText("visitReasons");

  return (
    <NamedList
      sectionId="visit_reasons"
      docId={VISIT_REASONS_DOC}
      field="reasons"
      defaults={DEFAULT_REASONS}
      icon={Stethoscope}
      canEdit={canEdit}
      text={{
        ...txt,
        countLabel: (n) => `${n} ${n === 1 ? txt.countOne : txt.countMany}`,
      }}
    />
  );
}
