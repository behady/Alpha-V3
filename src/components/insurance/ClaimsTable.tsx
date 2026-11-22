"use client";

/**
 * The saved approvals of one insurer in the chosen range, one patient per line.
 *
 * A patient opens in place to his approvals, and each approval shows its paper's facts (number,
 * dates, approved total, patient share, status), the month of the closing sheet it goes on, one
 * line per service (what, who, state, amount, the day it was done) and its actions: mark treated /
 * not treated, mark sent / not sent, collect the share, record the company's payment, open the
 * document, edit, delete (to the recycle bin).
 *
 * The whole approval goes on one month's sheet. Listed "by finish date" that month fills itself in
 * (the month its last service was done) and a picker moves the approval; listed "by approval date"
 * the approval date decides and no picker is shown. A sent approval's month is locked.
 *
 * The page owns the calls (`onPatch`, `onDelete`); this owns the questions: a claim already sent
 * to the company asks "continue?" before it is changed or deleted, and every delete asks first.
 */

import { useState } from "react";
import Link from "next/link";
import { ref, getDownloadURL } from "firebase/storage";
import { Banknote, CheckCircle2, ChevronDown, FileText, Landmark, Loader2, Lock, Pencil, RotateCcw, Send, Trash2, Undo2 } from "lucide-react";
import { storage } from "@/lib/firebase";
import { useLanguage } from "@/context/LanguageContext";
import { useUI } from "@/context/UIContext";
import { useBranchForMoney } from "@/lib/useBranchForMoney";
import { claimStatementName, isLineRemoved, lineStatusOf, type ClaimStatus, type InsuranceClaim } from "@/lib/insurance/claims";
import { claimProgress, type LinkedAppointmentLite } from "@/lib/insurance/appointments";
import { claimFinishedDate, claimSheetMonth, inSheetRange, type SheetDateMode } from "@/lib/insurance/billingMonth";
import { pickerMonths } from "@/lib/insurance/sheetPatients";
import Protect from "@/components/Protect";
import { cairoToday, type ClaimPatch } from "./api";
import { fill, monthLabel } from "./sheetFormat";
import { STATE_KEY, tr, type TextKey } from "./text";
import LineDoneControls from "./LineDoneControls";
import LineTeethField from "./LineTeethField";
import { isVisitService, parseTypedTeeth, sheetTeethOf } from "@/lib/insurance/nextcare";
import { useClinic } from "@/context/ClinicContext";
import { useOpenShares } from "./useOpenShares";

const STATUS: Record<ClaimStatus, { key: TextKey; pill: string }> = {
  approved: { key: "statusApproved", pill: "border-amber-200 bg-amber-50 text-amber-800" },
  treated: { key: "statusTreated", pill: "border-line bg-surface-subtle text-ink" },
  sent: { key: "statusSent", pill: "border-emerald-200 bg-emerald-50 text-emerald-800" },
  cancelled: { key: "statusCancelled", pill: "border-line bg-surface-subtle text-ink-faint line-through" },
};

const money = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });

export default function ClaimsTable({
  claims,
  onPatch,
  onDelete,
  onEdit,
  highlightId,
  loading,
  payerName,
  appointments = [],
  mode = "approval",
  from = "",
  to = "",
}: {
  claims: InsuranceClaim[];
  /** Resolves true when the change is saved; the page reports a failure itself. `branchId` rides along when money is taken. */
  onPatch: (claim: InsuranceClaim, patch: ClaimPatch, branchId?: string) => Promise<boolean>;
  onDelete: (claim: InsuranceClaim) => Promise<void>;
  /** Open the saved approval in the confirm card to correct it. */
  onEdit?: (claim: InsuranceClaim) => void;
  /** A claim the page asked to show (from "already saved — open"). */
  highlightId?: string | null;
  loading?: boolean;
  /** The insurer's name, for the payment questions; the claim's payer id stands in without it. */
  payerName?: string;
  /** Every appointment booked for an approved service, for the "2 of 3 done · 1 booked" line. */
  appointments?: LinkedAppointmentLite[];
  /** How the page lists approvals, and the dates picked: they say which approvals are on the sheet. */
  mode?: SheetDateMode;
  from?: string;
  to?: string;
}) {
  const { language } = useLanguage();
  const isAr = language === "ar";
  const t = tr(isAr);
  const { confirm, showToast } = useUI();
  const { isAdmin } = useClinic();
  const { requireBranchForMoney, picker: branchPicker } = useBranchForMoney();
  const [busyId, setBusyId] = useState("");
  /** The patients whose approvals are opened out under their line. */
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());
  const toggleOpen = (id: string) =>
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  // The share still unpaid, from the treatment rows: ordinary payments at the counter count too.
  const openShare = useOpenShares(claims);

  /** A claim already sent to MetLife is checked with the desk before anything changes it. */
  const sentOk = async (claim: InsuranceClaim) =>
    claim.status !== "sent" || (await confirm(t("sentWarning"), { confirmLabel: t("continue") }));

  const run = async (claim: InsuranceClaim, fn: () => Promise<unknown>) => {
    setBusyId(claim.id);
    try {
      await fn();
    } finally {
      setBusyId("");
    }
  };

  const patch = async (claim: InsuranceClaim, change: ClaimPatch) => {
    if (!(await sentOk(claim))) return;
    await run(claim, () => onPatch(claim, change));
  };

  /** Money is asked about first, with the figure, exactly as the patient's Insurance tab asks. */
  const collect = async (claim: InsuranceClaim, amount: number) => {
    const question = t("confirmShare").replace("{amount}", money(amount)).replace("{number}", claim.approvalNumber);
    if (!(await confirm(question, { confirmLabel: t("collectShare") }))) return;
    // The "already sent" warning comes before the branch pick, so nobody picks and is then warned.
    if (!(await sentOk(claim))) return;
    // Cash taken under "All branches" is told which branch it belongs to first.
    const branchId = await requireBranchForMoney();
    if (branchId === null) return;
    await run(claim, () => onPatch(claim, { collectShare: true }, branchId || undefined));
  };

  const insurerPaid = async (claim: InsuranceClaim) => {
    const question = t("confirmInsurerPaid")
      .replace("{amount}", money(claim.totals.approved))
      .replace("{insurer}", payerName || claim.payerId)
      .replace("{number}", claim.approvalNumber);
    if (!(await confirm(question, { confirmLabel: t("markInsurerPaid") }))) return;
    if (!(await sentOk(claim))) return;
    const branchId = await requireBranchForMoney();
    if (branchId === null) return;
    await run(claim, () => onPatch(claim, { insurerPaid: true }, branchId || undefined));
  };

  const remove = async (claim: InsuranceClaim) => {
    if (!(await sentOk(claim))) return;
    if (!(await confirm(t("deleteConfirm"), { tone: "danger", confirmLabel: t("delete") }))) return;
    await run(claim, () => onDelete(claim));
  };

  const openDoc = async (claim: InsuranceClaim) => {
    if (!claim.doc.path) {
      showToast(t("noDocument"), "error");
      return;
    }
    // Opened before the await: a window opened after one is a popup the browser blocks.
    const win = window.open("", "_blank");
    try {
      const url = await getDownloadURL(ref(storage, claim.doc.path));
      if (win) {
        win.opener = null;
        win.location.href = url;
      } else {
        window.location.assign(url);
      }
    } catch (err) {
      console.error("Insurance document link failed", err);
      win?.close();
      showToast(t("noDocument"), "error");
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center rounded-3xl border border-line bg-surface py-16">
        <Loader2 className="animate-spin text-ink-muted" size={22} />
      </div>
    );
  }
  if (claims.length === 0) {
    return <p className="rounded-3xl border border-dashed border-line bg-surface-subtle py-14 text-center text-sm font-bold text-ink-muted">{t("noClaims")}</p>;
  }

  const totals = claims.reduce(
    (acc, c) => (c.status === "cancelled" ? acc : { approved: acc.approved + c.totals.approved, share: acc.share + c.totals.patientShare }),
    { approved: 0, share: 0 },
  );

  /** The day the approval was finished, "Not finished" while a service is still open, a dash before any work. */
  const finishedText = (c: InsuranceClaim) => (c.status === "treated" || c.status === "sent" ? (claimFinishedDate(c) ?? t("notFinished")) : "—");

  /** What Collect would take; the claim's own figure while its rows load. */
  const shareDue = (c: InsuranceClaim) => openShare(c) ?? c.totals.patientShare;

  /** The row's buttons; `big` gives each a 40px target for the phone cards. */
  const renderActions = (c: InsuranceClaim, big = false) => {
    const busy = busyId === c.id;
    const s = big ? 18 : 14;
    // Phones: a labelled grid, four to a row, so every action says what it does without a long press.
    return (
      <div className={big ? "grid grid-cols-4 gap-1" : "flex flex-wrap items-center gap-1"}>
        {busy && <Loader2 size={s} className={`animate-spin text-ink-muted ${big ? "col-span-4 mx-auto" : ""}`} />}
        {(c.status === "approved" || c.status === "cancelled") && (
          <Action big={big} short={t("shortTreated")} label={t("markTreated")} disabled={busy} onClick={() => patch(c, { status: "treated" })}>
            <CheckCircle2 size={s} />
          </Action>
        )}
        {(c.status === "treated" || c.status === "sent") && (
          <Action big={big} short={t("shortNotTreated")} label={t("markNotTreated")} disabled={busy} onClick={() => patch(c, { status: "approved" })}>
            <RotateCcw size={s} />
          </Action>
        )}
        {c.status === "treated" && (
          <Action big={big} short={t("shortSent")} label={t("markSent")} disabled={busy} onClick={() => patch(c, { status: "sent" })}>
            <Send size={s} />
          </Action>
        )}
        {/* A sent approval's month is locked; this is how the desk unlocks one to correct it. No
            "already sent" question first: undoing that is the whole point of the button. */}
        {c.status === "sent" && (
          <Action big={big} short={t("shortNotSent")} label={t("markNotSent")} disabled={busy} onClick={() => void run(c, () => onPatch(c, { status: "treated" }))}>
            <Undo2 size={s} />
          </Action>
        )}
        {(c.status === "treated" || c.status === "sent") && shareDue(c) > 0 && (
          <Action big={big} short={t("shortCollect")} label={`${t("collectShare")} ${money(shareDue(c))}`} disabled={busy} onClick={() => void collect(c, shareDue(c))}>
            <Banknote size={s} />
          </Action>
        )}
        {(c.status === "treated" || c.status === "sent") && Object.keys(c.ledgerIds).length > 0 && !c.insurerPaid && (
          <Action big={big} short={t("shortInsurerPaid")} label={`${t("markInsurerPaid")} ${money(c.totals.approved)}`} disabled={busy} onClick={() => void insurerPaid(c)}>
            <Landmark size={s} />
          </Action>
        )}
        <Action big={big} short={t("shortDoc")} label={t("openPdf")} disabled={!c.doc.path} onClick={() => openDoc(c)}>
          <FileText size={s} />
        </Action>
        {onEdit && c.status !== "cancelled" && (
          <Action
            big={big}
            short={t("edit")}
            label={t("edit")}
            disabled={busy}
            onClick={() => {
              void (async () => {
                if (await sentOk(c)) onEdit(c);
              })();
            }}
          >
            <Pencil size={s} />
          </Action>
        )}
        <Action big={big} short={t("delete")} label={t("delete")} disabled={busy} onClick={() => remove(c)} danger>
          <Trash2 size={s} />
        </Action>
      </div>
    );
  };

  // --- one approval's month on the closing sheet ("by finish date" only) -------------------------
  const today = cairoToday();
  const monthChoices = pickerMonths(today, today.slice(0, 7) < "2026-01" ? today.slice(0, 7) : "2026-01");

  const pickMonth = async (c: InsuranceClaim, value: string) => {
    if (value === (c.sheetMonth ?? "")) return;
    // Placed before all of it is done: its unfinished services would go to the company too.
    if (value && claimFinishedDate(c) === null) {
      const ok = await confirm(fill(t("apMonthWarn"), { number: c.approvalNumber, month: monthLabel(value, isAr) }), {
        title: t("dwMonthWarnTitle"),
        confirmLabel: t("dwMonthWarnGo"),
      });
      if (!ok) return;
    }
    await run(c, () => onPatch(c, { sheetMonth: value || null }));
  };

  const monthControl = (c: InsuranceClaim) => {
    if (mode !== "finish" || c.status === "cancelled") return null;
    const auto = claimFinishedDate(c)?.slice(0, 7) ?? "";
    const shown = claimSheetMonth(c);
    if (c.status === "sent") {
      return (
        <span className="inline-flex items-center gap-1.5 text-[12.5px] font-bold text-ink-body" title={t("apMonthSentHint")}>
          <Lock size={13} aria-hidden="true" />
          {shown ? monthLabel(shown, isAr) : "—"}
        </span>
      );
    }
    if (c.status !== "treated") return <span className="text-[12.5px] font-semibold text-ink-muted">{t("apMonthNotTreated")}</span>;
    const picked = c.sheetMonth ?? "";
    const options = picked && !monthChoices.includes(picked) ? [...monthChoices, picked].sort() : monthChoices;
    return (
      <Protect permission="insurance.edit" fallback={<span className="text-[12.5px] font-bold text-ink-body">{shown ? monthLabel(shown, isAr) : t("monthNone")}</span>}>
        <select
          value={picked}
          disabled={busyId === c.id}
          onChange={(e) => void pickMonth(c, e.target.value)}
          aria-label={t("colMonth")}
          className={`h-9 w-full min-w-0 rounded-lg border bg-surface px-2 text-[13px] font-bold outline-none focus:border-ink disabled:opacity-60 sm:w-52 ${
            shown ? "border-line-strong text-ink" : "border-amber-300 text-amber-800"
          }`}
        >
          <option value="">{auto ? fill(t("monthAuto"), { month: monthLabel(auto, isAr) }) : t("monthNone")}</option>
          {options.map((m) => (
            <option key={m} value={m}>
              {monthLabel(m, isAr)}
            </option>
          ))}
        </select>
      </Protect>
    );
  };

  // --- one service's teeth ------------------------------------------------------------------------
  /** NextCare's and AXA's sheets print each service's teeth; MetLife's paper and sheet name none. */
  const hasTeeth = (c: InsuranceClaim) => c.insurer !== "metlife";
  /** The teeth a service goes to the company with: its own, else the ones the paper's conditions give it. */
  const teethOf = (c: InsuranceClaim, i: number): string[] => sheetTeethOf(c)[i] ?? [];

  /**
   * Typed over by hand: checked, then one question at most before it is saved everywhere at once —
   * an approval already sent asks its own (Owner or Admin only); otherwise the desk is warned when
   * numbers already there are replaced, or when the count of teeth is not the count approved.
   */
  const saveTeeth = async (c: InsuranceClaim, i: number, typed: string) => {
    const { teeth, bad } = parseTypedTeeth(typed);
    if (bad !== null) {
      showToast(fill(t("apTeethBad"), { tooth: bad }), "error");
      return;
    }
    const line = c.lines[i];
    const was = teethOf(c, i);
    const own = line.teeth ?? [];
    const replacing = was.join(",") !== teeth.join(",");
    // Nothing to do — unless the numbers shown are only the paper's: typing them saves them.
    if (!replacing && (teeth.length === 0 || own.join(",") === teeth.join(","))) return;
    const sent = c.status === "sent";
    if (sent && !isAdmin) {
      showToast(t("apTeethSentStaff"), "error");
      return;
    }
    const service = line.description || line.code;
    const units = Math.round(Number(line.unitsApproved) || 0);
    const parts: string[] = [];
    // Tooth lists read left to right ("44, 46"), also inside an Arabic sentence.
    const list = (codes: string[]) => `⁦${codes.join(", ")}⁩`;
    if (sent) parts.push(t("apTeethSentWarn"));
    if (replacing && was.length > 0) parts.push(fill(t("apTeethWarn"), { service, was: list(was), now: teeth.length ? list(teeth) : t("apTeethNone") }));
    if (teeth.length > 0 && units > 0 && teeth.length !== units) parts.push(fill(t("apTeethCountWarn"), { service, units: String(units), count: String(teeth.length) }));
    if (parts.length > 0) {
      const ok = await confirm(parts.join("\n\n"), sent ? { title: t("apTeethSentTitle"), confirmLabel: t("apTeethWarnGo"), tone: "danger" } : { title: t("apTeethWarnTitle"), confirmLabel: t("apTeethWarnGo") });
      if (!ok) return;
    }
    await run(c, async () => {
      if (await onPatch(c, { lineTeeth: { [i]: teeth }, ...(sent ? { confirmSent: true } : {}) })) showToast(t("apTeethSaved"), "success");
    });
  };

  const teethControl = (c: InsuranceClaim, i: number, gone: boolean) => {
    const teeth = teethOf(c, i);
    const plain = <bdi dir="ltr" className="font-figure text-[13px] font-bold tabular-nums text-ink-body">{teeth.join(", ") || "—"}</bdi>;
    if (gone) return plain;
    // The exam is per visit: NextCare's and AXA's sheets never print a tooth for it.
    if (isVisitService(c.lines[i])) {
      return (
        <span className="text-[13px] font-bold text-ink-faint" title={t("apTeethPerVisit")}>
          —
        </span>
      );
    }
    return (
      <Protect permission="insurance.edit" fallback={plain}>
        <LineTeethField teeth={teeth} borrowed={teeth.length > 0 && (c.lines[i].teeth ?? []).length === 0} disabled={busyId === c.id} label={t("colTeeth")} placeholder={t("apTeethPlaceholder")} onCommit={(typed) => saveTeeth(c, i, typed)} />
      </Protect>
    );
  };

  /** One service of an approval: what it is, its teeth (editable), who did it, its state, its amount, the day it was done (editable). */
  const serviceLine = (c: InsuranceClaim, i: number) => {
    const line = c.lines[i];
    const gone = isLineRemoved(c, i);
    const state = lineStatusOf(c, i);
    const dentist = (c.dentists[i]?.name ?? "").replace(/^Dr\.?\s*/i, "");
    const pill = state === "Completed" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-amber-200 bg-amber-50 text-amber-800";
    return (
      <li key={i} className="flex flex-col gap-2 px-4 py-3 lg:flex-row lg:items-center lg:gap-4">
        <div className="min-w-0 lg:flex-1">
          <div className="flex items-start justify-between gap-3">
            <p className={`min-w-0 text-[13.5px] font-bold leading-snug ${gone ? "text-ink-faint line-through" : "text-ink"}`}>
              <bdi dir="ltr" className="font-figure text-[12px] font-semibold text-ink-muted">{line.code}</bdi> {line.description}
            </p>
            <span className={`shrink-0 font-figure text-[14px] font-black tabular-nums lg:hidden ${gone ? "text-ink-faint line-through" : "text-ink"}`}>{money(line.approvedAmount)}</span>
          </div>
          {dentist && <p className="mt-0.5 text-[12px] text-ink-muted lg:hidden">{dentist}</p>}
        </div>
        {hasTeeth(c) && (
          <div className="flex items-center justify-between gap-3 lg:block lg:w-28 lg:text-center">
            <span className="text-[11px] font-black uppercase tracking-wider text-ink-muted lg:hidden">{t("colTeeth")}</span>
            {teethControl(c, i, gone)}
          </div>
        )}
        <span className="min-w-0 truncate text-[13px] text-ink-body max-lg:hidden lg:w-28">{dentist || "—"}</span>
        <div className="flex items-center justify-between gap-3 lg:block lg:w-28">
          <span className="text-[11px] font-black uppercase tracking-wider text-ink-muted lg:hidden">{t("colStatus")}</span>
          {gone ? (
            <span className="text-[12px] font-bold text-ink-faint">{t("apDeleted")}</span>
          ) : (
            <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-[11.5px] font-bold whitespace-nowrap ${pill}`}>{t(STATE_KEY[state])}</span>
          )}
        </div>
        <span className={`font-figure text-[14px] font-black tabular-nums max-lg:hidden lg:w-20 lg:text-end ${gone ? "text-ink-faint line-through" : "text-ink"}`}>{money(line.approvedAmount)}</span>
        <div className="flex items-center justify-between gap-3 lg:w-[17rem] lg:justify-end">
          <span className="text-[11px] font-black uppercase tracking-wider text-ink-muted lg:hidden">{t("apDoneOn")}</span>
          <LineDoneControls claim={c} line={i} disabled={busyId === c.id} />
        </div>
      </li>
    );
  };

  const progressLine = (c: InsuranceClaim) => {
    // Only when there is something to say: an approval with every service done and
    // nothing on the calendar is just its status.
    if (c.status === "cancelled") return null;
    const p = claimProgress(c, appointments);
    if (p.done === p.total && p.booked === 0) return null;
    return t("progress").replace("{done}", String(p.done)).replace("{total}", String(p.total)).replace("{booked}", String(p.booked));
  };

  /** One approval under its patient: the paper's facts, its sheet month, its services and its actions. */
  const approvalCard = (c: InsuranceClaim) => {
    const status = STATUS[c.status];
    const progress = progressLine(c);
    const month = monthControl(c);
    return (
      <div
        key={c.id}
        id={`claim-${c.id}`}
        className={`overflow-hidden rounded-2xl border ${highlightId === c.id ? "border-amber-300 bg-amber-50" : "border-line bg-surface"}`}
      >
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-4 pt-3.5">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
              <span className="font-display text-[14px] font-black text-ink">
                <bdi dir="ltr">{c.approvalNumber}</bdi>
              </span>
              <span className={`inline-block rounded-full border px-2.5 py-0.5 text-[11px] font-black ${status.pill}`}>{t(status.key)}</span>
              {progress && <span className="text-[11px] font-semibold tabular-nums text-ink-muted">{progress}</span>}
            </div>
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11.5px] font-bold tabular-nums text-ink-body">
              <span>
                {t("colApprovalDate")}: {c.approvalDate}
              </span>
              {c.treatedDate && (
                <span>
                  {t("colTreatedDate")}: {c.treatedDate}
                </span>
              )}
              {(c.status === "treated" || c.status === "sent") && (
                <span>
                  {t("colFinished")}: {finishedText(c)}
                </span>
              )}
            </div>
          </div>
          <div className="shrink-0 text-end">
            <div className="text-[10px] font-black uppercase tracking-wider text-ink-muted">{t("colApproved")}</div>
            <div className="font-display text-lg font-black tabular-nums leading-tight text-ink">{money(c.totals.approved)}</div>
            {c.totals.patientShare > 0 && (
              <div className="text-[11px] font-bold tabular-nums text-ink-body">
                {t("colShare")}: {money(c.totals.patientShare)}
              </div>
            )}
          </div>
        </div>

        {month && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 pt-2.5">
            <span className="text-[11px] font-black uppercase tracking-wider text-ink-muted">{t("colMonth")}</span>
            {month}
          </div>
        )}

        {c.status !== "cancelled" && (
          <div className="mt-3 border-t border-line">
            <div className="hidden items-center gap-4 border-b border-line bg-surface-subtle px-4 py-1.5 text-[10px] font-black uppercase tracking-wider text-ink-muted lg:flex">
              <span className="min-w-0 flex-1">{t("apService")}</span>
              {hasTeeth(c) && <span className="lg:w-28 lg:text-center">{t("colTeeth")}</span>}
              <span className="lg:w-28">{t("colDentist")}</span>
              <span className="lg:w-28">{t("colStatus")}</span>
              <span className="lg:w-20 lg:text-end">{t("colApproved")}</span>
              <span className="lg:w-[17rem] lg:text-end">{t("apDoneOn")}</span>
            </div>
            <ul className="divide-y divide-line">{c.lines.map((_, i) => serviceLine(c, i))}</ul>
          </div>
        )}

        <div className="border-t border-line px-3 py-2 md:hidden">{renderActions(c, true)}</div>
        <div className="hidden border-t border-line px-3 py-1.5 md:block">{renderActions(c)}</div>
      </div>
    );
  };

  // --- the patients -------------------------------------------------------------------------------
  type PatientGroup = { key: string; patientId: string; name: string; member: string; claims: InsuranceClaim[] };
  const groups: PatientGroup[] = [];
  const byKey = new Map<string, PatientGroup>();
  for (const c of claims) {
    const key = c.patientId || `claim:${c.id}`;
    let g = byKey.get(key);
    if (!g) {
      g = {
        key,
        patientId: c.patientId,
        name: claimStatementName(c),
        member: c.insurer === "metlife" ? `${c.metlife.certificateNumber}/${c.metlife.dependentCode}` : c.metlife.certificateNumber,
        claims: [],
      };
      byKey.set(key, g);
      groups.push(g);
    }
    g.claims.push(c);
  }

  /** Where a patient stands against the sheet on screen: his best-placed approval speaks for him. */
  const standing = (g: PatientGroup): { label: string; tone: string; rank: number } => {
    const on = g.claims.filter((c) => inSheetRange(c, mode, from, to));
    if (on.some((c) => c.status === "treated")) return { label: t("dwOnSheet"), tone: "border-ink-slab bg-ink-slab text-white", rank: 0 };
    if (on.length) return { label: t("statusSent"), tone: "border-emerald-200 bg-emerald-50 text-emerald-800", rank: 2 };
    if (g.claims.some((c) => c.status === "approved")) return { label: t("statusApproved"), tone: "border-amber-200 bg-amber-50 text-amber-800", rank: 1 };
    if (g.claims.some((c) => c.status === "treated")) return { label: t("notFinished"), tone: "border-amber-200 bg-amber-50 text-amber-800", rank: 1 };
    return { label: t("statusCancelled"), tone: "border-line bg-surface-subtle text-ink-faint", rank: 3 };
  };
  const ranked = groups
    .map((g) => ({ g, s: standing(g) }))
    .sort((a, b) => a.s.rank - b.s.rank || a.g.name.localeCompare(b.g.name));
  const highlighted = highlightId ? groups.find((g) => g.claims.some((c) => c.id === highlightId))?.key : undefined;

  return (
    <>
      {branchPicker}
      <p className="text-[12px] font-semibold text-ink-muted">{t("apListHint")}</p>
      <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
        {ranked.map(({ g, s }) => {
          const open = openIds.has(g.key) || highlighted === g.key;
          const live = g.claims.filter((c) => c.status !== "cancelled");
          const approved = live.reduce((sum, c) => sum + c.totals.approved, 0);
          return (
            <li key={g.key}>
              <div className={`flex items-center gap-3 px-4 py-3.5 transition-colors hover:bg-surface-subtle ${open ? "bg-surface-subtle" : ""}`}>
                <button type="button" onClick={() => toggleOpen(g.key)} aria-expanded={open} className="flex min-w-0 flex-1 items-center gap-3 text-start">
                  <span className="min-w-0 flex-1">
                    <span className="block text-[14.5px] font-bold text-ink">{g.name || "—"}</span>
                    <span className="mt-0.5 block truncate text-[12px] text-ink-muted">
                      {fill(t(g.claims.length === 1 ? "apOneApproval" : "apManyApprovals"), { n: g.claims.length })}
                      {" · "}
                      <bdi dir="ltr">{g.claims.map((c) => c.approvalNumber).join(", ")}</bdi>
                    </span>
                  </span>
                  <span className={`shrink-0 rounded-full border px-2.5 py-0.5 text-[11px] font-bold whitespace-nowrap ${s.tone}`}>{s.label}</span>
                  <span className="w-20 shrink-0 text-end font-figure text-[15px] font-black tabular-nums text-ink max-sm:hidden">{money(approved)}</span>
                  <ChevronDown size={16} className={`shrink-0 text-ink-muted transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
                </button>
              </div>
              {open && (
                <div className="space-y-3 border-t border-line bg-surface-subtle p-3 sm:p-4">
                  {g.patientId && (
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] font-semibold text-ink-muted">
                      <bdi dir="ltr">{g.member}</bdi>
                      <Link href={`/patients/${g.patientId}?tab=insurance`} className="font-bold underline underline-offset-2 hover:text-ink">
                        {t("dwOpenFile")}
                      </Link>
                    </div>
                  )}
                  {g.claims.map((c) => approvalCard(c))}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <div className="flex items-center justify-between rounded-2xl border border-line bg-surface-subtle px-4 py-3">
        <span className="text-[12px] font-black uppercase tracking-wider text-ink">
          {t("totalRow")} · {claims.length}
        </span>
        <span className="text-end">
          <span className="block font-display text-[15px] font-black tabular-nums text-ink">{money(totals.approved)}</span>
          {totals.share > 0 && <span className="block text-[11px] font-bold tabular-nums text-ink-body">{t("colShare")}: {money(totals.share)}</span>}
        </span>
      </div>
    </>
  );
}

function Action({ label, short, onClick, disabled, danger, big, children }: { label: string; short?: string; onClick: () => void; disabled?: boolean; danger?: boolean; big?: boolean; children: React.ReactNode }) {
  if (big && short) {
    // Phone card: the icon with its word under it; the full wording stays the button's name.
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        title={label}
        aria-label={label}
        className={`flex min-h-14 min-w-0 flex-col items-center justify-center gap-1 rounded-xl border border-transparent px-1 py-1.5 transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
          danger ? "text-ink-muted hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700" : "text-ink-body hover:border-line hover:bg-surface-subtle hover:text-ink"
        }`}
      >
        {children}
        <span aria-hidden className="w-full text-center text-[10.5px] font-bold leading-tight">{short}</span>
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className={`${big ? "inline-flex h-10 w-10 items-center justify-center rounded-xl" : "rounded-lg p-1.5"} border border-transparent transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
        danger ? "text-ink-muted hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700" : "text-ink-muted hover:border-line hover:bg-surface-subtle hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}
