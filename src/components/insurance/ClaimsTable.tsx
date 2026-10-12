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
import { useBranchForMoney } from "@/lib/useBranchForMoney";
import { claimStatementName, type ClaimStatus, type InsuranceClaim } from "@/lib/insurance/claims";
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
  /** Resolves true when the change is saved; the page reports a failure itself. `branchId` rides along when money is taken. */
  onPatch: (claim: InsuranceClaim, patch: ClaimPatch, branchId?: string) => Promise<boolean>;
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
  const { requireBranchForMoney, picker: branchPicker } = useBranchForMoney();
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
    // The "already sent" warning comes before the branch pick, so nobody picks and is then warned.
    if (!(await sentOk(claim))) return;
    // Cash taken under "All branches" is told which branch it belongs to first.
    const branchId = await requireBranchForMoney();
    if (branchId === null) return;
    await run(claim, () => onPatch(claim, { collectShare: true }, branchId || undefined));
  };

  const insurerPaid = async (claim: InsuranceClaim) => {
    const question = t("confirmInsurerPaid")
      .replace("{amount}", money(claim.totals.approved))
      .replace("{insurer}", payerName || claim.payerId)
      .replace("{number}", claim.approvalNumber);
    if (!(await confirm(question, { confirmLabel: t("markInsurerPaid") }))) return;
    if (!(await sentOk(claim))) return;
    const branchId = await requireBranchForMoney();
    if (branchId === null) return;
    await run(claim, () => onPatch(claim, { insurerPaid: true }, branchId || undefined));
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

  /** The row's buttons; `big` gives each a 40px target for the phone cards. */
  const renderActions = (c: InsuranceClaim, big = false) => {
    const busy = busyId === c.id;
    const s = big ? 18 : 14;
    // Phones: a labelled grid, four to a row, so every action says what it does without a long press.
    return (
      <div className={big ? "grid grid-cols-4 gap-1" : "flex flex-wrap items-center gap-1"}>
        {busy && <Loader2 size={s} className={`animate-spin text-ink-muted ${big ? "col-span-4 mx-auto" : ""}`} />}
        {(c.status === "approved" || c.status === "cancelled") && (
          <Action big={big} short={t("shortTreated")} label={t("markTreated")} disabled={busy} onClick={() => patch(c, { status: "treated" })}>
            <CheckCircle2 size={s} />
          </Action>
        )}
        {(c.status === "treated" || c.status === "sent") && (
          <Action big={big} short={t("shortNotTreated")} label={t("markNotTreated")} disabled={busy} onClick={() => patch(c, { status: "approved" })}>
            <RotateCcw size={s} />
          </Action>
        )}
        {c.status === "treated" && (
          <Action big={big} short={t("shortSent")} label={t("markSent")} disabled={busy} onClick={() => patch(c, { status: "sent" })}>
            <Send size={s} />
          </Action>
        )}
        {(c.status === "treated" || c.status === "sent") && c.totals.patientShare > 0 && !c.shareCollected && (
          <Action big={big} short={t("shortCollect")} label={`${t("collectShare")} ${money(c.totals.patientShare)}`} disabled={busy} onClick={() => void collect(c)}>
            <Banknote size={s} />
          </Action>
        )}
        {(c.status === "treated" || c.status === "sent") && Object.keys(c.ledgerIds).length > 0 && !c.insurerPaid && (
          <Action big={big} short={t("shortInsurerPaid")} label={`${t("markInsurerPaid")} ${money(c.totals.approved)}`} disabled={busy} onClick={() => void insurerPaid(c)}>
            <Landmark size={s} />
          </Action>
        )}
        <Action big={big} short={t("shortDoc")} label={t("openPdf")} disabled={!c.doc.path} onClick={() => openDoc(c)}>
          <FileText size={s} />
        </Action>
        {onEdit && c.status !== "cancelled" && (
          <Action
            big={big}
            short={t("edit")}
            label={t("edit")}
            disabled={busy}
            onClick={() => {
              void (async () => {
                if (await sentOk(c)) onEdit(c);
              })();
            }}
          >
            <Pencil size={s} />
          </Action>
        )}
        <Action big={big} short={t("delete")} label={t("delete")} disabled={busy} onClick={() => remove(c)} danger>
          <Trash2 size={s} />
        </Action>
      </div>
    );
  };

  const progressLine = (c: InsuranceClaim) => {
    // Only when there is something to say: an approval with every service done and
    // nothing on the calendar is just its status.
    if (c.status === "cancelled") return null;
    const p = claimProgress(c, appointments);
    if (p.done === p.total && p.booked === 0) return null;
    return t("progress").replace("{done}", String(p.done)).replace("{total}", String(p.total)).replace("{booked}", String(p.booked));
  };

  return (
    <>
    {branchPicker}
    {/* Phones: one card per approval. The 60rem table pushed every amount off a 375px screen. */}
    <div className="space-y-3 md:hidden">
      {claims.map((c) => {
        const status = STATUS[c.status];
        const progress = progressLine(c);
        return (
          <div
            key={c.id}
            id={`claim-m-${c.id}`}
            className={`rounded-2xl border p-4 ${highlightId === c.id ? "border-amber-300 bg-amber-50" : "border-line bg-surface"}`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="font-display text-[13px] font-black text-ink">
                  <bdi dir="ltr">{c.approvalNumber}</bdi>
                </div>
                <Link href={`/patients/${c.patientId}?tab=insurance`} className="block truncate text-[14px] font-black text-ink hover:underline">
                  {claimStatementName(c)}
                </Link>
                <div className="text-[11px] font-semibold text-ink-faint" dir="ltr">
                  {c.insurer === "nextcare" ? c.metlife.certificateNumber : `${c.metlife.certificateNumber}/${c.metlife.dependentCode}`}
                </div>
              </div>
              <div className="shrink-0 text-end">
                <div className="text-[10px] font-black uppercase tracking-wider text-ink-muted">{t("colApproved")}</div>
                <div className="font-display text-lg font-black tabular-nums leading-tight text-ink">{money(c.totals.approved)}</div>
                {c.totals.patientShare > 0 && (
                  <div className="text-[11px] font-bold tabular-nums text-ink-body">
                    {t("colShare")}: {money(c.totals.patientShare)}
                  </div>
                )}
              </div>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-bold text-ink-body">
              <span className={`inline-block rounded-full border px-2.5 py-0.5 text-[11px] font-black ${status.pill}`}>{t(status.key)}</span>
              <span className="tabular-nums">
                {t("colApprovalDate")}: {c.approvalDate}
              </span>
              {c.treatedDate && (
                <span className="tabular-nums">
                  {t("colTreatedDate")}: {c.treatedDate}
                </span>
              )}
            </div>
            {progress && <div className="mt-1 text-[11px] font-semibold tabular-nums text-ink-muted">{progress}</div>}
            <div className="mt-2 border-t border-line pt-2">{renderActions(c, true)}</div>
          </div>
        );
      })}
      <div className="flex items-center justify-between rounded-2xl border border-line bg-surface-subtle px-4 py-3">
        <span className="text-[12px] font-black uppercase tracking-wider text-ink">
          {t("totalRow")} · {claims.length}
        </span>
        <span className="text-end">
          <span className="block font-display text-[15px] font-black tabular-nums text-ink">{money(totals.approved)}</span>
          {totals.share > 0 && <span className="block text-[11px] font-bold tabular-nums text-ink-body">{t("colShare")}: {money(totals.share)}</span>}
        </span>
      </div>
    </div>
    <div className="hidden overflow-x-auto rounded-3xl border border-line bg-surface md:block">
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
            const status = STATUS[c.status];
            return (
              <tr key={c.id} id={`claim-${c.id}`} className={`border-t border-line ${highlightId === c.id ? "bg-amber-50" : ""}`}>
                <td className="px-3 py-2.5 text-start font-display text-[13px] font-black text-ink">
                  <bdi dir="ltr">{c.approvalNumber}</bdi>
                </td>
                <td className="px-3 py-2.5">
                  <Link href={`/patients/${c.patientId}?tab=insurance`} className="text-[13px] font-black text-ink hover:underline">
                    {claimStatementName(c)}
                  </Link>
                  <div className="text-[11px] font-semibold text-ink-faint" dir="ltr">
                    {c.insurer === "metlife" ? `${c.metlife.certificateNumber}/${c.metlife.dependentCode}` : c.metlife.certificateNumber}
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
                <td className="px-3 py-2">{renderActions(c)}</td>
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
    </>
  );
}

function Action({ label, short, onClick, disabled, danger, big, children }: { label: string; short?: string; onClick: () => void; disabled?: boolean; danger?: boolean; big?: boolean; children: React.ReactNode }) {
  if (big && short) {
    // Phone card: the icon with its word under it; the full wording stays the button's name.
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        title={label}
        aria-label={label}
        className={`flex min-h-14 min-w-0 flex-col items-center justify-center gap-1 rounded-xl border border-transparent px-1 py-1.5 transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
          danger ? "text-ink-muted hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700" : "text-ink-body hover:border-line hover:bg-surface-subtle hover:text-ink"
        }`}
      >
        {children}
        <span aria-hidden className="w-full text-center text-[10.5px] font-bold leading-tight">{short}</span>
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className={`${big ? "inline-flex h-10 w-10 items-center justify-center rounded-xl" : "rounded-lg p-1.5"} border border-transparent transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
        danger ? "text-ink-muted hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700" : "text-ink-muted hover:border-line hover:bg-surface-subtle hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}
