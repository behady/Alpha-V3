"use client";

import { AlertTriangle, CheckCircle2, CircleDashed, History, Hourglass, LogIn, StickyNote, Wallet } from "lucide-react";
import type { CardTiming, DetailPlan, PatientHistory, VisitMoney } from "@/lib/scheduleCard";

function clock(d: Date | null): string {
  if (!d) return "";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function mins(n: number, isAr: boolean): string {
  if (n < 60) return isAr ? `${n} د` : `${n} min`;
  const h = Math.floor(n / 60);
  const m = n % 60;
  return isAr ? `${h} س ${m ? `${m} د` : ""}`.trim() : `${h}h${m ? ` ${m}m` : ""}`;
}

const MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_AR = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];

/** "12 Aug" — a date said the way the desk says it, with the year only when it is not this one. */
function shortDate(ymd: string, isAr: boolean): string {
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return ymd;
  const month = (isAr ? MONTHS_AR : MONTHS_EN)[m - 1];
  return `${d} ${month}${y === new Date().getFullYear() ? "" : ` ${y}`}`;
}

const money = (n: number) => Math.round(n).toLocaleString();

/**
 * The middle of an appointment card: the details that fill a tall card instead of white space.
 *
 * Each line is one fact, prefixed by a small icon so it can be read without a label, and set on the
 * same translucent chip as the treatment line above it so the card reads as one object rather than
 * as text floating on a colour. Which lines appear, and in which order, is decided by `planDetails`
 * from the card's height and whether the patient has arrived — this component only draws what it
 * is told there is room for.
 */
export default function ScheduleCardDetails({
  plan,
  order,
  timing,
  visit,
  history,
  alert,
  status,
  note,
  isAr,
}: {
  plan: DetailPlan;
  /** The same order `planDetails` was given, so the lines come out in it. */
  order: readonly string[];
  timing: CardTiming;
  visit: VisitMoney | null;
  history: PatientHistory | null;
  alert: string;
  status: string;
  note: string;
  isAr: boolean;
}) {
  if (plan.show.size === 0 && plan.noteLines === 0) return null;
  const chip =
    "inline-flex max-w-full items-center gap-1.5 rounded-md bg-white/60 px-2 py-0.5 text-[11.5px] font-bold text-slate-800 lg:bg-white/75";

  const line = (key: string) => {
    switch (key) {
      case "alert":
        return (
          <span key={key} className={`${chip} !text-danger`} title={alert}>
            <AlertTriangle size={12} className="shrink-0" />
            <span className="truncate">{alert}</span>
          </span>
        );

      case "timing":
        if (timing.kind === "waiting") {
          return (
            <span key={key} className={`${chip} ${timing.long ? "!text-danger" : ""}`}>
              <LogIn size={12} className="shrink-0" />
              <span className="truncate">
                {isAr
                  ? `وصل ${clock(timing.arrivedAt)} · مستني ${mins(timing.waitedMin, true)}`
                  : `Arrived ${clock(timing.arrivedAt)} · waiting ${mins(timing.waitedMin, false)}`}
              </span>
            </span>
          );
        }
        if (timing.kind === "inChair") {
          return (
            <span key={key} className={`${chip} ${timing.overMin > 0 ? "!text-danger" : ""}`}>
              <Hourglass size={12} className="shrink-0" />
              <span className="truncate">
                {timing.overMin > 0
                  ? isAr
                    ? `على الكرسي من ${clock(timing.seatedAt)} · متأخر ${mins(timing.overMin, true)}`
                    : `In chair since ${clock(timing.seatedAt)} · ${mins(timing.overMin, false)} over`
                  : isAr
                    ? `على الكرسي من ${clock(timing.seatedAt)} · ${mins(timing.elapsedMin, true)}`
                    : `In chair since ${clock(timing.seatedAt)} · ${mins(timing.elapsedMin, false)}`}
              </span>
            </span>
          );
        }
        if (timing.kind === "done") {
          return (
            <span key={key} className={chip}>
              <CheckCircle2 size={12} className="shrink-0" />
              <span className="truncate">
                {timing.arrivedAt && timing.finishedAt
                  ? isAr
                    ? `وصل ${clock(timing.arrivedAt)} · خلص ${clock(timing.finishedAt)}`
                    : `Arrived ${clock(timing.arrivedAt)} · done ${clock(timing.finishedAt)}`
                  : timing.arrivedAt
                    ? isAr ? `وصل ${clock(timing.arrivedAt)}` : `Arrived ${clock(timing.arrivedAt)}`
                    : isAr ? "خلص" : "Done"}
              </span>
            </span>
          );
        }
        return null;

      case "money":
        if (!visit) return null;
        return (
          <span key={key} className={`${chip} ${visit.owed > 0 ? "!text-danger" : ""}`}>
            <Wallet size={12} className="shrink-0" />
            <span className="truncate font-figure">
              {visit.owed > 0
                ? isAr
                  ? `الزيارة ${money(visit.charged)} ج · باقي ${money(visit.owed)}`
                  : `This visit ${money(visit.charged)} EGP · ${money(visit.owed)} owed`
                : isAr
                  ? `الزيارة ${money(visit.charged)} ج · مدفوعة`
                  : `This visit ${money(visit.charged)} EGP · paid`}
            </span>
          </span>
        );

      case "owes":
        if (!history || history.owedBefore <= 0) return null;
        return (
          <span key={key} className={`${chip} !text-danger`}>
            <Wallet size={12} className="shrink-0" />
            <span className="truncate font-figure">
              {isAr
                ? `عليه ${money(history.owedBefore)} ج من قبل`
                : `Owes ${money(history.owedBefore)} EGP from before`}
            </span>
          </span>
        );

      case "status": {
        const confirmed = status === "Confirmed";
        const seen = history && history.visits > 0;
        const parts = [
          confirmed ? (isAr ? "مؤكد" : "Confirmed") : isAr ? "لسه مأكدش" : "Not confirmed yet",
          seen
            ? isAr
              ? `آخر زيارة ${shortDate(history!.lastVisit, true)} · ${history!.visits} زيارة`
              : `Last visit ${shortDate(history!.lastVisit, false)} · ${history!.visits} visit${history!.visits === 1 ? "" : "s"}`
            : isAr
              ? "أول زيارة"
              : "First visit",
        ];
        return (
          <span key={key} className={chip}>
            {confirmed ? <CheckCircle2 size={12} className="shrink-0" /> : <CircleDashed size={12} className="shrink-0" />}
            <span className="truncate">{parts.join(" · ")}</span>
            {seen && <History size={11} className="shrink-0 opacity-50" />}
          </span>
        );
      }

      default:
        return null;
    }
  };

  return (
    <div className="flex min-h-0 min-w-0 flex-col items-start gap-1">
      {order.filter((k) => plan.show.has(k as never)).map(line)}

      {plan.noteLines > 0 && note && (
        <span className={`${chip} !items-start !font-semibold`}>
          <StickyNote size={12} className="mt-[3px] shrink-0" />
          {/* line-clamp by style so the number of lines follows the card's height exactly. */}
          <span
            className="min-w-0 whitespace-pre-line break-words"
            style={{
              display: "-webkit-box",
              WebkitBoxOrient: "vertical",
              WebkitLineClamp: plan.noteLines,
              overflow: "hidden",
            }}
          >
            {note}
          </span>
        </span>
      )}
    </div>
  );
}

/**
 * The small red mark beside the name when the patient's file has a medical alert.
 *
 * Shown on EVERY card, whatever its height, because whether it is safe to treat somebody cannot
 * depend on how long their visit was booked for. The words are in the tooltip, and on the card
 * itself whenever there is a line to spare.
 */
export function AlertBadge({ alert, isAr }: { alert: string; isAr: boolean }) {
  if (!alert) return null;
  return (
    <span
      title={alert}
      aria-label={isAr ? `تنبيه طبي: ${alert}` : `Medical alert: ${alert}`}
      className="inline-grid size-5 shrink-0 place-items-center rounded-full bg-danger text-white shadow-sm"
    >
      <AlertTriangle size={11} strokeWidth={2.75} />
    </span>
  );
}

/**
 * The thin bar along the bottom edge while the patient is in the chair.
 *
 * It fills over the booked time, so a glance down the schedule shows who is nearly done and who is
 * running over — the bar turns red and stays full once it passes the end. Drawn on every card
 * height, because a short visit running over is exactly the one that makes the next one late.
 */
export function ChairProgress({ timing }: { timing: CardTiming }) {
  if (timing.kind !== "inChair") return null;
  const over = timing.overMin > 0;
  return (
    <div className="pointer-events-none absolute inset-x-2 bottom-1 h-1 overflow-hidden rounded-full bg-black/10" aria-hidden>
      <div
        className="h-full rounded-full transition-[width] duration-700 ease-out"
        style={{
          width: `${Math.min(100, Math.max(3, timing.progress * 100))}%`,
          background: over ? "var(--danger)" : "var(--ink-slab)",
        }}
      />
    </div>
  );
}
