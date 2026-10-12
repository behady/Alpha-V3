"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, FileSpreadsheet, Search, X } from "lucide-react";
import { exportToExcel } from "./reportExcelUtils";
import InsurerBadge from "@/components/shared/InsurerBadge";
import { PRIVATE_PAYER_ID } from "@/lib/payers";
import {
  EMPTY_FILTERS,
  PAGE_SIZES,
  buildCaseSheet,
  filterCases,
  optionsFor,
  pageOf,
  settlementOf,
  sumCases,
  type CaseFilters,
  type SheetLedgerRow,
} from "@/lib/caseSheet";

/**
 * The sheet the clinic was keeping on paper: one line per case, and a filter on every column.
 *
 * Every other report here groups something — by payer, by dentist, by service — and grouping is
 * what makes a number arguable. This one refuses to group, so it is the report the others get
 * checked against: run your finger down it, narrow it until only the rows in dispute are left,
 * and the totals underneath follow the filter rather than the period.
 *
 * Three decisions worth keeping:
 *
 *  - **The totals describe what is on screen.** Filter to one insurer and the totals are that
 *    insurer's. A footer that kept showing the period's totals while the rows narrowed would be
 *    read as the filtered figure by everyone, once, and be wrong every time.
 *  - **Paid is per case, not per patient.** A part-paid crown shows part paid and the rest
 *    outstanding. The patient's balance is a different question asked on a different screen.
 *  - **Export takes the filtered rows**, in the order shown. An export that quietly widened back
 *    to everything would be a different document from the one on screen.
 */

interface Props {
  procedures: SheetLedgerRow[];
  payments: SheetLedgerRow[];
  rangeLabel: string;
  isAr: boolean;
}

const fmt = (n: number) => Math.round(n).toLocaleString();

export default function CaseSheetReport({ procedures, payments, rangeLabel, isAr }: Props) {
  const all = useMemo(() => buildCaseSheet(procedures, payments), [procedures, payments]);
  const [filters, setFilters] = useState<CaseFilters>(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [size, setSize] = useState<number>(PAGE_SIZES[0]);

  const rows = useMemo(() => filterCases(all, filters), [all, filters]);
  const totals = useMemo(() => sumCases(rows), [rows]);
  const paged = useMemo(() => pageOf(rows, page, size), [rows, page, size]);

  /*
   * Stepping works off the page `pageOf` actually returned, not the one in state.
   *
   * Narrowing the list can leave `page` pointing past the end — a new date range shrinks the rows
   * without going through a setter. `pageOf` clamps what is displayed, and reading `paged.page`
   * here means the next click continues from what the reader can see. Correcting the state in an
   * effect instead would be a second render for no gain, and the lint rule against that is right.
   */

  const set = (patch: Partial<CaseFilters>) => {
    setFilters((current) => ({ ...current, ...patch }));
    setPage(1);
  };

  const payers = useMemo(() => optionsFor(all, "payer"), [all]);
  const doctors = useMemo(() => optionsFor(all, "doctor"), [all]);
  const services = useMemo(() => optionsFor(all, "service"), [all]);
  const dirty = JSON.stringify(filters) !== JSON.stringify(EMPTY_FILTERS);

  const columns = [
    isAr ? "التاريخ" : "Date",
    isAr ? "الشركة" : "Company",
    isAr ? "المريض" : "Patient",
    isAr ? "الخدمة" : "Service",
    isAr ? "السعر" : "Price",
    isAr ? "المدفوع" : "Paid",
    isAr ? "الدكتور" : "Dentist",
    isAr ? "نصيب الدكتور" : "Dentist's share",
  ];

  const exportSheet = () =>
    exportToExcel(
      rows.map((r) => ({
        [columns[0]]: r.date,
        [columns[1]]: r.payerName,
        [columns[2]]: r.patientName,
        [columns[3]]: r.service,
        [columns[4]]: r.price,
        [columns[5]]: r.paid,
        [columns[6]]: r.doctorName,
        [columns[7]]: r.share,
      })),
      `Case_Sheet_${new Date().toISOString().slice(0, 10)}`,
    );

  const selectClass =
    "rounded-xl border border-line bg-surface px-2.5 py-2 text-[12.5px] font-bold text-ink-body outline-none transition focus:border-accent";
  /*
    A select is as wide as its longest option, and "All services" carried a 600px treatment name:
    on a phone the filter ran off the screen and dragged the page sideways. Full width (one per
    row) below sm, natural width above.
  */
  const filterClass = `${selectClass} w-full min-w-0 max-w-full max-sm:min-h-10 sm:w-auto`;
  /** On-screen only: the stored default payer name is English. */
  const payerLabel = (r: { payerId: string; payerName: string }) => (isAr && r.payerId === PRIVATE_PAYER_ID ? "خاص" : r.payerName);

  return (
    <div className="space-y-4">
      {/* --- the filters, one per column that has something to choose from ------------------ */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="relative w-full sm:w-auto">
          <Search size={13} className="pointer-events-none absolute top-1/2 start-2.5 -translate-y-1/2 text-ink-faint" />
          <input
            value={filters.patient}
            onChange={(e) => set({ patient: e.target.value })}
            placeholder={isAr ? "ابحث باسم المريض" : "Search patient"}
            className="w-full max-sm:min-h-10 sm:w-44 rounded-xl border border-line bg-surface py-2 pe-2.5 ps-8 text-[12.5px] font-bold text-ink outline-none transition focus:border-accent"
          />
        </span>

        <select value={filters.payerId} onChange={(e) => set({ payerId: e.target.value })} className={filterClass}>
          <option value="">{isAr ? "كل الشركات" : "All companies"}</option>
          {payers.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>

        <select value={filters.doctorId} onChange={(e) => set({ doctorId: e.target.value })} className={filterClass}>
          <option value="">{isAr ? "كل الأطباء" : "All dentists"}</option>
          {doctors.map((o) => (
            <option key={o.value} value={o.value === "general" ? "" : o.value}>
              {o.label}
            </option>
          ))}
        </select>

        <select value={filters.service} onChange={(e) => set({ service: e.target.value })} className={filterClass}>
          <option value="">{isAr ? "كل الخدمات" : "All services"}</option>
          {services.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>

        <select value={filters.settled} onChange={(e) => set({ settled: e.target.value })} className={filterClass}>
          <option value="">{isAr ? "الكل" : "Any status"}</option>
          <option value="paid">{isAr ? "مدفوع بالكامل" : "Paid"}</option>
          <option value="partly">{isAr ? "مدفوع جزئياً" : "Part paid"}</option>
          <option value="unpaid">{isAr ? "مش مدفوع" : "Unpaid"}</option>
        </select>

        {dirty && (
          <button
            type="button"
            onClick={() => {
              setFilters(EMPTY_FILTERS);
              setPage(1);
            }}
            className="inline-flex items-center gap-1 rounded-xl px-2.5 py-2 text-[12px] font-black text-ink-faint transition hover:text-ink"
          >
            <X size={13} />
            {isAr ? "امسح الفلاتر" : "Clear"}
          </button>
        )}

        <button
          type="button"
          onClick={exportSheet}
          disabled={rows.length === 0}
          className="ms-auto inline-flex items-center gap-1.5 rounded-xl border border-line px-3 py-2 text-[12px] font-black text-ink-body transition-colors hover:text-ink disabled:opacity-50"
        >
          <FileSpreadsheet size={13} />
          {isAr ? `تصدير (${rows.length})` : `Export (${rows.length})`}
        </button>
      </div>

      {/* --- the sheet ---------------------------------------------------------------------- */}
      {/* Phones: one card per case (the table is 52rem). Same rows, same paging, same totals. */}
      <ul className="divide-y divide-line rounded-2xl border border-line bg-surface md:hidden">
        {paged.rows.length === 0 ? (
          <li className="px-4 py-10 text-center text-[13px] font-medium text-ink-faint">
            {all.length === 0
              ? isAr ? "مفيش حالات في الفترة دي." : "No cases in this period."
              : isAr ? "مفيش حالات مطابقة للفلاتر." : "No cases match these filters."}
          </li>
        ) : (
          paged.rows.map((r) => {
            const state = settlementOf(r);
            return (
              <li key={r.id} className="px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <p className="min-w-0 break-words text-[13.5px] font-bold text-ink">{r.patientName}</p>
                  <span className="shrink-0 font-figure text-[12px] text-ink-faint">{r.date}</span>
                </div>
                <p className="mt-0.5 break-words text-[12.5px] font-medium text-ink-body">{r.service}</p>
                <p className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[12px] font-semibold text-ink-muted">
                  <InsurerBadge name={r.payerName} isPrivate={r.payerId === PRIVATE_PAYER_ID} size={16} />
                  <span dir="auto">{payerLabel(r)}</span>
                  {r.doctorName ? <span>· <bdi>{r.doctorName}</bdi></span> : null}
                </p>
                <dl className="mt-2 grid grid-cols-3 gap-2">
                  <div className="min-w-0">
                    <dt className="text-[11px] font-semibold text-ink-muted">{columns[4]}</dt>
                    <dd className="font-figure text-[13px] text-ink-muted">{fmt(r.price)}</dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="text-[11px] font-semibold text-ink-muted">{columns[5]}</dt>
                    <dd className="font-figure text-[13px] font-bold text-ink">
                      {fmt(r.paid)}
                      {state !== "paid" && (
                        <span className="block text-[10.5px] font-bold text-danger">
                          {/* bdi ltr: in Arabic a bare "−495" lays out with the sign at the far end. */}
                          {state === "unpaid" ? (isAr ? "مش مدفوع" : "unpaid") : <bdi dir="ltr">−{fmt(r.price - r.paid)}</bdi>}
                        </span>
                      )}
                    </dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="text-[11px] font-semibold text-ink-muted">{columns[7]}</dt>
                    <dd className="font-figure text-[13px] text-ink-body">{fmt(r.share)}</dd>
                  </div>
                </dl>
              </li>
            );
          })
        )}
        {rows.length > 0 && (
          <li className="bg-surface-subtle px-4 py-3">
            <p className="text-[11.5px] font-black uppercase tracking-wider text-ink-muted">
              {isAr ? `إجمالي ${totals.cases} حالة` : `${totals.cases} cases`}
              {dirty && <span className="ms-2 normal-case tracking-normal text-ink-faint">{isAr ? "(بعد الفلترة)" : "(filtered)"}</span>}
            </p>
            <dl className="mt-2 grid grid-cols-3 gap-2">
              <div className="min-w-0">
                <dt className="text-[11px] font-semibold text-ink-muted">{columns[4]}</dt>
                <dd className="font-figure text-[13px] text-ink-muted">{fmt(totals.price)}</dd>
              </div>
              <div className="min-w-0">
                <dt className="text-[11px] font-semibold text-ink-muted">{columns[5]}</dt>
                <dd className="font-figure text-[13px] font-bold text-ink">
                  {fmt(totals.paid)}
                  {totals.outstanding > 0 && <span className="block text-[10.5px] font-bold text-danger"><bdi dir="ltr">−{fmt(totals.outstanding)}</bdi></span>}
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="text-[11px] font-semibold text-ink-muted">{columns[7]}</dt>
                <dd className="font-figure text-[13px] font-bold text-ink">{fmt(totals.share)}</dd>
              </div>
            </dl>
          </li>
        )}
      </ul>
      <div className="hidden overflow-x-auto rounded-2xl border border-line bg-surface md:block">
        <table className="w-full min-w-[52rem] border-collapse">
          <thead>
            <tr className="border-b border-line bg-surface-subtle">
              {columns.map((c, i) => (
                <th
                  key={c}
                  className={`px-3 py-3 text-[10.5px] font-black uppercase tracking-wider text-ink-muted ${
                    i >= 4 && i !== 6 ? "text-end" : "text-start"
                  }`}
                >
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {paged.rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-4 py-10 text-center text-[13px] font-medium text-ink-faint">
                  {all.length === 0
                    ? isAr
                      ? "مفيش حالات في الفترة دي."
                      : "No cases in this period."
                    : isAr
                      ? "مفيش حالات مطابقة للفلاتر."
                      : "No cases match these filters."}
                </td>
              </tr>
            ) : (
              paged.rows.map((r) => {
                const state = settlementOf(r);
                return (
                  <tr key={r.id} className="border-b border-line last:border-b-0">
                    <td className="whitespace-nowrap px-3 py-2.5 font-figure text-[12.5px] text-ink-faint">{r.date}</td>
                    <td className="px-3 py-2.5 text-[13px] font-bold text-ink">
                      <span className="flex items-center gap-1.5">
                        <InsurerBadge name={r.payerName} isPrivate={r.payerId === PRIVATE_PAYER_ID} size={20} />
                        {payerLabel(r)}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-[13px] font-medium text-ink-body">{r.patientName}</td>
                    <td className="px-3 py-2.5 text-[13px] font-medium text-ink-body">{r.service}</td>
                    <td className="px-3 py-2.5 text-end font-figure text-[13px] text-ink-muted">{fmt(r.price)}</td>
                    <td className="px-3 py-2.5 text-end font-figure text-[13px] font-bold text-ink">
                      {fmt(r.paid)}
                      {/* The gap, stated rather than left to subtraction. An unpaid case is the
                          one thing a clinic scans this sheet looking for. */}
                      {state !== "paid" && (
                        <span className="ms-1.5 text-[10.5px] font-bold text-danger">
                          {state === "unpaid"
                            ? isAr
                              ? "مش مدفوع"
                              : "unpaid"
                            : `−${fmt(r.price - r.paid)}`}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-[13px] font-medium text-ink-body">{r.doctorName}</td>
                    <td className="px-3 py-2.5 text-end font-figure text-[13px] text-ink-body">{fmt(r.share)}</td>
                  </tr>
                );
              })
            )}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr className="border-t-2 border-line bg-surface-subtle">
                <td colSpan={4} className="px-3 py-3 text-[11.5px] font-black uppercase tracking-wider text-ink-muted">
                  {isAr ? `إجمالي ${totals.cases} حالة` : `${totals.cases} cases`}
                  {dirty && (
                    <span className="ms-2 normal-case tracking-normal text-ink-faint">
                      {isAr ? "(بعد الفلترة)" : "(filtered)"}
                    </span>
                  )}
                </td>
                <td className="px-3 py-3 text-end font-figure text-[13px] text-ink-muted">{fmt(totals.price)}</td>
                <td className="px-3 py-3 text-end font-figure text-[13px] font-bold text-ink">
                  {fmt(totals.paid)}
                  {totals.outstanding > 0 && (
                    <span className="ms-1.5 text-[10.5px] font-bold text-danger">−{fmt(totals.outstanding)}</span>
                  )}
                </td>
                <td />
                <td className="px-3 py-3 text-end font-figure text-[13px] font-bold text-ink">{fmt(totals.share)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {/* --- paging ------------------------------------------------------------------------- */}
      {rows.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 px-1">
          <p className="font-figure text-[12px] text-ink-faint">
            {isAr
              ? `${paged.from}–${paged.to} من ${paged.total}`
              : `${paged.from}–${paged.to} of ${paged.total}`}
          </p>
          <div className="flex items-center gap-2">
            <select
              value={size}
              onChange={(e) => {
                setSize(Number(e.target.value));
                setPage(1);
              }}
              className={selectClass}
            >
              {PAGE_SIZES.map((n) => (
                <option key={n} value={n}>
                  {isAr ? `${n} في الصفحة` : `${n} per page`}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => setPage(Math.max(1, paged.page - 1))}
              disabled={paged.page <= 1}
              aria-label={isAr ? "السابق" : "Previous"}
              className="grid size-9 place-items-center rounded-xl border border-line text-ink-body transition-colors hover:text-ink disabled:opacity-40"
            >
              {isAr ? <ChevronRight size={15} /> : <ChevronLeft size={15} />}
            </button>
            <span className="font-figure text-[12.5px] font-bold text-ink-body">
              {paged.page} / {paged.pages}
            </span>
            <button
              type="button"
              onClick={() => setPage(paged.page + 1)}
              disabled={paged.page >= paged.pages}
              aria-label={isAr ? "التالي" : "Next"}
              className="grid size-9 place-items-center rounded-xl border border-line text-ink-body transition-colors hover:text-ink disabled:opacity-40"
            >
              {isAr ? <ChevronLeft size={15} /> : <ChevronRight size={15} />}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
