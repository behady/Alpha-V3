"use client";

import { Fragment, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, FileSpreadsheet, Info, Wallet } from "lucide-react";
import { exportToExcel } from "./reportExcelUtils";
import { buildPayerReport, byDoctor, type LedgerRowLite } from "@/lib/payerReport";
import { PRIVATE_PAYER_ID, type Payer } from "@/lib/payers";
import InsurerBadge from "@/components/shared/InsurerBadge";
import { ChartFrame, Figure, INK, MARK } from "@/components/reports/chartKit";

/**
 * Insurance, as the clinic's books see it.
 *
 * Two tables, because the owner asks two different questions and merging them helps neither:
 *
 *  - **By payer** — how much work each insurer sent, what it was worth, what the lab and the
 *    dentists took out of it, and what the clinic actually kept.
 *  - **By dentist** — the payroll view. One row per dentist, one column per payer, so "what do I
 *    owe Dr Omar, and how much of it is insurance work" is one line rather than an addition.
 *
 * Charged and collected are shown side by side and never blended. On private work they track each
 * other; on insurance work the distance between them is the number worth looking at, and a report
 * that picked one would be hiding exactly the thing it was built to show.
 *
 * Every figure is read off the rows as they were written — the payer, the dentist, the rate and
 * the commission are stamped when the money moves. Nothing here recomputes a payout, so changing a
 * rate in Settings can never rewrite a month that has already been paid.
 */

interface Props {
  procedures: LedgerRowLite[];
  payments: LedgerRowLite[];
  payers: Payer[];
  rangeLabel: string;
  isAr: boolean;
}

const fmt = (n: number) => Math.round(n).toLocaleString();

export default function PayerReport({ procedures, payments, payers, rangeLabel, isAr }: Props) {
  const report = useMemo(
    () => buildPayerReport(procedures, payments, payers),
    [procedures, payments, payers],
  );
  const payroll = useMemo(() => byDoctor(report), [report]);
  const [open, setOpen] = useState<string | null>(null);
  /**
   * What an expanded insurer shows. "Which patients came from this insurance" is the owner's
   * second question and it used to need a different screen; it is a tab here instead.
   */
  const [detail, setDetail] = useState<"doctors" | "patients">("doctors");

  const columns = report.payers;
  const hasInsurance = columns.some((c) => c.payerId !== PRIVATE_PAYER_ID);

  const exportRows = () =>
    exportToExcel(
      report.payers.map((p) => ({
        [isAr ? "جهة الدفع" : "Payer"]: p.payerName,
        [isAr ? "الحالات" : "Cases"]: p.cases,
        [isAr ? "المرضى" : "Patients"]: p.patients,
        [isAr ? "المطلوب" : "Charged"]: p.charged,
        [isAr ? "المحصّل" : "Collected"]: p.collected,
        [isAr ? "المعمل" : "Lab"]: p.labFees,
        [isAr ? "نسب الأطباء" : "Commission"]: p.commission,
        [isAr ? "صافي العيادة" : "Clinic net"]: p.clinicNet,
      })),
      `payers-${rangeLabel}`,
    );

  if (report.totals.cases === 0 && report.totals.collected === 0) {
    return (
      <p className="rounded-2xl border border-line bg-surface px-4 py-10 text-center text-[13px] font-medium text-ink-faint">
        {isAr ? "مفيش شغل في الفترة دي." : "No work in this period."}
      </p>
    );
  }

  /**
   * Charged against collected, one insurer per row.
   *
   * This is the only question the table cannot answer at a glance, and it is the question insurance
   * work exists to raise: private patients pay on the day, so the two figures sit on top of each
   * other; an insurer's do not, and the GAP between the bars is the money the clinic has done the
   * work for and not yet seen. On a private-only clinic the bars line up and the chart quietly says
   * "nothing to watch here", which is the correct answer rather than an empty panel.
   */
  const chartRows = columns
    .filter((p) => p.charged > 0 || p.collected > 0)
    .sort((a, b) => b.charged - a.charged)
    .slice(0, 8);
  const chartMax = Math.max(1, ...chartRows.map((p) => Math.max(p.charged, p.collected)));

  return (
    <div className="space-y-8">
      {/* Why the Private column may be bigger than it looks. Said once, plainly, at the top. */}
      {report.unstamped.procedures + report.unstamped.payments > 0 && (
        <p className="flex items-start gap-2 rounded-2xl border border-line bg-surface-subtle px-4 py-3 text-[12px] font-medium leading-relaxed text-ink-muted">
          <Info size={14} className="mt-0.5 shrink-0" />
          {isAr
            ? `فيه ${report.unstamped.procedures} علاج و${report.unstamped.payments} دفعة اتسجلوا قبل ما تظبّط جهات الدفع، فمتحسوبين على «خاص» — لأن مفيش طريقة نعرف بيها كانوا على مين.`
            : `${report.unstamped.procedures} treatments and ${report.unstamped.payments} payments were recorded before payers were set up, so they are counted as Private — there is no way to know what they were.`}
        </p>
      )}

      {/* --- the shape of it, before the table ---------------------------------------------- */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_auto]">
        <ChartFrame
          title={isAr ? "المطلوب مقابل المحصّل" : "Charged against collected"}
          note={
            isAr
              ? "الفرق بين العمودين هو الشغل اللي اتعمل ولسه فلوسه مجتش."
              : "The gap between the two bars is work done and not yet paid for."
          }
        >
          <div className="flex flex-col gap-4">
            {chartRows.map((p) => {
              const owed = Math.max(0, p.charged - p.collected);
              return (
                <div key={p.payerId}>
                  <div className="mb-1.5 flex items-center justify-between gap-3">
                    <span className="flex min-w-0 items-center gap-2 text-[13px] font-bold text-ink">
                      <InsurerBadge name={p.payerName} isPrivate={p.payerId === PRIVATE_PAYER_ID} size={16} />
                      <span className="truncate">{p.payerName}</span>
                    </span>
                    <span className="shrink-0 font-figure text-xs font-semibold text-ink-muted">
                      {fmt(p.collected)} / {fmt(p.charged)}
                    </span>
                  </div>
                  {/* Collected drawn INSIDE charged rather than beside it: two bars side by side
                      invite the reader to compare their lengths, when the thing being read is how
                      much of the first one the second one fills. */}
                  <div className="h-3 overflow-hidden rounded bg-surface-muted" style={{ width: `${Math.max(4, (p.charged / chartMax) * 100)}%` }}>
                    <div
                      className="h-full rounded transition-[width] duration-700 ease-out"
                      style={{
                        width: `${p.charged > 0 ? Math.min(100, (p.collected / p.charged) * 100) : 0}%`,
                        background: p.payerId === PRIVATE_PAYER_ID ? INK : MARK,
                      }}
                    />
                  </div>
                  {owed > 0 && (
                    <p className="mt-1 font-figure text-[10.5px] font-bold text-ink-muted">
                      {isAr ? `باقي ${fmt(owed)}` : `${fmt(owed)} outstanding`}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </ChartFrame>

        {/* The three figures the chart is an argument about. */}
        <div className="flex flex-row flex-wrap items-start gap-8 rounded-2xl border border-line bg-surface p-5 lg:w-56 lg:flex-col lg:gap-7">
          <Figure value={fmt(report.totals.charged)} label={isAr ? "المطلوب" : "Charged"} />
          <Figure value={fmt(report.totals.collected)} label={isAr ? "المحصّل" : "Collected"} />
          <Figure
            value={fmt(Math.max(0, report.totals.charged - report.totals.collected))}
            label={isAr ? "لسه مجاش" : "Still owed"}
            tone={report.totals.charged - report.totals.collected > 0 ? "bad" : "muted"}
          />
        </div>
      </div>

      {/* --- by payer ----------------------------------------------------------------------- */}
      <section>
        <div className="mb-3 flex items-center justify-between px-1">
          <h3 className="flex items-center gap-2 font-display text-[11px] font-black uppercase tracking-[0.18em] text-ink-muted">
            <Wallet size={13} />
            {isAr ? "حسب جهة الدفع" : "By payer"}
          </h3>
          <button
            type="button"
            onClick={exportRows}
            className="inline-flex items-center gap-1.5 rounded-xl border border-line px-3 py-1.5 text-[11.5px] font-black text-ink-body transition-colors hover:text-ink"
          >
            <FileSpreadsheet size={13} />
            {isAr ? "تصدير" : "Export"}
          </button>
        </div>

        <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
          <table className="w-full min-w-[46rem] border-collapse">
            <thead>
              <tr className="border-b border-line bg-surface-subtle">
                {[
                  isAr ? "جهة الدفع" : "Payer",
                  isAr ? "الحالات" : "Cases",
                  isAr ? "المرضى" : "Patients",
                  isAr ? "المطلوب" : "Charged",
                  isAr ? "المحصّل" : "Collected",
                  isAr ? "المعمل" : "Lab",
                  isAr ? "نسب الأطباء" : "Commission",
                  isAr ? "صافي العيادة" : "Clinic net",
                ].map((h, i) => (
                  <th
                    key={h}
                    className={`px-3 py-3 text-[10.5px] font-black uppercase tracking-wider text-ink-muted ${
                      i === 0 ? "text-start" : "text-end"
                    }`}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {columns.map((p) => {
                const expanded = open === p.payerId;
                return (
                  <Fragment key={p.payerId}>
                    <tr
                      onClick={() => setOpen(expanded ? null : p.payerId)}
                      className="cursor-pointer border-b border-line transition-colors hover:bg-surface-subtle"
                    >
                      <td className="px-3 py-2.5">
                        <span className="flex items-center gap-1.5 text-[13.5px] font-bold text-ink">
                          {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                          <InsurerBadge name={p.payerName} isPrivate={p.payerId === PRIVATE_PAYER_ID} size={22} />
                          {p.payerName}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-end font-figure text-[13px] text-ink-body">{p.cases}</td>
                      <td className="px-3 py-2.5 text-end font-figure text-[13px] text-ink-body">{p.patients}</td>
                      <td className="px-3 py-2.5 text-end font-figure text-[13px] text-ink-muted">{fmt(p.charged)}</td>
                      <td className="px-3 py-2.5 text-end font-figure text-[13px] font-bold text-ink">{fmt(p.collected)}</td>
                      <td className="px-3 py-2.5 text-end font-figure text-[13px] text-ink-muted">{fmt(p.labFees)}</td>
                      <td className="px-3 py-2.5 text-end font-figure text-[13px] text-ink-muted">{fmt(p.commission)}</td>
                      <td className="px-3 py-2.5 text-end font-figure text-[13px] font-bold text-ink">{fmt(p.clinicNet)}</td>
                    </tr>
                    {expanded && (
                      <tr key={`${p.payerId}-tabs`} className="border-b border-line bg-surface-subtle">
                        <td colSpan={8} className="px-10 py-2">
                          <span className="inline-flex gap-1 rounded-full bg-surface p-1">
                            {(["doctors", "patients"] as const).map((view) => (
                              <button
                                key={view}
                                type="button"
                                onClick={() => setDetail(view)}
                                className={`rounded-full px-3 py-1 text-[11.5px] font-black transition-colors ${
                                  detail === view ? "bg-ink-slab text-white" : "text-ink-faint hover:text-ink"
                                }`}
                              >
                                {view === "doctors"
                                  ? isAr
                                    ? "الأطباء"
                                    : "Dentists"
                                  : isAr
                                    ? `المرضى (${p.patients})`
                                    : `Patients (${p.patients})`}
                              </button>
                            ))}
                          </span>
                        </td>
                      </tr>
                    )}
                    {expanded && detail === "patients" &&
                      (p.patientList.length === 0 ? (
                        <tr key={`${p.payerId}-nopatients`} className="border-b border-line bg-surface-subtle">
                          <td colSpan={8} className="px-10 py-2.5 text-[12px] font-medium text-ink-faint">
                            {isAr ? "مفيش مرضى في الفترة دي." : "No patients in this period."}
                          </td>
                        </tr>
                      ) : (
                        p.patientList.map((person) => (
                          <tr key={`${p.payerId}-${person.patientId}`} className="border-b border-line bg-surface-subtle">
                            <td className="px-10 py-2 text-[12.5px] font-medium text-ink-body">
                              {person.patientName || (isAr ? "بدون اسم" : "Unnamed")}
                            </td>
                            <td className="px-3 py-2 text-end font-figure text-[12.5px] text-ink-body">{person.cases}</td>
                            <td className="px-3 py-2" />
                            <td className="px-3 py-2 text-end font-figure text-[12.5px] text-ink-faint">{fmt(person.charged)}</td>
                            <td className="px-3 py-2 text-end font-figure text-[12.5px] text-ink-body">{fmt(person.collected)}</td>
                            <td className="px-3 py-2" />
                            <td className="px-3 py-2" />
                            <td className="px-3 py-2" />
                          </tr>
                        ))
                      ))}
                    {expanded && detail === "doctors" &&
                      (p.doctors.length === 0 ? (
                        <tr key={`${p.payerId}-none`} className="border-b border-line bg-surface-subtle">
                          <td colSpan={8} className="px-10 py-2.5 text-[12px] font-medium text-ink-faint">
                            {isAr ? "مفيش علاج متسجل باسم دكتور هنا." : "No treatment here is attributed to a dentist."}
                          </td>
                        </tr>
                      ) : (
                        p.doctors.map((d) => (
                          <tr key={`${p.payerId}-${d.doctorId}`} className="border-b border-line bg-surface-subtle">
                            <td className="px-10 py-2 text-[12.5px] font-medium text-ink-body">
                              {d.doctorName || (isAr ? "بدون اسم" : "Unnamed")}
                              {d.ratePct !== null && (
                                <span className="ms-2 font-figure text-[11px] text-ink-faint">{d.ratePct}%</span>
                              )}
                              {/* Who the work was for, under the name rather than a tab away: the
                                  figure on this row immediately raises the question "on whom?",
                                  and answering it elsewhere means holding one number in your head
                                  while you go and find the other. Three names, then a count —
                                  a dentist with a busy month must not push the table sideways. */}
                              {d.patients.length > 0 && (
                                <p className="mt-0.5 truncate text-[11.5px] font-medium text-ink-faint">
                                  {d.patients.slice(0, 3).join(isAr ? "، " : ", ")}
                                  {d.patients.length > 3 && ` +${d.patients.length - 3}`}
                                </p>
                              )}
                            </td>
                            <td className="px-3 py-2 text-end font-figure text-[12.5px] text-ink-body">{d.cases}</td>
                            <td className="px-3 py-2" />
                            <td className="px-3 py-2 text-end font-figure text-[12.5px] text-ink-faint">{fmt(d.charged)}</td>
                            <td className="px-3 py-2 text-end font-figure text-[12.5px] text-ink-body">{fmt(d.collected)}</td>
                            <td className="px-3 py-2" />
                            <td className="px-3 py-2 text-end font-figure text-[12.5px] text-ink-body">{fmt(d.commission)}</td>
                            <td className="px-3 py-2" />
                          </tr>
                        ))
                      ))}
                  </Fragment>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-line bg-surface-subtle">
                <td className="px-3 py-3 text-[12px] font-black uppercase tracking-wider text-ink-muted">
                  {isAr ? "الإجمالي" : "Total"}
                </td>
                <td className="px-3 py-3 text-end font-figure text-[13px] font-bold text-ink">{report.totals.cases}</td>
                <td className="px-3 py-3 text-end font-figure text-[13px] font-bold text-ink">{report.totals.patients}</td>
                <td className="px-3 py-3 text-end font-figure text-[13px] text-ink-muted">{fmt(report.totals.charged)}</td>
                <td className="px-3 py-3 text-end font-figure text-[13px] font-bold text-ink">{fmt(report.totals.collected)}</td>
                <td className="px-3 py-3 text-end font-figure text-[13px] text-ink-muted">{fmt(report.totals.labFees)}</td>
                <td className="px-3 py-3 text-end font-figure text-[13px] text-ink-muted">{fmt(report.totals.commission)}</td>
                <td className="px-3 py-3 text-end font-figure text-[13px] font-bold text-ink">{fmt(report.totals.clinicNet)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        <p className="mt-2 px-1 text-[11.5px] font-medium text-ink-faint">
          {isAr
            ? "«المطلوب» هو سعر العلاجات، و«المحصّل» هو اللي دخل فعلاً. النِسَب بتتحسب على المحصّل."
            : "Charged is what the treatments came to; collected is money actually received. Commission is calculated on what was collected."}
        </p>
      </section>

      {/* --- by dentist: the payroll view ---------------------------------------------------- */}
      {payroll.length > 0 && (
        <section>
          <h3 className="mb-3 px-1 font-display text-[11px] font-black uppercase tracking-[0.18em] text-ink-muted">
            {isAr ? "مستحقات كل دكتور، حسب الجهة" : "What each dentist earned, by payer"}
          </h3>
          <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
            <table className="w-full min-w-[34rem] border-collapse">
              <thead>
                <tr className="border-b border-line bg-surface-subtle">
                  <th className="px-4 py-3 text-start text-[10.5px] font-black uppercase tracking-wider text-ink-muted">
                    {isAr ? "الدكتور" : "Dentist"}
                  </th>
                  {columns.map((p) => (
                    <th
                      key={p.payerId}
                      className="px-3 py-3 text-end text-[10.5px] font-black uppercase tracking-wider text-ink-muted"
                    >
                      {p.payerName}
                    </th>
                  ))}
                  <th className="px-4 py-3 text-end text-[10.5px] font-black uppercase tracking-wider text-ink">
                    {isAr ? "الإجمالي" : "Total"}
                  </th>
                </tr>
              </thead>
              <tbody>
                {payroll.map((row) => (
                  <tr key={row.doctorId} className="border-b border-line last:border-b-0">
                    <td className="px-4 py-2.5 text-[13.5px] font-bold text-ink">
                      {row.doctorName || (isAr ? "بدون اسم" : "Unnamed")}
                      <span className="ms-2 font-figure text-[11px] font-medium text-ink-faint">
                        {row.totalCases} {isAr ? "حالة" : row.totalCases === 1 ? "case" : "cases"}
                      </span>
                    </td>
                    {columns.map((p) => {
                      const cell = row.byPayer[p.payerId];
                      return (
                        <td key={p.payerId} className="px-3 py-2.5 text-end">
                          {cell ? (
                            <>
                              <span className="font-figure text-[13px] text-ink-body">{fmt(cell.commission)}</span>
                              {cell.ratePct !== null && (
                                <span className="ms-1.5 font-figure text-[10.5px] text-ink-faint">
                                  {cell.ratePct}%
                                </span>
                              )}
                            </>
                          ) : (
                            <span className="font-figure text-[13px] text-ink-faint">—</span>
                          )}
                        </td>
                      );
                    })}
                    <td className="px-4 py-2.5 text-end font-figure text-[13.5px] font-bold text-ink">
                      {fmt(row.totalCommission)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!hasInsurance && (
            <p className="mt-2 px-1 text-[11.5px] font-medium text-ink-faint">
              {isAr
                ? "لسه مفيش شركات تأمين متسجلة — ضيفها من الإعدادات ← التأمين وجهات الدفع وهتتقسم هنا لوحدها."
                : "No insurers set up yet — add them under Settings → Payers & Insurance and the split appears here on its own."}
            </p>
          )}
        </section>
      )}
    </div>
  );
}
