"use client";

/**
 * The saved approvals of one insurer in the chosen range.
 *
 * Columns: approval number, patient, approval date, treated date, approved total, patient share,
 * status. Row actions: mark treated / not treated, mark sent, open the document, delete (to the
 * recycle bin). The page owns the calls (`onPatch`, `onDelete`); this owns the questions: a claim
 * already sent to MetLife asks "continue?" before it is changed or deleted, and every delete asks
 * first anyway.
 */

import { useState } from "react";
import Link from "next/link";
import { ref, getDownloadURL } from "firebase/storage";
import { Banknote, CheckCircle2, FileText, Landmark, Loader2, Pencil, RotateCcw, Send, Trash2 } from "lucide-react";
import { storage } from "@/lib/firebase";
import { useLanguage } from "@/context/LanguageContext";
import { useUI } from "@/context/UIContext";
import type { ClaimStatus, InsuranceClaim } from "@/lib/insurance/claims";
import { claimProgress, type LinkedAppointmentLite } from "@/lib/insurance/appointments";
import type { ClaimPatch } from "./api";
import { tr, type TextKey } from "./text";

const STATUS: Record<ClaimStatus, { key: TextKey; pill: string }> = {
  approved: { key: "statusApproved", pill: "border-amber-200 bg-amber-50 text-amber-800" },
  treated: { key: "statusTreated", pill: "border-line bg-surface-subtle text-ink" },
  sent: { key: "statusSent", pill: "border-emerald-200 bg-emerald-50 text-emerald-800" },
  cancelled: { key: "statusCancelled", pill: "border-line bg-surface-subtle text-ink-faint line-through" },
};

const money = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });

export default function ClaimsTable({
  claims,
  onPatch,
  onDelete,
  onEdit,
  highlightId,
  loading,
  payerName,
  appointments = [],
}: {
  claims: InsuranceClaim[];
  /** Resolves true when the change is saved; the page reports a failure itself. */
  onPatch: (claim: InsuranceClaim, patch: ClaimPatch) => Promise<boolean>;
  onDelete: (claim: InsuranceClaim) => Promise<void>;
  /** Open the saved approval in the confirm card to correct it. */
  onEdit?: (claim: InsuranceClaim) => void;
  /** A claim the page asked to show (from "already saved — open"). */
  highlightId?: string | null;
  loading?: boolean;
  /** The insurer's name, for the payment questions; the claim's payer id stands in without it. */
  payerName?: string;
  /** Every appointment booked for an approved service, for the "2 of 3 done · 1 booked" line. */
  appointments?: LinkedAppointmentLite[];
}) {
  const { language } = useLanguage();
  const isAr = language === "ar";
  const t = tr(isAr);
  const { confirm, showToast } = useUI();
  const [busyId, setBusyId] = useState("");

  /** A claim already sent to MetLife is checked with the desk before anything changes it. */
  const sentOk = async (claim: InsuranceClaim) =>
    claim.status !== "sent" || (await confirm(t("sentWarning"), { confirmLabel: t("continue") }));

  const run = async (claim: InsuranceClaim, fn: () => Promise<unknown>) => {
    setBusyId(claim.id);
    try {
      await fn();
    } finally {
      setBusyId("");
    }
  };

  const patch = async (claim: InsuranceClaim, change: ClaimPatch) => {
    if (!(await sentOk(claim))) return;
    await run(claim, () => onPatch(claim, change));
  };

  /** Money is asked about first, with the figure, exactly as the patient's Insurance tab asks. */
  const collect = async (claim: InsuranceClaim) => {
    const question = t("confirmShare").replace("{amount}", money(claim.totals.patientShare)).replace("{number}", claim.approvalNumber);
    if (!(await confirm(question, { confirmLabel: t("collectShare") }))) return;
    await patch(claim, { collectShare: true });
  };

  const insurerPaid = async (claim: InsuranceClaim) => {
    const question = t("confirmInsurerPaid")
      .replace("{amount}", money(claim.totals.approved))
      .replace("{insurer}", payerName || claim.payerId)
      .replace("{number}", claim.approvalNumber);
    if (!(await confirm(question, { confirmLabel: t("markInsurerPaid") }))) return;
    await patch(claim, { insurerPaid: true });
  };

  const remove = async (claim: InsuranceClaim) => {
    if (!(await sentOk(claim))) return;
    if (!(await confirm(t("deleteConfirm"), { tone: "danger", confirmLabel: t("delete") }))) return;
    await run(claim, () => onDelete(claim));
  };

  const openDoc = async (claim: InsuranceClaim) => {
    if (!claim.doc.path) {
      showToast(t("noDocument"), "error");
      return;
    }
    // Opened before the await: a window opened after one is a popup the browser blocks.
    const win = window.open("", "_blank");
    try {
      const url = await getDownloadURL(ref(storage, claim.doc.path));
      if (win) {
        win.opener = null;
        win.location.href = url;
      } else {
        window.location.assign(url);
      }
    } catch (err) {
      console.error("Insurance document link failed", err);
      win?.close();
      showToast(t("noDocument"), "error");
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center rounded-3xl border border-line bg-surface py-16">
        <Loader2 className="animate-spin text-ink-muted" size={22} />
      </div>
    );
  }
  if (claims.length === 0) {
    return <p className="rounded-3xl border border-dashed border-line bg-surface-subtle py-14 text-center text-sm font-bold text-ink-muted">{t("noClaims")}</p>;
  }

  const totals = claims.reduce(
    (acc, c) => (c.status === "cancelled" ? acc : { approved: acc.approved + c.totals.approved, share: acc.share + c.totals.patientShare }),
    { approved: 0, share: 0 },
  );

  return (
    <div className="overflow-x-auto rounded-3xl border border-line bg-surface">
      <table className="w-full min-w-[60rem] border-collapse">
        <thead>
          <tr className="border-b border-line bg-surface-subtle">
            {(["colApproval", "colPatient", "colApprovalDate", "colTreatedDate", "colApproved", "colShare", "colStatus", "colActions"] as const).map((k) => (
              <th
                key={k}
                className={`px-3 py-3 text-[10.5px] font-black uppercase tracking-wider text-ink-muted ${k === "colApproved" || k === "colShare" ? "text-end" : "text-start"}`}
              >
                {t(k)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {claims.map((c) => {
            const busy = busyId === c.id;
            const status = STATUS[c.status];
            return (
              <tr key={c.id} id={`claim-${c.id}`} className={`border-t border-line ${highlightId === c.id ? "bg-amber-50" : ""}`}>
                <td className="px-3 py-2.5 text-start font-display text-[13px] font-black text-ink">
                  <bdi dir="ltr">{c.approvalNumber}</bdi>
                </td>
                <td className="px-3 py-2.5">
                  <Link href={`/patients/${c.patientId}`} className="text-[13px] font-black text-ink hover:underline">
                    {c.patientName || c.paperPatientName}
                  </Link>
                  <div className="text-[11px] font-semibold text-ink-faint" dir="ltr">
                    {c.metlife.certificateNumber}/{c.metlife.dependentCode}
                  </div>
                </td>
                <td className="px-3 py-2.5 text-[13px] font-bold tabular-nums text-ink-body">{c.approvalDate}</td>
                <td className="px-3 py-2.5 text-[13px] font-bold tabular-nums text-ink-body">{c.treatedDate ?? "—"}</td>
                <td className="px-3 py-2.5 text-end text-[13px] font-black tabular-nums text-ink">{money(c.totals.approved)}</td>
                <td className="px-3 py-2.5 text-end text-[13px] font-bold tabular-nums text-ink-body">{money(c.totals.patientShare)}</td>
                <td className="px-3 py-2.5">
                  <span className={`inline-block rounded-full border px-2.5 py-0.5 text-[11px] font-black ${status.pill}`}>{t(status.key)}</span>
                  {(() => {
                    // Only when there is something to say: an approval with every service done and
                    // nothing on the calendar is just its status.
                    if (c.status === "cancelled") return null;
                    const p = claimProgress(c, appointments);
                    if (p.done === p.total && p.booked === 0) return null;
                    return (
                      <div className="mt-1 text-[11px] font-semibold tabular-nums text-ink-muted">
                        {t("progress").replace("{done}", String(p.done)).replace("{total}", String(p.total)).replace("{booked}", String(p.booked))}
                      </div>
                    );
                  })()}
                </td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap items-center gap-1">
                    {busy && <Loader2 size={14} className="animate-spin text-ink-muted" />}
                    {(c.status === "approved" || c.status === "cancelled") && (
                      <Action label={t("markTreated")} disabled={busy} onClick={() => patch(c, { status: "treated" })}>
                        <CheckCircle2 size={14} />
                      </Action>
                    )}
                    {(c.status === "treated" || c.status === "sent") && (
                      <Action label={t("markNotTreated")} disabled={busy} onClick={() => patch(c, { status: "approved" })}>
                        <RotateCcw size={14} />
                      </Action>
                    )}
                    {c.status === "treated" && (
                      <Action label={t("markSent")} disabled={busy} onClick={() => patch(c, { status: "sent" })}>
                        <Send size={14} />
                      </Action>
                    )}
                    {(c.status === "treated" || c.status === "sent") && c.totals.patientShare > 0 && !c.shareCollected && (
                      <Action label={`${t("collectShare")} ${money(c.totals.patientShare)}`} disabled={busy} onClick={() => void collect(c)}>
                        <Banknote size={14} />
                      </Action>
                    )}
                    {(c.status === "treated" || c.status === "sent") && Object.keys(c.ledgerIds).length > 0 && !c.insurerPaid && (
                      <Action label={`${t("markInsurerPaid")} ${money(c.totals.approved)}`} disabled={busy} onClick={() => void insurerPaid(c)}>
                        <Landmark size={14} />
                      </Action>
                    )}
                    <Action label={t("openPdf")} disabled={!c.doc.path} onClick={() => openDoc(c)}>
                      <FileText size={14} />
                    </Action>
                    {onEdit && c.status !== "cancelled" && (
                      <Action
                        label={t("edit")}
                        disabled={busy}
                        onClick={() => {
                          void (async () => {
                            if (await sentOk(c)) onEdit(c);
                          })();
                        }}
                      >
                        <Pencil size={14} />
                      </Action>
                    )}
                    <Action label={t("delete")} disabled={busy} onClick={() => remove(c)} danger>
                      <Trash2 size={14} />
                    </Action>
                  </div>
                </td>
              </tr>
            );
          })}
          <tr className="border-t border-line bg-surface-subtle">
            <td colSpan={4} className="px-3 py-3 text-[12px] font-black uppercase tracking-wider text-ink">
              {t("totalRow")} · {claims.length}
            </td>
            <td className="px-3 py-3 text-end font-display text-[15px] font-black tabular-nums text-ink">{money(totals.approved)}</td>
            <td className="px-3 py-3 text-end text-[13px] font-black tabular-nums text-ink-body">{money(totals.share)}</td>
            <td colSpan={2} />
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function Action({ label, onClick, disabled, danger, children }: { label: string; onClick: () => void; disabled?: boolean; danger?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className={`rounded-lg border border-transparent p-1.5 transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
        danger ? "text-ink-muted hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700" : "text-ink-muted hover:border-line hover:bg-surface-subtle hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}
