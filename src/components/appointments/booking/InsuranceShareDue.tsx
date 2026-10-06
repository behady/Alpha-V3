"use client";

import { useState } from "react";
import { Banknote, Loader2 } from "lucide-react";
import InsurerBadge from "@/components/shared/InsurerBadge";
import { collectPatientShare, InsuranceCallError } from "@/components/insurance/api";
import { useClinic } from "@/context/ClinicContext";
import { useUI } from "@/context/UIContext";
import type { InsuranceClaim } from "@/lib/insurance/claims";

/**
 * The patient's share of each insurance approval that is still unpaid, on the popup's Payment tab.
 *
 * "Collect" is the same step as on the patient file's Insurance tab: one income row in today's
 * ledger, remembered on the approval so it can never be taken twice.
 */
export default function InsuranceShareDue({ claims, language }: { claims: InsuranceClaim[]; language: string }) {
  const isAr = language === "ar";
  const { clinicId } = useClinic();
  const { showToast, confirm } = useUI();
  const [busy, setBusy] = useState("");
  const due = claims.filter((c) => c.status !== "cancelled" && c.totals.patientShare > 0 && !c.shareCollected);
  if (due.length === 0) return null;

  const collect = async (c: InsuranceClaim) => {
    if (!clinicId || busy) return;
    const amount = c.totals.patientShare.toLocaleString("en-US");
    const ok = await confirm(
      isAr ? `تحصيل حصة المريض ${amount} ج.م لموافقة ${c.approvalNumber}؟` : `Collect the patient's share of ${amount} EGP for approval ${c.approvalNumber}?`,
      { confirmLabel: isAr ? "حصّل" : "Collect" },
    );
    if (!ok) return;
    setBusy(c.id);
    try {
      const error = await collectPatientShare(clinicId, c.id);
      if (error) showToast(error, "error");
      else showToast(isAr ? "حصة المريض اتحصّلت" : "Patient share collected", "success");
    } catch (err) {
      showToast(
        err instanceof InsuranceCallError && err.kind === "signed_out"
          ? isAr ? "سجّل دخول تاني" : "Please sign in again"
          : isAr ? "التحصيل ماتمّش" : "Could not collect the share",
        "error",
      );
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="mt-4 mb-5">
      <p className="mb-2.5 text-[13px] font-semibold uppercase tracking-[0.05em] text-ink-body">{isAr ? "حصة المريض في التأمين" : "Insurance — patient's share"}</p>
      <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line-strong">
        {due.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center justify-between gap-4 px-5 py-4">
            <span className="flex min-w-0 items-center gap-2.5">
              <InsurerBadge name="MetLife" size={20} />
              <span className="min-w-0">
                <span className="block text-[15px] font-semibold text-ink">
                  {isAr ? "موافقة" : "Approval"} <span className="font-figure">{c.approvalNumber}</span>
                </span>
                <span className="block text-[13px] text-ink-body">{c.lines.map((l) => l.description).join(" · ")}</span>
              </span>
            </span>
            <span className="flex items-center gap-3">
              <span className="font-figure text-xl font-semibold tabular-nums text-ink">
                {c.totals.patientShare.toLocaleString("en-US")} <span className="text-xs font-medium text-ink-muted">{isAr ? "ج.م" : "EGP"}</span>
              </span>
              <button
                type="button"
                onClick={() => void collect(c)}
                disabled={!!busy}
                className="inline-flex h-11 items-center gap-2 rounded-xl bg-ink-slab px-5 text-[15px] font-semibold text-white transition-colors hover:bg-slate-800 disabled:opacity-50"
              >
                {busy === c.id ? <Loader2 size={14} className="animate-spin" /> : <Banknote size={14} />}
                {isAr ? "حصّل" : "Collect"}
              </button>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
