"use client";

/**
 * The three header lines printed at the top of an insurer statement (clinic and doctor, address,
 * phones), typed once and remembered in this browser per clinic.
 *
 * Shared by the Reports → Insurance statement tab (Nextcare) and the Insurance page (MetLife), so a
 * header typed on one is already there on the other. Nothing here writes to Firestore; the first time
 * on a machine the lines start from the clinic profile, which is what the insurers' samples print.
 */

import { useEffect, useState } from "react";
import { getClinicProfile } from "@/lib/clinicProfile";
import type { StatementHeader } from "@/lib/insuranceStatementXlsx";

export const EMPTY_HEADER: StatementHeader = { line1: "", line2: "", line3: "" };

export function headerStorageKey(clinicId: string | null): string {
  return `insurance-statement-header:${clinicId || "clinic"}`;
}

export function loadHeader(clinicId: string | null): StatementHeader | null {
  try {
    const raw = localStorage.getItem(headerStorageKey(clinicId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StatementHeader>;
    return { line1: String(parsed.line1 || ""), line2: String(parsed.line2 || ""), line3: String(parsed.line3 || "") };
  } catch {
    return null;
  }
}

export function saveHeader(clinicId: string | null, header: StatementHeader): void {
  try {
    localStorage.setItem(headerStorageKey(clinicId), JSON.stringify(header));
  } catch {
    // Private mode or a full store: the header is still on screen, just not remembered.
  }
}

/** The header for this clinic and a setter that remembers each edit. */
export function useStatementHeader(clinicId: string | null): [StatementHeader, (key: keyof StatementHeader, value: string) => void] {
  const [header, setHeader] = useState<StatementHeader>(EMPTY_HEADER);
  useEffect(() => {
    let cancelled = false;
    const saved = loadHeader(clinicId);
    // First time on this machine: start from the clinic profile, which is what the samples' header is.
    const source: Promise<StatementHeader | null> = saved
      ? Promise.resolve(saved)
      : getClinicProfile().then((profile) =>
          profile ? { line1: profile.clinicName || "", line2: profile.address || "", line3: profile.phone || "" } : null,
        );
    source
      .then((next) => {
        if (!cancelled && next) setHeader(next);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [clinicId]);
  const editHeader = (key: keyof StatementHeader, value: string) => {
    setHeader((prev) => {
      const next = { ...prev, [key]: value };
      saveHeader(clinicId, next);
      return next;
    });
  };
  return [header, editHeader];
}
