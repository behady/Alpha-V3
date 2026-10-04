"use client";

/**
 * The clinic's sheet wording for MetLife service codes, over the built-in defaults.
 *
 * One listener on `settings/insurance_wording`; the Insurance page and the patient's Insurance tab
 * both read it, so the same code prints the same Arabic everywhere.
 */

import { useEffect, useMemo, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { WORDING_DOC } from "@/lib/insurance/claims";
import { DEFAULT_METLIFE_WORDING } from "@/lib/insuranceStatementMetlife";

export function useWording(clinicId: string | null): Record<string, string> {
  const [stored, setStored] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!clinicId) return;
    return onSnapshot(
      doc(db, "clinics", clinicId, "settings", WORDING_DOC),
      (snap) => {
        const table = snap.get("metlife");
        const out: Record<string, string> = {};
        if (table && typeof table === "object") {
          for (const [code, entry] of Object.entries(table as Record<string, unknown>)) {
            const ar = entry && typeof entry === "object" ? (entry as { ar?: unknown }).ar : undefined;
            if (typeof ar === "string" && ar.trim()) out[code] = ar.trim();
          }
        }
        setStored(out);
      },
      () => setStored({}),
    );
  }, [clinicId]);
  return useMemo(() => ({ ...DEFAULT_METLIFE_WORDING, ...stored }), [stored]);
}
