"use client";

/**
 * Insurance Statement — one insurer, one month, in the insurer's own layout.
 *
 * The receptionist used to retype every month's insured cases into the sheet the insurer accepts
 * (docs/samples/insurance-statement-nextcare-2026-02.xlsx). This tab builds that sheet from the
 * ledger: pick the insurer and the month, check the cases on screen, press Excel.
 *
 * Nothing here writes to Firestore. The three header lines (clinic and doctor, address, phones)
 * are typed once and remembered in this browser; a member number is recorded on the patient's own
 * file, which this tab links to when one is missing.
 */

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, FileSpreadsheet, Loader2 } from "lucide-react";
import { useClinic } from "@/context/ClinicContext";
import type { ReportProps } from "@/components/reports/types";
import { Note, PatientLink, ReportState, SectionTitle } from "@/components/reports/reportKit";
import { PRIVATE_PAYER_ID, type Payer } from "@/lib/payers";
import { getClinicProfile } from "@/lib/clinicProfile";
import { readMemberNumbers } from "@/lib/patientInsurance";
import { buildInsuranceStatement, caseLabel, type StatementRowLite } from "@/lib/insuranceStatement";
import type { StatementHeader } from "@/lib/insuranceStatementXlsx";

const TEXT = {
  insurer: { en: "Insurer", ar: "شركة التأمين" },
  month: { en: "Month", ar: "الشهر" },
  header: { en: "Statement header", ar: "ترويسة الكشف" },
  headerHint: {
    en: "Printed at the top of the sheet, exactly as typed. Remembered on this computer.",
    ar: "تُطبع أعلى الكشف كما هي مكتوبة. تُحفظ على هذا الجهاز.",
  },
  line1: { en: "Clinic and doctor", ar: "العيادة والطبيب" },
  line2: { en: "Address", ar: "العنوان" },
  line3: { en: "Phones", ar: "الهواتف" },
  excel: { en: "Excel", ar: "Excel" },
  preparing: { en: "Preparing…", ar: "جارٍ التجهيز…" },
  noInsurers: {
    en: "No insurer is configured yet. Add one in Settings → Payers, give it a price list, and record treatments under it.",
    ar: "لا توجد شركة تأمين بعد. أضفها من الإعدادات ← جهات الدفع، واربطها بقائمة أسعار، وسجّل العلاجات عليها.",
  },
  noCases: { en: "No treatments were recorded under this insurer in this month.", ar: "لا توجد علاجات مسجلة على هذه الشركة في هذا الشهر." },
  missing: { en: "No member number yet — open the file and add it under Insurance member numbers:", ar: "بدون رقم عضوية — افتح الملف وأضفه في أرقام العضوية في التأمين:" },
  serial: { en: "#", ar: "م" },
  caseName: { en: "Case", ar: "اسم الحالة" },
  service: { en: "Service", ar: "بيان الخدمة" },
  value: { en: "Value", ar: "قيمة الخدمة" },
  subtotal: { en: "Subtotal", ar: "الاجمالي" },
  total: { en: "Grand total", ar: "الاجمالي الكلي" },
  cases: { en: "cases", ar: "حالة" },
  preview: { en: "Statement", ar: "الكشف" },
  failed: { en: "Could not build the file. Try again.", ar: "تعذّر إنشاء الملف. حاول مرة أخرى." },
} as const;

const EMPTY_HEADER: StatementHeader = { line1: "", line2: "", line3: "" };

function lastDayOf(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

function storageKey(clinicId: string | null): string {
  return `insurance-statement-header:${clinicId || "clinic"}`;
}

function loadHeader(clinicId: string | null): StatementHeader | null {
  try {
    const raw = localStorage.getItem(storageKey(clinicId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StatementHeader>;
    return { line1: String(parsed.line1 || ""), line2: String(parsed.line2 || ""), line3: String(parsed.line3 || "") };
  } catch {
    return null;
  }
}

function saveHeader(clinicId: string | null, header: StatementHeader): void {
  try {
    localStorage.setItem(storageKey(clinicId), JSON.stringify(header));
  } catch {
    // Private mode or a full store: the header is still on screen, just not remembered.
  }
}

const money = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });

export default function InsuranceStatementReport({ procedures, allPatients, range, setRange, isAr, payers }: ReportProps & { payers: Payer[] }) {
  const t = (k: keyof typeof TEXT) => (isAr ? TEXT[k].ar : TEXT[k].en);
  const { clinicId } = useClinic();

  const insurers = useMemo(() => payers.filter((p) => p.id !== PRIVATE_PAYER_ID && p.active), [payers]);
  const [payerId, setPayerId] = useState<string>("");
  useEffect(() => {
    if (!payerId && insurers[0]) setPayerId(insurers[0].id);
  }, [insurers, payerId]);
  const payer = insurers.find((p) => p.id === payerId) || null;

  // The month is the page's own range: picking one here moves the range to the whole month, so the
  // rows arrive through the same loader every other report uses.
  const month = range.start.slice(0, 7);
  const pickMonth = (m: string) => {
    if (!/^\d{4}-\d{2}$/.test(m) || !setRange) return;
    setRange({ start: `${m}-01`, end: lastDayOf(m) });
  };

  const [header, setHeader] = useState<StatementHeader>(EMPTY_HEADER);
  useEffect(() => {
    let cancelled = false;
    const saved = loadHeader(clinicId);
    if (saved) {
      setHeader(saved);
      return;
    }
    // First time on this machine: start from the clinic profile, which is what the sample's header is.
    getClinicProfile()
      .then((profile) => {
        if (cancelled || !profile) return;
        setHeader({ line1: profile.clinicName || "", line2: profile.address || "", line3: profile.phone || "" });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [clinicId]);
  const editHeader = (key: keyof StatementHeader, value: string) => {
    setHeader((prev) => {
      const next = { ...prev, [key]: value };
      saveHeader(clinicId, next);
      return next;
    });
  };

  const memberNumbers = useMemo(() => {
    const map = new Map<string, string>();
    if (!payerId) return map;
    for (const p of allPatients) {
      const numbers = readMemberNumbers(p as Record<string, unknown>);
      if (numbers[payerId]) map.set(String(p.id), numbers[payerId]);
    }
    return map;
  }, [allPatients, payerId]);

  const statement = useMemo(
    () =>
      buildInsuranceStatement({
        rows: procedures as unknown as StatementRowLite[],
        payerId,
        payerName: payer ? (isAr ? payer.nameAr || payer.name : payer.name) : "",
        month,
        memberNumbers,
      }),
    [procedures, payerId, payer, isAr, month, memberNumbers]
  );

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const download = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      // The styled writer is 2.7 MB; it is fetched only when somebody actually presses the button.
      const [{ default: XLSX }, { statementToWorkbook, statementFileName }] = await Promise.all([
        import("xlsx-js-style"),
        import("@/lib/insuranceStatementXlsx"),
      ]);
      XLSX.writeFile(statementToWorkbook(statement, header), statementFileName(statement), { compression: true });
    } catch {
      setError(t("failed"));
    } finally {
      setBusy(false);
    }
  };

  if (insurers.length === 0) {
    return <ReportState kind="empty" isAr={isAr} text={t("noInsurers")} />;
  }

  const inputClass =
    "w-full rounded-xl border border-line bg-surface-subtle px-3 py-2 text-sm font-bold text-ink outline-none transition-colors focus:border-accent focus:bg-surface";

  return (
    <div className="space-y-6">
      {/* --- controls ------------------------------------------------------------------------ */}
      <section className="grid gap-4 rounded-2xl border border-line bg-surface p-5 lg:grid-cols-[14rem_11rem_1fr]">
        <label className="block">
          <span className="mb-1 block text-[10.5px] font-black uppercase tracking-wider text-ink-muted">{t("insurer")}</span>
          <select value={payerId} onChange={(e) => setPayerId(e.target.value)} className={inputClass} data-tour="insurance-payer">
            {insurers.map((p) => (
              <option key={p.id} value={p.id}>{isAr ? p.nameAr || p.name : p.name}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-[10.5px] font-black uppercase tracking-wider text-ink-muted">{t("month")}</span>
          <input type="month" value={month} onChange={(e) => pickMonth(e.target.value)} className={inputClass} data-tour="insurance-month" />
        </label>
        <div>
          <span className="mb-1 block text-[10.5px] font-black uppercase tracking-wider text-ink-muted">{t("header")}</span>
          <div className="grid gap-2">
            <textarea value={header.line1} onChange={(e) => editHeader("line1", e.target.value)} placeholder={t("line1")} rows={2} className={inputClass} />
            <input value={header.line2} onChange={(e) => editHeader("line2", e.target.value)} placeholder={t("line2")} className={inputClass} />
            <input value={header.line3} onChange={(e) => editHeader("line3", e.target.value)} placeholder={t("line3")} className={inputClass} />
          </div>
          <Note>{t("headerHint")}</Note>
        </div>
      </section>

      {/* --- missing member numbers ---------------------------------------------------------- */}
      {statement.missingMemberNumber.length > 0 && (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-2xl border border-line bg-surface-subtle px-4 py-3 text-[12px] font-semibold text-ink-body">
          <AlertTriangle size={14} className="shrink-0 text-ink-muted" />
          <span>{t("missing")}</span>
          {statement.missingMemberNumber.map((m) => (
            <PatientLink key={m.patientId} id={m.patientId} name={m.patientName} isAr={isAr} />
          ))}
        </p>
      )}

      {/* --- the statement ------------------------------------------------------------------- */}
      <section>
        <SectionTitle
          aside={
            <button
              type="button"
              onClick={download}
              disabled={busy || statement.cases.length === 0}
              data-tour="insurance-excel"
              className="inline-flex items-center gap-1.5 rounded-xl border border-line px-3 py-1.5 text-[11.5px] font-black text-ink-body transition-colors hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? <Loader2 size={13} className="animate-spin" /> : <FileSpreadsheet size={13} />}
              {busy ? t("preparing") : t("excel")}
            </button>
          }
        >
          {t("preview")} · {statement.payerName} · {month} · {statement.cases.length} {t("cases")}
        </SectionTitle>
        {error && <Note>{error}</Note>}

        {statement.cases.length === 0 ? (
          <ReportState kind="empty" isAr={isAr} text={t("noCases")} />
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
            <table className="w-full min-w-[40rem] border-collapse">
              <thead>
                <tr className="border-b border-line bg-surface-subtle">
                  {[t("serial"), t("caseName"), t("service"), t("value")].map((h, i) => (
                    <th key={h} className={`px-3 py-3 text-[10.5px] font-black uppercase tracking-wider text-ink-muted ${i === 3 ? "text-end" : "text-start"}`}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {statement.cases.map((c) => (
                  <CaseRows key={`${c.patientId}-${c.serial}`} c={c} isAr={isAr} subtotalLabel={t("subtotal")} />
                ))}
                <tr className="bg-surface-subtle">
                  <td colSpan={3} className="px-3 py-3 text-[12px] font-black uppercase tracking-wider text-ink">{t("total")}</td>
                  <td className="px-3 py-3 text-end font-display text-[15px] font-black tabular-nums text-ink">{money(statement.total)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function CaseRows({ c, isAr, subtotalLabel }: { c: ReturnType<typeof buildInsuranceStatement>["cases"][number]; isAr: boolean; subtotalLabel: string }) {
  const span = c.lines.length + 1;
  return (
    <>
      {c.lines.map((line, i) => (
        <tr key={line.rowId} className="border-t border-line">
          {i === 0 && (
            <>
              <td rowSpan={span} className="px-3 py-2 align-top font-display text-[13px] font-black tabular-nums text-ink-muted">{c.serial}</td>
              <td rowSpan={span} className="px-3 py-2 align-top">
                <PatientLink id={c.patientId} name={caseLabel(c)} isAr={isAr} />
                <div className="text-[11px] font-semibold text-ink-faint">{c.date}</div>
              </td>
            </>
          )}
          <td className="px-3 py-2 text-[13px] font-semibold text-ink-body">{line.text}</td>
          <td className="px-3 py-2 text-end text-[13px] font-bold tabular-nums text-ink">{money(line.amount)}</td>
        </tr>
      ))}
      <tr className="border-t border-line bg-surface-subtle/60">
        <td className="px-3 py-2 text-[11px] font-black uppercase tracking-wider text-ink-muted">{subtotalLabel}</td>
        <td className="px-3 py-2 text-end text-[13px] font-black tabular-nums text-ink">{money(c.subtotal)}</td>
      </tr>
    </>
  );
}
