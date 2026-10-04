"use client";

/**
 * The range, the sheet's header lines, and the monthly Excel to MetLife.
 *
 * The statement is `buildMetlifeStatement` over the claims on screen: approvals in [from, to] that are
 * treated or sent. What it leaves out is said above the button — approvals not yet marked treated,
 * services not Completed yet, and service codes with no sheet wording (printed in the paper's English
 * instead). The workbook writer is
 * imported only when the button is pressed: it carries 2.7 MB of xlsx-js-style.
 *
 * "Mark all as sent" patches each treated claim in the range, one after another, so a failure halfway
 * leaves a clear line between what was marked and what was not.
 */

import { useMemo, useState } from "react";
import { FileSpreadsheet, Loader2, Send } from "lucide-react";
import { useLanguage } from "@/context/LanguageContext";
import { useUI } from "@/context/UIContext";
import type { InsuranceClaim } from "@/lib/insurance/claims";
import { buildMetlifeStatement } from "@/lib/insuranceStatementMetlife";
import type { StatementHeader } from "@/lib/insuranceStatementXlsx";
import type { ClaimPatch } from "./api";
import { tr } from "./text";

const money = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });

export default function ClaimsExportBar({
  claims,
  from,
  to,
  setRange,
  header,
  setHeader,
  wording,
  onPatch,
}: {
  claims: InsuranceClaim[];
  from: string;
  to: string;
  setRange: (range: { from: string; to: string }) => void;
  header: StatementHeader;
  setHeader: (key: keyof StatementHeader, value: string) => void;
  /** Code → the clinic's sheet wording (its saved list over the defaults). */
  wording: Record<string, string>;
  /** Resolves true when the change was saved. */
  onPatch: (claim: InsuranceClaim, patch: ClaimPatch) => Promise<boolean>;
}) {
  const { language } = useLanguage();
  const isAr = language === "ar";
  const t = tr(isAr);
  const { confirm, showToast } = useUI();

  const inverted = from > to;
  const statement = useMemo(() => buildMetlifeStatement({ claims, from, to, wording }), [claims, from, to, wording]);
  // Only what is actually on the sheet can be marked sent: a treated claim whose services are all
  // still planned or ongoing prints nothing and must not be stamped as sent to the insurer.
  const toSend = useMemo(() => {
    if (inverted) return [];
    const printed = new Set(statement.cases.map((c) => c.approvalNumber));
    return claims.filter((c) => c.status === "treated" && c.approvalDate >= from && c.approvalDate <= to && printed.has(c.approvalNumber));
  }, [claims, from, to, inverted, statement.cases]);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [marking, setMarking] = useState(false);

  const download = async () => {
    if (busy || inverted || statement.cases.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const [{ default: XLSX }, { metlifeStatementToWorkbook }] = await Promise.all([
        import("xlsx-js-style"),
        import("@/lib/insuranceStatementMetlifeXlsx"),
      ]);
      XLSX.writeFile(metlifeStatementToWorkbook(statement, header), `statement-metlife-${from}-${to}.xlsx`, { compression: true });
    } catch (err) {
      console.error("MetLife statement failed", err);
      setError(t("excelFailed"));
    } finally {
      setBusy(false);
    }
  };

  const markAllSent = async () => {
    if (marking || toSend.length === 0) return;
    const ok = await confirm(t("markAllSentConfirm").replace("{n}", String(toSend.length)), { confirmLabel: t("markAllSent") });
    if (!ok) return;
    setMarking(true);
    let failed = 0;
    try {
      for (const claim of toSend) {
        if (!(await onPatch(claim, { status: "sent" }))) failed += 1;
      }
    } finally {
      setMarking(false);
    }
    showToast(failed ? t("markSentPartial") : t("markedSent"), failed ? "error" : "success");
  };

  const inputClass =
    "w-full rounded-xl border border-line bg-surface-subtle px-3 py-2 text-sm font-bold text-ink outline-none transition-colors focus:border-ink focus:bg-surface";

  return (
    <section className="space-y-3 rounded-3xl border border-line bg-surface p-5" data-tour="insurance-export">
      <div className="grid gap-4 lg:grid-cols-[11rem_11rem_1fr]">
        <label className="block">
          <span className="mb-1 block text-[10.5px] font-black uppercase tracking-wider text-ink-muted">{t("from")}</span>
          <input type="date" value={from} onChange={(e) => e.target.value && setRange({ from: e.target.value, to })} className={inputClass} dir="ltr" />
        </label>
        <label className="block">
          <span className="mb-1 block text-[10.5px] font-black uppercase tracking-wider text-ink-muted">{t("to")}</span>
          <input type="date" value={to} onChange={(e) => e.target.value && setRange({ from, to: e.target.value })} className={inputClass} dir="ltr" />
        </label>
        <div>
          <span className="mb-1 block text-[10.5px] font-black uppercase tracking-wider text-ink-muted">{t("header")}</span>
          <div className="grid gap-2">
            <textarea value={header.line1} onChange={(e) => setHeader("line1", e.target.value)} placeholder={t("line1")} rows={2} className={inputClass} />
            <input value={header.line2} onChange={(e) => setHeader("line2", e.target.value)} placeholder={t("line2")} className={inputClass} />
            <input value={header.line3} onChange={(e) => setHeader("line3", e.target.value)} placeholder={t("line3")} className={inputClass} />
          </div>
          <p className="mt-1 text-[11.5px] font-semibold text-ink-muted">{t("headerHint")}</p>
        </div>
      </div>

      {inverted && <p className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-[13px] font-bold text-rose-800">{t("rangeInverted")}</p>}
      {!inverted && statement.heldBack > 0 && (
        <p className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-[13px] font-bold text-amber-900">
          {statement.heldBack} {t("heldBack")}
        </p>
      )}
      {!inverted && statement.pendingLines > 0 && (
        <p className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-[13px] font-bold text-amber-900">
          {t("pendingLines").replace("{n}", String(statement.pendingLines))}
        </p>
      )}
      {!inverted && statement.missingWording.length > 0 && (
        <p className="rounded-2xl border border-line bg-surface-subtle px-4 py-2.5 text-[13px] font-bold text-ink-body">
          {t("missingWording")}{" "}
          <span className="font-display font-black text-ink" dir="ltr">
            {statement.missingWording.join(", ")}
          </span>
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
        <p className="text-[13px] font-bold text-ink-body">
          <span className="font-display text-lg font-black tabular-nums text-ink">{inverted ? 0 : statement.cases.length}</span> {t("cases")} {t("onSheet")} ·{" "}
          {t("approvedSum")} <span className="font-display font-black tabular-nums text-ink">{money(inverted ? 0 : statement.total)}</span>
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={markAllSent}
            disabled={marking || toSend.length === 0}
            className="inline-flex items-center gap-1.5 rounded-xl border border-line px-3 py-2 text-[12.5px] font-black text-ink-body transition-colors hover:bg-surface-subtle hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
          >
            {marking ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            {marking ? t("markingSent") : `${t("markAllSent")}${toSend.length ? ` (${toSend.length})` : ""}`}
          </button>
          <button
            type="button"
            onClick={download}
            disabled={busy || inverted || statement.cases.length === 0}
            data-tour="insurance-metlife-excel"
            className="inline-flex items-center gap-1.5 rounded-xl bg-accent px-4 py-2 text-[12.5px] font-black text-ink-on-accent transition-colors hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <FileSpreadsheet size={14} />}
            {busy ? t("preparing") : t("excel")}
          </button>
        </div>
      </div>
      {error && <p className="text-[12.5px] font-bold text-rose-700">{error}</p>}
    </section>
  );
}
