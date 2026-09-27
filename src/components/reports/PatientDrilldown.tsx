"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight, ExternalLink, FileSpreadsheet, Search, Users } from "lucide-react";
import { exportToExcel } from "./reportExcelUtils";
import { dayText } from "@/lib/reportHelpers";
import { matchesPatient, summarize, type PatientRollup } from "@/lib/reportPatients";

/**
 * The drawer under a figure: who it is made of.
 *
 * Every grouped report ends in a number, and the number's first question is "who?". This is the
 * one answer, used by every tab, so the list of twelve Instagram patients and the list of four
 * crown patients look and behave the same: a name that opens the patient's file, a phone to call,
 * when they came, what was done, who did it, and what they paid — in the period on screen.
 *
 * Two shapes:
 *
 *  - **framed** (default): a closed strip with the count and the money, which opens on click.
 *    For a figure that stands alone — a dentist's card, the new-patients tile.
 *  - **embedded**: the table with no frame and no toggle, for a table row that is ALREADY
 *    expanded and would otherwise ask the reader to open a drawer inside a drawer.
 *
 * Long lists get a search box and stop at fifty lines until asked for the rest; a report is not a
 * place to scroll through a whole clinic. Export takes the filtered rows, in the order shown.
 */

interface Props {
  rows: PatientRollup[];
  isAr: boolean;
  /** Heading on the closed strip. Defaults to "Patients". */
  title?: string;
  /** One line under the heading saying what the list is — "from Instagram", "had a crown". */
  note?: string;
  embedded?: boolean;
  defaultOpen?: boolean;
  /** File name stem for the Excel export; no button when omitted. */
  exportName?: string;
}

const SHOW_FIRST = 50;
const SEARCH_FROM = 8;

const fmt = (n: number) => Math.round(n).toLocaleString();

export default function PatientDrilldown({
  rows,
  isAr,
  title,
  note,
  embedded = false,
  defaultOpen = false,
  exportName,
}: Props) {
  const [open, setOpen] = useState(embedded || defaultOpen);
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);

  const filtered = useMemo(() => rows.filter((r) => matchesPatient(r, query)), [rows, query]);
  const totals = useMemo(() => summarize(rows), [rows]);
  const shown = showAll ? filtered : filtered.slice(0, SHOW_FIRST);
  const hidden = filtered.length - shown.length;

  const t = {
    patients: isAr ? "المرضى" : "Patients",
    patient: isAr ? "المريض" : "Patient",
    visits: isAr ? "الزيارات" : "Visits",
    treatment: isAr ? "العلاج" : "Treatment",
    dentist: isAr ? "الدكتور" : "Dentist",
    paid: isAr ? "المدفوع" : "Paid",
    search: isAr ? "ابحث بالاسم أو الرقم" : "Search by name or phone",
    none: isAr ? "مفيش مرضى في الفترة دي." : "No patients in this period.",
    noMatch: isAr ? "مفيش مريض بالاسم ده." : "No patient matches.",
    open: isAr ? "افتح الملف" : "Open file",
    showAll: (n: number) => (isAr ? `اعرض الباقي (${n})` : `Show the rest (${n})`),
    export: isAr ? "تصدير" : "Export",
    visitWord: (n: number) => (isAr ? (n === 1 ? "زيارة" : "زيارات") : n === 1 ? "visit" : "visits"),
    patientWord: (n: number) => (isAr ? (n === 1 ? "مريض" : "مريض") : n === 1 ? "patient" : "patients"),
    egp: isAr ? "ج.م" : "EGP",
  };

  const exportRows = () => {
    if (!exportName) return;
    exportToExcel(
      filtered.map((r) => ({
        [t.patient]: r.name,
        [isAr ? "الهاتف" : "Phone"]: r.phone,
        [t.visits]: r.visits,
        [isAr ? "أول زيارة" : "First visit"]: r.firstDate,
        [isAr ? "آخر زيارة" : "Last visit"]: r.lastDate,
        [isAr ? "عدد العلاجات" : "Treatments"]: r.procedures,
        [t.treatment]: r.services.join(" + "),
        [t.dentist]: r.doctors.join(", "),
        [isAr ? "السعر" : "Charged"]: r.charged,
        [t.paid]: r.paid,
      })),
      `${exportName}_${new Date().toISOString().slice(0, 10)}`,
      isAr,
    );
  };

  const table = (
    <div className={embedded ? "" : "border-t border-line"}>
      {(rows.length >= SEARCH_FROM || exportName) && rows.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 px-4 py-3">
          {rows.length >= SEARCH_FROM && (
            <span className="relative">
              <Search size={13} className="pointer-events-none absolute top-1/2 start-2.5 -translate-y-1/2 text-ink-faint" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                placeholder={t.search}
                className="w-52 rounded-xl border border-line bg-surface py-1.5 pe-2.5 ps-8 text-[12.5px] font-bold text-ink outline-none transition focus:border-accent"
              />
            </span>
          )}
          {exportName && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                exportRows();
              }}
              className="ms-auto inline-flex items-center gap-1.5 rounded-xl border border-line px-3 py-1.5 text-[11.5px] font-black text-ink-body transition-colors hover:text-ink"
            >
              <FileSpreadsheet size={13} />
              {t.export} ({filtered.length})
            </button>
          )}
        </div>
      )}

      {rows.length === 0 ? (
        <p className="px-4 py-6 text-center text-[12.5px] font-medium text-ink-faint">{t.none}</p>
      ) : filtered.length === 0 ? (
        <p className="px-4 py-6 text-center text-[12.5px] font-medium text-ink-faint">{t.noMatch}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] border-collapse">
            <thead>
              <tr className="border-y border-line bg-surface-subtle">
                <th className="px-4 py-2 text-start text-[10.5px] font-black uppercase tracking-wider text-ink-muted">{t.patient}</th>
                <th className="px-3 py-2 text-start text-[10.5px] font-black uppercase tracking-wider text-ink-muted">{t.visits}</th>
                <th className="px-3 py-2 text-start text-[10.5px] font-black uppercase tracking-wider text-ink-muted">{t.treatment}</th>
                <th className="px-3 py-2 text-start text-[10.5px] font-black uppercase tracking-wider text-ink-muted">{t.dentist}</th>
                <th className="px-4 py-2 text-end text-[10.5px] font-black uppercase tracking-wider text-ink-muted">{t.paid}</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r, i) => (
                <tr key={r.patientId || `${r.name}-${i}`} className="border-b border-line last:border-b-0">
                  <td className="px-4 py-2.5">
                    {r.patientId ? (
                      <Link
                        href={`/patients/${r.patientId}`}
                        onClick={(e) => e.stopPropagation()}
                        title={t.open}
                        className="group inline-flex items-center gap-1.5 text-[13px] font-bold text-ink hover:underline"
                      >
                        {r.name}
                        <ExternalLink size={11} className="text-ink-faint opacity-0 transition-opacity group-hover:opacity-100" />
                      </Link>
                    ) : (
                      <span className="text-[13px] font-bold text-ink">{r.name}</span>
                    )}
                    {r.phone && (
                      <a
                        href={`tel:${r.phone}`}
                        onClick={(e) => e.stopPropagation()}
                        dir="ltr"
                        className="block font-figure text-[11.5px] text-ink-faint hover:text-ink"
                      >
                        {r.phone}
                      </a>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 align-top">
                    <span className="font-figure text-[13px] text-ink-body">{r.visits}</span>
                    {r.lastDate && (
                      <span className="block text-[11px] font-medium text-ink-faint">
                        {r.firstDate && r.firstDate !== r.lastDate
                          ? `${dayText(r.firstDate, isAr)} → ${dayText(r.lastDate, isAr)}`
                          : dayText(r.lastDate, isAr)}
                      </span>
                    )}
                  </td>
                  <td className="max-w-[18rem] px-3 py-2.5 align-top text-[12.5px] font-medium text-ink-body">
                    {r.services.length === 0 ? (
                      <span className="text-ink-faint">—</span>
                    ) : (
                      <>
                        <span className="line-clamp-2" title={r.services.join(" + ")}>
                          {r.services.join(" + ")}
                        </span>
                        {r.procedures > 1 && (
                          <span className="font-figure text-[11px] text-ink-faint">
                            {isAr ? `${r.procedures} علاجات` : `${r.procedures} treatments`}
                          </span>
                        )}
                      </>
                    )}
                  </td>
                  <td className="px-3 py-2.5 align-top text-[12.5px] font-medium text-ink-body">
                    {r.doctors.length === 0 ? <span className="text-ink-faint">—</span> : r.doctors.join(", ")}
                  </td>
                  <td className="px-4 py-2.5 text-end align-top">
                    <span className="font-figure text-[13px] font-bold text-ink">{fmt(r.paid)}</span>
                    {r.charged > r.paid && (
                      <span className="block font-figure text-[10.5px] font-bold text-danger">−{fmt(r.charged - r.paid)}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            {filtered.length > 1 && (
              <tfoot>
                <tr className="border-t-2 border-line bg-surface-subtle">
                  <td colSpan={4} className="px-4 py-2.5 text-[11px] font-black uppercase tracking-wider text-ink-muted">
                    {filtered.length} {t.patientWord(filtered.length)}
                    {query && <span className="ms-2 normal-case tracking-normal text-ink-faint">{isAr ? "(بعد البحث)" : "(filtered)"}</span>}
                  </td>
                  <td className="px-4 py-2.5 text-end font-figure text-[13px] font-bold text-ink">
                    {fmt(filtered.reduce((s, r) => s + r.paid, 0))}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}

      {hidden > 0 && (
        <div className="px-4 py-3 text-center">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setShowAll(true);
            }}
            className="rounded-xl border border-line px-3 py-1.5 text-[12px] font-black text-ink-body transition-colors hover:text-ink"
          >
            {t.showAll(hidden)}
          </button>
        </div>
      )}
    </div>
  );

  if (embedded) return table;

  return (
    <section className="overflow-hidden rounded-2xl border border-line bg-surface">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-4 py-3 text-start transition-colors hover:bg-surface-subtle"
      >
        <Users size={15} className="shrink-0 text-ink-muted" />
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] font-black text-ink">
            {title || t.patients}
            <span className="ms-2 font-figure text-[12px] font-bold text-ink-muted">{totals.patients}</span>
          </span>
          {note && <span className="block truncate text-[11px] font-semibold text-ink-muted">{note}</span>}
        </span>
        {totals.patients > 0 && (
          <span className="hidden shrink-0 font-figure text-[12px] font-semibold text-ink-muted sm:block">
            {totals.visits} {t.visitWord(totals.visits)} · {fmt(totals.paid)} {t.egp}
          </span>
        )}
        {open ? <ChevronDown size={15} className="shrink-0 text-ink-faint" /> : <ChevronRight size={15} className="shrink-0 text-ink-faint rtl:rotate-180" />}
      </button>
      {open && table}
    </section>
  );
}
