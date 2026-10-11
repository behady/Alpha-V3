"use client";

import { useEffect, useMemo, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { Check, Link2, Link2Off, Loader2, Plus, Upload, X } from "lucide-react";
import { db } from "@/lib/firebase";
import { isInsurerFormat, parsePayers, PRIVATE_PAYER_ID, type Payer } from "@/lib/payers";
import InsurerBadge from "@/components/shared/InsurerBadge";
import { patchClaim, InsuranceCallError } from "@/components/insurance/api";
import { useClinic } from "@/context/ClinicContext";
import { useUI } from "@/context/UIContext";
import { LINE_STATUSES, lineStatusOf, type InsuranceClaim, type LineStatus } from "@/lib/insurance/claims";
import type { ClaimLink } from "@/lib/insurance/appointments";
import { formatDayLabel } from "./PatientTimeline";

type Props = {
  language: string;
  loaded: boolean;
  claims: InsuranceClaim[];
  /** The approved services this visit is booked for. */
  claimLinks: ClaimLink[];
  /** `"claimId|line"`: link that service to this visit, or unlink it if it already is. */
  onToggle: (value: string) => void;
  /** The visit's dentist: a service marked Ongoing or Completed here is put on them. */
  dentistId?: string | null;
  /** Open the upload panel, on this insurer when given (a company the patient has no approval with yet, or the tab's own). */
  onUpload?: (payerId?: string) => void;
};

const money = (n: number) => `${Math.round(Number(n) || 0).toLocaleString("en-US")}`;

const STATUS_LABEL: Record<InsuranceClaim["status"], { en: string; ar: string }> = {
  approved: { en: "Approved", ar: "موافق عليها" },
  treated: { en: "Treated", ar: "اتعالجت" },
  sent: { en: "Sent to insurer", ar: "اتبعتت للتأمين" },
  cancelled: { en: "Cancelled", ar: "ملغية" },
};
const LINE_LABEL: Record<LineStatus, { en: string; ar: string }> = {
  Completed: { en: "Completed", ar: "خلصت" },
  Ongoing: { en: "Ongoing", ar: "شغالين فيها" },
  Planned: { en: "Planned", ar: "متخططة" },
};

/** Approved total, what is done (Completed services), and what is left to use. Cancelled approvals count for nothing. */
export function approvalFigures(claims: readonly InsuranceClaim[]): { approved: number; done: number; left: number } {
  let approved = 0;
  let done = 0;
  for (const c of claims) {
    if (c.status === "cancelled") continue;
    c.lines.forEach((line, i) => {
      approved += Number(line.approvedAmount) || 0;
      if (lineStatusOf(c, i) === "Completed") done += Number(line.approvedAmount) || 0;
    });
  }
  return { approved, done, left: Math.max(0, approved - done) };
}

/**
 * The patient's insurance approvals inside the booking popup.
 *
 * Top: approved / done / remaining credit across every live approval. Each service line can be
 * linked to this visit (several may be — when the visit is marked done, every linked service is
 * marked completed on its approval), and its progress (Planned / Ongoing / Completed) is changed
 * right here, saved at once through the claims route exactly as the patient file's Insurance tab
 * does it.
 */
export default function InsuranceApprovals({ language, loaded, claims, claimLinks, onToggle, dentistId, onUpload }: Props) {
  const isAr = language === "ar";
  const t = (o: { en: string; ar: string }) => (isAr ? o.ar : o.en);
  const { clinicId } = useClinic();
  const { showToast, confirm } = useUI();
  const [busy, setBusy] = useState("");
  const [payers, setPayers] = useState<Payer[]>([]);
  /** The insurance company whose approvals are on screen. "" = the first tab. */
  const [tab, setTab] = useState("");
  /** Ticked service lines, as `"claimId|line"`, for the bulk bar. */
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  useEffect(() => {
    if (!clinicId) return;
    return onSnapshot(
      doc(db, "clinics", clinicId, "settings", "payers"),
      (snap) => setPayers(parsePayers(snap.data())),
      () => setPayers([]),
    );
  }, [clinicId]);

  const payerName = (id: string) => {
    const p = payers.find((x) => x.id === id);
    return p ? (isAr ? p.nameAr || p.name : p.name) : isAr ? "شركة تأمين" : "Insurer";
  };

  /**
   * One tab per insurance company the patient has approvals with: the company with the newest
   * live approval first. A patient covered by two companies sees each one's approvals and credit
   * apart — the money never adds up across insurers.
   */
  const groups = useMemo(() => {
    const byPayer = new Map<string, InsuranceClaim[]>();
    for (const c of claims) byPayer.set(c.payerId, [...(byPayer.get(c.payerId) ?? []), c]);
    const newestLive = (list: InsuranceClaim[]) =>
      list.filter((c) => c.status !== "cancelled").reduce((m, c) => (c.approvalDate > m ? c.approvalDate : m), "");
    return [...byPayer.entries()]
      .map(([id, list]) => ({ id, claims: list, live: list.filter((c) => c.status !== "cancelled").length, newest: newestLive(list) }))
      .sort((a, b) => b.newest.localeCompare(a.newest));
  }, [claims]);
  const activeId = groups.some((g) => g.id === tab) ? tab : (groups[0]?.id ?? "");
  const shown = groups.find((g) => g.id === activeId)?.claims ?? [];
  /** A company set up to read approvals that this patient has none with yet: where "add another insurance" goes. */
  const otherInsurer = payers.find(
    (p) => p.active && p.id !== PRIVATE_PAYER_ID && isInsurerFormat(p.format) && !groups.some((g) => g.id === p.id),
  );

  if (!loaded) {
    return <p className="py-8 text-[15px] text-ink-body">{isAr ? "بنحمّل الموافقات…" : "Loading approvals…"}</p>;
  }
  if (claims.length === 0) {
    return (
      <p className="mt-4 rounded-2xl border border-dashed border-line-strong px-5 py-7 text-[15px] text-ink-body">
        {isAr
          ? "مفيش موافقات تأمين للمريض ده لسه. ارفع ورقة الموافقة من الزرار اللي تحت، واختار شركة التأمين."
          : "No insurance approvals for this patient yet. Upload the approval paper with the button below and pick the insurance company."}
      </p>
    );
  }

  const setProgress = async (claim: InsuranceClaim, line: number, next: LineStatus) => {
    if (!clinicId || lineStatusOf(claim, line) === next) return;
    // The sheet already went to the insurer: changing a service's state changes what it showed.
    if (
      claim.status === "sent" &&
      !(await confirm(
        isAr ? "الموافقة دي اتبعتت للتأمين خلاص. تغيير حالة الخدمة هيغيّر اللي اتبعت. تكمّل؟" : "This approval was already sent to the insurer. Changing a service's state changes what was sent. Continue?",
        { confirmLabel: isAr ? "كمّل" : "Continue" },
      ))
    ) {
      return;
    }
    setBusy(`${claim.id}|${line}`);
    try {
      // Being worked on (Ongoing) or done (Completed) here means it is THIS visit's work: the
      // service is linked to the visit and put on the visit's dentist, in the same step.
      const working = next !== "Planned";
      const assign = working && dentistId && claim.dentists[line]?.staffId !== dentistId ? { dentists: { [line]: dentistId } } : {};
      const error = await patchClaim(clinicId, claim.id, { lineStatus: { [line]: next }, ...assign });
      if (error) showToast(error, "error");
      else {
        if (working && !linked(claim.id, line)) onToggle(`${claim.id}|${line}`);
        showToast(
          working
            ? isAr ? "اتحدّثت واتربطت بالزيارة دي" : "Updated and linked to this visit"
            : isAr ? "اتحدّثت" : "Updated",
          "success",
        );
      }
    } catch (err) {
      showToast(
        err instanceof InsuranceCallError && err.kind === "signed_out"
          ? isAr ? "سجّل دخول تاني" : "Please sign in again"
          : isAr ? "التحديث ماتمّش" : "Could not update",
        "error",
      );
    } finally {
      setBusy("");
    }
  };

  const linked = (claimId: string, line: number) => claimLinks.some((l) => l.claimId === claimId && l.claimLine === line);

  // --- bulk: tick several services, then one action for all of them ---------------------------------
  const keyOf = (claimId: string, line: number) => `${claimId}|${line}`;
  /** Only this insurer's live approvals can be ticked; switching company tab leaves the others out. */
  const pickable = shown.filter((c) => c.status !== "cancelled");
  const pickedLines = pickable.flatMap((c) =>
    c.lines.map((_, i) => ({ claim: c, line: i })).filter(({ line }) => picked.has(keyOf(c.id, line))),
  );
  const togglePick = (k: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  const setPickedFor = (keys: string[], on: boolean) =>
    setPicked((prev) => {
      const next = new Set(prev);
      keys.forEach((k) => (on ? next.add(k) : next.delete(k)));
      return next;
    });
  const allKeys = pickable.flatMap((c) => c.lines.map((_, i) => keyOf(c.id, i)));
  const allPicked = allKeys.length > 0 && allKeys.every((k) => picked.has(k));

  /** One status for every ticked service: one save per approval, then the working ones join this visit. */
  const bulkStatus = async (next: LineStatus) => {
    if (!clinicId || pickedLines.length === 0) return;
    const byClaim = new Map<string, { claim: InsuranceClaim; lines: number[] }>();
    for (const { claim, line } of pickedLines) {
      if (lineStatusOf(claim, line) === next) continue;
      const entry = byClaim.get(claim.id) ?? { claim, lines: [] };
      entry.lines.push(line);
      byClaim.set(claim.id, entry);
    }
    if (byClaim.size === 0) {
      showToast(isAr ? "كلهم على الحالة دي بالفعل" : "They are all at that status already", "info");
      return;
    }
    if (
      [...byClaim.values()].some((e) => e.claim.status === "sent") &&
      !(await confirm(
        isAr
          ? "فيه موافقة اتبعتت للتأمين خلاص. تغيير حالة الخدمات هيغيّر اللي اتبعت. تكمّل؟"
          : "An approval here was already sent to the insurer. Changing its services changes what was sent. Continue?",
        { confirmLabel: isAr ? "كمّل" : "Continue" },
      ))
    ) {
      return;
    }
    const working = next !== "Planned";
    setBulkBusy(true);
    let done = 0;
    const errors: string[] = [];
    try {
      for (const { claim, lines } of byClaim.values()) {
        const lineStatus: Record<number, LineStatus> = {};
        const dentists: Record<number, string> = {};
        for (const i of lines) {
          lineStatus[i] = next;
          if (working && dentistId && claim.dentists[i]?.staffId !== dentistId) dentists[i] = dentistId;
        }
        const error = await patchClaim(clinicId, claim.id, { lineStatus, ...(Object.keys(dentists).length ? { dentists } : {}) });
        if (error) {
          errors.push(error);
          continue;
        }
        done += lines.length;
        if (working) lines.forEach((i) => !linked(claim.id, i) && onToggle(keyOf(claim.id, i)));
      }
    } catch (err) {
      errors.push(
        err instanceof InsuranceCallError && err.kind === "signed_out"
          ? isAr ? "سجّل دخول تاني" : "Please sign in again"
          : isAr ? "التحديث ماتمّش" : "Could not update",
      );
    } finally {
      setBulkBusy(false);
    }
    if (errors.length) showToast(errors[0], "error");
    if (done > 0) {
      showToast(
        isAr
          ? `اتحدّثت ${done} خدمة${working ? " واتربطت بالزيارة دي" : ""}`
          : `${done} service${done === 1 ? "" : "s"} updated${working ? " and linked to this visit" : ""}`,
        "success",
      );
      setPicked(new Set());
    }
  };

  /** Book every ticked service on this visit. A completed service is already done and is left alone. */
  const bulkLink = () => {
    let added = 0;
    let skipped = 0;
    for (const { claim, line } of pickedLines) {
      if (linked(claim.id, line)) continue;
      if (lineStatusOf(claim, line) === "Completed") {
        skipped += 1;
        continue;
      }
      onToggle(keyOf(claim.id, line));
      added += 1;
    }
    showToast(
      isAr
        ? `اتربطت ${added} خدمة بالزيارة دي${skipped ? ` — ${skipped} خلصت قبل كده ومتربطتش` : ""}`
        : `${added} linked to this visit${skipped ? ` — ${skipped} already completed, left as they are` : ""}`,
      added > 0 ? "success" : "info",
    );
    if (added > 0) setPicked(new Set());
  };

  const bulkUnlink = () => {
    let removed = 0;
    for (const { claim, line } of pickedLines) {
      if (!linked(claim.id, line)) continue;
      onToggle(keyOf(claim.id, line));
      removed += 1;
    }
    showToast(isAr ? `اتشال الربط من ${removed} خدمة` : `${removed} unlinked from this visit`, removed > 0 ? "success" : "info");
    if (removed > 0) setPicked(new Set());
  };
  const total = approvalFigures(shown);
  const tile = (label: string, value: number, strong = false) => (
    <div className={`rounded-2xl border px-5 py-4 ${strong ? "border-ink-slab" : "border-line-strong"}`}>
      <p className="text-[13px] font-semibold uppercase tracking-[0.05em] text-ink-body">{label}</p>
      <p className="mt-1 font-figure text-[28px] font-semibold leading-tight tabular-nums text-ink">
        {money(value)} <span className="text-sm font-medium text-ink-muted">{isAr ? "ج.م" : "EGP"}</span>
      </p>
    </div>
  );

  // Live approvals first, newest first; cancelled ones sink to the bottom.
  const sorted = [...shown].sort(
    (a, b) => Number(a.status === "cancelled") - Number(b.status === "cancelled") || b.approvalDate.localeCompare(a.approvalDate),
  );

  return (
    <div className="mt-4 space-y-4">
      {/* Which insurance company: one tab each, and a way to add another. */}
      <div className="flex flex-wrap items-center gap-2 border-b border-line pb-3" role="tablist" aria-label={isAr ? "شركات التأمين" : "Insurance companies"}>
        {groups.map((g) => {
          const on = g.id === activeId;
          return (
            <button
              key={g.id}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => setTab(g.id)}
              className={`inline-flex h-12 items-center gap-2.5 rounded-xl border px-4 text-[15px] font-bold transition-colors ${
                on ? "border-ink-slab bg-ink-slab text-white" : "border-line-strong bg-surface text-ink hover:border-ink"
              }`}
            >
              <InsurerBadge name={payerName(g.id)} size={24} />
              {payerName(g.id)}
              <span className={`rounded-full px-2 py-0.5 font-figure text-xs ${on ? "bg-white/15 text-white" : "bg-surface-muted text-ink-body"}`}>{g.live}</span>
            </button>
          );
        })}
        {onUpload && (
          <button
            type="button"
            onClick={() => onUpload(otherInsurer?.id)}
            className="inline-flex h-12 items-center gap-2 rounded-xl border border-dashed border-line-strong px-4 text-[14px] font-semibold text-ink-body transition-colors hover:border-ink hover:text-ink"
          >
            <Plus size={16} /> {isAr ? "تأمين تاني" : "Another insurance"}
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xl font-black text-ink">{payerName(activeId)}</p>
        {onUpload && (
          <button
            type="button"
            onClick={() => onUpload(activeId)}
            className="inline-flex h-10 items-center gap-2 rounded-xl border border-line-strong bg-surface px-4 text-sm font-semibold text-ink transition-colors hover:border-ink hover:bg-surface-subtle"
          >
            <Upload size={15} /> {isAr ? `ارفع موافقة لـ ${payerName(activeId)}` : `Upload an approval for ${payerName(activeId)}`}
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {tile(isAr ? "المبلغ الموافق عليه" : "Approved amount", total.approved)}
        {tile(isAr ? "اتعمل منه" : "Services done", total.done)}
        {tile(isAr ? "الرصيد الباقي" : "Remaining credit", total.left, true)}
      </div>
      <p className="text-sm text-ink-body">
        {isAr
          ? "اربط الزيارة بخدمة أو أكتر من الموافقة: لما الزيارة تتعلّم خلصت، الخدمات دي بتتعلّم خلصت على الموافقة."
          : "Link this visit to one or more approved services: when the visit is marked done, those services are marked completed on the approval."}
      </p>
      {/* Bulk: tick services in the tables below, then act on all of them at once. */}
      {pickable.length > 0 && (
        <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded-2xl border border-line-strong bg-surface px-4 py-3 shadow-sm">
          <label className="inline-flex cursor-pointer items-center gap-2 text-sm font-bold text-ink">
            <input
              type="checkbox"
              checked={allPicked}
              onChange={(e) => setPickedFor(allKeys, e.target.checked)}
              className="h-5 w-5 accent-black"
            />
            {isAr ? "اختار الكل" : "Select all"}
          </label>
          {pickedLines.length > 0 ? (
            <>
              <span className="rounded-full bg-ink-slab px-2.5 py-0.5 font-figure text-xs font-bold text-white">
                {pickedLines.length} {isAr ? "مختارة" : "selected"}
              </span>
              <span className="mx-1 h-6 w-px bg-line" aria-hidden="true" />
              {LINE_STATUSES.map((s) => (
                <button
                  key={s}
                  type="button"
                  disabled={bulkBusy}
                  onClick={() => void bulkStatus(s)}
                  className="h-9 rounded-lg border border-line-strong bg-surface px-3 text-sm font-semibold text-ink transition-colors hover:border-ink hover:bg-surface-subtle disabled:opacity-50"
                >
                  {t(LINE_LABEL[s])}
                </button>
              ))}
              <button
                type="button"
                disabled={bulkBusy}
                onClick={bulkLink}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-ink-slab bg-ink-slab px-3 text-sm font-semibold text-white transition-colors hover:opacity-90 disabled:opacity-50"
              >
                <Link2 size={14} /> {isAr ? "اربط بالزيارة دي" : "Link to this visit"}
              </button>
              {pickedLines.some(({ claim, line }) => linked(claim.id, line)) && (
                <button
                  type="button"
                  disabled={bulkBusy}
                  onClick={bulkUnlink}
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line-strong bg-surface px-3 text-sm font-semibold text-ink-body transition-colors hover:border-ink hover:text-danger disabled:opacity-50"
                >
                  <Link2Off size={14} /> {isAr ? "شيل الربط" : "Unlink"}
                </button>
              )}
              {bulkBusy && <Loader2 size={16} className="animate-spin text-ink-faint" />}
              <button
                type="button"
                onClick={() => setPicked(new Set())}
                title={isAr ? "إلغاء الاختيار" : "Clear selection"}
                aria-label={isAr ? "إلغاء الاختيار" : "Clear selection"}
                className="ms-auto rounded-lg p-1.5 text-ink-faint hover:bg-surface-muted hover:text-ink"
              >
                <X size={16} />
              </button>
            </>
          ) : (
            <span className="text-[13px] text-ink-body">
              {isAr
                ? "علّم على خدمات من الجدول عشان تغيّر حالتها أو تربطها بالزيارة مرة واحدة"
                : "Tick services below to change their status or link them to this visit in one go"}
            </span>
          )}
        </div>
      )}
      {sorted.map((c) => {
        const cardKeys = c.status === "cancelled" ? [] : c.lines.map((_, i) => keyOf(c.id, i));
        const cardAll = cardKeys.length > 0 && cardKeys.every((k) => picked.has(k));
        const fig = approvalFigures([{ ...c, status: c.status === "cancelled" ? "approved" : c.status }]);
        return (
          <div key={c.id} className={`overflow-hidden rounded-2xl border border-line-strong ${c.status === "cancelled" ? "opacity-60" : ""}`}>
            <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
              <div className="flex flex-wrap items-center gap-2.5">
                <InsurerBadge name={payerName(c.payerId)} size={26} />
                <span className="font-figure text-lg font-semibold tabular-nums text-ink">
                  {isAr ? "موافقة" : "Approval"} {c.approvalNumber}
                </span>
                <span className="rounded-full border border-line-strong px-2.5 py-0.5 text-xs font-semibold text-ink">{t(STATUS_LABEL[c.status])}</span>
              </div>
              <span className="text-[13px] text-ink-body">
                {isAr ? "اتعمل" : "Done"} <b className="font-figure text-ink">{money(fig.done)}</b> {isAr ? "من" : "of"}{" "}
                <b className="font-figure text-ink">{money(fig.approved)}</b> · {formatDayLabel(c.approvalDate, isAr, false)} {c.approvalDate.slice(0, 4)}
              </span>
            </div>
            <div className="custom-scrollbar overflow-x-auto">
              <table className="w-full min-w-[680px] border-collapse text-[15px]">
                <thead>
                  <tr className="border-y border-line bg-surface-subtle text-[13px] font-semibold text-ink-body">
                    <th className="w-10 ps-5 py-2.5">
                      {cardKeys.length > 0 && (
                        <input
                          type="checkbox"
                          checked={cardAll}
                          onChange={(e) => setPickedFor(cardKeys, e.target.checked)}
                          aria-label={isAr ? "اختار كل خدمات الموافقة دي" : "Select every service on this approval"}
                          className="h-5 w-5 align-middle accent-black"
                        />
                      )}
                    </th>
                    <th className="px-5 py-2.5 text-start font-semibold">{isAr ? "الخدمة" : "Treatment"}</th>
                    <th className="px-4 py-2.5 text-end font-semibold">{isAr ? "الموافق عليه" : "Approved"}</th>
                    <th className="px-4 py-2.5 text-end font-semibold">{isAr ? "على المريض" : "Patient share"}</th>
                    <th className="px-4 py-2.5 text-start font-semibold">{isAr ? "الحالة" : "Status"}</th>
                    <th className="px-5 py-2.5" />
                  </tr>
                </thead>
                <tbody>
                  {c.lines.map((line, i) => {
                    const status = lineStatusOf(c, i);
                    const isLinked = linked(c.id, i);
                    const open = c.status !== "cancelled" && status !== "Completed";
                    const saving = busy === `${c.id}|${i}`;
                    return (
                      <tr key={i} className={`border-b border-line last:border-b-0 ${isLinked ? "bg-accent-tint" : ""}`}>
                        <td className="w-10 ps-5 py-3">
                          {c.status !== "cancelled" && (
                            <input
                              type="checkbox"
                              checked={picked.has(keyOf(c.id, i))}
                              onChange={() => togglePick(keyOf(c.id, i))}
                              aria-label={isAr ? `اختار ${line.description}` : `Select ${line.description}`}
                              className="h-5 w-5 align-middle accent-black"
                            />
                          )}
                        </td>
                        <td className="px-5 py-3">
                          <span className="block font-figure text-[13px] text-ink-muted">{line.code}</span>
                          <span className="text-ink">{line.description}</span>
                          {c.dentists[i]?.name && <span className="block text-[13px] text-ink-body">{c.dentists[i].name}</span>}
                        </td>
                        <td className="px-4 py-3 text-end font-figure font-medium tabular-nums text-ink">{money(line.approvedAmount)}</td>
                        <td className="px-4 py-3 text-end font-figure font-medium tabular-nums text-ink">{money(line.patientShare)}</td>
                        <td className="px-4 py-3">
                          <span className="inline-flex items-center gap-1.5">
                            <select
                              value={status}
                              disabled={c.status === "cancelled" || saving}
                              onChange={(e) => void setProgress(c, i, e.target.value as LineStatus)}
                              aria-label={isAr ? "حالة الخدمة" : "Service status"}
                              className="h-9 rounded-lg border border-line-strong bg-surface px-2.5 text-sm font-semibold text-ink outline-none focus:border-ink disabled:opacity-60"
                            >
                              {LINE_STATUSES.map((s) => (
                                <option key={s} value={s}>
                                  {t(LINE_LABEL[s])}
                                </option>
                              ))}
                            </select>
                            {saving && <Loader2 size={13} className="animate-spin text-ink-faint" />}
                          </span>
                        </td>
                        <td className="px-5 py-3 text-end">
                          {isLinked ? (
                            <span className="inline-flex items-center gap-2">
                              <span className="inline-flex items-center gap-1 text-sm font-bold text-ink">
                                <Check size={14} /> {isAr ? "الزيارة دي" : "This visit"}
                              </span>
                              <button
                                type="button"
                                onClick={() => onToggle(`${c.id}|${i}`)}
                                title={isAr ? "شيل الربط" : "Unlink"}
                                className="rounded-lg p-1.5 text-ink-faint hover:bg-surface-muted hover:text-danger"
                              >
                                <Link2Off size={14} />
                              </button>
                            </span>
                          ) : open ? (
                            <button
                              type="button"
                              onClick={() => onToggle(`${c.id}|${i}`)}
                              className="h-10 whitespace-nowrap rounded-xl border border-line-strong bg-surface px-4 text-sm font-semibold text-ink transition-colors hover:border-ink hover:bg-surface-subtle"
                            >
                              {isAr ? "للزيارة دي" : "Use for this visit"}
                            </button>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t border-line bg-surface-subtle font-semibold">
                    <td />
                    <td className="px-5 py-3 text-ink-body">{isAr ? "الإجمالي" : "Total"}</td>
                    <td className="px-4 py-3 text-end font-figure font-medium tabular-nums text-ink">{money(c.totals.approved)}</td>
                    <td className="px-4 py-3 text-end font-figure font-medium tabular-nums text-ink">{money(c.totals.patientShare)}</td>
                    <td colSpan={2} className="px-4 py-3 text-[13px] font-semibold text-ink-body">
                      {c.totals.patientShare > 0 &&
                        (c.shareCollected
                          ? isAr ? "حصة المريض اتدفعت" : "Patient share collected"
                          : isAr ? "حصة المريض بتتحصّل من تبويب الدفع" : "Patient share is collected on the Payment tab")}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        );
      })}
    </div>
  );
}
