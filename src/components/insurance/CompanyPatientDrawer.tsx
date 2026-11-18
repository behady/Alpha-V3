"use client";

/**
 * One patient of a contract company (GASCO), opened from the Insurance page's list: every service
 * he had since the monthly sheet began, grouped by the sheet it goes on, each with its finish date
 * and its story.
 *
 * - A finished service's finish date can be changed: that day decides the month (the sheet takes a
 *   patient in the month his LAST service finished). "Not finished? Undo" puts it back to In
 *   progress; an unfinished one has "Mark finished" (today).
 * - A service on a month already sent is locked; the route refuses it anyway.
 *
 * Every change goes through the company-sheet route; the page's live listeners redraw the drawer,
 * so nothing here keeps its own copy of a card.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronDown, Loader2, Lock, X } from "lucide-react";
import { useLanguage } from "@/context/LanguageContext";
import { useUI } from "@/context/UIContext";
import Protect from "@/components/Protect";
import { statementLineText } from "@/lib/insuranceStatement";
import type { SentMonth, SheetCard, SheetCharge } from "@/lib/insurance/companySheet";
import { serviceState, serviceStory, type DrawerGroup, type PatientRow, type StoryEvent } from "@/lib/insurance/sheetPatients";
import { toYmd } from "@/lib/reports/patientStats";
import { cairoToday, finishTreatment, reopenTreatment, setTreatmentFinishDate } from "./api";
import { DoneDateField } from "./LineDoneControls";
import { dayLabel, fill, money, monthLabel } from "./sheetFormat";
import { tr, type TextKey } from "./text";

const REFUSAL: Record<string, TextKey> = {
  sent_locked: "sheetToastSentLocked",
  month_sent: "dwToastMonthSent",
  before_visit: "dwToastBeforeVisit",
  future_date: "dwToastFuture",
  not_done: "dwToastChanged",
  already_done: "dwToastChanged",
  not_found: "dwToastChanged",
};

const amountOf = (c: SheetCharge) => Math.round((Number(c.cost) || Number(c.amount) || 0) * 100) / 100;

export default function CompanyPatientDrawer({
  clinicId,
  payerId,
  row,
  groups,
  cards,
  cardKids: children,
  sent,
  onClose,
}: {
  clinicId: string;
  payerId: string;
  row: PatientRow;
  groups: DrawerGroup[];
  cards: ReadonlyMap<string, SheetCard>;
  /** Cards by the card they continue. */
  cardKids: ReadonlyMap<string, SheetCard[]>;
  sent: readonly SentMonth[];
  onClose: () => void;
}) {
  const { language, isRTL } = useLanguage();
  const ar = language === "ar";
  const t = useMemo(() => tr(ar), [ar]);
  const { confirm, showToast } = useUI();
  /** The service being saved; every button waits while one is in flight. */
  const [busy, setBusy] = useState<string | null>(null);
  /** Services whose history is open. */
  const [openStory, setOpenStory] = useState<ReadonlySet<string>>(new Set());
  const today = cairoToday();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

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

  // --- the headline: where his work goes next -----------------------------------------------
  const first = groups[0];
  let head = t("dwHeadSent");
  let headSub = t("dwHeadSentSub");
  let headTotal: number | null = null;
  if (first?.kind === "pending") {
    headTotal = first.value;
    if (first.reason === "not_finished") {
      head = t("dwHeadWaiting");
      headSub = t("dwHeadWaitingSub");
    } else {
      head = fill(t("dwHeadOn"), { month: monthLabel(first.month, ar) });
      headSub = t("dwHeadLateSub");
    }
  } else if (first?.kind === "month" && !first.sent) {
    headTotal = first.value;
    const last = first.charges.map((c) => serviceState(c, cards, children, sent).finishDate).sort().pop() ?? "";
    head = fill(t("dwHeadNotSent"), { month: monthLabel(first.month, ar) });
    headSub = last ? fill(t("dwHeadOnSub"), { date: dayLabel(last, ar) }) + " " + t("dwHeadNotSentSub") : t("dwHeadNotSentSub");
  }

  const storyText = (e: StoryEvent): string => {
    switch (e.kind) {
      case "started":
        return t("stStarted");
      case "visit":
        return t("stVisit");
      case "finished":
        return t("stFinished");
      case "date_changed":
        return fill(t("stDateChanged"), { from: dayLabel(e.from ?? "", ar) || "—", to: dayLabel(e.to ?? "", ar) || "—" });
      case "reopened":
        return fill(t("stReopened"), { from: dayLabel(e.from ?? "", ar) || "—" });
      case "marked_finished":
        return t("stMarkedFinished");
      case "sent":
        return fill(t("stSent"), { month: monthLabel(e.month ?? "", ar) });
    }
  };
  const dot = (e: StoryEvent) =>
    e.kind === "sent"
      ? "rounded-[2px] bg-ink border-ink"
      : e.kind === "finished" || e.kind === "marked_finished"
        ? "rounded-full bg-ink border-ink"
        : e.kind === "date_changed" || e.kind === "reopened"
          ? "rounded-full bg-accent border-ink"
          : "rounded-full bg-surface border-ink";

  // One flat list: work not sent yet first (oldest first), then what was sent, newest month first.
  const ordered = groups
    .flatMap((g) => g.charges)
    .map((c) => ({ c, s: serviceState(c, cards, children, sent) }))
    .sort((x, y) => {
      if (!x.s.sentMonth !== !y.s.sentMonth) return x.s.sentMonth ? 1 : -1;
      if (x.s.sentMonth !== y.s.sentMonth) return y.s.sentMonth.localeCompare(x.s.sentMonth);
      return toYmd(x.c.date).localeCompare(toYmd(y.c.date));
    })
    .map((x) => x.c);

  const service = (c: SheetCharge) => {
    const id = String(c.id);
    const state = serviceState(c, cards, children, sent);
    const story = serviceStory(c, cards, children, sent);
    const isLocked = state.sentMonth !== "";
    const canChange = !isLocked && state.noteId !== "";
    const name = statementLineText(c) || "—";
    const rowBusy = busy === id;
    const storyOpen = openStory.has(id);
    const pill = state.done ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-amber-200 bg-amber-50 text-amber-800";
    const label = state.done ? t("dwFinished") : t("dwInProgress");

    // The one status control: tap to switch Finished <-> In progress (each asks first).
    const toggle = async () => {
      if (state.done) {
        const ok = await confirm(fill(t("dwUndoConfirm"), { service: name, patient: row.patientName }), { title: t("dwInProgress"), confirmLabel: t("dwInProgress") });
        if (ok) await run(id, () => reopenTreatment(clinicId, payerId, state.noteId));
      } else {
        const ok = await confirm(fill(t("dwFinishConfirm"), { service: name }), { title: t("dwFinished"), confirmLabel: t("dwFinished") });
        if (ok) await run(id, () => finishTreatment(clinicId, payerId, state.noteId));
      }
    };

    return (
      <li key={id} className={`rounded-2xl border border-line p-4 ${isLocked ? "bg-surface-subtle" : "bg-surface"}`}>
        <div className="flex items-baseline gap-3">
          <p className={`min-w-0 flex-1 text-[14px] font-bold ${isLocked ? "text-ink-body" : "text-ink"}`}>{name}</p>
          <span className="font-figure text-[15px] font-black text-ink">{money(amountOf(c), ar)}</span>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2.5">
          {canChange ? (
            <Protect permission="patients.edit" fallback={<span className={`inline-flex rounded-full border px-3 py-1 text-[12px] font-bold ${pill}`}>{label}</span>}>
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => void toggle()}
                title={t("dwTapToChange")}
                className={`inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-[12px] font-bold disabled:opacity-50 ${pill}`}
              >
                {label}
                <ChevronDown size={13} aria-hidden="true" />
              </button>
            </Protect>
          ) : (
            <span className={`inline-flex rounded-full border px-3 py-1 text-[12px] font-bold ${pill}`}>{label}</span>
          )}

          {state.done &&
            (canChange ? (
              <Protect permission="patients.edit" fallback={<span className="text-[12px] font-semibold text-ink-muted">{dayLabel(state.finishDate, ar)}</span>}>
                <DoneDateField
                  key={`${state.noteId}|${state.finishDate}`}
                  stored={state.finishDate}
                  min={state.lastVisit}
                  max={today}
                  disabled={busy !== null && !rowBusy}
                  busy={rowBusy}
                  label={t("dwFinishedOn")}
                  hint={fill(t("dwFinishedOnHint"), { min: dayLabel(state.lastVisit, ar) })}
                  onCommit={(day) => run(id, () => setTreatmentFinishDate(clinicId, payerId, state.noteId, day))}
                />
              </Protect>
            ) : (
              <span className="text-[12px] font-semibold text-ink-muted">{dayLabel(state.finishDate, ar)}</span>
            ))}

          {isLocked && (
            <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-ink-muted" title={t("dwLockedHint")}>
              <Lock size={12} aria-hidden="true" />
              {fill(t("dwSentWith"), { month: monthLabel(state.sentMonth, ar) })}
            </span>
          )}
          {rowBusy && <Loader2 size={14} className="animate-spin text-ink-muted" />}

          {story.length > 0 && (
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
              className="ms-auto inline-flex min-h-9 items-center gap-1 rounded-full px-2 text-[12px] font-bold text-ink-muted hover:text-ink"
            >
              {t("dwHistory")}
              <ChevronDown size={13} className={storyOpen ? "rotate-180" : ""} aria-hidden="true" />
            </button>
          )}
        </div>

        {storyOpen && (
          <ol className="mt-3 flex flex-col gap-1.5 border-t border-dashed border-line pt-3">
            {story.map((e, i) => (
              <li key={i} className="flex items-baseline gap-2.5 text-[12px] leading-relaxed text-ink-body">
                <span className={`size-2 shrink-0 translate-y-[-1px] border-[1.5px] ${dot(e)}`} aria-hidden="true" />
                <span>
                  {e.date && <b className="font-figure font-bold text-ink">{dayLabel(e.date, ar)}</b>}
                  {e.date && " · "}
                  {storyText(e)}
                  {e.by ? ` — ${e.by}` : ""}
                </span>
              </li>
            ))}
          </ol>
        )}
      </li>
    );
  };

  return (
    <>
      <div className="fixed inset-0 z-[100] bg-slate-900/40 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={row.patientName}
        dir={isRTL ? "rtl" : "ltr"}
        className="fixed inset-y-0 end-0 z-[101] flex w-full flex-col bg-surface shadow-2xl sm:w-[540px]"
      >
        <div className="border-b border-line px-5 pb-4 pt-5">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <h2 className="font-display text-xl font-extrabold text-ink">{row.patientName || "—"}</h2>
              {row.patientId && (
                <Link href={`/patients/${row.patientId}`} className="mt-1 inline-block text-[12px] font-bold text-ink-muted underline underline-offset-2 hover:text-ink">
                  {t("dwOpenFile")}
                </Link>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label={t("dwClose")}
              className="grid size-11 shrink-0 place-items-center rounded-full border border-line text-ink hover:bg-surface-subtle"
            >
              <X size={18} />
            </button>
          </div>
          <div className="mt-4 flex items-center gap-4 rounded-2xl bg-ink-slab px-4 py-3.5 text-white">
            <div className="min-w-0 flex-1">
              <p className="text-[14px] font-bold">{head}</p>
              <p className="mt-1 text-[12px] leading-relaxed text-white/65">{headSub}</p>
            </div>
            {headTotal !== null && <span className="shrink-0 font-figure text-2xl font-black">{money(headTotal, ar)}</span>}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 pb-8">
          <ul className="flex flex-col gap-3 pt-5">{ordered.map((c) => service(c))}</ul>
        </div>
      </aside>
    </>
  );
}
