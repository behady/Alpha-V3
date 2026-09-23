"use client";

import { Hourglass, LogIn, StickyNote, Wallet, CheckCircle2 } from "lucide-react";
import type { CardTiming, DetailPlan, VisitMoney } from "@/lib/scheduleCard";

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

/**
 * The middle of an appointment card: the details that fill a tall card instead of white space.
 *
 * Each line is one fact, prefixed by a small icon so it can be read without a label, and set on the
 * same translucent chip as the treatment line above it so the card reads as one object rather than
 * as text floating on a colour. Which lines appear is decided by `planDetails` from the card's
 * height — this component only draws what it is told there is room for.
 */
export default function ScheduleCardDetails({
  plan,
  timing,
  money,
  note,
  isAr,
}: {
  plan: DetailPlan;
  timing: CardTiming;
  money: VisitMoney | null;
  note: string;
  isAr: boolean;
}) {
  if (!plan.timing && !plan.money && plan.noteLines === 0) return null;
  const chip = "inline-flex max-w-full items-center gap-1.5 rounded-md bg-white/60 px-2 py-0.5 text-[11.5px] font-bold text-slate-800 lg:bg-white/75";

  return (
    <div className="flex min-h-0 min-w-0 flex-col items-start gap-1">
      {plan.timing && timing.kind === "waiting" && (
        <span className={`${chip} ${timing.long ? "!text-danger" : ""}`}>
          <LogIn size={12} className="shrink-0" />
          <span className="truncate">
            {isAr
              ? `وصل ${clock(timing.arrivedAt)} · مستني ${mins(timing.waitedMin, true)}`
              : `Arrived ${clock(timing.arrivedAt)} · waiting ${mins(timing.waitedMin, false)}`}
          </span>
        </span>
      )}

      {plan.timing && timing.kind === "inChair" && (
        <span className={`${chip} ${timing.overMin > 0 ? "!text-danger" : ""}`}>
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
      )}

      {plan.timing && timing.kind === "done" && (
        <span className={chip}>
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
      )}

      {plan.money && money && (
        <span className={`${chip} ${money.owed > 0 ? "!text-danger" : ""}`}>
          <Wallet size={12} className="shrink-0" />
          <span className="truncate font-figure">
            {money.owed > 0
              ? isAr
                ? `${money.charged.toLocaleString()} ج · باقي ${money.owed.toLocaleString()}`
                : `${money.charged.toLocaleString()} EGP · ${money.owed.toLocaleString()} owed`
              : isAr
                ? `${money.charged.toLocaleString()} ج · مدفوع`
                : `${money.charged.toLocaleString()} EGP · paid`}
          </span>
        </span>
      )}

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
