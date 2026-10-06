"use client";

import { Check, Link2Off } from "lucide-react";
import InsurerBadge from "@/components/shared/InsurerBadge";
import { lineStatusOf, type InsuranceClaim } from "@/lib/insurance/claims";
import type { ClaimLink } from "@/lib/insurance/appointments";
import { formatDayLabel } from "./PatientTimeline";

type Props = {
  language: string;
  loaded: boolean;
  claims: InsuranceClaim[];
  /** The approval service this visit is booked for, if any. */
  claimLink: ClaimLink | null;
  /** `"claimId|line"` to link a service to this visit, "" to make it a plain visit again. */
  onPick: (value: string) => void;
};

const money = (n: number) => `${Math.round(Number(n) || 0).toLocaleString("en-US")}`;

const STATUS_LABEL: Record<InsuranceClaim["status"], { en: string; ar: string }> = {
  approved: { en: "Approved", ar: "موافق عليها" },
  treated: { en: "Treated", ar: "اتعالجت" },
  sent: { en: "Sent to insurer", ar: "اتبعتت للتأمين" },
  cancelled: { en: "Cancelled", ar: "ملغية" },
};
const LINE_LABEL = {
  Completed: { en: "Done", ar: "خلصت" },
  Ongoing: { en: "Ongoing", ar: "شغالين فيها" },
  Planned: { en: "Planned", ar: "متخططة" },
} as const;

/**
 * The patient's insurance approvals, and which approved service this visit is for.
 *
 * Linking is the same choice the old booking form made with its "Approved insurance service"
 * dropdown: when the visit is marked done, that service is marked completed on the approval.
 */
export default function InsuranceApprovals({ language, loaded, claims, claimLink, onPick }: Props) {
  const isAr = language === "ar";
  const t = (o: { en: string; ar: string }) => (isAr ? o.ar : o.en);

  if (!loaded) {
    return <p className="py-6 text-sm text-ink-muted">{isAr ? "بنحمّل الموافقات…" : "Loading approvals…"}</p>;
  }
  if (claims.length === 0) {
    return (
      <p className="mt-3 rounded-2xl border border-dashed border-line px-4 py-6 text-sm text-ink-muted">
        {isAr
          ? "مفيش موافقات تأمين للمريض ده لسه. ارفع ورقة الموافقة من الزرار اللي تحت."
          : "No insurance approvals for this patient yet. Upload the approval paper with the button below."}
      </p>
    );
  }

  // Live approvals first, newest first; cancelled ones sink to the bottom.
  const sorted = [...claims].sort(
    (a, b) => Number(a.status === "cancelled") - Number(b.status === "cancelled") || b.approvalDate.localeCompare(a.approvalDate),
  );

  return (
    <div className="space-y-3">
      <p className="text-xs text-ink-muted">
        {isAr
          ? "اربط الزيارة بخدمة من الموافقة: لما الزيارة تتعلّم خلصت، الخدمة بتتعلّم خلصت على الموافقة."
          : "Link this visit to an approved service: when the visit is marked done, that service is marked completed on the approval."}
      </p>
      {sorted.map((c) => (
        <div key={c.id} className={`overflow-hidden rounded-2xl border border-line ${c.status === "cancelled" ? "opacity-60" : ""}`}>
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
            <div className="flex flex-wrap items-center gap-2.5">
              <InsurerBadge name="MetLife" size={22} />
              <span className="font-figure text-[15px] font-semibold tabular-nums text-ink">
                {isAr ? "موافقة" : "Approval"} {c.approvalNumber}
              </span>
              <span className="rounded-full border border-line px-2 py-0.5 text-[11px] font-semibold text-ink-body">{t(STATUS_LABEL[c.status])}</span>
            </div>
            <span className="text-xs text-ink-muted">
              {formatDayLabel(c.approvalDate, isAr, false)} {c.approvalDate.slice(0, 4)}
            </span>
          </div>
          <div className="custom-scrollbar overflow-x-auto">
            <table className="w-full min-w-[560px] border-collapse text-sm">
              <thead>
                <tr className="border-y border-line bg-surface-subtle text-start text-[11.5px] font-semibold text-ink-muted">
                  <th className="px-4 py-2 text-start font-semibold">{isAr ? "الخدمة" : "Treatment"}</th>
                  <th className="px-3 py-2 text-end font-semibold">{isAr ? "الموافق عليه" : "Approved"}</th>
                  <th className="px-3 py-2 text-end font-semibold">{isAr ? "على المريض" : "Patient share"}</th>
                  <th className="px-3 py-2 text-start font-semibold">{isAr ? "الحالة" : "Progress"}</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {c.lines.map((line, i) => {
                  const status = lineStatusOf(c, i);
                  const linked = !!claimLink && claimLink.claimId === c.id && claimLink.claimLine === i;
                  const open = c.status !== "cancelled" && status !== "Completed";
                  return (
                    <tr key={i} className={`border-b border-line last:border-b-0 ${linked ? "bg-accent-tint" : ""}`}>
                      <td className="px-4 py-2.5">
                        <span className="block font-figure text-[11.5px] text-ink-muted">{line.code}</span>
                        <span className="text-ink">{line.description}</span>
                        {c.dentists[i]?.name && <span className="block text-[11.5px] text-ink-muted">{c.dentists[i].name}</span>}
                      </td>
                      <td className="px-3 py-2.5 text-end font-figure tabular-nums text-ink">{money(line.approvedAmount)}</td>
                      <td className="px-3 py-2.5 text-end font-figure tabular-nums text-ink">{money(line.patientShare)}</td>
                      <td className="px-3 py-2.5 text-xs font-semibold text-ink-body">{t(LINE_LABEL[status])}</td>
                      <td className="px-4 py-2.5 text-end">
                        {linked ? (
                          <span className="inline-flex items-center gap-2">
                            <span className="inline-flex items-center gap-1 text-xs font-semibold text-ink">
                              <Check size={14} /> {isAr ? "الزيارة دي" : "This visit"}
                            </span>
                            <button
                              type="button"
                              onClick={() => onPick("")}
                              title={isAr ? "شيل الربط" : "Unlink"}
                              className="rounded-lg p-1.5 text-ink-faint hover:bg-surface-muted hover:text-danger"
                            >
                              <Link2Off size={14} />
                            </button>
                          </span>
                        ) : open ? (
                          <button
                            type="button"
                            onClick={() => onPick(`${c.id}|${i}`)}
                            className="whitespace-nowrap rounded-[10px] border border-line-strong bg-surface px-3 py-1.5 text-[13px] font-semibold text-ink hover:border-ink"
                          >
                            {isAr ? "للزيارة دي" : "Use for this visit"}
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t border-line bg-surface-subtle font-semibold">
                  <td className="px-4 py-2.5 text-ink-muted">{isAr ? "الإجمالي" : "Total"}</td>
                  <td className="px-3 py-2.5 text-end font-figure tabular-nums text-ink">{money(c.totals.approved)}</td>
                  <td className="px-3 py-2.5 text-end font-figure tabular-nums text-ink">{money(c.totals.patientShare)}</td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}
