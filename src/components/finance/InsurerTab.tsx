"use client";

/**
 * One insurance company's tab on the Finance page: the treatments it is the payer of, what the
 * patient paid at the counter, what the company has paid, and what it still owes — with "Mark
 * collected" on a row, or on every selected row at once.
 *
 * The figures and the list follow the page's dates (`period`): for a contract company a whole
 * month is exactly that month's sheet (`chargeInPeriod`); for an approval insurer a treatment
 * counts on its own date. What is still unpaid outside the dates is named in one line under the
 * figures, and "Show all dates" opens the whole account: every charge on the branch on screen,
 * from any date. "Only outstanding" (on by default) only shortens the list to the unpaid rows.
 *
 * The figures come from `insurerRows`, the same function the route recomputes with before it
 * writes, so the screen and the receipt can never disagree about what was owed. The charges'
 * payments are read here by treatment rather than by date,
 * because a company that pays in November for October's work would otherwise leave October's rows
 * reading "outstanding" forever, and a collection recorded today would never show on a past month.
 *
 * "Excel report" writes the company's monthly statement in its own sheet layout (GASCO's), for the
 * page's period rather than the whole account: the company is billed month by month. Only for a
 * company with no approval paper; an approval insurer's statement is built on the Insurance page.
 *
 * Collecting never asks which branch: the money follows each treatment's own branch, which the
 * route takes from the charge. Rows written by an approval are listed for the picture but collected
 * on the Insurance page, where their claim lives.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CheckCircle2, FileSpreadsheet, Loader2 } from "lucide-react";
import { onSnapshot, query, where } from "firebase/firestore";
import { useLanguage } from "@/context/LanguageContext";
import { useUI } from "@/context/UIContext";
import { useClinic } from "@/context/ClinicContext";
import Protect from "@/components/Protect";
import InsurerBadge from "@/components/shared/InsurerBadge";
import { getClinicCollection } from "@/lib/db-utils";
import { rowInScope } from "@/lib/branchAccess";
import { insurerRows, insurerTotals, treatmentHasDentist, type InsurerRow, type LedgerLite } from "@/lib/insurerLedger";
import { MoneyApiError } from "@/lib/moneyApi";
import { buildInsuranceStatement, type StatementRowLite } from "@/lib/insuranceStatement";
import { useStatementHeader } from "@/lib/insuranceStatementHeader";
import { buildCompanySheets, companyStatement, placeCharges, scopeSheets, type SheetCharge } from "@/lib/insurance/companySheet";
import { chargeInPeriod } from "@/lib/insurance/chargePeriod";
import { clinicTimeZone, ymdInTimeZone } from "@/lib/clinicDate";
import { useCompanySheet } from "@/components/insurance/useCompanySheet";
import CompanySheetPanel from "@/components/insurance/CompanySheetPanel";
import { tr } from "@/components/insurance/text";

const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** The route refuses a whole batch when one treatment names no dentist, so such rows cannot be ticked. */
const hasDentist = (charge: LedgerLite) => treatmentHasDentist(charge as Record<string, unknown>);

const round2 = (n: number) => Math.round(n * 100) / 100;

export default function InsurerTab({
  payerId,
  payerName,
  rows,
  scopeBranchId,
  isLoading,
  collect: post,
  collectClaim,
  statementPeriod,
  period,
  sheetPanel,
}: {
  payerId: string;
  payerName: string;
  /** The page's rows for the period and the branch on screen: its treatment charges and its cash rows. */
  rows: readonly LedgerLite[];
  /** The branch on screen ("" = all), for the backlog this tab reads itself. */
  scopeBranchId: string;
  /** The page's period is still loading. */
  isLoading: boolean;
  /**
   * Records the collection (the page's `collectFromInsurer`). The rows refresh from the live
   * listeners, so nothing needs reloading afterwards.
   */
  collect: (payerId: string, chargeIds: string[]) => Promise<{ count: number; receiptNumbers: string[] }>;
  /**
   * Records the company's payment for one approval (the claims route pays every treatment on it).
   * Resolves to the server's message on a refusal, null on success. `branchId` is the rows' branch.
   */
  collectClaim: (claimId: string, branchId: string | null) => Promise<string | null>;
  /** The page's period, for the Excel statement; absent = no statement for this company (approval insurers). */
  statementPeriod?: { start: string; end: string };
  /** The page's dates: the figures and the list show only these. Absent = the whole account. */
  period?: { start: string; end: string };
  /** Show the monthly sheet (patients, their procedures, Mark as sent) INSTEAD of the money account. The Insurance page sets it; Finance does not. */
  sheetPanel?: boolean;
}) {
  const { language } = useLanguage();
  const ar = language === "ar";
  const { confirm, showToast } = useUI();
  const [onlyOutstanding, setOnlyOutstanding] = useState(true);
  /** "Show all dates": the whole account instead of the page's dates. */
  const [allDates, setAllDates] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  /** Every payment against this company's charges, whatever its date, by payment id. */
  const [livePayments, setLivePayments] = useState<Map<string, LedgerLite>>(new Map());
  /**
   * Every charge of this company, read here, whatever its date. null while it loads;
   * `backlogFailed` falls back to the page's period rather than to nothing.
   */
  const [backlog, setBacklog] = useState<LedgerLite[] | null>(null);
  const [backlogFailed, setBacklogFailed] = useState(false);

  useEffect(() => {
    setBacklog(null);
    setBacklogFailed(false);
    // Two equality filters: served by the single-field indexes, no composite index needed.
    return onSnapshot(
      query(getClinicCollection("ledger"), where("payerId", "==", payerId), where("type", "==", "procedure")),
      (snap) => setBacklog(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) }))),
      () => setBacklogFailed(true),
    );
  }, [payerId]);

  const useBacklog = !backlogFailed;
  const charges = useMemo(() => {
    if (useBacklog) {
      // The branch on screen, live rows only; `insurerRows` works out each split exactly.
      return (backlog ?? []).filter((r) => {
        const row = r as Record<string, unknown>;
        if (!rowInScope(row, scopeBranchId)) return false;
        return !["deleted", "cancelled"].includes(String(row.status || "").toLowerCase());
      });
    }
    return rows.filter((r) => String(r.type || "") === "procedure" && text(r.payerId) === payerId);
  }, [useBacklog, backlog, scopeBranchId, rows, payerId]);
  const backlogLoading = useBacklog ? backlog === null : isLoading;
  const chargeKey = useMemo(() => charges.map((c) => c.id).sort().join(","), [charges]);

  useEffect(() => {
    setLivePayments(new Map());
    if (!chargeKey) return;
    const ids = chargeKey.split(",");
    const unsubs: (() => void)[] = [];
    // In chunks of 30, the `in` limit; payment rows only — a charge's lab line is not money in.
    for (let i = 0; i < ids.length; i += 30) {
      const chunk = ids.slice(i, i + 30);
      unsubs.push(
        onSnapshot(
          query(getClinicCollection("ledger"), where("procedureId", "in", chunk)),
          (snap) =>
            setLivePayments((prev) => {
              const next = new Map(prev);
              for (const [id, p] of prev) if (chunk.includes(text(p.procedureId))) next.delete(id);
              for (const d of snap.docs) {
                const data = d.data() as Record<string, unknown>;
                if (String(data.type || "") === "payment") next.set(d.id, { id: d.id, ...data });
              }
              return next;
            }),
          // Unreadable: the period's own payments (in `rows`) still count, so the tab degrades to that.
          () => {},
        ),
      );
    }
    return () => unsubs.forEach((u) => u());
  }, [chargeKey]);

  const all: InsurerRow[] = useMemo(() => {
    const byId = new Map<string, LedgerLite>();
    for (const r of rows) if (String(r.type || "") === "payment") byId.set(r.id, r);
    for (const [id, p] of livePayments) byId.set(id, p);
    return insurerRows([...charges, ...byId.values()], payerId);
  }, [rows, charges, livePayments, payerId]);

  // --- The page's dates ----------------------------------------------------------------------------
  const { clinicId } = useClinic();
  // Every live charge of the company, ALL branches: whether a patient is finished does not depend on
  // the branch on screen. The branch only narrows what is printed (`keep`, below). The tab's own cost
  // (the whole price, as the company is billed), not the row's amount.
  const sheetCharges = useMemo(
    () =>
      backlog
        ? backlog
            .filter((r) => !["deleted", "cancelled"].includes(String((r as Record<string, unknown>).status || "").toLowerCase()))
            .map((c) => ({ ...c, amount: Number(c.cost) || Number(c.amount) || 0 }) as SheetCharge)
        : null,
    [backlog],
  );
  const { inputs, failed: sheetFailed } = useCompanySheet(clinicId, payerId, useBacklog && statementPeriod ? sheetCharges : null);
  // A contract company's rows wait for the sheet's placements, so a month never flashes a wrong total.
  // If the sheet cannot be read, each treatment counts on its own date.
  const placing = Boolean(period && statementPeriod && useBacklog && !sheetPanel && !inputs && !sheetFailed);
  const loading = backlogLoading || placing;
  const placed = useMemo(() => (inputs ? placeCharges({ ...inputs, payerId }) : null), [inputs, payerId]);
  const { shown, outsideUnpaid } = useMemo(() => {
    if (!period) return { shown: all, outsideUnpaid: 0 };
    const inside: InsurerRow[] = [];
    let unpaid = 0;
    for (const r of all) {
      if (chargeInPeriod(r.charge, period, placed?.get(r.charge.id))) inside.push(r);
      else unpaid += r.outstanding;
    }
    return { shown: allDates ? all : inside, outsideUnpaid: round2(unpaid) };
  }, [all, period, placed, allDates]);

  const totals = useMemo(() => insurerTotals(shown), [shown]);
  const visible = useMemo(() => (onlyOutstanding ? shown.filter((r) => r.outstanding > 0.009) : shown), [shown, onlyOutstanding]);
  // An approval's insurer money is never held back for a missing dentist (the share was stamped at
  // assignment); a contract row's is, because the route refuses the whole batch without one.
  const canCollect = (r: InsurerRow) => r.collectable && (r.viaClaim || hasDentist(r.charge));
  const selectable = useMemo(() => shown.filter(canCollect), [shown]);

  // A new company, or a row that stopped being collectable (collected, or its dentist removed), drops out.
  useEffect(() => setSelected(new Set()), [payerId]);
  useEffect(() => setAllDates(false), [payerId]);
  useEffect(() => {
    setSelected((prev) => {
      const ok = new Set(selectable.map((r) => r.charge.id));
      const next = new Set([...prev].filter((id) => ok.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [selectable]);

  const chosen = selectable.filter((r) => selected.has(r.charge.id));
  const chosenTotal = round2(chosen.reduce((s, r) => s + r.outstanding, 0));
  const allChosen = selectable.length > 0 && chosen.length === selectable.length;
  const fmt = (n: number) => n.toLocaleString(ar ? "ar-EG" : "en-US");

  // --- The monthly statement ---------------------------------------------------------------------
  const [header] = useStatementHeader(clinicId);
  const [exporting, setExporting] = useState(false);
  // The statement and the panel come from one call, so the Excel report is exactly what the panel shows.
  // While the sheet's inputs load there is no statement (the button waits); if the backlog could not be
  // read, today's per-visit statement from the period's rows is all there is.
  const built = useMemo(() => {
    if (!statementPeriod) return null;
    if (!useBacklog) {
      const rows = charges.map((c) => ({ ...c, amount: Number(c.cost) || Number(c.amount) || 0 }) as StatementRowLite);
      return {
        statement: buildInsuranceStatement({
          rows,
          payerId,
          payerName,
          month: statementPeriod.start.slice(0, 7),
          range: statementPeriod,
          memberNumbers: new Map(),
        }),
        sheets: [],
      };
    }
    if (!inputs) return null;
    return companyStatement({
      ...inputs,
      payerId,
      payerName,
      range: statementPeriod,
      memberNumbers: new Map(),
      keep: (c) => rowInScope(c as Record<string, unknown>, scopeBranchId),
    });
  }, [statementPeriod, useBacklog, charges, inputs, payerId, payerName, scopeBranchId]);
  // The patient list walks from the start month through today or the end of the dates, whichever is
  // later, so a patient finished after the dates still shows where he goes. Mark as sent freezes the
  // whole company month, so it is judged on every branch's walk; the list shows the branch on screen.
  const walks = useMemo(() => {
    if (!sheetPanel || !statementPeriod || !inputs || !useBacklog) return null;
    const today = ymdInTimeZone(clinicTimeZone()).slice(0, 7);
    const end = statementPeriod.end.slice(0, 7);
    const all = buildCompanySheets({ ...inputs, payerId, through: end > today ? end : today });
    const keep = (c: SheetCharge) => rowInScope(c as Record<string, unknown>, scopeBranchId);
    return { all, scoped: scopeBranchId === "" ? all : scopeSheets(all, keep), charges: inputs.charges.filter(keep) };
  }, [sheetPanel, statementPeriod, inputs, useBacklog, payerId, scopeBranchId]);
  const statement = built?.statement ?? null;
  const sheetFailedText = sheetFailed && useBacklog && statementPeriod ? tr(ar)("sheetLoadFailed") : "";
  const exportStatement = async () => {
    if (!statement || !statementPeriod || exporting) return;
    setExporting(true);
    try {
      // The styled writer is 2.7 MB; it is fetched only when somebody actually presses the button.
      const [{ default: XLSX }, { gascoStatementToWorkbook, gascoFileName }] = await Promise.all([
        import("xlsx-js-style"),
        import("@/lib/insuranceStatementGascoXlsx"),
      ]);
      // A counted line gets its `2X880` working on the sheet; a flat price is one unit whatever the count.
      const units = new Map<string, number>();
      for (const c of charges) {
        const row = c as Record<string, unknown>;
        const count = Number(row.unitsCount) || 0;
        if (count > 1 && text(row.pricingMode) !== "flat") units.set(c.id, count);
      }
      XLSX.writeFile(
        gascoStatementToWorkbook(statement, header, units),
        gascoFileName(payerName, statementPeriod.start, statementPeriod.end),
        { compression: true },
      );
    } catch {
      showToast(ar ? "معرفناش نعمل ملف الـ Excel." : "Could not build the Excel file.", "error");
    } finally {
      setExporting(false);
    }
  };

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const collect = async (list: InsurerRow[]) => {
    if (list.length === 0 || busy) return;
    const total = round2(list.reduce((s, r) => s + r.outstanding, 0));
    // Contract rows go through insurer-collect in one batch; approval rows go claim by claim, and
    // a claim is paid whole — every treatment on that paper, ticked or not.
    const contract = list.filter((r) => !r.viaClaim);
    const claims = new Map<string, InsurerRow>();
    for (const r of list) {
      const claimId = r.viaClaim ? text(r.charge.claimId) : "";
      if (claimId && !claims.has(claimId)) claims.set(claimId, r);
    }
    const wholeNote =
      claims.size > 0
        ? ar
          ? ` الموافقات بتتحصّل كاملة: كل علاج على نفس الورقة.`
          : ` An approval is collected whole: every treatment on the same paper.`
        : "";
    const ok = await confirm(
      (ar
        ? `تسجيل ${fmt(total)} ج.م من ${payerName} عن ${fmt(list.length)} علاج؟`
        : `Record ${fmt(total)} EGP from ${payerName} for ${list.length} treatment${list.length === 1 ? "" : "s"}?`) + wholeNote,
      { title: ar ? "اتحصّل من شركة التأمين" : "Collected from the insurance company", confirmLabel: ar ? "تسجيل" : "Record" },
    );
    if (!ok) return;
    setBusy(true);
    try {
      let count = 0;
      const receipts: string[] = [];
      const refusals: string[] = [];
      if (contract.length > 0) {
        const res = await post(payerId, contract.map((r) => r.charge.id));
        count += res.count;
        receipts.push(...res.receiptNumbers.filter(Boolean));
      }
      for (const [claimId, r] of claims) {
        const refused = await collectClaim(claimId, text(r.charge.branchId) || null);
        if (refused) refusals.push(refused);
        else count += list.filter((x) => text(x.charge.claimId) === claimId).length;
      }
      const range = receipts.length === 0 ? "" : receipts.length === 1 ? receipts[0] : `${receipts[0]}…${receipts[receipts.length - 1]}`;
      if (count > 0) {
        showToast(
          ar
            ? `اتحصّل ${fmt(count)} علاج${range ? ` — إيصالات ${range}` : ""}`
            : `${count} treatment${count === 1 ? "" : "s"} collected${range ? ` — receipts ${range}` : ""}`,
          "success",
        );
      }
      if (refusals.length > 0) showToast(refusals[0], "error");
      setSelected(new Set());
    } catch (e) {
      showToast(e instanceof MoneyApiError ? e.message : ar ? "معرفناش نسجّل التحصيل." : "Could not record the collection.", "error");
    } finally {
      setBusy(false);
    }
  };

  const status = (r: InsurerRow) => {
    if (r.outstanding > 0.009)
      return <span className="inline-flex rounded-full bg-amber-50 text-amber-800 border border-amber-100 px-2.5 py-0.5 text-[11px] font-bold whitespace-nowrap">{ar ? "متبقي" : "Outstanding"}</span>;
    return <span className="inline-flex rounded-full bg-emerald-50 text-emerald-700 border border-emerald-100 px-2.5 py-0.5 text-[11px] font-bold whitespace-nowrap">{ar ? "اتحصّل" : "Collected"}</span>;
  };

  const dentistOf = (r: InsurerRow) => {
    const c = r.charge as Record<string, unknown>;
    return (text(c.doctorName) || text(c.doctor)).replace(/^Dr\.\s*/i, "");
  };

  const action = (r: InsurerRow) => {
    if (!r.collectable) return null;
    if (!r.viaClaim && !hasDentist(r.charge))
      return <span className="text-[11px] font-semibold text-ink-muted">{ar ? "مفيش طبيب على العلاج ده" : "No dentist on this treatment"}</span>;
    return (
      <Protect permission="finance.add">
        <button
          type="button"
          disabled={busy}
          onClick={() => collect([r])}
          className="inline-flex items-center gap-1.5 max-lg:min-h-10 max-lg:px-4 rounded-full border border-line bg-surface px-3 py-1 text-[11px] font-black text-ink hover:border-slate-400 disabled:opacity-50 whitespace-nowrap"
        >
          <CheckCircle2 size={13} />
          {ar ? "اتحصّل" : "Mark collected"}
        </button>
      </Protect>
    );
  };

  /** True when the row can be ticked; the phone list draws no box at all for the rest. */
  const canTick = canCollect;
  const box = (r: InsurerRow, phone = false) => {
    const can = canTick(r);
    // Ticking is the first half of collecting, so it is offered only to who may collect.
    return (
      <Protect permission="finance.add">
        <input
          type="checkbox"
          disabled={!can || busy}
          checked={can && selected.has(r.charge.id)}
          onChange={() => toggle(r.charge.id)}
          aria-label={ar ? "اختار العلاج" : "Select treatment"}
          className={`${phone ? "size-5" : "size-4"} accent-[var(--accent)] disabled:opacity-30`}
        />
      </Protect>
    );
  };

  /** The page's dates are in force; `whole` = the whole account is on screen. */
  const dated = Boolean(period) && !allDates;
  const whole = useBacklog && !dated;
  const figures: { label: string; value: number; tone: string }[] = [
    { label: ar ? "إجمالي العلاج" : "Billed", value: totals.billed, tone: "text-white/80" },
    { label: ar ? "دفع المريض" : "Patient paid", value: totals.patientPaid, tone: "text-white/80" },
    { label: ar ? "دفعت الشركة" : "Company paid", value: totals.insurerPaid, tone: "text-white/80" },
    { label: ar ? "المتبقي" : "Outstanding", value: totals.outstanding, tone: "text-white" },
  ];

  if (sheetPanel) {
    return (
      <div className="flex flex-col gap-5">
        {statementPeriod && walks && inputs && clinicId ? (
          <CompanySheetPanel
            clinicId={clinicId}
            payerId={payerId}
            payerName={payerName}
            range={statementPeriod}
            charges={walks.charges}
            walked={walks.scoped}
            allBranchWalked={walks.all}
            inputs={inputs}
            scoped={scopeBranchId !== ""}
            onExcel={() => void exportStatement()}
            exporting={exporting}
            excelReady={!loading && !!statement && statement.cases.length > 0}
          />
        ) : sheetFailedText ? (
          <p className="text-sm text-ink-muted">{sheetFailedText}</p>
        ) : (
          <div className="flex justify-center py-16">
            <Loader2 className="animate-spin text-ink-muted" size={22} />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5 flex-1 min-h-0">

      {/* The company's account, on the slab: four figures, the debt last. */}
      <div className="rounded-2xl xl:rounded-3xl bg-ink-slab text-white p-5 xl:p-7 border border-slate-800">
        <div className="flex items-center gap-2.5">
          <InsurerBadge name={payerName} size={26} />
          <p className="font-display text-lg font-extrabold">{payerName}</p>
        </div>
        <p className="mt-1 text-xs font-medium text-white/55">
          {whole
            ? ar ? `كل العلاج على حساب ${payerName}، من أي تاريخ.` : `Every treatment billed to ${payerName}, from any date.`
            : period && dated
              ? period.start === period.end
                ? ar ? `علاج يوم ${period.start}.` : `Treatments on ${period.start}.`
                : ar ? `العلاج من ${period.start} لـ ${period.end}.` : `Treatments from ${period.start} to ${period.end}.`
              : ar ? "علاج الفترة اللي فوق." : "Treatments in the period above."}
        </p>
        <dl className="mt-5 grid grid-cols-2 lg:grid-cols-4 gap-4">
          {figures.map((f) => (
            <div key={f.label} className="min-w-0">
              <dt className="text-[11px] font-bold uppercase tracking-wider text-white/50">{f.label}</dt>
              <dd className={`mt-1 font-figure text-2xl xl:text-3xl font-black ${f.tone}`}>{fmt(f.value)}</dd>
            </div>
          ))}
        </dl>
        {/* What the dates leave out, and the way to the whole account. */}
        {period && useBacklog && !loading && (
          <p className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-white/10 pt-4 text-xs font-semibold text-white/70">
            {dated && outsideUnpaid > 0.009 && (
              <span>
                {ar ? "برّه التواريخ دي لسه متبقي " : "Outside these dates, still unpaid: "}
                <span className="font-figure font-black text-white">{fmt(outsideUnpaid)}</span>
                {ar ? " ج.م" : " EGP"}
              </span>
            )}
            <button
              type="button"
              onClick={() => setAllDates(!allDates)}
              className="max-lg:min-h-10 rounded-full border border-white/25 px-3 py-1 font-bold text-white hover:border-white/60"
            >
              {allDates ? (ar ? "ارجع للتواريخ المختارة" : "Back to the chosen dates") : ar ? "اعرض كل التواريخ" : "Show all dates"}
            </button>
          </p>
        )}
      </div>

      <div className="bg-surface rounded-2xl xl:rounded-3xl border border-slate-200/80 shadow-sm overflow-hidden flex flex-col flex-1 min-h-[320px] ring-1 ring-slate-100">
        <div className="flex flex-wrap items-center gap-3 p-4 border-b border-slate-100">
          <label className="flex items-center gap-2 max-lg:min-h-10 text-xs font-bold text-ink-body">
            <input type="checkbox" checked={onlyOutstanding} onChange={(e) => setOnlyOutstanding(e.target.checked)} className="size-4 accent-[var(--accent)]" />
            {ar ? "المتبقي بس" : "Only outstanding"}
          </label>
          <div className="flex-1" />
          {statementPeriod && (
            <button
              type="button"
              onClick={exportStatement}
              disabled={loading || exporting || !statement || statement.cases.length === 0}
              title={
                sheetFailedText ||
                (ar
                  ? `كشف ${payerName} من ${statementPeriod.start} لـ ${statementPeriod.end}`
                  : `${payerName} statement, ${statementPeriod.start} to ${statementPeriod.end}`)
              }
              className="max-lg:min-h-10 inline-flex items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2 text-xs font-bold text-ink-body hover:border-slate-400 disabled:opacity-40"
            >
              {exporting ? <Loader2 size={14} className="animate-spin" /> : <FileSpreadsheet size={14} />}
              {ar ? "تقرير Excel" : "Excel report"}
              {statement && <span className="font-figure text-ink-muted">({fmt(statement.cases.length)})</span>}
            </button>
          )}
          <Protect permission="finance.add">
            <button
              type="button"
              disabled={selectable.length === 0 || busy}
              onClick={() => setSelected(allChosen ? new Set() : new Set(selectable.map((r) => r.charge.id)))}
              className={`${selectable.length === 0 ? "max-lg:hidden" : ""} max-lg:min-h-10 inline-flex items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2 text-xs font-bold text-ink-body hover:border-slate-400 disabled:opacity-40`}
            >
              {allChosen ? (ar ? "إلغاء الاختيار" : "Clear selection") : ar ? "اختار كل المتبقي" : "Select all outstanding"}
            </button>
          </Protect>
        </div>

        {loading ? (
          <div className="flex-1 flex flex-col items-center justify-center text-slate-400 min-h-[240px]">
            <Loader2 size={28} className="animate-spin mb-3 text-accent-soft" />
            <p className="font-bold text-xs text-ink-muted uppercase tracking-widest">{ar ? "جاري التحميل..." : "Loading..."}</p>
          </div>
        ) : visible.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center px-6 py-16">
            <p className="font-bold text-ink-body">
              {whole
                ? shown.length === 0
                  ? ar ? `مفيش علاج على حساب ${payerName} لسه.` : `No ${payerName} treatments yet.`
                  : ar ? `مفيش حاجة متبقية على ${payerName}.` : `${payerName} owes nothing.`
                : shown.length === 0
                  ? ar ? `مفيش علاج على حساب ${payerName} في الفترة دي.` : `No ${payerName} treatments in this period.`
                  : ar ? `مفيش حاجة متبقية على ${payerName} في الفترة دي.` : `${payerName} owes nothing for this period.`}
            </p>
            <p className="text-sm text-ink-muted mt-1">
              {shown.length === 0
                ? whole
                  ? ar ? "العلاج اللي يتسجل على حساب الشركة هيظهر هنا." : "Treatments charged to the company will show here."
                  : ar ? "غيّر التاريخ أو الفرع." : "Try another date or branch."
                : useBacklog
                  ? ar ? "شيل \"المتبقي بس\" عشان تشوف كل العلاج." : "Untick \"Only outstanding\" to see every treatment."
                  : ar ? "غيّر التاريخ أو الفرع." : "Try another date or branch."}
            </p>
          </div>
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden lg:block overflow-x-auto flex-1">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50/90 border-b border-line text-[11px] font-black uppercase tracking-wider text-ink-muted">
                    <th className="w-10 py-3 ps-5" />
                    <th className="text-start py-3 px-3 whitespace-nowrap">{ar ? "التاريخ" : "Date"}</th>
                    <th className="text-start py-3 px-3">{ar ? "المريض" : "Patient"}</th>
                    <th className="text-start py-3 px-3">{ar ? "العلاج" : "Treatment"}</th>
                    <th className="text-start py-3 px-3">{ar ? "الطبيب" : "Dentist"}</th>
                    <th className="text-end py-3 px-3 whitespace-nowrap">{ar ? "التكلفة" : "Cost"}</th>
                    <th className="text-end py-3 px-3 whitespace-nowrap">{ar ? "دفع المريض" : "Patient paid"}</th>
                    <th className="text-end py-3 px-3 whitespace-nowrap">{ar ? "دفعت الشركة" : "Company paid"}</th>
                    <th className="text-end py-3 px-3 whitespace-nowrap">{ar ? "المتبقي" : "Outstanding"}</th>
                    <th className="text-start py-3 px-3">{ar ? "الحالة" : "Status"}</th>
                    <th className="py-3 pe-5" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {visible.map((r) => (
                    <tr key={r.charge.id} className={`transition-colors ${selected.has(r.charge.id) ? "bg-accent-soft/10" : "hover:bg-slate-50/80"}`}>
                      <td className="py-3 ps-5 align-middle">{box(r)}</td>
                      <td className="py-3 px-3 align-middle font-figure text-xs font-bold text-ink-body whitespace-nowrap">{text(r.charge.date)}</td>
                      <td className="py-3 px-3 align-middle font-semibold text-ink">
                        {text(r.charge.patientId) ? (
                          <Link href={`/patients/${text(r.charge.patientId)}?tab=finance`} className="hover:underline">
                            {text(r.charge.patientName) || "—"}
                          </Link>
                        ) : (
                          text(r.charge.patientName) || "—"
                        )}
                      </td>
                      <td className="py-3 px-3 align-middle text-ink-body">{text(r.charge.description) || "—"}</td>
                      <td className="py-3 px-3 align-middle text-ink-body">{dentistOf(r) || <span className="text-slate-300">—</span>}</td>
                      <td className="py-3 px-3 align-middle text-end font-figure font-bold text-ink">{fmt(r.cost)}</td>
                      <td className="py-3 px-3 align-middle text-end font-figure text-ink-body">{fmt(r.patientPaid)}</td>
                      <td className="py-3 px-3 align-middle text-end font-figure text-ink-body">{fmt(r.insurerPaid)}</td>
                      <td className={`py-3 px-3 align-middle text-end font-figure font-black ${r.outstanding > 0.009 ? "text-ink" : "text-ink-muted"}`}>{fmt(r.outstanding)}</td>
                      <td className="py-3 px-3 align-middle">{status(r)}</td>
                      <td className="py-3 pe-5 align-middle text-end">{action(r)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile list */}
            <div className="lg:hidden divide-y divide-slate-100">
              {visible.map((r) => (
                <div key={r.charge.id} className="p-4 flex gap-3">
                  {canTick(r) ? <label className="-m-2 grid size-9 shrink-0 place-items-center self-start">{box(r, true)}</label> : null}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-bold text-ink text-sm leading-snug">{text(r.charge.description) || "—"}</p>
                        <p className="text-xs font-semibold text-ink-body mt-0.5 truncate">{text(r.charge.patientName) || "—"}</p>
                        <p className="text-[11px] font-bold text-ink-muted mt-0.5">
                          <span className="font-figure">{text(r.charge.date)}</span>
                          {dentistOf(r) ? ` · ${dentistOf(r)}` : ""}
                        </p>
                      </div>
                      <span className="font-figure text-base font-black text-ink shrink-0">{fmt(r.outstanding)}</span>
                    </div>
                    <p className="mt-2 text-[11px] font-semibold text-ink-muted">
                      {ar ? "التكلفة" : "Cost"} <span className="font-figure text-ink-body">{fmt(r.cost)}</span> · {ar ? "المريض" : "Patient"}{" "}
                      <span className="font-figure text-ink-body">{fmt(r.patientPaid)}</span> · {ar ? "الشركة" : "Company"}{" "}
                      <span className="font-figure text-ink-body">{fmt(r.insurerPaid)}</span>
                    </p>
                    <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                      {status(r)}
                      {action(r)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* The batch, held at the bottom of the screen while anything is ticked. */}
      {chosen.length > 0 && (
        // pe-16 on phones: the AI button floats at the bottom end corner and would cover this button's end.
        <div className="sticky bottom-20 lg:bottom-4 z-20 flex justify-center max-lg:pe-16">
          <Protect permission="finance.add">
            <button
              type="button"
              disabled={busy}
              onClick={() => collect(chosen)}
              className="inline-flex items-center gap-2 rounded-full bg-accent text-ink-on-accent px-5 py-3 text-sm font-black shadow-lg shadow-slate-900/20 hover:bg-accent-strong active:scale-[0.98] disabled:opacity-60"
            >
              {busy ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
              {ar
                ? `تحصيل ${fmt(chosen.length)} علاج (${fmt(chosenTotal)} ج.م)`
                : `Mark ${chosen.length} selected collected (${fmt(chosenTotal)} EGP)`}
            </button>
          </Protect>
        </div>
      )}
    </div>
  );
}
