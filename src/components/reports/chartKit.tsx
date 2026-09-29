"use client";

/**
 * One visual language for every chart in Reports.
 *
 * Each of the seven tabs invented its own: five hand-picked hues here, a pastel palette there,
 * four pie charts each with a different legend, tooltips in three shapes. The result read as a
 * template rather than as this product — which is the one thing the app's design rules are written
 * to avoid (globals.css: "chrome stays achromatic, so colour only ever names a destination").
 *
 * The rules, and why:
 *
 *   - ONE INK. Bars and lines are drawn in the near-black the rest of the app is set in. A chart
 *     comparing six services does not need six colours; the bars are already different lengths,
 *     which is the comparison. Colour spent on things that are not being compared is colour that
 *     cannot be spent on the one thing that is.
 *   - ONE MARK, ONCE. The brand yellow is a FILL and never text, so it is used to fill exactly one
 *     thing per chart — the row being read, the period being looked at. The Arabic marketing plate
 *     for this very feature does the same: a single sector filled yellow in a ring of grey.
 *   - RED MEANS BAD, and nothing else. Lost leads, missed appointments, money owed. It is never a
 *     category colour, because a category that happens to be drawn in red reads as a problem.
 *   - NO PIE CHARTS. Every one in this folder compared quantities, which is the thing an angle is
 *     worst at; four of them had a legend a reader had to match back to a slice by colour. A bar
 *     puts the label against the bar.
 *
 * Colours are literal hex rather than `var(--token)` on purpose: these values are also read by the
 * Excel writer and by the detached iframe the PDF is printed from, neither of which resolves CSS
 * custom properties. They are kept in step with src/app/globals.css by hand, and are documented
 * there.
 */

import type { ReactNode } from "react";

/** The near-black everything is drawn in. `--ink-slab`. */
export const INK = "#111318";
/** A second series, when there genuinely is one — charged behind collected. */
export const GHOST = "#CBD5E1";
/** Grid lines, which should be almost invisible. `--line`. */
export const GRID = "#E2E8F0";
/** Axis labels: small, mid-grey, never black — they are the frame, not the content. */
export const TICK = { fontSize: 11, fill: "#78899F", fontWeight: 600 } as const;
/** The brand fill, for the ONE thing being read. Never behind text. */
export const MARK = "#FACC15";
/** Bad news only. */
export const BAD = "#C51F1F";
/** Long enough to be seen, short enough not to be waited for. */
export const ANIM = 900;

/**
 * A horizontal bar list, which is what most of these charts should have been.
 *
 * Labels sit beside their own bar, so nothing has to be matched to a legend by colour, and a long
 * Arabic treatment name has room to be read. Copied from the owner's dashboard rather than
 * reinvented — it is the most-liked visual in the app and reports should look like it.
 */
export function Bars({
  rows,
  max,
}: {
  rows: Array<{ label: string; value: number; text: string; color?: string; warn?: boolean }>;
  max?: number;
}) {
  const top = max ?? Math.max(1, ...rows.map((r) => r.value));
  if (rows.length === 0) return <p className="text-sm font-semibold text-ink-faint">—</p>;
  return (
    <div className="flex flex-col gap-2.5">
      {rows.map((r, i) => (
        <div key={`${r.label}-${i}`}>
          <div className="flex items-center justify-between gap-3 mb-1">
            <span className={`text-[13px] font-bold truncate ${r.warn ? "text-danger" : "text-ink"}`}>{r.label}</span>
            <span className="font-figure text-xs font-semibold text-ink-muted shrink-0">{r.text}</span>
          </div>
          <div className="h-2 rounded bg-surface-muted overflow-hidden">
            <div
              className="h-full rounded transition-[width] duration-700 ease-out"
              style={{
                width: `${Math.min(100, (r.value / top) * 100)}%`,
                background: r.color || (r.warn ? BAD : INK),
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

type TipPayload = { name?: string; value?: number | string | null; color?: string };

/**
 * Recharts hands its content renderer a READONLY payload, so the prop has to be readonly too.
 * Declaring it mutable compiles everywhere except the one place it is actually used.
 */

/**
 * The dark tooltip, with the axis's own word.
 *
 * `labelPrefix` exists because the dashboard's copy hardcoded "Day", and the same tooltip over a
 * service axis then read "Day Root Canal". A tooltip that names the wrong dimension is worse than
 * one that names none, so a caller charting anything other than time passes "".
 */
export function ReportTip({
  active,
  payload,
  label,
  fmt,
  isAr,
  labelPrefix = "",
}: {
  active?: boolean;
  payload?: readonly TipPayload[];
  label?: string | number;
  fmt: (n: number) => string;
  isAr: boolean;
  labelPrefix?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl bg-ink-slab text-white shadow-xl px-3.5 py-2.5 min-w-[150px]" dir={isAr ? "rtl" : "ltr"}>
      <p className="font-figure text-[10px] font-bold text-white/50 mb-1.5">
        {labelPrefix ? `${labelPrefix} ` : ""}
        {String(label ?? "")}
      </p>
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-2 py-0.5">
          <span className="w-3 h-[3px] rounded-full shrink-0" style={{ background: p.color || "#fff" }} />
          <span className="font-figure text-sm font-extrabold">{p.value == null ? "—" : fmt(Number(p.value))}</span>
          <span className="text-[11px] font-semibold text-white/60 truncate">{String(p.name || "")}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * Nothing to show, and WHY there is nothing.
 *
 * The three reasons are different problems with different answers, and a single "No data" sentence
 * made them look like the same one: the clinic recorded nothing in this period (widen it), the
 * filters exclude everything (clear them), or work was recorded but no money has come in yet (a
 * fact, not a fault). A clinic six weeks old meets all three in a week of use.
 */
export function ReportEmpty({
  reason,
  isAr,
  action,
}: {
  reason: "period" | "filter" | "money";
  isAr: boolean;
  action?: ReactNode;
}) {
  const text = {
    period: isAr ? "مفيش حاجة اتسجلت في الفترة دي." : "Nothing was recorded in this period.",
    filter: isAr ? "مفيش نتايج بالفلاتر دي." : "No rows match these filters.",
    money: isAr ? "فيه شغل اتسجل، بس لسه مفيش فلوس اتحصّلت." : "Work was recorded, but no money has come in yet.",
  }[reason];
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-line bg-surface-subtle py-12 px-6 text-center">
      <p className="text-sm font-bold text-ink-muted">{text}</p>
      {action}
    </div>
  );
}

/**
 * A figure and its name, set the way this app sets figures.
 *
 * The tabs each had their own: `text-2xl font-bold text-slate-800` in one, `text-xl font-black` in
 * another, none of them in the figures font. A column of numbers that disagree about their own
 * typography reads as a page assembled from parts.
 */
export function Figure({
  value,
  label,
  tone = "ink",
}: {
  value: string;
  label: string;
  tone?: "ink" | "muted" | "bad";
}) {
  const colour = tone === "bad" ? "text-danger" : tone === "muted" ? "text-ink-muted" : "text-ink";
  return (
    <div className="flex flex-col gap-1 min-w-0">
      <span className={`font-figure text-[26px] font-extrabold leading-none ${colour}`}>{value}</span>
      <span className="text-[11px] font-semibold text-ink-muted leading-tight">{label}</span>
    </div>
  );
}

/** A chart's heading, with room for a quiet note about what it is counting. */
export function ChartFrame({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-line bg-surface p-5">
      <div className="mb-4">
        <h3 className="text-sm font-black tracking-tight text-ink">{title}</h3>
        {note && <p className="mt-0.5 text-[11px] font-semibold text-ink-muted">{note}</p>}
      </div>
      {children}
    </section>
  );
}
