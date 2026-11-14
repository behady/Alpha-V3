"use client";

/**
 * The company's monthly sheet on screen, one block per month: who prints this month, who waits and
 * why, a "This month / Next month" switch per patient, and Mark as sent (which freezes the month).
 *
 * The lists come ready-made from `companyStatement` (the same call that feeds the Excel report), so
 * what is shown here is exactly what the report prints. Every write goes through the company-sheet
 * route; the page's live listeners then redraw this panel, so nothing here keeps its own copy.
 * A sent month is read-only until it is marked not sent.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { CheckCircle2, Loader2, Undo2 } from "lucide-react";
import { useLanguage } from "@/context/LanguageContext";
import { useUI } from "@/context/UIContext";
import Protect from "@/components/Protect";
import { statementLineText } from "@/lib/insuranceStatement";
import type { HeldPatient, MonthSheet, SheetChoice, SheetPatient } from "@/lib/insurance/companySheet";
import { markCompanySheet, sendCompanySheet, unsendCompanySheet } from "./api";
import { tr, type TextKey } from "./text";

const REFUSAL_TEXT: Record<string, TextKey> = {
  sent_locked: "sheetToastSentLocked",
  already_sent: "sheetToastSentLocked",
  not_finished: "sheetToastNotFinished",
  empty: "sheetToastEmpty",
  earlier_open: "sheetToastEarlierOpen",
  later_sent: "sheetToastLaterSent",
};

const HELD_TEXT: Record<HeldPatient["reason"], TextKey> = {
  not_finished: "sheetNotFinished",
  finished_late: "sheetFinishedLate",
  moved: "sheetMoved",
};

export default function CompanySheetPanel({
  clinicId,
  payerId,
  sheets,
  allBranchSheets,
  scoped,
}: {
  clinicId: string;
  payerId: string;
  payerName: string;
  sheets: MonthSheet[];
  /** The same months for every branch: Mark as sent freezes the whole company month, so it is judged on these. */
  allBranchSheets?: MonthSheet[];
  /** A single branch is on screen, so the list above is not the whole month. */
  scoped?: boolean;
}) {
  const { language } = useLanguage();
  const ar = language === "ar";
  const t = useMemo(() => tr(ar), [ar]);
  const { confirm, showToast } = useUI();
  /** What is being saved: a month's button or a patient's switch. Everything is held while one is in flight. */
  const [busy, setBusy] = useState<string | null>(null);

  const fmt = (n: number) => n.toLocaleString(ar ? "ar-EG" : "en-US");
  const monthName = (month: string) =>
    new Intl.DateTimeFormat(ar ? "ar-EG" : "en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${month}-01T00:00:00Z`));

  const finish = (reason: string | null) => {
    if (reason) showToast(t(REFUSAL_TEXT[reason] ?? "sheetToastFailed"), "error");
  };

  const choose = async (month: string, patientId: string, choice: SheetChoice | null) => {
    if (busy) return;
    setBusy(`${month}|${patientId}`);
    try {
      finish(await markCompanySheet(clinicId, payerId, patientId, month, choice));
    } finally {
      setBusy(null);
    }
  };

  const send = async (month: string) => {
    if (busy) return;
    const ok = await confirm(t("sheetConfirm").replace("{month}", monthName(month)) + (scoped ? " " + t("sheetConfirmAllBranches") : ""), {
      title: t("sheetMarkSent"),
      confirmLabel: t("sheetMarkSent"),
    });
    if (!ok) return;
    setBusy(month);
    try {
      finish(await sendCompanySheet(clinicId, payerId, month));
    } finally {
      setBusy(null);
    }
  };

  const unsend = async (month: string) => {
    if (busy) return;
    setBusy(month);
    try {
      finish(await unsendCompanySheet(clinicId, payerId, month));
    } finally {
      setBusy(null);
    }
  };

  const seg = (active: boolean) =>
    `max-lg:min-h-10 px-3 py-1 text-[11px] font-black whitespace-nowrap transition-colors disabled:opacity-40 ${
      active ? "bg-ink text-white" : "bg-surface text-ink-body hover:bg-slate-50"
    }`;

  /** One patient: name, treatments, value, and the switch. `reason` only for a waiting patient. */
  const row = (sheet: MonthSheet, p: SheetPatient, held: HeldPatient | null) => {
    const locked = sheet.sent !== null;
    const rowBusy = busy === `${sheet.month}|${p.patientId}`;
    const onThisMonth = held === null;
    // Not finished: no switch can override it, so none is offered.
    const switchable = held === null || held.reason !== "not_finished";
    const treatments = p.charges.map((c) => statementLineText(c)).join(" + ");
    return (
      <li key={p.patientId} className="flex flex-col gap-2 py-3 lg:flex-row lg:items-center lg:gap-4">
        <div className="min-w-0 lg:w-56 shrink-0 font-semibold text-ink">
          {p.patientId ? (
            <Link href={`/patients/${p.patientId}`} className="hover:underline">
              {p.patientName || "—"}
            </Link>
          ) : (
            p.patientName || "—"
          )}
        </div>
        <p className="min-w-0 flex-1 text-sm text-ink-body">{treatments || "—"}</p>
        {held && (
          <span className="inline-flex w-fit rounded-full bg-amber-50 text-amber-800 border border-amber-100 px-2.5 py-0.5 text-[11px] font-bold whitespace-nowrap">
            {t(HELD_TEXT[held.reason])}
          </span>
        )}
        <span className="font-figure text-sm font-black text-ink lg:w-24 lg:text-end">{fmt(p.value)}</span>
        <Protect permission="patients.edit">
          <div className="flex items-center gap-2 lg:w-60 lg:justify-end">
            {switchable && (
              <div className="inline-flex overflow-hidden rounded-full border border-line" role="group">
                <button
                  type="button"
                  disabled={locked || busy !== null}
                  aria-pressed={onThisMonth}
                  onClick={() => {
                    if (onThisMonth) return;
                    void choose(sheet.month, p.patientId, "include");
                  }}
                  className={seg(onThisMonth)}
                >
                  {t("sheetThisMonth")}
                </button>
                <button
                  type="button"
                  disabled={locked || busy !== null}
                  aria-pressed={!onThisMonth}
                  onClick={() => {
                    if (!onThisMonth) return;
                    void choose(sheet.month, p.patientId, "hold");
                  }}
                  className={seg(!onThisMonth)}
                >
                  {t("sheetNextMonth")}
                </button>
              </div>
            )}
            {switchable && p.choice !== null && (
              <button
                type="button"
                disabled={locked || busy !== null}
                onClick={() => void choose(sheet.month, p.patientId, null)}
                className="max-lg:min-h-10 text-[11px] font-bold text-ink-muted underline underline-offset-2 hover:text-ink disabled:opacity-40"
              >
                {t("sheetAutomatic")}
              </button>
            )}
            {rowBusy && <Loader2 size={14} className="animate-spin text-ink-muted" />}
          </div>
        </Protect>
      </li>
    );
  };

  if (sheets.length === 0) return null;

  return (
    <div className="flex flex-col gap-4">
      {sheets.map((sheet) => {
        const sentLine = sheet.sent?.sentAt
          ? (sheet.sent.sentByName ? t("sheetSentOn").replace("{name}", sheet.sent.sentByName) : t("sheetSentOnNoName")).replace("{date}", sheet.sent.sentAt)
          : "";
        const empty = sheet.printed.length === 0 && sheet.held.length === 0;
        return (
          <section key={sheet.month} className="rounded-3xl border border-line bg-surface p-4 xl:p-6">
            <div className="flex flex-wrap items-center gap-3">
              <h3 className="font-display text-base font-extrabold text-ink">{t("sheetTitle").replace("{month}", monthName(sheet.month))}</h3>
              {sheet.sent && sentLine && <span className="text-xs font-semibold text-ink-muted">{sentLine}</span>}
              <div className="flex-1" />
              <Protect permission="patients.edit">
                {sheet.sent ? (
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => void unsend(sheet.month)}
                    className="max-lg:min-h-10 inline-flex items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2 text-xs font-bold text-ink-body hover:border-slate-400 disabled:opacity-40"
                  >
                    {busy === sheet.month ? <Loader2 size={14} className="animate-spin" /> : <Undo2 size={14} />}
                    {t("markNotSent")}
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={busy !== null || (allBranchSheets ?? sheets).find((s) => s.month === sheet.month)?.printed.length === 0}
                    onClick={() => void send(sheet.month)}
                    className="max-lg:min-h-10 inline-flex items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2 text-xs font-bold text-ink-body hover:border-slate-400 disabled:opacity-40"
                  >
                    {busy === sheet.month ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                    {t("sheetMarkSent")}
                  </button>
                )}
              </Protect>
            </div>

            {empty ? (
              <p className="mt-3 text-sm text-ink-muted">{t("sheetEmpty")}</p>
            ) : (
              <>
                <h4 className="mt-4 text-[11px] font-black uppercase tracking-wider text-ink-muted">{t("sheetOnHeading")}</h4>
                {sheet.printed.length === 0 ? (
                  <p className="mt-1 text-sm text-ink-muted">{t("sheetEmpty")}</p>
                ) : (
                  <ul className="mt-1 divide-y divide-slate-100">{sheet.printed.map((p) => row(sheet, p, null))}</ul>
                )}
                {sheet.held.length > 0 && (
                  <>
                    <h4 className="mt-4 text-[11px] font-black uppercase tracking-wider text-ink-muted">{t("sheetWaitingHeading")}</h4>
                    <ul className="mt-1 divide-y divide-slate-100">{sheet.held.map((p) => row(sheet, p, p))}</ul>
                  </>
                )}
              </>
            )}
          </section>
        );
      })}
    </div>
  );
}
