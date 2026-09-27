"use client";

/**
 * The building blocks the twenty newer reports are assembled from.
 *
 * chartKit.tsx sets the visual language (one ink, one mark, red means bad, no pies). This file
 * adds the FORMS that language is spoken in when a report compares, lists or grids things:
 *
 *   - `DeltaFigure` — a figure with how it moved. Colour only when the move is bad.
 *   - `DataTable`   — one table component with a header, aligned columns, a totals row and an
 *                     export button, so twenty tables cannot drift into twenty styles.
 *   - `MonthBars`   — twelve months as bars, the best one marked.
 *   - `HeatGrid`    — a 7 × N grid shaded in one ink, which is what a "when" question needs.
 *   - `Note`        — a quiet line under a section saying what the numbers are and are not.
 *
 * All text is bilingual through `isAr`; all numbers are set in the figures font.
 */

import { type ReactNode, useMemo } from "react";
import { ArrowDownRight, ArrowUpRight, FileSpreadsheet, Minus } from "lucide-react";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell } from "recharts";
import { exportToExcel } from "./reportExcelUtils";
import { ANIM, GRID, INK, MARK, ReportTip, TICK } from "@/components/reports/chartKit";
import type { Delta } from "@/lib/reports/ledgerStats";
import { WEEKDAYS_AR, WEEKDAYS_EN } from "@/lib/reports/periods";

export const fmt = (n: number) => Math.round(n).toLocaleString();
export const fmtPct = (n: number | null, digits = 0) => (n === null ? "—" : `${n.toFixed(digits)}%`);

// --- a figure and how it moved -------------------------------------------------------------------

/**
 * "12,400 · ▲ 8% on last month".
 *
 * `goodWhen` says which direction is welcome: income up, expenses down, no-shows down. Only the
 * unwelcome direction is coloured, because red means bad and green would mean "category".
 */
export function DeltaFigure({
  label,
  value,
  delta,
  goodWhen = "up",
  isAr,
  format = fmt,
  against,
}: {
  label: string;
  value: number;
  delta?: Delta | null;
  goodWhen?: "up" | "down" | "none";
  isAr: boolean;
  format?: (n: number) => string;
  /** "last month", "same period last year" — the thing the arrow is relative to. */
  against?: string;
}) {
  const move = delta ? Math.sign(delta.abs) : 0;
  const bad = goodWhen !== "none" && move !== 0 && (goodWhen === "up" ? move < 0 : move > 0);
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-2xl border border-line bg-surface p-4">
      <span className="text-[11px] font-semibold leading-tight text-ink-muted">{label}</span>
      <span className="font-figure text-[24px] font-extrabold leading-none text-ink">{format(value)}</span>
      {delta && (
        <span className={`mt-1 inline-flex items-center gap-1 font-figure text-[11.5px] font-bold ${bad ? "text-danger" : "text-ink-muted"}`}>
          {move > 0 ? <ArrowUpRight size={12} /> : move < 0 ? <ArrowDownRight size={12} /> : <Minus size={12} />}
          {delta.pct === null ? (isAr ? "جديد" : "new") : `${Math.abs(delta.pct)}%`}
          <span className="font-sans font-semibold text-ink-faint">
            {delta.pct === null ? "" : `(${move >= 0 ? "+" : "−"}${format(Math.abs(delta.abs))})`}
            {against ? ` ${isAr ? "عن" : "vs"} ${against}` : ""}
          </span>
        </span>
      )}
    </div>
  );
}

/** A grid of DeltaFigures or Figures, however many fit. */
export function FigureRow({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">{children}</div>;
}

// --- one table, everywhere -----------------------------------------------------------------------

export type Column<T> = {
  key: string;
  label: string;
  align?: "start" | "end" | "center";
  /** What to draw in the cell. Defaults to the string of `row[key]`. */
  render?: (row: T) => ReactNode;
  /** What to put in the spreadsheet. Defaults to `row[key]`. */
  exportValue?: (row: T) => string | number;
  /** The totals-row cell. Omit for blank. */
  total?: ReactNode;
  className?: string;
};

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  isAr,
  title,
  exportName,
  emptyText,
  onRowClick,
  expanded,
  renderExpanded,
  maxRows,
  dense,
}: {
  columns: Column<T>[];
  rows: readonly T[];
  rowKey: (row: T) => string;
  isAr: boolean;
  title?: string;
  exportName?: string;
  emptyText?: string;
  onRowClick?: (row: T) => void;
  expanded?: string | null;
  renderExpanded?: (row: T) => ReactNode;
  maxRows?: number;
  dense?: boolean;
}) {
  const shown = maxRows ? rows.slice(0, maxRows) : rows;
  const hasTotals = columns.some((c) => c.total !== undefined);
  const doExport = () =>
    exportToExcel(
      rows.map((r) => {
        const out: Record<string, string | number> = {};
        for (const c of columns) {
          const v = c.exportValue ? c.exportValue(r) : (r as Record<string, unknown>)[c.key];
          out[c.label] = typeof v === "number" ? v : String(v ?? "");
        }
        return out;
      }),
      `${exportName}_${new Date().toISOString().slice(0, 10)}`,
      isAr,
    );
  const align = (a?: Column<T>["align"]) => (a === "end" ? "text-end" : a === "center" ? "text-center" : "text-start");
  const pad = dense ? "px-3 py-2" : "px-3 py-2.5";

  return (
    <section className="overflow-hidden rounded-2xl border border-line bg-surface">
      {(title || exportName) && (
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <h3 className="text-sm font-black tracking-tight text-ink">{title}</h3>
          {exportName && rows.length > 0 && (
            <button
              type="button"
              onClick={doExport}
              className="inline-flex items-center gap-1.5 rounded-xl border border-line px-3 py-1.5 text-[11.5px] font-black text-ink-body transition-colors hover:text-ink"
            >
              <FileSpreadsheet size={13} />
              {isAr ? "تصدير" : "Export"} ({rows.length})
            </button>
          )}
        </div>
      )}
      {rows.length === 0 ? (
        <p className="px-4 py-8 text-center text-[12.5px] font-medium text-ink-faint">{emptyText || (isAr ? "مفيش بيانات في الفترة دي." : "Nothing in this period.")}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-y border-line bg-surface-subtle">
                {columns.map((c) => (
                  <th key={c.key} className={`${pad} whitespace-nowrap text-[10.5px] font-black uppercase tracking-wider text-ink-muted ${align(c.align)}`}>
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const k = rowKey(r);
                const open = expanded === k;
                return (
                  <RowPair key={k}>
                    <tr
                      onClick={onRowClick ? () => onRowClick(r) : undefined}
                      className={`border-b border-line ${onRowClick ? "cursor-pointer transition-colors hover:bg-surface-subtle" : ""} ${open ? "bg-surface-subtle" : ""}`}
                    >
                      {columns.map((c) => (
                        <td key={c.key} className={`${pad} text-[12.5px] text-ink-body ${align(c.align)} ${c.className || ""}`}>
                          {c.render ? c.render(r) : String((r as Record<string, unknown>)[c.key] ?? "")}
                        </td>
                      ))}
                    </tr>
                    {open && renderExpanded && (
                      <tr className="border-b border-line bg-surface-subtle/60">
                        <td colSpan={columns.length} className="p-0">
                          {renderExpanded(r)}
                        </td>
                      </tr>
                    )}
                  </RowPair>
                );
              })}
            </tbody>
            {hasTotals && (
              <tfoot>
                <tr className="border-t-2 border-line bg-surface-subtle">
                  {columns.map((c, i) => (
                    <td key={c.key} className={`${pad} font-figure text-[12.5px] font-bold text-ink ${align(c.align)}`}>
                      {c.total !== undefined ? c.total : i === 0 ? <span className="font-sans text-[11px] font-black uppercase tracking-wider text-ink-muted">{isAr ? "الإجمالي" : "Total"}</span> : ""}
                    </td>
                  ))}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
      {maxRows && rows.length > maxRows && (
        <p className="px-4 py-2.5 text-[11.5px] font-medium text-ink-faint">
          {isAr ? `أول ${maxRows} من ${rows.length}. التصدير فيه الكل.` : `First ${maxRows} of ${rows.length}. The export has all of them.`}
        </p>
      )}
    </section>
  );
}

function RowPair({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

/** A number cell in the figures font. */
export function Num({ v, bold, bad, muted, format = fmt }: { v: number; bold?: boolean; bad?: boolean; muted?: boolean; format?: (n: number) => string }) {
  return <span className={`font-figure text-[12.5px] ${bad ? "text-danger" : muted ? "text-ink-faint" : bold ? "font-bold text-ink" : "text-ink-body"}`}>{format(v)}</span>;
}

/** A change cell: the arrow and the percentage, red only when it is the wrong way. */
export function DeltaCell({ d, goodWhen = "up", isAr }: { d: Delta; goodWhen?: "up" | "down"; isAr: boolean }) {
  const move = Math.sign(d.abs);
  const bad = move !== 0 && (goodWhen === "up" ? move < 0 : move > 0);
  return (
    <span className={`inline-flex items-center gap-0.5 font-figure text-[12px] font-bold ${bad ? "text-danger" : move === 0 ? "text-ink-faint" : "text-ink-body"}`}>
      {move > 0 ? <ArrowUpRight size={11} /> : move < 0 ? <ArrowDownRight size={11} /> : <Minus size={11} />}
      {d.pct === null ? (isAr ? "جديد" : "new") : `${Math.abs(d.pct)}%`}
    </span>
  );
}

// --- months as bars ------------------------------------------------------------------------------

export function MonthBars({
  data,
  isAr,
  fmtValue = (n) => `${fmt(n)} ${isAr ? "ج.م" : "EGP"}`,
  height = 220,
  markMax = true,
  name,
}: {
  data: { label: string; value: number }[];
  isAr: boolean;
  fmtValue?: (n: number) => string;
  height?: number;
  markMax?: boolean;
  name?: string;
}) {
  const max = Math.max(0, ...data.map((d) => d.value));
  if (max === 0) return <p className="py-8 text-center text-[12.5px] font-medium text-ink-faint">—</p>;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 6, right: 6, bottom: 0, left: -18 }}>
        <CartesianGrid stroke={GRID} strokeDasharray="0" vertical={false} />
        <XAxis dataKey="label" tick={TICK} tickLine={false} axisLine={false} interval={0} reversed={isAr} />
        <YAxis tick={TICK} tickLine={false} axisLine={false} width={54} orientation={isAr ? "right" : "left"} tickFormatter={(v: number) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))} />
        <Tooltip cursor={{ fill: GRID, opacity: 0.4 }} content={(props) => <ReportTip {...props} isAr={isAr} fmt={fmtValue} />} />
        <Bar dataKey="value" name={name || (isAr ? "القيمة" : "Value")} radius={[4, 4, 0, 0]} animationDuration={ANIM}>
          {data.map((d, i) => (
            <Cell key={i} fill={markMax && d.value === max ? MARK : INK} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// --- when: a weekday × hour grid -----------------------------------------------------------------

export function HeatGrid({
  cells,
  isAr,
  hours = { from: 8, to: 23 },
  fmtValue = fmt,
  unit,
}: {
  cells: { weekday: number; hour: number; value: number; count: number }[];
  isAr: boolean;
  hours?: { from: number; to: number };
  fmtValue?: (n: number) => string;
  unit?: string;
}) {
  const grid = useMemo(() => {
    const m = new Map<string, number>();
    let max = 0;
    for (const c of cells) {
      if (c.hour < 0) continue;
      const k = `${c.weekday}:${c.hour}`;
      const v = (m.get(k) || 0) + c.value;
      m.set(k, v);
      if (v > max) max = v;
    }
    return { m, max };
  }, [cells]);
  const hourList: number[] = [];
  for (let h = hours.from; h <= hours.to; h++) hourList.push(h);
  const days = isAr ? WEEKDAYS_AR : WEEKDAYS_EN;
  const rowTotals = Array.from({ length: 7 }, (_, d) => cells.filter((c) => c.weekday === d).reduce((s, c) => s + c.value, 0));
  const best = Math.max(...rowTotals);
  if (grid.max === 0) return <p className="py-8 text-center text-[12.5px] font-medium text-ink-faint">—</p>;

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse" style={{ minWidth: `${hourList.length * 30 + 120}px` }}>
        <thead>
          <tr>
            <th />
            {hourList.map((h) => (
              <th key={h} className="pb-1 text-center font-figure text-[10px] font-semibold text-ink-faint">
                {h > 12 ? h - 12 : h}
                {h >= 12 ? "p" : "a"}
              </th>
            ))}
            <th className="pb-1 pe-1 text-end text-[10px] font-black uppercase tracking-wider text-ink-muted">{isAr ? "اليوم" : "Day"}</th>
          </tr>
        </thead>
        <tbody>
          {days.map((day, d) => (
            <tr key={day}>
              <td className="pe-2 text-[11.5px] font-bold text-ink">{day}</td>
              {hourList.map((h) => {
                const v = grid.m.get(`${d}:${h}`) || 0;
                const t = v / grid.max;
                return (
                  <td key={h} className="p-[2px]">
                    <div
                      title={`${day} ${h}:00 · ${fmtValue(v)}${unit ? ` ${unit}` : ""}`}
                      className="h-6 rounded-[4px]"
                      style={{ background: v === 0 ? "var(--surface-muted)" : v === grid.max ? MARK : INK, opacity: v === 0 ? 1 : v === grid.max ? 1 : 0.18 + t * 0.82 }}
                    />
                  </td>
                );
              })}
              <td className={`ps-2 text-end font-figure text-[12px] ${rowTotals[d] === best && best > 0 ? "font-bold text-ink" : "text-ink-muted"}`}>{fmtValue(rowTotals[d])}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// --- the quiet sentence under a section ----------------------------------------------------------

export function Note({ children }: { children: ReactNode }) {
  return <p className="px-1 text-[11.5px] font-medium leading-relaxed text-ink-faint">{children}</p>;
}

/** A section heading in the reports' small-caps style. */
export function SectionTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3 px-1">
      <h3 className="font-display text-[11px] font-black uppercase tracking-[0.18em] text-ink-muted">{children}</h3>
      {aside}
    </div>
  );
}

/** A patient's name that opens their file, used in every table that names one. */
export function PatientLink({ id, name, isAr }: { id: string; name: string; isAr: boolean }) {
  const label = name || (isAr ? "بدون اسم" : "Unnamed");
  if (!id) return <span className="text-[13px] font-bold text-ink">{label}</span>;
  return (
    <a href={`/patients/${id}`} onClick={(e) => e.stopPropagation()} className="text-[13px] font-bold text-ink hover:underline">
      {label}
    </a>
  );
}

/** A phone that dials. */
export function Phone({ value }: { value: string }) {
  if (!value) return <span className="text-ink-faint">—</span>;
  return (
    <a href={`tel:${value}`} dir="ltr" onClick={(e) => e.stopPropagation()} className="font-figure text-[12px] text-ink-muted hover:text-ink">
      {value}
    </a>
  );
}

/** The state a whole report is in before its data has arrived, or when a module is not enabled. */
export function ReportState({ kind, isAr, text }: { kind: "loading" | "locked" | "empty" | "error"; isAr: boolean; text?: string }) {
  const message =
    text ||
    {
      loading: isAr ? "بنحمّل البيانات…" : "Loading…",
      locked: isAr ? "الوحدة دي مش مفعّلة في اشتراك العيادة." : "This module is not enabled on the clinic's plan.",
      empty: isAr ? "مفيش بيانات في الفترة دي." : "Nothing recorded in this period.",
      error: isAr ? "مقدرناش نحمّل البيانات." : "The data could not be loaded.",
    }[kind];
  return (
    <div className={`rounded-2xl border border-dashed border-line bg-surface-subtle px-6 py-12 text-center text-sm font-bold ${kind === "error" ? "text-danger" : "text-ink-muted"}`}>{message}</div>
  );
}
