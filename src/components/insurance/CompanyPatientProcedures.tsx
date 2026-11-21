"use client";

/**
 * One patient's procedures for a contract company (GASCO), opened under his name on the Insurance
 * page: one line per procedure — name, dentist, start date, end date, status, price, and the month
 * of the sheet it goes on.
 *
 * - The month fills itself in: the month the procedure ended. The picker moves it to another
 *   month; picking one for a procedure that is not finished asks first.
 * - Start and end dates and the status can be changed here. The start date is the procedure's real
 *   date, so the patient's file and Finance follow it.
 * - A procedure on a month already sent is locked; the route refuses it anyway.
 *
 * Every change goes through the company-sheet route; the page's live listeners redraw the lines,
 * so nothing here keeps its own copy.
 */

import { Fragment, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronDown, History, Loader2, Lock } from "lucide-react";
import { useLanguage } from "@/context/LanguageContext";
import { useUI } from "@/context/UIContext";
import Protect from "@/components/Protect";
import { statementLineText } from "@/lib/insuranceStatement";
import { COMPANY_SHEET_START, type Placement, type SentMonth, type SheetCard, type SheetCharge } from "@/lib/insurance/companySheet";
import { pickerMonths, serviceState, serviceStory, type StoryEvent } from "@/lib/insurance/sheetPatients";
import { cairoToday, finishTreatment, reopenTreatment, setProcedureSheetMonth, setProcedureStartDate, setTreatmentFinishDate } from "./api";
import { DoneDateField } from "./LineDoneControls";
import { dayLabel, fill, money, monthLabel } from "./sheetFormat";
import { tr, type TextKey } from "./text";

const REFUSAL: Record<string, TextKey> = {
  sent_locked: "sheetToastSentLocked",
  month_sent: "dwToastMonthSent",
  before_visit: "dwToastBeforeVisit",
  after_visit: "dwToastAfterVisit",
  after_finish: "dwToastAfterFinish",
  future_date: "dwToastFuture",
  before_start: "dwToastBeforeStart",
  not_done: "dwToastChanged",
  already_done: "dwToastChanged",
  not_found: "dwToastChanged",
};

const amountOf = (c: SheetCharge) => Math.round((Number(c.cost) || Number(c.amount) || 0) * 100) / 100;

export default function CompanyPatientProcedures({
  clinicId,
  payerId,
  patientId,
  patientName,
  charges,
  placed,
  cards,
  cardKids,
  sent,
}: {
  clinicId: string;
  payerId: string;
  patientId: string;
  patientName: string;
  /** Every procedure of his on the company's account, oldest first. */
  charges: SheetCharge[];
  placed: ReadonlyMap<string, Placement>;
  cards: ReadonlyMap<string, SheetCard>;
  /** Cards by the card they continue. */
  cardKids: ReadonlyMap<string, SheetCard[]>;
  sent: readonly SentMonth[];
}) {
  const { language } = useLanguage();
  const ar = language === "ar";
  const t = useMemo(() => tr(ar), [ar]);
  const { confirm, showToast } = useUI();
  /** The procedure being saved; every control waits while one is in flight. */
  const [busy, setBusy] = useState<string | null>(null);
  /** Procedures whose history is open. */
  const [openStory, setOpenStory] = useState<ReadonlySet<string>>(new Set());
  const today = cairoToday();
  const sentMonths = useMemo(() => new Set(sent.map((s) => s.month)), [sent]);
  const offered = useMemo(() => pickerMonths(today, COMPANY_SHEET_START), [today]);

  const run = async (chargeId: string, call: () => Promise<string | null>): Promise<boolean> => {
    if (busy) return false;
    setBusy(chargeId);
    try {
      const refused = await call();
      if (refused) {
        showToast(t(REFUSAL[refused] ?? "sheetToastFailed"), "error");
        return false;
      }
      showToast(t("dwSaved"), "success");
      return true;
    } finally {
      setBusy(null);
    }
  };

  const storyText = (e: StoryEvent): string => {
    const day = (v?: string) => dayLabel(v ?? "", ar) || "—";
    switch (e.kind) {
      case "started":
        return t("stStarted");
      case "visit":
        return t("stVisit");
      case "finished":
        return t("stFinished");
      case "date_changed":
        return fill(t("stDateChanged"), { from: day(e.from), to: day(e.to) });
      case "start_changed":
        return fill(t("stStartChanged"), { from: day(e.from), to: day(e.to) });
      case "month_changed":
        return e.to ? fill(t("stMonthChanged"), { month: monthLabel(e.to, ar) }) : t("stMonthAuto");
      case "reopened":
        return fill(t("stReopened"), { from: day(e.from) });
      case "marked_finished":
        return t("stMarkedFinished");
      case "sent":
        return fill(t("stSent"), { month: monthLabel(e.month ?? "", ar) });
    }
  };

  /** A cell: its label sits above it on a phone, and in the heading row on a wide screen. */
  const cell = (label: string, width: string, body: React.ReactNode) => (
    <div className={`min-w-0 ${width}`}>
      <p className="mb-1 text-[10px] font-black uppercase tracking-wider text-ink-muted lg:hidden">{label}</p>
      {body}
    </div>
  );
  const W = { dentist: "lg:w-28", date: "lg:w-[9.5rem]", status: "lg:w-28", price: "lg:w-20 lg:text-end", month: "lg:w-48", history: "lg:w-9" };

  const line = (c: SheetCharge) => {
    const id = String(c.id);
    const at = placed.get(id);
    if (!at) return null;
    const state = serviceState(c, cards, cardKids);
    const name = statementLineText(c) || "—";
    const rowBusy = busy === id;
    const waitingOther = busy !== null && !rowBusy;
    const canChange = !at.sent && state.noteId !== "";
    const storyOpen = openStory.has(id);
    const story = storyOpen ? serviceStory(c, cards, cardKids, sent) : [];
    const pill = state.done ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-amber-200 bg-amber-50 text-amber-800";
    const label = state.done ? t("dwFinished") : t("dwInProgress");
    const shown = (ymd: string) => <span className="font-figure text-[13px] font-semibold text-ink-body">{dayLabel(ymd, ar) || "—"}</span>;

    // Tap the status to switch Finished <-> In progress (each asks first).
    const toggle = async () => {
      if (state.done) {
        const ok = await confirm(fill(t("dwUndoConfirm"), { service: name, patient: patientName }), { title: t("dwInProgress"), confirmLabel: t("dwInProgress") });
        if (ok) await run(id, () => reopenTreatment(clinicId, payerId, state.noteId));
      } else {
        const ok = await confirm(fill(t("dwFinishConfirm"), { service: name }), { title: t("dwFinished"), confirmLabel: t("dwFinished") });
        if (ok) await run(id, () => finishTreatment(clinicId, payerId, state.noteId));
      }
    };

    const pickMonth = async (value: string) => {
      if (value === at.picked) return;
      if (value && !state.done) {
        const ok = await confirm(fill(t("dwMonthWarn"), { service: name, month: monthLabel(value, ar) }), {
          title: t("dwMonthWarnTitle"),
          confirmLabel: t("dwMonthWarnGo"),
        });
        if (!ok) return;
      }
      await run(id, () => setProcedureSheetMonth(clinicId, payerId, id, value || null));
    };

    // The start can move up to the next visit, or the end date when it has one.
    const startMax = [today, state.nextVisit, state.done ? state.finishDate : ""].filter(Boolean).sort()[0];
    const autoMonth = at.picked ? at.auto : at.month;
    const monthOptions = at.picked && !offered.includes(at.picked) ? [...offered, at.picked].sort() : offered;

    return (
      <Fragment key={id}>
        <li className={`grid grid-cols-2 gap-x-4 gap-y-3 px-4 py-3.5 lg:flex lg:items-center lg:gap-4 ${at.sent ? "bg-surface-subtle" : ""}`}>
          <div className="col-span-2 min-w-0 lg:flex-1">
            <p className={`text-[14px] font-bold ${at.sent ? "text-ink-body" : "text-ink"}`}>{name}</p>
          </div>

          {cell(t("colDentist"), W.dentist, <span className="block truncate text-[13px] text-ink-body">{state.dentist || "—"}</span>)}

          {cell(
            t("colStart"),
            W.date,
            at.sent ? (
              shown(state.startDate)
            ) : (
              <Protect permission="patients.edit" fallback={shown(state.startDate)}>
                <DoneDateField
                  key={`s|${id}|${state.startDate}`}
                  stored={state.startDate}
                  min={`${COMPANY_SHEET_START}-01`}
                  max={startMax}
                  disabled={waitingOther}
                  busy={rowBusy}
                  label={t("colStart")}
                  hint={t("colStart")}
                  onCommit={(day) => run(id, () => setProcedureStartDate(clinicId, payerId, id, day))}
                />
              </Protect>
            ),
          )}

          {cell(
            t("colEnd"),
            W.date,
            !state.done ? (
              <span className="text-[13px] text-ink-muted">—</span>
            ) : !canChange ? (
              shown(state.finishDate)
            ) : (
              <Protect permission="patients.edit" fallback={shown(state.finishDate)}>
                <DoneDateField
                  key={`e|${state.noteId}|${state.finishDate}`}
                  stored={state.finishDate}
                  min={state.lastVisit}
                  max={today}
                  disabled={waitingOther}
                  busy={rowBusy}
                  label={t("colEnd")}
                  hint={fill(t("dwFinishedOnHint"), { min: dayLabel(state.lastVisit, ar) })}
                  onCommit={(day) => run(id, () => setTreatmentFinishDate(clinicId, payerId, state.noteId, day))}
                />
              </Protect>
            ),
          )}

          {cell(
            t("colStatus"),
            W.status,
            canChange ? (
              <Protect permission="patients.edit" fallback={<span className={`inline-flex rounded-full border px-3 py-1 text-[12px] font-bold ${pill}`}>{label}</span>}>
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void toggle()}
                  title={t("dwTapToChange")}
                  className={`inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-[12px] font-bold whitespace-nowrap disabled:opacity-50 ${pill}`}
                >
                  {label}
                  <ChevronDown size={13} aria-hidden="true" />
                </button>
              </Protect>
            ) : (
              <span className={`inline-flex rounded-full border px-3 py-1 text-[12px] font-bold whitespace-nowrap ${pill}`}>{label}</span>
            ),
          )}

          {cell(t("colPrice"), W.price, <span className="font-figure text-[15px] font-black text-ink">{money(amountOf(c), ar)}</span>)}

          {cell(
            t("colMonth"),
            `col-span-2 ${W.month}`,
            at.sent ? (
              <span className="inline-flex items-center gap-1.5 text-[13px] font-bold text-ink-body" title={t("dwLockedHint")}>
                <Lock size={13} aria-hidden="true" />
                {monthLabel(at.month, ar)}
              </span>
            ) : (
              <Protect permission="patients.edit" fallback={<span className="text-[13px] font-bold text-ink-body">{at.month ? monthLabel(at.month, ar) : t("monthNone")}</span>}>
                <select
                  value={at.picked}
                  disabled={busy !== null}
                  onChange={(e) => void pickMonth(e.target.value)}
                  aria-label={t("colMonth")}
                  className={`h-9 w-full rounded-lg border bg-surface px-2 text-[13px] font-bold outline-none focus:border-ink disabled:opacity-60 ${
                    at.month ? "border-line-strong text-ink" : "border-amber-300 text-amber-800"
                  }`}
                >
                  <option value="">{autoMonth ? fill(t("monthAuto"), { month: monthLabel(autoMonth, ar) }) : t("monthNone")}</option>
                  {monthOptions.map((m) => (
                    <option key={m} value={m} disabled={sentMonths.has(m)}>
                      {sentMonths.has(m) ? fill(t("monthSentTag"), { month: monthLabel(m, ar) }) : monthLabel(m, ar)}
                    </option>
                  ))}
                </select>
              </Protect>
            ),
          )}

          <div className={`col-span-2 flex items-center justify-end gap-2 ${W.history}`}>
            {rowBusy && <Loader2 size={14} className="animate-spin text-ink-muted" />}
            <button
              type="button"
              onClick={() =>
                setOpenStory((prev) => {
                  const next = new Set(prev);
                  if (next.has(id)) next.delete(id);
                  else next.add(id);
                  return next;
                })
              }
              aria-expanded={storyOpen}
              aria-label={t("dwHistory")}
              title={t("dwHistory")}
              className={`inline-flex size-9 items-center justify-center rounded-full border text-ink-muted hover:border-ink hover:text-ink ${storyOpen ? "border-ink text-ink" : "border-line"}`}
            >
              <History size={15} aria-hidden="true" />
            </button>
          </div>
        </li>
        {storyOpen && (
          <li className="bg-surface-subtle px-4 py-3">
            <ol className="flex flex-col gap-1.5">
              {story.map((e, i) => (
                <li key={i} className="flex items-baseline gap-2.5 text-[12px] leading-relaxed text-ink-body">
                  <span className="size-1.5 shrink-0 translate-y-[-2px] rounded-full bg-ink" aria-hidden="true" />
                  <span>
                    {e.date && <b className="font-figure font-bold text-ink">{dayLabel(e.date, ar)}</b>}
                    {e.date && " · "}
                    {storyText(e)}
                    {e.by ? ` — ${e.by}` : ""}
                  </span>
                </li>
              ))}
            </ol>
          </li>
        )}
      </Fragment>
    );
  };

  const head = (label: string, width: string) => <span className={`shrink-0 ${width}`}>{label}</span>;

  return (
    <div className="border-t border-line bg-surface">
      <div className="hidden items-center gap-4 border-b border-line px-4 py-2 text-[10px] font-black uppercase tracking-wider text-ink-muted lg:flex">
        <span className="min-w-0 flex-1">{t("colProcedure")}</span>
        {head(t("colDentist"), W.dentist)}
        {head(t("colStart"), W.date)}
        {head(t("colEnd"), W.date)}
        {head(t("colStatus"), W.status)}
        {head(t("colPrice"), W.price)}
        {head(t("colMonth"), W.month)}
        {head("", W.history)}
      </div>
      <ul className="divide-y divide-line">{charges.map((c) => line(c))}</ul>
      {patientId && (
        <div className="border-t border-line px-4 py-2.5">
          <Link href={`/patients/${patientId}`} className="text-[12px] font-bold text-ink-muted underline underline-offset-2 hover:text-ink">
            {t("dwOpenFile")}
          </Link>
        </div>
      )}
    </div>
  );
}
