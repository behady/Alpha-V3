"use client";

/**
 * "What goes on this sheet?" — the pop-up behind the Insurance page's button, for a contract
 * company (GASCO): for each month the picked dates touch, who will be sent (or was sent) and for
 * how much, who is not on it and why, and the month's Mark as sent / Mark not sent. The Excel
 * button writes exactly these lists (the same `companyStatement` call feeds both).
 */

import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, FileSpreadsheet, Loader2, Lock, Undo2, X } from "lucide-react";
import { useLanguage } from "@/context/LanguageContext";
import { useUI } from "@/context/UIContext";
import Protect from "@/components/Protect";
import { statementLineText } from "@/lib/insuranceStatement";
import { COMPANY_SHEET_START, sendRefusal, unsendRefusal, type HeldReason, type MonthSheet } from "@/lib/insurance/companySheet";
import { toYmd } from "@/lib/reports/patientStats";
import { cairoToday, sendCompanySheet, unsendCompanySheet } from "./api";
import { dayLabel, fill, money, monthLabel } from "./sheetFormat";
import { tr, type TextKey } from "./text";

const REFUSAL: Record<string, TextKey> = {
  sent_locked: "sheetToastSentLocked",
  already_sent: "sheetToastSentLocked",
  empty: "sheetToastEmpty",
  earlier_open: "sheetToastEarlierOpen",
  later_sent: "sheetToastLaterSent",
};

const WHY: Record<HeldReason, TextKey> = {
  not_finished: "pvWhyNotFinished",
  moved: "pvWhyMoved",
};

export default function CompanySheetPreview({
  clinicId,
  payerId,
  payerName,
  range,
  sheets,
  allBranchSheets,
  scoped,
  onExcel,
  exporting,
  excelReady,
  onClose,
}: {
  clinicId: string;
  payerId: string;
  payerName: string;
  range: { start: string; end: string };
  /** The months the dates touch (from the start month on), for the branch on screen. */
  sheets: MonthSheet[];
  /** The same walk for every branch: Mark as sent freezes the whole company month, so it is judged on these. */
  allBranchSheets: MonthSheet[];
  scoped: boolean;
  onExcel: () => void;
  exporting: boolean;
  excelReady: boolean;
  onClose: () => void;
}) {
  const { language, isRTL } = useLanguage();
  const ar = language === "ar";
  const t = useMemo(() => tr(ar), [ar]);
  const { confirm, showToast } = useUI();
  const [busy, setBusy] = useState<string | null>(null);
  const thisMonth = cairoToday().slice(0, 7);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const patients = sheets.reduce((n, s) => n + s.printed.length, 0);
  const total = sheets.reduce((n, s) => n + s.printed.reduce((m, p) => m + p.value, 0), 0);

  const act = async (month: string, call: () => Promise<string | null>) => {
    if (busy) return;
    setBusy(month);
    try {
      const refused = await call();
      if (refused) showToast(t(REFUSAL[refused] ?? "sheetToastFailed"), "error");
    } finally {
      setBusy(null);
    }
  };

  const send = async (month: string) => {
    const ok = await confirm(fill(t("sheetConfirm"), { month: monthLabel(month, ar) }) + (scoped ? " " + t("sheetConfirmAllBranches") : ""), {
      title: t("sheetMarkSent"),
      confirmLabel: t("sheetMarkSent"),
    });
    if (ok) await act(month, () => sendCompanySheet(clinicId, payerId, month));
  };

  const detail = (charges: MonthSheet["printed"][number]["charges"]) =>
    [...charges]
      .sort((a, b) => toYmd(a.date).localeCompare(toYmd(b.date)))
      .map((c) => statementLineText(c))
      .filter(Boolean)
      .join(" + ");

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
              {payerName} · <span dir="ltr">{range.start} → {range.end}</span>
            </p>
            <button type="button" onClick={onClose} aria-label={t("dwClose")} className="-m-2 grid size-10 place-items-center rounded-full text-white/70 hover:text-white">
              <X size={18} />
            </button>
          </div>
          <div className="mt-2 flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <h2 className="flex-1 font-display text-3xl font-extrabold">{fill(t("pvPatients"), { n: money(patients, ar) })}</h2>
            <span className="font-figure text-3xl font-black">
              {money(total, ar)} <span className="text-[13px] font-bold text-white/55">{ar ? "ج.م" : "EGP"}</span>
            </span>
          </div>
        </div>

        <div className="flex flex-col gap-6 px-6 py-5">
          {range.start < `${COMPANY_SHEET_START}-01` && <p className="text-[12.5px] font-semibold text-ink-muted">{t("pvOldWay")}</p>}

          {sheets.map((sheet) => {
            const isSent = sheet.sent !== null;
            // Offered whenever it could apply; a refusal (an earlier month still open, a later one sent) says why.
            const refusedSend = sendRefusal(allBranchSheets, sheet.month);
            const canSend = !isSent && sheet.month <= thisMonth && refusedSend !== "empty" && refusedSend !== "already_sent";
            const canUnsend = isSent && unsendRefusal(allBranchSheets, sheet.month) !== "not_sent";
            return (
              <section key={sheet.month} className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  {isSent && <Lock size={14} className="text-ink-muted" aria-hidden="true" />}
                  <h3 className="font-display text-lg font-extrabold text-ink">{fill(t("sheetTitle"), { month: monthLabel(sheet.month, ar) })}</h3>
                  <span className="text-[12px] font-semibold text-ink-muted">
                    {isSent ? fill(t("pvSentSub"), { date: dayLabel(sheet.sent?.sentAt ?? "", ar) || "—" }) : t("pvNotSentSub")}
                  </span>
                </div>

                <div>
                  <p className="mb-2 text-[11px] font-black uppercase tracking-wider text-ink">{isSent ? t("pvSentList") : t("pvWillSend")}</p>
                  {sheet.printed.length === 0 ? (
                    <p className="rounded-2xl border border-line bg-surface-subtle px-4 py-3 text-[13px] font-semibold text-ink-muted">{t("pvNobody")}</p>
                  ) : (
                    <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line">
                      {sheet.printed.map((p) => (
                        <li key={p.patientId} className="flex items-center gap-3 px-4 py-3">
                          <CheckCircle2 size={16} className="shrink-0 text-ink" aria-hidden="true" />
                          <div className="min-w-0 flex-1">
                            <p className="text-[14px] font-bold text-ink">{p.patientName || "—"}</p>
                            <p className="mt-0.5 text-[12px] text-ink-muted">{detail(p.charges)}</p>
                          </div>
                          <span className="font-figure text-[15px] font-black text-ink">{money(p.value, ar)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {!isSent && sheet.held.length > 0 && (
                  <div>
                    <p className="mb-2 text-[11px] font-black uppercase tracking-wider text-ink-muted">{t("pvNotOn")}</p>
                    <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface-subtle">
                      {sheet.held.map((p) => (
                        <li key={p.patientId} className="flex items-center gap-3 px-4 py-3">
                          <div className="min-w-0 flex-1">
                            <p className="text-[13.5px] font-bold text-ink-body">{p.patientName || "—"}</p>
                            <p className="mt-0.5 text-[12px] text-ink-muted">{t(WHY[p.reason])}</p>
                          </div>
                          <span className="font-figure text-[14px] font-bold text-ink-muted">{money(p.value, ar)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <Protect permission="patients.edit">
                  <div className="flex flex-wrap justify-end gap-2">
                    {canSend && (
                      <button
                        type="button"
                        disabled={busy !== null}
                        onClick={() => void send(sheet.month)}
                        className="inline-flex min-h-11 items-center gap-2 rounded-full bg-accent px-5 text-[13.5px] font-black text-ink-on-accent hover:bg-accent-strong disabled:opacity-50"
                      >
                        {busy === sheet.month ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />}
                        {t("sheetMarkSent")}
                      </button>
                    )}
                    {canUnsend && (
                      <button
                        type="button"
                        disabled={busy !== null}
                        onClick={() => void act(sheet.month, () => unsendCompanySheet(clinicId, payerId, sheet.month))}
                        className="inline-flex min-h-11 items-center gap-2 rounded-full border border-ink px-5 text-[13.5px] font-bold text-ink hover:bg-surface-subtle disabled:opacity-50"
                      >
                        {busy === sheet.month ? <Loader2 size={15} className="animate-spin" /> : <Undo2 size={15} />}
                        {t("pvMarkNotSent")}
                      </button>
                    )}
                  </div>
                </Protect>
              </section>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-line px-6 py-4">
          <button type="button" onClick={onClose} className="min-h-11 rounded-full border border-line px-5 text-[13.5px] font-bold text-ink hover:bg-surface-subtle">
            {t("dwClose")}
          </button>
          <div className="flex-1" />
          <button
            type="button"
            onClick={onExcel}
            disabled={!excelReady || exporting}
            className="inline-flex min-h-11 items-center gap-2 rounded-full border border-ink px-5 text-[13.5px] font-bold text-ink hover:bg-surface-subtle disabled:opacity-40"
          >
            {exporting ? <Loader2 size={15} className="animate-spin" /> : <FileSpreadsheet size={15} />}
            {t("pvExcel")}
          </button>
        </div>
      </div>
    </div>
  );
}
