"use client";

import { useState } from "react";
import { Check, Link2Off, Loader2 } from "lucide-react";
import InsurerBadge from "@/components/shared/InsurerBadge";
import { patchClaim, InsuranceCallError } from "@/components/insurance/api";
import { useClinic } from "@/context/ClinicContext";
import { useUI } from "@/context/UIContext";
import { LINE_STATUSES, lineStatusOf, type InsuranceClaim, type LineStatus } from "@/lib/insurance/claims";
import type { ClaimLink } from "@/lib/insurance/appointments";
import { formatDayLabel } from "./PatientTimeline";

type Props = {
  language: string;
  loaded: boolean;
  claims: InsuranceClaim[];
  /** The approved services this visit is booked for. */
  claimLinks: ClaimLink[];
  /** `"claimId|line"`: link that service to this visit, or unlink it if it already is. */
  onToggle: (value: string) => void;
  /** The visit's dentist: a service marked Ongoing or Completed here is put on them. */
  dentistId?: string | null;
};

const money = (n: number) => `${Math.round(Number(n) || 0).toLocaleString("en-US")}`;

const STATUS_LABEL: Record<InsuranceClaim["status"], { en: string; ar: string }> = {
  approved: { en: "Approved", ar: "موافق عليها" },
  treated: { en: "Treated", ar: "اتعالجت" },
  sent: { en: "Sent to insurer", ar: "اتبعتت للتأمين" },
  cancelled: { en: "Cancelled", ar: "ملغية" },
};
const LINE_LABEL: Record<LineStatus, { en: string; ar: string }> = {
  Completed: { en: "Completed", ar: "خلصت" },
  Ongoing: { en: "Ongoing", ar: "شغالين فيها" },
  Planned: { en: "Planned", ar: "متخططة" },
};

/** Approved total, what is done (Completed services), and what is left to use. Cancelled approvals count for nothing. */
export function approvalFigures(claims: readonly InsuranceClaim[]): { approved: number; done: number; left: number } {
  let approved = 0;
  let done = 0;
  for (const c of claims) {
    if (c.status === "cancelled") continue;
    c.lines.forEach((line, i) => {
      approved += Number(line.approvedAmount) || 0;
      if (lineStatusOf(c, i) === "Completed") done += Number(line.approvedAmount) || 0;
    });
  }
  return { approved, done, left: Math.max(0, approved - done) };
}

/**
 * The patient's insurance approvals inside the booking popup.
 *
 * Top: approved / done / remaining credit across every live approval. Each service line can be
 * linked to this visit (several may be — when the visit is marked done, every linked service is
 * marked completed on its approval), and its progress (Planned / Ongoing / Completed) is changed
 * right here, saved at once through the claims route exactly as the patient file's Insurance tab
 * does it.
 */
export default function InsuranceApprovals({ language, loaded, claims, claimLinks, onToggle, dentistId }: Props) {
  const isAr = language === "ar";
  const t = (o: { en: string; ar: string }) => (isAr ? o.ar : o.en);
  const { clinicId } = useClinic();
  const { showToast, confirm } = useUI();
  const [busy, setBusy] = useState("");

  if (!loaded) {
    return <p className="py-8 text-[15px] text-ink-body">{isAr ? "بنحمّل الموافقات…" : "Loading approvals…"}</p>;
  }
  if (claims.length === 0) {
    return (
      <p className="mt-4 rounded-2xl border border-dashed border-line-strong px-5 py-7 text-[15px] text-ink-body">
        {isAr
          ? "مفيش موافقات تأمين للمريض ده لسه. ارفع ورقة الموافقة من الزرار اللي تحت."
          : "No insurance approvals for this patient yet. Upload the approval paper with the button below."}
      </p>
    );
  }

  const setProgress = async (claim: InsuranceClaim, line: number, next: LineStatus) => {
    if (!clinicId || lineStatusOf(claim, line) === next) return;
    // The sheet already went to the insurer: changing a service's state changes what it showed.
    if (
      claim.status === "sent" &&
      !(await confirm(
        isAr ? "الموافقة دي اتبعتت للتأمين خلاص. تغيير حالة الخدمة هيغيّر اللي اتبعت. تكمّل؟" : "This approval was already sent to the insurer. Changing a service's state changes what was sent. Continue?",
        { confirmLabel: isAr ? "كمّل" : "Continue" },
      ))
    ) {
      return;
    }
    setBusy(`${claim.id}|${line}`);
    try {
      // Being worked on (Ongoing) or done (Completed) here means it is THIS visit's work: the
      // service is linked to the visit and put on the visit's dentist, in the same step.
      const working = next !== "Planned";
      const assign = working && dentistId && claim.dentists[line]?.staffId !== dentistId ? { dentists: { [line]: dentistId } } : {};
      const error = await patchClaim(clinicId, claim.id, { lineStatus: { [line]: next }, ...assign });
      if (error) showToast(error, "error");
      else {
        if (working && !linked(claim.id, line)) onToggle(`${claim.id}|${line}`);
        showToast(
          working
            ? isAr ? "اتحدّثت واتربطت بالزيارة دي" : "Updated and linked to this visit"
            : isAr ? "اتحدّثت" : "Updated",
          "success",
        );
      }
    } catch (err) {
      showToast(
        err instanceof InsuranceCallError && err.kind === "signed_out"
          ? isAr ? "سجّل دخول تاني" : "Please sign in again"
          : isAr ? "التحديث ماتمّش" : "Could not update",
        "error",
      );
    } finally {
      setBusy("");
    }
  };

  const linked = (claimId: string, line: number) => claimLinks.some((l) => l.claimId === claimId && l.claimLine === line);
  const total = approvalFigures(claims);
  const tile = (label: string, value: number, strong = false) => (
    <div className={`rounded-2xl border px-5 py-4 ${strong ? "border-ink-slab" : "border-line-strong"}`}>
      <p className="text-[13px] font-semibold uppercase tracking-[0.05em] text-ink-body">{label}</p>
      <p className="mt-1 font-figure text-[28px] font-semibold leading-tight tabular-nums text-ink">
        {money(value)} <span className="text-sm font-medium text-ink-muted">{isAr ? "ج.م" : "EGP"}</span>
      </p>
    </div>
  );

  // Live approvals first, newest first; cancelled ones sink to the bottom.
  const sorted = [...claims].sort(
    (a, b) => Number(a.status === "cancelled") - Number(b.status === "cancelled") || b.approvalDate.localeCompare(a.approvalDate),
  );

  return (
    <div className="mt-4 space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {tile(isAr ? "المبلغ الموافق عليه" : "Approved amount", total.approved)}
        {tile(isAr ? "اتعمل منه" : "Services done", total.done)}
        {tile(isAr ? "الرصيد الباقي" : "Remaining credit", total.left, true)}
      </div>
      <p className="text-sm text-ink-body">
        {isAr
          ? "اربط الزيارة بخدمة أو أكتر من الموافقة: لما الزيارة تتعلّم خلصت، الخدمات دي بتتعلّم خلصت على الموافقة."
          : "Link this visit to one or more approved services: when the visit is marked done, those services are marked completed on the approval."}
      </p>
      {sorted.map((c) => {
        const fig = approvalFigures([{ ...c, status: c.status === "cancelled" ? "approved" : c.status }]);
        return (
          <div key={c.id} className={`overflow-hidden rounded-2xl border border-line-strong ${c.status === "cancelled" ? "opacity-60" : ""}`}>
            <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
              <div className="flex flex-wrap items-center gap-2.5">
                <InsurerBadge name="MetLife" size={26} />
                <span className="font-figure text-lg font-semibold tabular-nums text-ink">
                  {isAr ? "موافقة" : "Approval"} {c.approvalNumber}
                </span>
                <span className="rounded-full border border-line-strong px-2.5 py-0.5 text-xs font-semibold text-ink">{t(STATUS_LABEL[c.status])}</span>
              </div>
              <span className="text-[13px] text-ink-body">
                {isAr ? "اتعمل" : "Done"} <b className="font-figure text-ink">{money(fig.done)}</b> {isAr ? "من" : "of"}{" "}
                <b className="font-figure text-ink">{money(fig.approved)}</b> · {formatDayLabel(c.approvalDate, isAr, false)} {c.approvalDate.slice(0, 4)}
              </span>
            </div>
            <div className="custom-scrollbar overflow-x-auto">
              <table className="w-full min-w-[680px] border-collapse text-[15px]">
                <thead>
                  <tr className="border-y border-line bg-surface-subtle text-[13px] font-semibold text-ink-body">
                    <th className="px-5 py-2.5 text-start font-semibold">{isAr ? "الخدمة" : "Treatment"}</th>
                    <th className="px-4 py-2.5 text-end font-semibold">{isAr ? "الموافق عليه" : "Approved"}</th>
                    <th className="px-4 py-2.5 text-end font-semibold">{isAr ? "على المريض" : "Patient share"}</th>
                    <th className="px-4 py-2.5 text-start font-semibold">{isAr ? "الحالة" : "Status"}</th>
                    <th className="px-5 py-2.5" />
                  </tr>
                </thead>
                <tbody>
                  {c.lines.map((line, i) => {
                    const status = lineStatusOf(c, i);
                    const isLinked = linked(c.id, i);
                    const open = c.status !== "cancelled" && status !== "Completed";
                    const saving = busy === `${c.id}|${i}`;
                    return (
                      <tr key={i} className={`border-b border-line last:border-b-0 ${isLinked ? "bg-accent-tint" : ""}`}>
                        <td className="px-5 py-3">
                          <span className="block font-figure text-[13px] text-ink-muted">{line.code}</span>
                          <span className="text-ink">{line.description}</span>
                          {c.dentists[i]?.name && <span className="block text-[13px] text-ink-body">{c.dentists[i].name}</span>}
                        </td>
                        <td className="px-4 py-3 text-end font-figure font-medium tabular-nums text-ink">{money(line.approvedAmount)}</td>
                        <td className="px-4 py-3 text-end font-figure font-medium tabular-nums text-ink">{money(line.patientShare)}</td>
                        <td className="px-4 py-3">
                          <span className="inline-flex items-center gap-1.5">
                            <select
                              value={status}
                              disabled={c.status === "cancelled" || saving}
                              onChange={(e) => void setProgress(c, i, e.target.value as LineStatus)}
                              aria-label={isAr ? "حالة الخدمة" : "Service status"}
                              className="h-9 rounded-lg border border-line-strong bg-surface px-2.5 text-sm font-semibold text-ink outline-none focus:border-ink disabled:opacity-60"
                            >
                              {LINE_STATUSES.map((s) => (
                                <option key={s} value={s}>
                                  {t(LINE_LABEL[s])}
                                </option>
                              ))}
                            </select>
                            {saving && <Loader2 size={13} className="animate-spin text-ink-faint" />}
                          </span>
                        </td>
                        <td className="px-5 py-3 text-end">
                          {isLinked ? (
                            <span className="inline-flex items-center gap-2">
                              <span className="inline-flex items-center gap-1 text-sm font-bold text-ink">
                                <Check size={14} /> {isAr ? "الزيارة دي" : "This visit"}
                              </span>
                              <button
                                type="button"
                                onClick={() => onToggle(`${c.id}|${i}`)}
                                title={isAr ? "شيل الربط" : "Unlink"}
                                className="rounded-lg p-1.5 text-ink-faint hover:bg-surface-muted hover:text-danger"
                              >
                                <Link2Off size={14} />
                              </button>
                            </span>
                          ) : open ? (
                            <button
                              type="button"
                              onClick={() => onToggle(`${c.id}|${i}`)}
                              className="h-10 whitespace-nowrap rounded-xl border border-line-strong bg-surface px-4 text-sm font-semibold text-ink transition-colors hover:border-ink hover:bg-surface-subtle"
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
                    <td className="px-5 py-3 text-ink-body">{isAr ? "الإجمالي" : "Total"}</td>
                    <td className="px-4 py-3 text-end font-figure font-medium tabular-nums text-ink">{money(c.totals.approved)}</td>
                    <td className="px-4 py-3 text-end font-figure font-medium tabular-nums text-ink">{money(c.totals.patientShare)}</td>
                    <td colSpan={2} className="px-4 py-3 text-[13px] font-semibold text-ink-body">
                      {c.totals.patientShare > 0 &&
                        (c.shareCollected
                          ? isAr ? "حصة المريض اتدفعت" : "Patient share collected"
                          : isAr ? "حصة المريض بتتحصّل من تبويب الدفع" : "Patient share is collected on the Payment tab")}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        );
      })}
    </div>
  );
}
