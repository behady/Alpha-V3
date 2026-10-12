"use client";

import { useState, type ReactNode } from "react";
import { Banknote, Edit2, FileSpreadsheet, Loader2, MinusCircle, Save, Trash2 } from "lucide-react";
import type { StaffCommission } from "@/lib/staffCommission";
import type { StaffInsuranceWork } from "@/lib/staffInsurance";
import type { StaffSettlementDraft } from "@/lib/moneyApi";
import type { ClinicBranch } from "@/lib/clinicLocations";
import type { EarningSettled } from "@/lib/staffSettlement";
import {
  btnDark, btnGhost, dayOf, Empty, fieldInput, fieldLabel, money, PaidCell, PAY_METHODS, Section, tableHead, todayYmd,
  type SettlementForm, type SettlementView,
} from "./profileKit";

/**
 * Everything money about one person: what their work earned (dentists), line by line, and what has
 * been paid to them or held back.
 */
export default function MoneyTab({
  first,
  dentist,
  commission,
  insurance,
  settlement,
  branches,
  canEdit,
  isAr,
  onSetPct,
  onExportCommission,
  onSaveSettlement,
  onDeleteSettlement,
}: {
  first: string;
  dentist: boolean;
  commission: StaffCommission;
  insurance: StaffInsuranceWork;
  settlement: SettlementView | null;
  /** The clinic's branches, to name where each payout was made; empty for a clinic without any. */
  branches: readonly ClinicBranch[];
  canEdit: boolean;
  isAr: boolean;
  onSetPct: (paymentId: string, pct: number) => void;
  onExportCommission: () => Promise<void>;
  onSaveSettlement: (draft: StaffSettlementDraft, id: string | null) => Promise<boolean>;
  onDeleteSettlement: (id: string) => Promise<void>;
}) {
  /**
   * The rate cell being typed in, keyed by payment id.
   *
   * Held separately from the row so a half-typed "1" on the way to "15" never reaches the server,
   * and so the table keeps showing the stored figure until the box is left.
   */
  const [pctDraft, setPctDraft] = useState<Record<string, string>>({});
  const [exporting, setExporting] = useState(false);
  const [settleForm, setSettleForm] = useState<SettlementForm | null>(null);
  const [settleSaving, setSettleSaving] = useState(false);

  /** The settled part of one earning line, for the Paid column. */
  const settledOf = (key: string): EarningSettled | null => settlement?.byKey.get(key) ?? null;

  /*
    Phones get each row as a stacked card instead of the table. The tables are 30–36rem wide, and in
    a 340px card they hid exactly the columns that matter — the amount, the editable rate, the share.
    The cards below use the same handlers and the same figures; the tables are unchanged from md up.
  */

  /** The editable (or read-only) rate on one commission payment — shared by the table and the card. */
  const pctCell = (e: StaffCommission["entries"][number], inputClass: string) =>
    canEdit ? (
      <span className="inline-flex items-center gap-1">
        <input
          type="number"
          min={0}
          max={100}
          step="0.5"
          inputMode="decimal"
          aria-label={isAr ? "نسبة الدفعة" : "Rate on this payment"}
          value={pctDraft[e.id] ?? (e.pct == null ? "" : String(e.pct))}
          onChange={(ev) => setPctDraft((d) => ({ ...d, [e.id]: ev.target.value }))}
          onBlur={(ev) => {
            const raw = ev.target.value.trim();
            setPctDraft((d) => {
              const next = { ...d };
              delete next[e.id];
              return next;
            });
            if (raw === "") return;
            const next = Math.max(0, Math.min(100, Number(raw) || 0));
            if (e.pct != null && next === e.pct) return;
            onSetPct(e.id, next);
          }}
          onKeyDown={(ev) => {
            if (ev.key === "Enter") (ev.target as HTMLInputElement).blur();
            if (ev.key === "Escape") {
              setPctDraft((d) => {
                const next = { ...d };
                delete next[e.id];
                return next;
              });
              (ev.target as HTMLInputElement).blur();
            }
          }}
          className={inputClass}
        />
        <span className="font-figure text-[14px] font-semibold text-ink-muted">%</span>
      </span>
    ) : (
      <span className="font-figure font-semibold text-ink-muted">
        {e.pct == null ? "—" : `${e.pct}%`}
      </span>
    );

  /** PaidCell's content without the <td>, for the phone cards. */
  const paidValue = (settled: EarningSettled | null) =>
    !settled ? (
      <span className="font-figure font-semibold text-ink-muted">—</span>
    ) : (
      <span className={`font-figure font-semibold ${settled.remaining === 0 ? "text-ink" : "text-ink-muted"}`}>
        {money(settled.paid)}
        {settled.deducted > 0 && (
          <span className="block text-[12px] font-semibold text-danger"><bdi dir="ltr">−{money(settled.deducted)}</bdi> {isAr ? "خصم" : "deducted"}</span>
        )}
      </span>
    );

  /** One label-over-value cell of a phone card. */
  const cardFigure = (label: string, value: ReactNode) => (
    <div className="min-w-0">
      <dt className="text-[12px] font-bold text-ink-muted">{label}</dt>
      <dd className="mt-0.5 text-[15px]">{value}</dd>
    </div>
  );

  return (
    <>
      {/* --- what was paid to them, and what was held back: first, because it is the thing that changes hands --- */}
      <Section
        title={isAr ? `اللي اتدفع لـ ${first}` : `Paid to ${first}`}
        action={
          canEdit && !settleForm ? (
            <div className="flex flex-wrap gap-2">
              <button type="button" className={btnDark} onClick={() => setSettleForm({ id: null, kind: "payout", amount: "", date: todayYmd(), note: "", method: "Cash" })}>
                <Banknote size={16} /> {isAr ? "سجّل دفعة" : "Record a payout"}
              </button>
              <button type="button" className={btnGhost} onClick={() => setSettleForm({ id: null, kind: "deduction", amount: "", date: todayYmd(), note: "", method: "Cash" })}>
                <MinusCircle size={16} /> {isAr ? "سجّل خصم" : "Record a deduction"}
              </button>
            </div>
          ) : undefined
        }
        note={
          dentist
            ? isAr
              ? "كل دفعة بتتحسب على أقدم شغل لسه ماتدفعش. الدفعة بتتسجل كمان في المالية كمصروف مرتبات؛ الخصم بيقلّل المستحق بس."
              : "Every payout is applied to the oldest unpaid work first. A payout is also written on the Finance page as a Salary expense; a deduction only lowers what is owed."
            : isAr
              ? "سجّل اللي اتدفع له، حتى من غير ما تحدد مرتب. الدفعة بتتسجل كمان في المالية كمصروف مرتبات؛ الخصم بيقلّل المستحق بس."
              : "Record what was paid, with or without a salary set. A payout is also written on the Finance page as a Salary expense; a deduction only lowers what is owed."
        }
      >
        {settleForm && (
          <form
            className="mb-5 rounded-2xl bg-surface-subtle p-4 sm:p-5"
            onSubmit={async (ev) => {
              ev.preventDefault();
              const amount = Number(settleForm.amount);
              if (!Number.isFinite(amount) || amount <= 0 || !settleForm.date) return;
              setSettleSaving(true);
              try {
                const ok = await onSaveSettlement({ kind: settleForm.kind, amount, date: settleForm.date, note: settleForm.note.trim(), method: settleForm.kind === "payout" ? settleForm.method : undefined }, settleForm.id);
                if (ok) setSettleForm(null);
              } finally {
                setSettleSaving(false);
              }
            }}
          >
            <p className="mb-4 text-[16px] font-extrabold text-ink">
              {settleForm.id
                ? isAr ? "تعديل" : "Edit"
                : settleForm.kind === "payout"
                  ? isAr ? "دفعة جديدة" : "New payout"
                  : isAr ? "خصم جديد" : "New deduction"}
              {settleForm.id ? ` · ${settleForm.kind === "payout" ? (isAr ? "دفعة" : "payout") : isAr ? "خصم" : "deduction"}` : ""}
            </p>
            <div className={`grid grid-cols-1 gap-4 ${settleForm.kind === "payout" ? "sm:grid-cols-4" : "sm:grid-cols-3"}`}>
              <label className="block">
                <span className={fieldLabel}>{isAr ? "المبلغ" : "Amount"}</span>
                <input
                  type="number"
                  min={0}
                  step="1"
                  inputMode="decimal"
                  required
                  autoFocus
                  value={settleForm.amount}
                  onChange={(e) => setSettleForm({ ...settleForm, amount: e.target.value })}
                  className={`${fieldInput} font-figure`}
                />
              </label>
              <label className="block">
                <span className={fieldLabel}>{settleForm.kind === "payout" ? (isAr ? "اتدفع يوم" : "Paid on") : isAr ? "بتاريخ" : "Dated"}</span>
                <input type="date" required value={settleForm.date} onChange={(e) => setSettleForm({ ...settleForm, date: e.target.value })} className={`${fieldInput} font-figure`} />
              </label>
              {settleForm.kind === "payout" && (
                <label className="block">
                  <span className={fieldLabel}>{isAr ? "طريقة الدفع" : "Paid by"}</span>
                  <select value={settleForm.method} onChange={(e) => setSettleForm({ ...settleForm, method: e.target.value })} className={fieldInput}>
                    {PAY_METHODS.map((m) => <option key={m.id} value={m.id}>{isAr ? m.ar : m.en}</option>)}
                    {!PAY_METHODS.some((m) => m.id === settleForm.method) ? <option value={settleForm.method}>{settleForm.method}</option> : null}
                  </select>
                </label>
              )}
              <label className="block">
                <span className={fieldLabel}>{settleForm.kind === "payout" ? (isAr ? "ملاحظة (اختياري)" : "Note (optional)") : isAr ? "السبب" : "Reason"}</span>
                <input
                  type="text"
                  value={settleForm.note}
                  onChange={(e) => setSettleForm({ ...settleForm, note: e.target.value })}
                  placeholder={settleForm.kind === "payout" ? (isAr ? "مثال: كاش، شهر سبتمبر" : "e.g. cash, September") : isAr ? "مثال: أداة اتكسرت" : "e.g. broken instrument"}
                  className={fieldInput}
                />
              </label>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <button type="submit" disabled={settleSaving} className={`${btnDark} disabled:opacity-50`}>
                {settleSaving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} {isAr ? "حفظ" : "Save"}
              </button>
              <button type="button" className={btnGhost} onClick={() => setSettleForm(null)} disabled={settleSaving}>
                {isAr ? "إلغاء" : "Cancel"}
              </button>
            </div>
          </form>
        )}
        {!settlement ? (
          <p className="flex items-center gap-2 text-[15px] font-semibold text-ink-muted"><Loader2 size={16} className="animate-spin" /> {isAr ? "بنحمّل…" : "Loading…"}</p>
        ) : settlement.items.length === 0 ? (
          <Empty text={isAr ? `لسه ماتسجلش أي دفعة لـ ${first}.` : `Nothing recorded for ${first} yet.`} />
        ) : (
          <>
          <ul className="divide-y divide-line/60 md:hidden">
            {settlement.items.map((s) => (
              <li key={s.id} className="flex items-start gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-[15px] font-semibold text-ink">
                    {s.kind === "payout" ? (isAr ? "دفعة" : "Payout") : isAr ? "خصم" : "Deduction"}
                    {s.method ? <span className="text-ink-muted"> · {(PAY_METHODS.find((m) => m.id === s.method) ?? { en: s.method, ar: s.method })[isAr ? "ar" : "en"]}</span> : null}
                  </p>
                  <p className="mt-0.5 text-[13px] font-semibold text-ink-muted">
                    {dayOf(s.date, isAr)} {s.date.slice(0, 4)}
                    {branches.length > 0 && s.branchId ? ` · ${branches.find((b) => b.id === s.branchId)?.name ?? ""}` : ""}
                  </p>
                  {s.note ? <p className="mt-1 break-words text-[14px] font-medium text-ink-body">{s.note}</p> : null}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <span className={`font-figure text-[16px] font-extrabold ${s.kind === "deduction" ? "text-danger" : "text-ink"}`}>
                    <bdi dir="ltr">{s.kind === "deduction" ? "−" : ""}{money(s.amount)}</bdi>
                  </span>
                  {canEdit && (
                    <span className="-me-2 inline-flex gap-1">
                      <button
                        type="button"
                        aria-label={isAr ? "تعديل" : "Edit"}
                        className="grid size-10 place-items-center rounded-lg text-ink-muted hover:bg-surface-muted hover:text-ink"
                        onClick={() => setSettleForm({ id: s.id, kind: s.kind, amount: String(s.amount), date: s.date, note: s.note, method: s.method ?? "Cash" })}
                      >
                        <Edit2 size={16} />
                      </button>
                      <button
                        type="button"
                        aria-label={isAr ? "حذف" : "Delete"}
                        className="grid size-10 place-items-center rounded-lg text-ink-muted hover:bg-surface-muted hover:text-danger"
                        onClick={() => void onDeleteSettlement(s.id)}
                      >
                        <Trash2 size={16} />
                      </button>
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[30rem] border-collapse text-[14px]">
              <thead>
                <tr className={tableHead}>
                  <th className="py-2.5 pe-3 text-start">{isAr ? "التاريخ" : "Date"}</th>
                  <th className="py-2.5 pe-3 text-start">{isAr ? "النوع" : "Type"}</th>
                  <th className="py-2.5 pe-3 text-start">{isAr ? "ملاحظة" : "Note"}</th>
                  <th className="py-2.5 pe-3 text-end">{isAr ? "المبلغ" : "Amount"}</th>
                  {canEdit && <th className="py-2.5 text-end" />}
                </tr>
              </thead>
              <tbody>
                {settlement.items.map((s) => (
                  <tr key={s.id} className="border-b border-line/60">
                    <td className="py-3 pe-3 font-semibold text-ink-muted">{dayOf(s.date, isAr)} {s.date.slice(0, 4)}</td>
                    <td className="py-3 pe-3 font-semibold text-ink">
                      {s.kind === "payout" ? (isAr ? "دفعة" : "Payout") : isAr ? "خصم" : "Deduction"}
                      {s.method ? <span className="block text-[12px] font-semibold text-ink-muted">{(PAY_METHODS.find((m) => m.id === s.method) ?? { en: s.method, ar: s.method })[isAr ? "ar" : "en"]}</span> : null}
                    </td>
                    <td className="py-3 pe-3 font-medium text-ink-body">
                      {s.note || "—"}
                      {branches.length > 0 && s.branchId ? <span className="block text-[12px] font-semibold text-ink-muted">{branches.find((b) => b.id === s.branchId)?.name ?? ""}</span> : null}
                    </td>
                    <td className={`py-3 pe-3 text-end font-figure font-extrabold ${s.kind === "deduction" ? "text-danger" : "text-ink"}`}>
                      {s.kind === "deduction" ? "−" : ""}{money(s.amount)}
                    </td>
                    {canEdit && (
                      <td className="py-3 text-end">
                        <span className="inline-flex gap-1">
                          <button
                            type="button"
                            aria-label={isAr ? "تعديل" : "Edit"}
                            className="rounded-lg p-2 text-ink-muted hover:bg-surface-muted hover:text-ink"
                            onClick={() => setSettleForm({ id: s.id, kind: s.kind, amount: String(s.amount), date: s.date, note: s.note, method: s.method ?? "Cash" })}
                          >
                            <Edit2 size={15} />
                          </button>
                          <button
                            type="button"
                            aria-label={isAr ? "حذف" : "Delete"}
                            className="rounded-lg p-2 text-ink-muted hover:bg-surface-muted hover:text-danger"
                            onClick={() => void onDeleteSettlement(s.id)}
                          >
                            <Trash2 size={15} />
                          </button>
                        </span>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </>
        )}
      </Section>

      {/*
        --- still owed on work dated before the period ---------------------------------------
        The header's "incl. X from before this period" used to be the only trace of this work: the
        tables below list the period alone, so an insurance approval dated last month was counted in
        the total and shown nowhere. These are the lines behind that figure.
      */}
      {settlement && settlement.earlier.length > 0 && (
        <Section
          title={isAr ? "لسه مستحق من قبل الفترة دي" : "Still owed from before this period"}
          note={
            isAr
              ? "شغل تاريخه قبل الفترة اللي على الشاشة ولسه ماتدفعش كله. غيّر الفترة من فوق عشان تشوف تفاصيله كاملة."
              : "Work dated before the period on screen that is not fully paid yet. Change the period above to see it in full."
          }
        >
          <ul className="divide-y divide-line/60">
            {settlement.earlier.map((e) => (
              <li key={e.key} className="flex items-start justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="break-words text-[15px] font-semibold text-ink">{e.patientName || "—"}</p>
                  <p className="break-words text-[13px] font-semibold text-ink-body">
                    {e.service || "—"}
                    {e.approvalNumber !== null && (
                      <span className="text-ink-muted"> · {isAr ? "تأمين" : "Insurance"}{e.approvalNumber ? ` #${e.approvalNumber}` : ""}</span>
                    )}
                  </p>
                  <p className="mt-0.5 text-[13px] font-semibold text-ink-muted">{dayOf(e.date, isAr)} {e.date.slice(0, 4)}</p>
                </div>
                <span className="shrink-0 font-figure text-[16px] font-extrabold text-ink">{money(e.remaining)}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* --- what they earned, payment by payment -------------------------------------------- */}
      {dentist && (
        <Section
          title={isAr ? "العمولة من كل دفعة" : "Commission from each payment"}
          action={
            /*
              One file for both tables: insurance work is commission too, and a dentist with only
              insurance cases would otherwise download an empty sheet.
            */
            <button
              type="button"
              className={btnGhost + " disabled:opacity-50"}
              disabled={exporting || (commission.entries.length === 0 && insurance.entries.length === 0)}
              onClick={async () => {
                setExporting(true);
                try {
                  await onExportCommission();
                } finally {
                  setExporting(false);
                }
              }}
            >
              {exporting ? <Loader2 size={16} className="animate-spin" /> : <FileSpreadsheet size={16} />}
              {isAr ? "تنزيل Excel" : "Download Excel"}
            </button>
          }
          note={
            isAr
              ? canEdit
                ? "النسبة اللي اتسجلت وقت ما المريض دفع. لو اتفقت على نسبة مختلفة لحالة واحدة، غيّرها هنا للدفعة دي بس."
                : "النسبة اللي اتسجلت وقت ما المريض دفع."
              : canEdit
                ? "The rate recorded when the patient paid. If you agreed a different rate for one case, change it here for that payment only."
                : "The rate recorded when the patient paid."
          }
        >
          {commission.entries.length === 0 ? (
            <Empty text={isAr ? "مفيش فلوس اتحصّلت على شغله في الفترة دي." : "No payments for their work in this period yet."} />
          ) : (
            <>
            <ul className="divide-y divide-line/60 md:hidden">
              {commission.entries.map((e) => (
                <li key={e.id} className="py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="break-words text-[15px] font-semibold text-ink">{e.patientName}</p>
                      <p className="break-words text-[13px] font-semibold text-ink-body">{e.serviceName}</p>
                    </div>
                    <span className="shrink-0 text-[13px] font-semibold text-ink-muted">{dayOf(e.date, isAr)}</span>
                  </div>
                  <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2">
                    {cardFigure(isAr ? "المدفوع" : "Patient paid", <span className="font-figure font-semibold text-ink-body">{money(e.paid)}</span>)}
                    {cardFigure("%", pctCell(e, "min-h-10 w-20 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-end font-figure text-[15px] font-bold text-ink outline-none focus:border-accent"))}
                    {cardFigure(isAr ? "نصيبه" : "Their share", <span className="font-figure font-extrabold text-ink">{money(e.amount)}</span>)}
                    {cardFigure(isAr ? "اتدفع له" : "Paid to them", paidValue(settledOf(e.id)))}
                  </dl>
                </li>
              ))}
              <li className="flex items-center justify-between gap-3 py-3">
                <span className="text-[15px] font-bold text-ink">{isAr ? "الإجمالي" : "Total"}</span>
                <span className="font-figure text-[18px] font-extrabold text-ink">{money(commission.total)}</span>
              </li>
            </ul>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[34rem] border-collapse text-[14px]">
                <thead>
                  <tr className={tableHead}>
                    <th className="py-2.5 pe-3 text-start">{isAr ? "التاريخ" : "Date"}</th>
                    <th className="py-2.5 pe-3 text-start">{isAr ? "المريض" : "Patient"}</th>
                    <th className="py-2.5 pe-3 text-start">{isAr ? "العلاج" : "Treatment"}</th>
                    <th className="py-2.5 pe-3 text-end">{isAr ? "المدفوع" : "Paid"}</th>
                    <th className="py-2.5 pe-3 text-end">%</th>
                    <th className="py-2.5 pe-3 text-end">{isAr ? "نصيبه" : "Their share"}</th>
                    <th className="py-2.5 text-end">{isAr ? "اتدفع" : "Paid"}</th>
                  </tr>
                </thead>
                <tbody>
                  {commission.entries.map((e) => (
                    <tr key={e.id} className="border-b border-line/60">
                      <td className="py-3 pe-3 font-semibold text-ink-muted">{dayOf(e.date, isAr)}</td>
                      <td className="py-3 pe-3 font-semibold text-ink">{e.patientName}</td>
                      <td className="py-3 pe-3 font-semibold text-ink-body">{e.serviceName}</td>
                      <td className="py-3 pe-3 text-end font-figure font-semibold text-ink-body">{money(e.paid)}</td>
                      {/*
                        Editable: the one-off case where the dentist took a different cut, set on
                        that payment rather than by moving their standing rate. The server recomputes
                        the share and the clinic's profit and stamps the row as set by hand.
                      */}
                      <td className="py-3 pe-3 text-end">
                        {pctCell(e, "w-20 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-end font-figure text-[15px] font-bold text-ink outline-none focus:border-accent")}
                      </td>
                      <td className="py-3 pe-3 text-end font-figure font-extrabold text-ink">{money(e.amount)}</td>
                      <PaidCell settled={settledOf(e.id)} isAr={isAr} />
                    </tr>
                  ))}
                  <tr>
                    <td colSpan={5} className="py-3 pe-3 text-end text-[15px] font-bold text-ink">
                      {isAr ? "الإجمالي" : "Total"}
                    </td>
                    <td className="py-3 pe-3 text-end font-figure text-[18px] font-extrabold text-ink">{money(commission.total)}</td>
                    <td />
                  </tr>
                </tbody>
              </table>
            </div>
            </>
          )}
        </Section>
      )}

      {/* --- insurance work, line by line: paid apart from private work --------------------- */}
      {dentist && insurance.entries.length > 0 && (
        <Section
          title={isAr ? "شغل التأمين" : "Insurance work"}
          note={
            isAr
              ? "الخدمات اللي الطبيب ده عملها على موافقات التأمين. النسبة اتحسبت على المبلغ الموافق عليه، ومنفصلة عن الشغل الخاص."
              : "Services this dentist did on insurance approvals. Their share is worked out on the approved amount and kept apart from private work."
          }
        >
          <ul className="divide-y divide-line/60 md:hidden">
            {insurance.entries.map((e) => (
              <li key={e.claimId + "-" + e.lineIndex} className="py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="break-words text-[15px] font-semibold text-ink">{e.patientName}</p>
                    <p className="break-words text-[13px] font-semibold text-ink-body">{e.service}</p>
                    <p className="text-[12px] font-semibold text-ink-muted">
                      {isAr ? "رقم الموافقة" : "Approval no."} <bdi dir="ltr" className="font-figure">{e.approvalNumber}</bdi>
                    </p>
                  </div>
                  <span className="shrink-0 text-[13px] font-semibold text-ink-muted">{dayOf(e.date, isAr)}</span>
                </div>
                <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2">
                  {cardFigure(isAr ? "الموافق عليه" : "Approved", <span className="font-figure font-semibold text-ink-body">{money(e.approved)}</span>)}
                  {cardFigure("%", <span className="font-figure font-semibold text-ink-body">{e.rate}%</span>)}
                  {cardFigure(isAr ? "نصيبه" : "Their share", <span className="font-figure font-extrabold text-ink">{money(e.share)}</span>)}
                  {cardFigure(isAr ? "اتدفع له" : "Paid to them", paidValue(settledOf(`${e.claimId}#${e.lineIndex}`)))}
                </dl>
              </li>
            ))}
            <li className="py-3">
              <dl className="grid grid-cols-2 gap-x-4">
                {cardFigure(isAr ? "إجمالي الموافق عليه" : "Total approved", <span className="font-figure text-[18px] font-extrabold text-ink">{money(insurance.approved)}</span>)}
                {cardFigure(isAr ? "إجمالي نصيبه" : "Total share", <span className="font-figure text-[18px] font-extrabold text-ink">{money(insurance.total)}</span>)}
              </dl>
            </li>
          </ul>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[36rem] border-collapse text-[14px]">
              <thead>
                <tr className={tableHead}>
                  <th className="py-2.5 pe-3 text-start">{isAr ? "التاريخ" : "Date"}</th>
                  <th className="py-2.5 pe-3 text-start">{isAr ? "المريض" : "Patient"}</th>
                  <th className="py-2.5 pe-3 text-start">{isAr ? "رقم الموافقة" : "Approval no."}</th>
                  <th className="py-2.5 pe-3 text-start">{isAr ? "الخدمة" : "Service"}</th>
                  <th className="py-2.5 pe-3 text-end">{isAr ? "الموافق عليه" : "Approved"}</th>
                  <th className="py-2.5 pe-3 text-end">%</th>
                  <th className="py-2.5 pe-3 text-end">{isAr ? "نصيبه" : "Their share"}</th>
                  <th className="py-2.5 text-end">{isAr ? "اتدفع" : "Paid"}</th>
                </tr>
              </thead>
              <tbody>
                {insurance.entries.map((e) => (
                  <tr key={e.claimId + "-" + e.lineIndex} className="border-b border-line/60">
                    <td className="py-3 pe-3 font-semibold text-ink-muted">{dayOf(e.date, isAr)}</td>
                    <td className="py-3 pe-3 font-semibold text-ink">{e.patientName}</td>
                    <td className="py-3 pe-3 text-start font-figure font-semibold text-ink-body"><bdi dir="ltr">{e.approvalNumber}</bdi></td>
                    <td className="py-3 pe-3 font-semibold text-ink-body">{e.service}</td>
                    <td className="py-3 pe-3 text-end font-figure font-semibold text-ink-body">{money(e.approved)}</td>
                    <td className="py-3 pe-3 text-end font-figure font-semibold text-ink-body">{e.rate}%</td>
                    <td className="py-3 pe-3 text-end font-figure font-extrabold text-ink">{money(e.share)}</td>
                    <PaidCell settled={settledOf(`${e.claimId}#${e.lineIndex}`)} isAr={isAr} />
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={4} className="py-3 pe-3 text-[15px] font-bold text-ink">{isAr ? "الإجمالي" : "Total"}</td>
                  <td className="py-3 pe-3 text-end font-figure text-[18px] font-extrabold text-ink">{money(insurance.approved)}</td>
                  <td />
                  <td className="py-3 pe-3 text-end font-figure text-[18px] font-extrabold text-ink">{money(insurance.total)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        </Section>
      )}
    </>
  );
}
