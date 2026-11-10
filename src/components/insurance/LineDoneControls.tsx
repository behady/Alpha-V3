"use client";

/**
 * One approved service's "done on" day and its delete / restore button.
 *
 * The clinic bills an approval in the month its LAST service was done, and pays the dentist for
 * each service in the month THAT service was done, so every service carries its own day:
 *
 * - a Completed service shows the day it was done, editable (a visit fills it in; marking it done
 *   by hand makes it today);
 * - a service that is not done can be deleted when the patient will not come back for it, so the
 *   approval can finish — its treatment leaves the patient's file, and money the patient already
 *   paid on it stays on their account as credit;
 * - a deleted service can be restored.
 *
 * The same control sits in the booking pop-up's Insurance tab, the patient's Insurance tab and the
 * Insurance page, and all three save through the claims route (the browser cannot write claims).
 * The server decides what is allowed — an approval already sent to the company cannot be moved to
 * another month — and its own bilingual message is what a refusal shows.
 */

import { useEffect, useRef, useState } from "react";
import { Loader2, RotateCcw, Trash2 } from "lucide-react";
import { useClinic } from "@/context/ClinicContext";
import { useLanguage } from "@/context/LanguageContext";
import { useUI } from "@/context/UIContext";
import { isLineRemoved, lineDateOf, lineStatusOf, type InsuranceClaim } from "@/lib/insurance/claims";
import { cairoToday, editClaimLine, InsuranceCallError, type ClaimPatch } from "./api";
import { tr } from "./text";

const money = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });

/** Whether a service's own day means anything yet: only work on a treated or sent approval is dated. */
function isWorked(claim: Pick<InsuranceClaim, "status">): boolean {
  return claim.status === "treated" || claim.status === "sent";
}

/** How long the date field waits after the last keystroke before it saves. */
const SAVE_AFTER_MS = 800;

/**
 * The date field itself. Typing a date by keyboard passes through other valid dates on the way
 * (the year 2026 is 0002, 0020 and 0202 first), so nothing is saved per keystroke: the field
 * keeps a draft, and saves it once typing has stopped — or at once when the field is left — and
 * only when it is a real day between the approval date and today. Anything else is shown in red
 * and never sent. The parent remounts this (`key`) when the stored day changes, so the draft
 * always starts from what is saved.
 */
function DoneDateField({
  stored,
  min,
  max,
  disabled,
  busy,
  label,
  hint,
  onCommit,
}: {
  stored: string;
  min: string;
  max: string;
  disabled: boolean;
  busy: boolean;
  label: string;
  hint: string;
  /** Resolves false when the save was refused, so the field goes back to the stored day. */
  onCommit: (day: string) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState(stored);
  const saving = useRef(false);
  const valid = draft !== "" && (!min || draft >= min) && draft <= max;
  const dirty = draft !== stored;

  const commit = async (day: string) => {
    if (saving.current) return;
    saving.current = true;
    try {
      if (!(await onCommit(day))) setDraft(stored);
    } finally {
      saving.current = false;
    }
  };

  useEffect(() => {
    if (!dirty || !valid) return;
    const timer = setTimeout(() => void commit(draft), SAVE_AFTER_MS);
    return () => clearTimeout(timer);
    // `commit` is recreated every render; the draft is what this waits on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, dirty, valid]);

  return (
    <input
      type="date"
      dir="ltr"
      value={draft}
      min={min || undefined}
      max={max}
      disabled={disabled || busy}
      aria-label={label}
      aria-invalid={dirty && !valid}
      title={hint}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (dirty && valid) void commit(draft);
        else if (dirty) setDraft(stored);
      }}
      className={`h-9 rounded-lg border bg-surface px-2 font-figure text-[13px] font-semibold tabular-nums text-ink outline-none disabled:opacity-60 ${
        dirty && !valid ? "border-rose-400 focus:border-rose-500" : "border-line-strong focus:border-ink"
      }`}
    />
  );
}

export default function LineDoneControls({
  claim,
  line,
  showLabel = false,
  disabled = false,
}: {
  claim: InsuranceClaim;
  /** The service's index on the approval. */
  line: number;
  /** Phones and narrow lists have no column heading, so the date says what it is. */
  showLabel?: boolean;
  disabled?: boolean;
}) {
  const { clinicId } = useClinic();
  const { language } = useLanguage();
  const t = tr(language === "ar");
  const { confirm, showToast } = useUI();
  const [busy, setBusy] = useState(false);

  /** Resolves to the kept credit on success (0 when there is none), null when nothing was saved. */
  const save = async (patch: ClaimPatch): Promise<number | null> => {
    if (!clinicId || busy) return null;
    setBusy(true);
    try {
      const answer = await editClaimLine(clinicId, claim.id, patch);
      if (answer.error) {
        showToast(answer.error, "error");
        return null;
      }
      return answer.creditKept;
    } catch (err) {
      showToast(err instanceof InsuranceCallError && err.kind === "signed_out" ? t("signedOut") : t("updateFailed"), "error");
      return null;
    } finally {
      setBusy(false);
    }
  };

  const removed = isLineRemoved(claim, line);
  const done = lineStatusOf(claim, line) === "Completed";
  const service = claim.lines[line]?.description ?? "";

  if (claim.status === "cancelled") return null;

  if (removed) {
    return (
      <span className="inline-flex items-center gap-2">
        <span className="rounded-full border border-line px-2 py-0.5 text-[11px] font-black text-ink-faint">{t("lineRemovedTag")}</span>
        <button
          type="button"
          disabled={disabled || busy}
          onClick={() =>
            void (async () => {
              if ((await save({ restoreLine: line })) !== null) showToast(t("lineRestored"), "success");
            })()
          }
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line-strong bg-surface px-3 text-[12.5px] font-bold text-ink transition-colors hover:border-ink disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? <Loader2 size={13} className="animate-spin" /> : <RotateCcw size={13} />}
          {t("restoreLine")}
        </button>
      </span>
    );
  }

  if (done) {
    if (!isWorked(claim)) return null;
    const stored = lineDateOf(claim, line);
    return (
      <label className="inline-flex items-center gap-2">
        {showLabel && <span className="text-[11px] font-bold text-ink-muted">{t("colDoneOn")}</span>}
        <DoneDateField
          key={stored}
          stored={stored}
          min={claim.approvalDate}
          max={cairoToday()}
          disabled={disabled}
          busy={busy}
          label={`${t("colDoneOn")} — ${service}`}
          hint={t("colDoneOnHint")}
          onCommit={async (day) => {
            const saved = (await save({ lineDates: { [line]: day } })) !== null;
            if (saved) showToast(t("updated"), "success");
            return saved;
          }}
        />
        {busy && <Loader2 size={13} className="animate-spin text-ink-faint" />}
      </label>
    );
  }

  // Not done yet: it can be deleted, so it stops holding the approval open.
  return (
    <button
      type="button"
      disabled={disabled || busy}
      title={t("deleteService")}
      aria-label={`${t("deleteService")} — ${service}`}
      onClick={() =>
        void (async () => {
          if (!(await confirm(t("removeLineConfirm").replace("{service}", service), { tone: "danger", confirmLabel: t("deleteService") }))) return;
          const kept = await save({ removeLine: line });
          if (kept === null) return;
          showToast(kept > 0 ? `${t("lineRemoved")} ${t("removeCreditKept").replace("{n}", money(kept))}` : t("lineRemoved"), "success");
        })()
      }
      className="grid h-9 w-9 place-items-center rounded-lg border border-transparent text-ink-muted transition-colors hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700 disabled:cursor-not-allowed disabled:opacity-40"
    >
      {busy ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={15} />}
    </button>
  );
}
