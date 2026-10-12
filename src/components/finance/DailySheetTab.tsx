"use client";

/**
 * The Finance page's "Daily sheet" tab: the desk's day as the clinic kept it in Excel — a numbered
 * line per patient with their file (the clinic's own, or the insurer's), how they paid, the day's
 * total, what they paid and what is left — and an Export button that writes the same sheet.
 *
 * The period is the page's (Daily / Monthly / Range), and the rows are the page's, already narrowed
 * to the branch on screen; the figures come from `dailySheet`, so the screen and the file agree.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { FileSpreadsheet, Loader2 } from "lucide-react";
import { useLanguage } from "@/context/LanguageContext";
import { useUI } from "@/context/UIContext";
import InsurerBadge from "@/components/shared/InsurerBadge";
import { dailySheet, sheetDay, sheetMethodLabel, type SheetLedgerRow, type SheetLine } from "@/lib/dailySheet";

type PayerLite = { id: string; name: string; nameAr?: string };

export default function DailySheetTab({
  rows,
  isLoading,
  start,
  end,
  payers,
  branchName,
}: {
  /** The period's treatment charges and cash rows, on the branch on screen. */
  rows: readonly SheetLedgerRow[];
  isLoading: boolean;
  /** The period, yyyy-mm-dd, for the file's heading and name. */
  start: string;
  end: string;
  /** Every payer the clinic has, to name an insurer by its current name. */
  payers: readonly PayerLite[];
  /** The branch on screen, when there is one, for the file's heading. */
  branchName?: string;
}) {
  const { language } = useLanguage();
  const { showToast } = useUI();
  const ar = language === "ar";
  const [exporting, setExporting] = useState(false);

  const { lines, totals } = useMemo(() => dailySheet(rows), [rows]);

  const fmt = (v: number) => v.toLocaleString(ar ? "ar-EG" : "en-US", { maximumFractionDigits: 2 });
  /** Whose file a line is: the insurers behind the day's work, or the clinic's own. */
  const fileNames = (line: SheetLine): string[] =>
    line.payerIds.map((id, i) => {
      const p = payers.find((x) => x.id === id);
      return (p ? (ar && p.nameAr ? p.nameAr : p.name) : "") || line.payerNames[i] || id;
    });
  const fileLabel = (line: SheetLine) => fileNames(line).join(" + ") || (ar ? "ملف" : "File");
  const methodText = (line: SheetLine) => line.methods.map((m) => sheetMethodLabel(m, ar)).join(" + ") || "—";

  const exportSheet = async () => {
    setExporting(true);
    try {
      const [{ default: XLSX }, { dailySheetWorkbook, dailySheetFileName }] = await Promise.all([
        import("xlsx-js-style"),
        import("@/lib/dailySheetXlsx"),
      ]);
      const wb = dailySheetWorkbook({
        lines: lines.map((l) => ({
          n: l.n,
          date: l.date,
          file: fileLabel(l),
          patient: l.patientName,
          method: methodText(l),
          work: l.work,
          company: l.company,
          total: l.total,
          paid: l.paid,
          remaining: l.remaining,
        })),
        byMethod: totals.byMethod.map((m) => ({ label: sheetMethodLabel(m.method, ar), paid: m.paid })),
        start,
        end,
        branchName,
        isAr: ar,
      });
      XLSX.writeFile(wb, dailySheetFileName(start, end), { compression: true });
    } catch (err) {
      console.error("Daily sheet export failed:", err);
      showToast(ar ? "مقدرناش نجهّز ملف الإكسل" : "Could not make the Excel file", "error");
    } finally {
      setExporting(false);
    }
  };

  const figures = [
    { label: ar ? "قيمة الشغل" : "Work done", value: totals.work, tone: "text-white" },
    { label: ar ? "على الشركة" : "Company owes", value: totals.company, tone: "text-white/80" },
    { label: ar ? "المطلوب من المريض" : "Patient owes", value: totals.total, tone: "text-white" },
    { label: ar ? "المدفوع" : "Paid", value: totals.paid, tone: "text-emerald-300" },
    { label: ar ? "المتبقي" : "Remaining", value: totals.remaining, tone: totals.remaining > 0.009 ? "text-amber-300" : "text-white/60" },
  ];

  return (
    <div className="flex flex-col gap-4 xl:gap-6 flex-1">
      <div className="rounded-2xl xl:rounded-3xl bg-ink-slab text-white p-5 xl:p-7 shadow-xl shadow-slate-900/20">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-widest text-white/50">{ar ? "اليومية" : "Daily sheet"}</p>
            <p className="mt-1 text-sm font-medium text-white/60">
              {ar ? "سطر لكل مريض في اليوم: الملف، طريقة الدفع، قيمة الشغل، اللي على الشركة، المطلوب من المريض، المدفوع والمتبقي." : "One line per patient per day: file, method, work done, what the company owes, what the patient owes, paid and remaining."}
            </p>
          </div>
          <button
            type="button"
            onClick={exportSheet}
            disabled={isLoading || exporting}
            className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-xs font-bold text-ink-on-accent shadow-md hover:bg-accent-strong disabled:opacity-50 transition-colors"
          >
            {exporting ? <Loader2 size={16} className="animate-spin" /> : <FileSpreadsheet size={16} />}
            {ar ? "تصدير Excel" : "Export to Excel"}
          </button>
        </div>
        <dl className="mt-5 grid grid-cols-2 sm:grid-cols-5 gap-4">
          {figures.map((f) => (
            <div key={f.label} className="min-w-0">
              <dt className="text-[11px] font-bold uppercase tracking-wider text-white/50">{f.label}</dt>
              <dd className={`mt-1 font-figure text-2xl xl:text-3xl font-black ${f.tone}`}>{isLoading ? "—" : fmt(f.value)}</dd>
            </div>
          ))}
        </dl>
        {!isLoading && totals.byMethod.length > 0 && (
          <p className="mt-4 flex flex-wrap gap-x-5 gap-y-1 border-t border-white/10 pt-4 text-xs font-semibold text-white/60">
            {totals.byMethod.map((m) => (
              <span key={m.method}>
                {sheetMethodLabel(m.method, ar)} <span className="font-figure font-black text-white">{fmt(m.paid)}</span>
              </span>
            ))}
          </p>
        )}
      </div>

      <div className="bg-surface rounded-2xl xl:rounded-3xl border border-slate-200/80 shadow-sm overflow-hidden flex flex-col flex-1 min-h-[320px] ring-1 ring-slate-100">
        {isLoading ? (
          <div className="flex-1 flex flex-col items-center justify-center text-slate-400 min-h-[240px]">
            <Loader2 size={28} className="animate-spin mb-3 text-accent-soft" />
            <p className="font-bold text-xs text-ink-muted uppercase tracking-widest">{ar ? "جاري التحميل..." : "Loading..."}</p>
          </div>
        ) : lines.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center px-6 py-16">
            <p className="font-bold text-ink-body">{ar ? "مفيش مرضى في الفترة دي." : "No patients in this period."}</p>
            <p className="text-sm text-ink-muted mt-1">{ar ? "غيّر التاريخ أو الفرع." : "Try another date or branch."}</p>
          </div>
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden lg:block overflow-x-auto flex-1">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-[11px] font-black uppercase tracking-wider text-slate-400">
                    <th className="text-center py-3 ps-5 pe-2 w-12">#</th>
                    <th className="text-start py-3 px-3 whitespace-nowrap">{ar ? "التاريخ" : "Date"}</th>
                    <th className="text-start py-3 px-3">{ar ? "الملف" : "File"}</th>
                    <th className="text-start py-3 px-3">{ar ? "المريض" : "Patient"}</th>
                    <th className="text-start py-3 px-3">{ar ? "طريقة الدفع" : "Method"}</th>
                    <th className="text-end py-3 px-3 whitespace-nowrap">{ar ? "قيمة الشغل" : "Work done"}</th>
                    <th className="text-end py-3 px-3 whitespace-nowrap">{ar ? "على الشركة" : "Company owes"}</th>
                    <th className="text-end py-3 px-3 whitespace-nowrap">{ar ? "المطلوب" : "Patient owes"}</th>
                    <th className="text-end py-3 px-3 whitespace-nowrap">{ar ? "المدفوع" : "Paid"}</th>
                    <th className="text-end py-3 pe-5 ps-3 whitespace-nowrap">{ar ? "المتبقي" : "Remaining"}</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l) => (
                    <tr key={`${l.date}|${l.patientId || l.patientName}`} className="border-b border-slate-100 last:border-0 even:bg-surface-subtle">
                      <td className="py-3 ps-5 pe-2 text-center font-figure text-xs font-bold text-ink-muted">{l.n}</td>
                      <td className="py-3 px-3 font-figure text-xs font-bold text-ink-body whitespace-nowrap">{sheetDay(l.date)}</td>
                      <td className="py-3 px-3"><FileCell names={fileNames(l)} ar={ar} /></td>
                      <td className="py-3 px-3 font-semibold text-ink">
                        <PatientName line={l} />
                      </td>
                      <td className="py-3 px-3 text-ink-body whitespace-nowrap">{methodText(l)}</td>
                      <td className="py-3 px-3 text-end font-figure font-bold text-ink-body">{fmt(l.work)}</td>
                      <td className="py-3 px-3 text-end font-figure font-bold text-ink-body">{fmt(l.company)}</td>
                      <td className="py-3 px-3 text-end font-figure font-bold text-ink">{fmt(l.total)}</td>
                      <td className="py-3 px-3 text-end font-figure text-emerald-700 font-bold">{fmt(l.paid)}</td>
                      <td className={`py-3 pe-5 ps-3 text-end font-figure font-black ${l.remaining > 0.009 ? "text-amber-700" : "text-ink-muted"}`}>{fmt(l.remaining)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-slate-200 bg-surface-subtle font-black">
                    <td className="py-3 ps-5 pe-2" />
                    <td colSpan={4} className="py-3 px-3 text-ink">{ar ? "الإجمالي" : "Total"}</td>
                    <td className="py-3 px-3 text-end font-figure text-ink-body">{fmt(totals.work)}</td>
                    <td className="py-3 px-3 text-end font-figure text-ink-body">{fmt(totals.company)}</td>
                    <td className="py-3 px-3 text-end font-figure text-ink">{fmt(totals.total)}</td>
                    <td className="py-3 px-3 text-end font-figure text-emerald-700">{fmt(totals.paid)}</td>
                    <td className="py-3 pe-5 ps-3 text-end font-figure text-amber-700">{fmt(totals.remaining)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>

            {/* Phones: one card per line */}
            <ul className="lg:hidden divide-y divide-slate-100">
              {lines.map((l) => (
                <li key={`${l.date}|${l.patientId || l.patientName}`} className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-bold text-ink">
                        <span className="font-figure text-xs text-ink-muted me-2">{l.n}</span>
                        <PatientName line={l} />
                      </p>
                      <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink-muted">
                        <span className="font-figure font-bold">{sheetDay(l.date)}</span>
                        <FileCell names={fileNames(l)} ar={ar} />
                        <span>{methodText(l)}</span>
                      </p>
                    </div>
                    <p className={`shrink-0 font-figure text-base font-black ${l.remaining > 0.009 ? "text-amber-700" : "text-ink-muted"}`}>{fmt(l.remaining)}</p>
                  </div>
                  <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs font-semibold text-ink-muted">
                    <span>{ar ? "الشغل" : "Work"} <span className="font-figure font-black text-ink">{fmt(l.work)}</span></span>
                    {l.company > 0.009 && <span>{ar ? "على الشركة" : "Company"} <span className="font-figure font-black text-ink">{fmt(l.company)}</span></span>}
                    <span>{ar ? "المطلوب" : "Patient"} <span className="font-figure font-black text-ink">{fmt(l.total)}</span></span>
                    <span>{ar ? "المدفوع" : "Paid"} <span className="font-figure font-black text-emerald-700">{fmt(l.paid)}</span></span>
                  </p>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}

function PatientName({ line }: { line: SheetLine }) {
  const name = <bdi>{line.patientName || "—"}</bdi>;
  if (!line.patientId) return name;
  return (
    <Link href={`/patients/${line.patientId}?tab=finance`} className="hover:underline underline-offset-2">
      {name}
    </Link>
  );
}

function FileCell({ names, ar }: { names: string[]; ar: boolean }) {
  if (names.length === 0) {
    return <span className="inline-flex rounded-full border border-line px-2 py-0.5 text-[11px] font-bold text-ink-body">{ar ? "ملف" : "File"}</span>;
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {names.map((name) => (
        <span key={name} className="inline-flex items-center gap-1.5 text-xs font-bold text-ink">
          <InsurerBadge name={name} size={16} />
          {name}
        </span>
      ))}
    </span>
  );
}
