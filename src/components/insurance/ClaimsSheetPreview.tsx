"use client";

/**
 * "What goes on this sheet?" for an approval insurer (MetLife, NextCare, AXA): the approvals the
 * Excel will print for the dates and the date rule on screen, the ones already sent, and the ones
 * left off with the reason. It reads the very statement the Excel is written from, so the two
 * cannot disagree. Mark all as sent and the Excel are the export bar's own actions, offered here
 * beside the list they act on.
 */

import { useEffect, useMemo } from "react";
import { CheckCircle2, FileSpreadsheet, Loader2, Lock, Send, X } from "lucide-react";
import { useLanguage } from "@/context/LanguageContext";
import Protect from "@/components/Protect";
import { claimStatementName, type InsuranceClaim } from "@/lib/insurance/claims";
import { claimFinishedDate, claimSheetMonth, type SheetDateMode } from "@/lib/insurance/billingMonth";
import { fill, money, monthLabel } from "./sheetFormat";
import { tr } from "./text";

export default function ClaimsSheetPreview({
  payerName,
  from,
  to,
  mode,
  claims,
  printedIds,
  total,
  toSendCount,
  onMarkAllSent,
  marking,
  onExcel,
  exporting,
  onClose,
}: {
  payerName: string;
  from: string;
  to: string;
  mode: SheetDateMode;
  /** The approvals on screen (already picked by the dates and the date rule). */
  claims: InsuranceClaim[];
  /** The approvals the statement prints. */
  printedIds: ReadonlySet<string>;
  /** The statement's own total. */
  total: number;
  toSendCount: number;
  onMarkAllSent: () => void;
  marking: boolean;
  onExcel: () => void;
  exporting: boolean;
  onClose: () => void;
}) {
  const { language, isRTL } = useLanguage();
  const ar = language === "ar";
  const t = useMemo(() => tr(ar), [ar]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const printed = claims.filter((c) => printedIds.has(c.id));
  const willSend = printed.filter((c) => c.status !== "sent");
  const alreadySent = printed.filter((c) => c.status === "sent");
  const leftOff = claims.filter((c) => !printedIds.has(c.id));

  const why = (c: InsuranceClaim): string => {
    if (c.status === "cancelled") return t("apWhyCancelled");
    if (c.status === "approved") return t("apWhyNotTreated");
    if (mode === "finish") {
      const month = claimSheetMonth(c);
      if (month === null) return t("apWhyNotFinished");
      if (month < from.slice(0, 7) || month > to.slice(0, 7)) return fill(t("apWhyOtherMonth"), { month: monthLabel(month, ar) });
    }
    return t("apWhyOutside");
  };

  const row = (c: InsuranceClaim, icon: React.ReactNode, note?: React.ReactNode) => (
    <li key={c.id} className="flex items-center gap-3 px-4 py-3">
      {icon}
      <div className="min-w-0 flex-1">
        <p className="text-[14px] font-bold text-ink">{claimStatementName(c) || "—"}</p>
        <p className="mt-0.5 text-[12px] text-ink-muted">
          <bdi dir="ltr">{c.approvalNumber}</bdi>
          {note}
        </p>
      </div>
      <span className="font-figure text-[15px] font-black tabular-nums text-ink">{money(c.totals.approved, ar)}</span>
    </li>
  );

  const unfinishedTag = (c: InsuranceClaim) =>
    claimFinishedDate(c) === null ? (
      <span className="ms-2 inline-flex rounded-full border border-amber-200 bg-amber-50 px-1.5 text-[10.5px] font-bold text-amber-800">{t("pvNotFinishedTag")}</span>
    ) : null;

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-slate-900/50 px-4 py-10 backdrop-blur-sm sm:py-16" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("pvTitle")}
        dir={isRTL ? "rtl" : "ltr"}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-2xl overflow-hidden rounded-3xl bg-surface shadow-2xl"
      >
        <div className="bg-ink-slab px-6 py-5 text-white">
          <div className="flex items-start gap-3">
            <p className="flex-1 text-[11px] font-black uppercase tracking-wider text-white/55">
              {payerName} · <span dir="ltr">{from} → {to}</span> · {t(mode === "finish" ? "dateModeFinish" : "dateModeApproval")}
            </p>
            <button type="button" onClick={onClose} aria-label={t("dwClose")} className="-m-2 grid size-10 place-items-center rounded-full text-white/70 hover:text-white">
              <X size={18} />
            </button>
          </div>
          <div className="mt-2 flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <h2 className="flex-1 font-display text-3xl font-extrabold">{fill(t("apPreviewApprovals"), { n: money(printed.length, ar) })}</h2>
            <span className="font-figure text-3xl font-black">
              {money(total, ar)} <span className="text-[13px] font-bold text-white/55">{ar ? "ج.م" : "EGP"}</span>
            </span>
          </div>
        </div>

        <div className="flex flex-col gap-5 px-6 py-5">
          <div>
            <p className="mb-2 text-[11px] font-black uppercase tracking-wider text-ink">{t("pvWillSend")}</p>
            {willSend.length === 0 ? (
              <p className="rounded-2xl border border-line bg-surface-subtle px-4 py-3 text-[13px] font-semibold text-ink-muted">{t("pvNobody")}</p>
            ) : (
              <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line">
                {willSend.map((c) => row(c, <CheckCircle2 size={16} className="shrink-0 text-ink" aria-hidden="true" />, unfinishedTag(c)))}
              </ul>
            )}
          </div>

          {alreadySent.length > 0 && (
            <div>
              <p className="mb-2 text-[11px] font-black uppercase tracking-wider text-ink-muted">{t("apPreviewSent")}</p>
              <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface-subtle">
                {alreadySent.map((c) => row(c, <Lock size={15} className="shrink-0 text-ink-muted" aria-hidden="true" />))}
              </ul>
            </div>
          )}

          {leftOff.length > 0 && (
            <div>
              <p className="mb-2 text-[11px] font-black uppercase tracking-wider text-ink-muted">{t("pvNotOn")}</p>
              <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface-subtle">
                {leftOff.map((c) => (
                  <li key={c.id} className="flex items-center gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-[13.5px] font-bold text-ink-body">
                        {claimStatementName(c) || "—"} · <bdi dir="ltr" className="font-figure font-semibold text-ink-muted">{c.approvalNumber}</bdi>
                      </p>
                      <p className="mt-0.5 text-[12px] text-ink-muted">{why(c)}</p>
                    </div>
                    <span className="font-figure text-[14px] font-bold tabular-nums text-ink-muted">{money(c.totals.approved, ar)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-line px-6 py-4">
          <button type="button" onClick={onClose} className="min-h-11 rounded-full border border-line px-5 text-[13.5px] font-bold text-ink hover:bg-surface-subtle">
            {t("dwClose")}
          </button>
          <div className="flex-1" />
          <Protect permission="insurance.send">
            <button
              type="button"
              onClick={onMarkAllSent}
              disabled={marking || toSendCount === 0}
              className="inline-flex min-h-11 items-center gap-2 rounded-full border border-ink px-5 text-[13.5px] font-bold text-ink hover:bg-surface-subtle disabled:opacity-40"
            >
              {marking ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
              {t("markAllSent")}
              {toSendCount ? ` (${toSendCount})` : ""}
            </button>
          </Protect>
          <button
            type="button"
            onClick={onExcel}
            disabled={exporting || printed.length === 0}
            className="inline-flex min-h-11 items-center gap-2 rounded-full bg-accent px-5 text-[13.5px] font-black text-ink-on-accent hover:bg-accent-strong disabled:opacity-40"
          >
            {exporting ? <Loader2 size={15} className="animate-spin" /> : <FileSpreadsheet size={15} />}
            {t("pvExcel")}
          </button>
        </div>
      </div>
    </div>
  );
}
