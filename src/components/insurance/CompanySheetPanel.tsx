"use client";

/**
 * A contract company's (GASCO's) monthly sheet on the Insurance page, one patient per line.
 *
 * Each patient carries one label against the dates picked above: on this sheet, sent with a month,
 * waiting (a procedure on no sheet yet), or goes on a later month. Tapping him opens his procedures
 * right under his name (`CompanyPatientProcedures`): each with its dates, status and the month of
 * the sheet it goes on. "What goes on this sheet?" opens the month-by-month list with Mark as sent
 * and the Excel (`CompanySheetPreview`).
 *
 * Every list comes from the same placement the Excel report is built from, so what is shown here
 * is exactly what the report prints.
 */

import { useMemo, useState } from "react";
import { ChevronDown, Eye } from "lucide-react";
import { useLanguage } from "@/context/LanguageContext";
import { statementLineText } from "@/lib/insuranceStatement";
import { cardChildren, COMPANY_SHEET_START, placeCharges, type MonthSheet, type SheetCharge, type SheetInputs } from "@/lib/insurance/companySheet";
import { patientRows, type PatientRow } from "@/lib/insurance/sheetPatients";
import CompanyPatientProcedures from "./CompanyPatientProcedures";
import CompanySheetPreview from "./CompanySheetPreview";
import { fill, money, monthShort } from "./sheetFormat";
import { tr } from "./text";

const GREY = "border-line bg-surface-subtle text-ink-body";
const AMBER = "border-amber-100 bg-amber-50 text-amber-800";
const BLACK = "border-ink-slab bg-ink-slab text-white";

export default function CompanySheetPanel({
  clinicId,
  payerId,
  payerName,
  range,
  charges,
  walked,
  allBranchWalked,
  inputs,
  scoped,
  onExcel,
  exporting,
  excelReady,
}: {
  clinicId: string;
  payerId: string;
  payerName: string;
  /** The dates picked on the page (yyyy-mm-dd). */
  range: { start: string; end: string };
  /** The company's live charges for the branch on screen. */
  charges: readonly SheetCharge[];
  /** Every month from the start through today or the end of the dates, whichever is later — for the branch on screen. */
  walked: MonthSheet[];
  /** The same months for every branch (Mark as sent freezes the whole company month). */
  allBranchWalked: MonthSheet[];
  inputs: SheetInputs;
  /** A single branch is on screen, so the lists are not the whole company. */
  scoped: boolean;
  onExcel: () => void;
  exporting: boolean;
  excelReady: boolean;
}) {
  const { language } = useLanguage();
  const ar = language === "ar";
  const t = useMemo(() => tr(ar), [ar]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const from = (range.start > `${COMPANY_SHEET_START}-01` ? range.start : `${COMPANY_SHEET_START}-01`).slice(0, 7);
  const to = range.end.slice(0, 7);
  const placed = useMemo(() => placeCharges({ ...inputs, payerId }), [inputs, payerId]);
  const rows = useMemo(() => (to >= from ? patientRows(charges, placed, from, to) : []), [charges, placed, from, to]);
  const earlier = rows.filter((r) => r.standing.kind === "earlier");
  const visible = showAll ? rows : rows.filter((r) => r.standing.kind !== "earlier");

  const unfinished = useMemo(() => new Set([...placed].filter(([, at]) => !at.done).map(([id]) => id)), [placed]);
  const cards = useMemo(() => new Map(inputs.cards.map((c) => [c.id, c])), [inputs.cards]);
  const cardKids = useMemo(() => cardChildren(inputs.cards), [inputs.cards]);
  const months = walked.filter((s) => s.month >= from && s.month <= to);

  const chip = (r: PatientRow): { label: string; tone: string } => {
    const s = r.standing;
    if (s.kind === "on_sheet") return s.sent ? { label: fill(t("dwSentWith"), { month: monthShort(s.month, ar) }), tone: GREY } : { label: t("dwOnSheet"), tone: BLACK };
    if (s.kind === "waiting") return { label: t("dwWaiting"), tone: AMBER };
    if (s.kind === "later") return { label: fill(t("dwGoesOn"), { month: monthShort(s.month, ar) }), tone: GREY };
    return { label: fill(t("dwEarlier"), { month: monthShort(s.month, ar) }), tone: GREY };
  };

  return (
    <section className="rounded-3xl border border-line bg-surface p-3 sm:p-4 xl:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1">
          <h3 className="font-display text-base font-extrabold text-ink">{payerName}</h3>
          <p className="mt-0.5 max-w-2xl text-[12.5px] font-semibold leading-relaxed text-ink-muted">{t("dwRules")}</p>
        </div>
        <button
          type="button"
          onClick={() => setPreview(true)}
          disabled={to < from}
          className="inline-flex min-h-11 items-center gap-2 self-start rounded-full bg-accent px-5 text-[13.5px] font-black text-ink-on-accent shadow-sm hover:bg-accent-strong disabled:opacity-40"
        >
          <Eye size={16} />
          {t("dwPreview")}
        </button>
      </div>

      {visible.length === 0 ? (
        <p className="mt-4 rounded-2xl border border-line bg-surface-subtle px-4 py-3 text-sm font-semibold text-ink-muted">{t("dwEmpty")}</p>
      ) : (
        <>
          <p className="mt-4 text-[12px] font-semibold text-ink-muted">{t("dwListHint")}</p>
          <ul className="mt-2 divide-y divide-line overflow-hidden rounded-2xl border border-line">
            {visible.map((r) => {
              const c = chip(r);
              const quiet = r.standing.kind !== "on_sheet" || r.standing.sent;
              const open = openId === r.patientId;
              return (
                <li key={r.patientId}>
                  <button
                    type="button"
                    onClick={() => setOpenId(open ? null : r.patientId)}
                    aria-expanded={open}
                    className={`flex w-full items-center gap-3 px-4 py-3.5 text-start transition-colors hover:bg-surface-subtle ${open ? "bg-surface-subtle" : ""}`}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block text-[14.5px] font-bold text-ink">{r.patientName || "—"}</span>
                      <span className="mt-0.5 block truncate text-[12px] text-ink-muted">{r.charges.map((x) => statementLineText(x)).filter(Boolean).join(" + ")}</span>
                    </span>
                    <span className={`shrink-0 rounded-full border px-2.5 py-0.5 text-[11px] font-bold whitespace-nowrap ${c.tone}`}>{c.label}</span>
                    <span className={`w-16 shrink-0 text-end font-figure text-[15px] font-black max-sm:hidden ${quiet ? "text-ink-muted" : "text-ink"}`}>{money(r.value, ar)}</span>
                    <ChevronDown size={16} className={`shrink-0 text-ink-muted transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
                  </button>
                  {open && (
                    <CompanyPatientProcedures
                      clinicId={clinicId}
                      payerId={payerId}
                      patientId={r.patientId}
                      patientName={r.patientName}
                      charges={r.all}
                      placed={placed}
                      cards={cards}
                      cardKids={cardKids}
                      sent={inputs.sent}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
      {earlier.length > 0 && (
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          className="mt-2 min-h-10 rounded-xl px-2 text-[12.5px] font-black text-ink-body underline underline-offset-2 hover:text-ink"
        >
          {showAll ? t("dwShowLess") : fill(t("dwShowAll"), { n: money(earlier.length, ar) })}
        </button>
      )}

      {preview && (
        <CompanySheetPreview
          clinicId={clinicId}
          payerId={payerId}
          payerName={payerName}
          range={range}
          sheets={months}
          allBranchSheets={allBranchWalked}
          scoped={scoped}
          onExcel={onExcel}
          exporting={exporting}
          excelReady={excelReady}
          unfinished={unfinished}
          onClose={() => setPreview(false)}
        />
      )}
    </section>
  );
}
