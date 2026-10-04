"use client";

/**
 * One approval paper, read, waiting for a person to say "yes, that is what it says".
 *
 * The scan sits beside the fields; every field is editable. The checks are the reader's own pure
 * `checkMetlife`, re-run in the browser on every edit with today's Cairo date, the payer's provider
 * code and the chosen patient's name, so the card and the claims route agree on what blocks a save.
 * A field that fails is outlined (red = blocks the save, amber = worth a look) and the reasons are
 * listed under the fields.
 *
 * Saving posts to `/api/insurance/claims`; nothing is written from here. The route answers:
 *   201 → `onSaved`;  409 duplicate → "already saved on … — open";  409 doc_taken → the same
 *   "open" on the claim that holds this document;  400 → the server's checks are shown.
 *
 * Each service line carries its own dentist and its own state (Completed / Planned / Ongoing, the
 * clinical editor's words); the "same for all services" row above the table fills every line at once,
 * and each line can still be changed on its own afterwards. Neither a status nor `treatedDate` is
 * sent: the server saves the paper as treated on the approval date, and only Completed lines go on
 * the monthly sheet and into payroll.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, ExternalLink, Loader2, Plus, Search, Trash2, X } from "lucide-react";
import { collection, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { isDentistStaff } from "@/lib/staffRoles";
import { useClinic } from "@/context/ClinicContext";
import { useLanguage } from "@/context/LanguageContext";
import { checkMetlife, hasHardFailure, normalizeMetlife, type Check, type MetlifeExtraction, type MetlifeHeader, type MetlifeLine } from "@/lib/insurance/metlife";
import { nameSimilarity } from "@/lib/insurance/matchPatient";
import { patientMatchesSearch } from "@/lib/flexibleSearch";
import { DEFAULT_METLIFE_WORDING } from "@/lib/insuranceStatementMetlife";
import { LINE_STATUSES, type LineStatus } from "@/lib/insurance/claims";
import type { Payer } from "@/lib/payers";
import type { PatientInsuranceEntry } from "@/lib/patientInsurance";
import { cairoToday, InsuranceCallError, saveClaim, type ReadResult, type SaveBody } from "./api";
import type { BinNotice } from "@/lib/recycleBin";
import { STATE_KEY, tr, type TextKey } from "./text";

/** Who did one service line ("" = nobody yet) and where it stands. */
type LineMeta = { dentistId: string; status: LineStatus };

export type PatientOption = { id: string; name: string; phone: string; insurance?: Record<string, PatientInsuranceEntry> };

type TextField = "approvalNumber" | "statusText" | "policyNumber" | "employer" | "certificateNumber" | "dependentCode" | "paperPatientName" | "paperPatientNameAr" | "providerCode" | "physician" | "diagnosisCode" | "comment";
type DateField = "approvalDate" | "terminationDate";
type MoneyField = "estimatedCost" | "requestedTotal" | "approvedTotal" | "patientShareTotal" | "collectNote";
type LineNumber = "unitsRequested" | "grossPerUnit" | "grossTotal" | "unitsApproved" | "patientShare" | "approvedAmount";

/** Fields the reader stores upper-case; typed the same way here so the checks see what the server will. */
const UPPER: ReadonlySet<string> = new Set(["approvalNumber", "statusText", "certificateNumber", "dependentCode", "providerCode"]);

type Picker =
  | { mode: "existing"; patientId: string; locked: boolean }
  | { mode: "create" };

type Problem =
  | { kind: "duplicate"; claimId: string; savedAt: string | null }
  /** `approval` is the number it was found under: correcting a misread number lifts the block. */
  | { kind: "in_bin"; notice: BinNotice; approval: string }
  | { kind: "doc_taken"; claimId: string }
  | { kind: "checks"; checks: Check[]; error: string }
  | { kind: "error"; error: string };

function cloneExtraction(x: MetlifeExtraction): MetlifeExtraction {
  return { header: { ...x.header, confidence: { ...x.header.confidence } }, lines: x.lines.map((l) => ({ ...l })) };
}

function blankLine(): MetlifeLine {
  return { code: "", description: "", unitsRequested: 1, grossPerUnit: 0, grossTotal: 0, unitsApproved: 1, patientShare: 0, approvedAmount: 0, comment: "", confidence: 1 };
}

/** An approval number as its id sees it (claimDocId): case and punctuation do not count. */
function approvalKey(n: string): string {
  return String(n ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function savedOn(iso: string | null, isAr: boolean): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString(isAr ? "ar-EG" : "en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export default function ApprovalConfirmCard({
  payer,
  docId,
  docPath,
  docUrl,
  contentType,
  result,
  typed,
  patients,
  storedWording,
  onSaved,
  onDismiss,
  onOpenClaim,
}: {
  payer: Payer;
  docId: string;
  docPath: string;
  docUrl: string;
  contentType: string;
  result: ReadResult;
  typed: boolean;
  patients: PatientOption[];
  /** The clinic's saved sheet wording, live: a code already worded needs no box. */
  storedWording: Record<string, string>;
  onSaved: (claimId: string) => void;
  onDismiss: () => void;
  onOpenClaim: (claimId: string) => void;
}) {
  const { clinicId } = useClinic();
  const { language } = useLanguage();
  const isAr = language === "ar";
  const t = tr(isAr);

  const [x, setX] = useState<MetlifeExtraction>(() => cloneExtraction(result.extraction));
  const [picker, setPicker] = useState<Picker>(() =>
    result.match.kind === "exact"
      ? { mode: "existing", patientId: result.match.patientId, locked: true }
      : result.match.kind === "candidates"
        ? { mode: "existing", patientId: "", locked: false }
        : { mode: "create" },
  );
  // A new patient is named in Arabic, as the clinic writes names and as the statement prints them; the paper's Latin name stays on the claim for matching.
  const [newName, setNewName] = useState(result.extraction.header.paperPatientNameAr || result.extraction.header.paperPatientName);
  const [newPhone, setNewPhone] = useState("");
  const [search, setSearch] = useState("");
  // Per service line, kept in step with `x.lines` (added and removed together).
  const [meta, setMeta] = useState<LineMeta[]>(() => result.extraction.lines.map(() => ({ dentistId: "", status: "Completed" })));
  // The "same for all services" row: what it last set, and what a newly added line starts with.
  const [allDentist, setAllDentist] = useState("");
  const [allStatus, setAllStatus] = useState<LineStatus>("Completed");
  const [dentists, setDentists] = useState<Array<{ id: string; name: string }>>([]);
  useEffect(() => {
    if (!clinicId) return;
    getDocs(collection(db, "clinics", clinicId, "staff"))
      .then((snap) =>
        setDentists(
          snap.docs
            .map((d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) }))
            .filter((m) => isDentistStaff(m as { role?: string; isDentist?: boolean }))
            .map((m) => ({ id: m.id, name: String((m as { name?: unknown }).name ?? "") }))
            .sort((a, b) => a.name.localeCompare(b.name)),
        ),
      )
      .catch((err) => console.error("Dentist list failed", err));
  }, [clinicId]);
  const [wordingDraft, setWordingDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(
    result.duplicate
      ? { kind: "duplicate", claimId: result.duplicate.claimId, savedAt: result.duplicate.savedAt }
      : result.inBin
        ? { kind: "in_bin", notice: result.inBin, approval: approvalKey(result.extraction.header.approvalNumber) }
        : null,
  );

  // --- the patient ------------------------------------------------------------------------------
  const candidates = useMemo(() => (result.match.kind === "candidates" ? result.match.candidates : []), [result.match]);
  const chosenName =
    picker.mode === "create"
      ? newName.trim()
      : patients.find((p) => p.id === picker.patientId)?.name ?? candidates.find((c) => c.patientId === picker.patientId)?.name ?? "";
  // The claims route writes the paper's certificate and dependent onto the patient. When the patient
  // already holds different ones for this payer, say so first: saving is still allowed.
  const membershipDiffers = useMemo(() => {
    if (picker.mode !== "existing" || !picker.patientId) return false;
    const stored = patients.find((p) => p.id === picker.patientId)?.insurance?.[payer.id];
    if (!stored) return false;
    const paperCert = x.header.certificateNumber.trim();
    const paperDep = x.header.dependentCode.trim();
    return (!!stored.certificateNumber && stored.certificateNumber !== paperCert) || (!!stored.dependentCode && stored.dependentCode !== paperDep);
  }, [picker, patients, payer.id, x.header.certificateNumber, x.header.dependentCode]);
  const searchResults = useMemo(() => {
    if (!search.trim()) return [];
    const offered = new Set(candidates.map((c) => c.patientId));
    return patients.filter((p) => !offered.has(p.id) && patientMatchesSearch(search, p.name, p.phone)).slice(0, 8);
  }, [search, patients, candidates]);

  // --- the checks, on every edit ------------------------------------------------------------------
  const checks = useMemo(
    () =>
      checkMetlife(x, {
        today: cairoToday(),
        providerCode: payer.providerCode,
        ...(chosenName ? { matchedPatientName: chosenName, nameScore: nameSimilarity(x.header.paperPatientName, chosenName) } : {}),
      }),
    [x, payer.providerCode, chosenName],
  );
  const blocked = hasHardFailure(checks);
  const hard = checks.filter((c) => c.severity === "hard");
  const soft = checks.filter((c) => c.severity === "soft");
  const flag = (field: string): "hard" | "soft" | null =>
    hard.some((c) => c.field === field) ? "hard" : soft.some((c) => c.field === field) ? "soft" : null;
  const lineFlag = (i: number, field?: string): "hard" | "soft" | null => {
    const mine = (c: Check) => c.field === `lines[${i}]` || (field ? c.field === `lines[${i}].${field}` : c.field.startsWith(`lines[${i}]`));
    return hard.some(mine) ? "hard" : soft.some(mine) ? "soft" : null;
  };

  // --- the wording boxes ----------------------------------------------------------------------------
  const unworded = useMemo(() => {
    const seen = new Map<string, string>();
    for (const l of x.lines) {
      const code = l.code.trim();
      if (!code || seen.has(code)) continue;
      if (result.wording[code] || storedWording[code]) continue;
      seen.set(code, DEFAULT_METLIFE_WORDING[code] ?? l.description);
    }
    return [...seen.entries()].map(([code, suggestion]) => ({ code, suggestion }));
  }, [x.lines, result.wording, storedWording]);

  // --- edits -------------------------------------------------------------------------------------
  /** A field a person has typed into is no longer "hard to read". */
  const looked = (h: MetlifeHeader, field: string) => (field in h.confidence ? { ...h.confidence, [field]: 1 } : h.confidence);
  const setText = (field: TextField, value: string) =>
    setX((prev) => ({ ...prev, header: { ...prev.header, [field]: UPPER.has(field) ? value.toUpperCase() : value, confidence: looked(prev.header, field) } }));
  const setDate = (field: DateField, value: string) =>
    setX((prev) => ({ ...prev, header: { ...prev.header, [field]: value || null, confidence: looked(prev.header, field) } }));
  const setMoney = (field: MoneyField, value: number | null) =>
    setX((prev) => ({ ...prev, header: { ...prev.header, [field]: value, confidence: looked(prev.header, field) } }));
  const setLine = (i: number, change: Partial<MetlifeLine>) =>
    setX((prev) => ({ ...prev, lines: prev.lines.map((l, k) => (k === i ? { ...l, ...change, confidence: 1 } : l)) }));
  const addLine = () => {
    setX((prev) => ({ ...prev, lines: [...prev.lines, blankLine()] }));
    setMeta((prev) => [...prev, { dentistId: allDentist, status: allStatus }]);
  };
  const removeLine = (i: number) => {
    setX((prev) => ({ ...prev, lines: prev.lines.filter((_, k) => k !== i) }));
    setMeta((prev) => prev.filter((_, k) => k !== i));
  };
  const setLineMeta = (i: number, change: Partial<LineMeta>) => setMeta((prev) => prev.map((m, k) => (k === i ? { ...m, ...change } : m)));
  /** The "same for all services" row: fills every line; each line can still be changed afterwards. */
  const setAll = (change: Partial<LineMeta>) => {
    if (change.dentistId !== undefined) setAllDentist(change.dentistId);
    if (change.status !== undefined) setAllStatus(change.status);
    setMeta((prev) => prev.map((m) => ({ ...m, ...change })));
  };

  // --- save --------------------------------------------------------------------------------------
  const patientReady = picker.mode === "create" ? newName.trim().length > 0 : !!picker.patientId;
  // An approval still in Recently Deleted is restored, never saved twice: the bin keeps one copy
  // per approval number, so a second one could never be deleted again.
  const inBin = problem?.kind === "in_bin" && problem.approval === approvalKey(x.header.approvalNumber) ? problem.notice : null;
  const canSave = !saving && !blocked && patientReady && !!clinicId && !inBin;

  const save = async () => {
    if (!canSave || !clinicId) return;
    setSaving(true);
    setProblem(null);
    const wording: Record<string, string> = {};
    for (const { code, suggestion } of unworded) {
      const v = (wordingDraft[code] ?? suggestion).trim();
      if (v) wording[code] = v;
    }
    const phone = newPhone.trim();
    // Every line, explicitly: its dentist (null = nobody yet) and its state. The server drops a typed
    // "Total" row as the reader does, so the lines are numbered the way it will number them.
    const lines: NonNullable<SaveBody["lines"]> = {};
    let k = 0;
    x.lines.forEach((l, i) => {
      // Exactly the server's rule: a row the normaliser drops (the table's Total row) takes no number.
      if (normalizeMetlife({ lines: [l] }).lines.length === 0) return;
      const m = meta[i] ?? { dentistId: "", status: "Completed" };
      lines[k++] = { dentistId: m.dentistId || null, status: m.status };
    });
    const body: SaveBody = {
      clinicId,
      docId,
      payerId: payer.id,
      extraction: x,
      patient: picker.mode === "create" ? { create: phone ? { name: newName.trim(), phone } : { name: newName.trim() } } : { id: picker.patientId },
      ...(k > 0 ? { lines } : {}),
      ...(Object.keys(wording).length ? { wording } : {}),
      ...(docPath ? { docPath } : {}),
    };
    try {
      const outcome = await saveClaim(body);
      if (outcome.kind === "saved") {
        onSaved(outcome.claimId);
        return;
      }
      if (outcome.kind === "duplicate") setProblem({ kind: "duplicate", claimId: outcome.claimId, savedAt: outcome.savedAt });
      else if (outcome.kind === "in_bin") setProblem({ kind: "in_bin", notice: outcome.notice, approval: approvalKey(x.header.approvalNumber) });
      else if (outcome.kind === "doc_taken") setProblem({ kind: "doc_taken", claimId: outcome.claimId });
      else if (outcome.kind === "checks") setProblem({ kind: "checks", checks: outcome.checks, error: outcome.error });
      else setProblem({ kind: "error", error: outcome.error || t("saveFailed") });
    } catch (err) {
      setProblem({ kind: "error", error: err instanceof InsuranceCallError ? t(err.kind === "signed_out" ? "signedOut" : "networkFailed") : t("saveFailed") });
    } finally {
      setSaving(false);
    }
  };

  const say = (c: Check) => (isAr ? c.ar : c.en) || t("checkFallback");
  const isPdf = contentType === "application/pdf";

  return (
    <article className="overflow-hidden rounded-3xl border border-line bg-surface shadow-sm" data-tour="insurance-card">
      <header className="flex flex-wrap items-center justify-between gap-3 bg-ink-slab px-5 py-4 text-white">
        <div className="min-w-0">
          <p className="text-[10.5px] font-black uppercase tracking-[0.18em] text-white/50">{typed ? t("typedTitle") : t("cardTitle")}</p>
          <p className="font-display text-xl font-black tracking-tight" dir="ltr">
            {x.header.approvalNumber || "—"}
          </p>
        </div>
        <button type="button" onClick={onDismiss} className="rounded-xl p-2 text-white/60 transition-colors hover:bg-white/10 hover:text-white" aria-label={t("cancel")}>
          <X size={18} />
        </button>
      </header>

      {problem && (problem.kind === "duplicate" || problem.kind === "doc_taken") && (
        <div className="flex flex-wrap items-center gap-2 border-b border-line bg-amber-50 px-5 py-3 text-[13px] font-bold text-amber-900">
          <AlertTriangle size={15} className="shrink-0" />
          <span>
            {problem.kind === "duplicate"
              ? problem.savedAt
                ? `${t("alreadySaved")} ${savedOn(problem.savedAt, isAr)}`
                : t("alreadySavedNoDate")
              : t("docTaken")}
          </span>
          <span aria-hidden>—</span>
          <button type="button" onClick={() => onOpenClaim(problem.claimId)} className="underline underline-offset-2 hover:no-underline">
            {t("open")}
          </button>
        </div>
      )}

      {inBin && (
        <div className="flex flex-wrap items-center gap-2 border-b border-line bg-amber-50 px-5 py-3 text-[13px] font-bold text-amber-900" data-tour="insurance-in-bin">
          <AlertTriangle size={15} className="shrink-0" />
          <span>
            {inBin.withParent
              ? `${t("inBinWithPatient")} ${inBin.withParent}. ${t("inBinRestorePatient")}`
              : `${t("inBinTitle")}${inBin.deletedAt ? ` (${savedOn(inBin.deletedAt, isAr)})` : ""}. ${t("inBinRestore")}`}
          </span>
          <span aria-hidden>—</span>
          <Link href="/settings/recently-deleted" className="underline underline-offset-2 hover:no-underline">
            {t("openBin")}
          </Link>
        </div>
      )}

      <div className="grid gap-0 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        {/* --- the document ------------------------------------------------------------------- */}
        <div className="border-b border-line bg-surface-subtle p-4 lg:border-b-0 lg:border-e">
          {docUrl ? (
            isPdf ? (
              <object data={docUrl} type="application/pdf" className="h-[70vh] w-full rounded-xl border border-line bg-white">
                <DocLink url={docUrl} label={t("openDoc")} />
              </object>
            ) : (
              <div className="max-h-[70vh] overflow-auto rounded-xl border border-line bg-white">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={docUrl} alt={x.header.approvalNumber || t("openDoc")} className="w-full" />
              </div>
            )
          ) : (
            <p className="py-16 text-center text-[13px] font-semibold text-ink-muted">{t("noPreview")}</p>
          )}
          {docUrl && <DocLink url={docUrl} label={t("openDoc")} />}
        </div>

        {/* --- the fields --------------------------------------------------------------------- */}
        <div className="space-y-5 p-5">
          <Group title={t("sectionApproval")}>
            <TextInput label={t("approvalNumber")} value={x.header.approvalNumber} flag={flag("approvalNumber")} onChange={(v) => setText("approvalNumber", v)} ltr hint={t("approvalNumberHint")} />
            <DateInput label={t("approvalDate")} value={x.header.approvalDate} flag={flag("approvalDate")} onChange={(v) => setDate("approvalDate", v)} />
            <TextInput label={t("statusText")} value={x.header.statusText} flag={flag("statusText")} onChange={(v) => setText("statusText", v)} ltr />
          </Group>

          <Group title={t("sectionMember")}>
            <TextInput label={t("policyNumber")} value={x.header.policyNumber} flag={flag("policyNumber")} onChange={(v) => setText("policyNumber", v)} ltr />
            <TextInput label={t("employer")} value={x.header.employer} flag={null} onChange={(v) => setText("employer", v)} ltr />
            <TextInput label={t("certificateNumber")} value={x.header.certificateNumber} flag={flag("certificateNumber")} onChange={(v) => setText("certificateNumber", v)} ltr />
            <TextInput label={t("dependentCode")} value={x.header.dependentCode} flag={flag("dependentCode")} onChange={(v) => setText("dependentCode", v)} ltr />
            <TextInput label={t("paperPatientName")} value={x.header.paperPatientName} flag={flag("paperPatientName")} onChange={(v) => setText("paperPatientName", v)} ltr />
            <TextInput label={t("paperPatientNameAr")} value={x.header.paperPatientNameAr} flag={flag("paperPatientNameAr")} onChange={(v) => { setText("paperPatientNameAr", v); if (picker.mode === "create") setNewName(v); }} />
            <DateInput label={t("terminationDate")} value={x.header.terminationDate} flag={flag("terminationDate")} onChange={(v) => setDate("terminationDate", v)} />
          </Group>

          <Group title={t("sectionProvider")}>
            <TextInput label={t("providerCode")} value={x.header.providerCode} flag={flag("providerCode")} onChange={(v) => setText("providerCode", v)} ltr />
            <TextInput label={t("physician")} value={x.header.physician} flag={null} onChange={(v) => setText("physician", v)} ltr />
            <TextInput label={t("diagnosisCode")} value={x.header.diagnosisCode} flag={null} onChange={(v) => setText("diagnosisCode", v)} ltr />
          </Group>

          <Group title={t("sectionTotals")}>
            {(["estimatedCost", "requestedTotal", "approvedTotal", "patientShareTotal", "collectNote"] as const).map((f) => (
              <MoneyInput key={f} label={t(f)} value={x.header[f]} flag={flag(f)} onChange={(v) => setMoney(f, v)} />
            ))}
          </Group>

          {/* --- the service lines ------------------------------------------------------------- */}
          <div>
            <p className={groupTitle}>{t("sectionLines")}</p>
            {/* One dentist and one state for every service at once; each line can still differ. */}
            <div className="mb-2 flex flex-wrap items-center gap-2 rounded-2xl border border-line bg-surface-subtle px-3 py-2">
              <span className="text-[12px] font-black text-ink">{t("sameForAll")}</span>
              <DentistSelect value={allDentist} dentists={dentists} label={t("colDentist")} placeholder={t("pickDentist")} onChange={(v) => setAll({ dentistId: v })} className={`${cellInput(null)} w-auto min-w-[10rem]`} />
              <StateSelect value={allStatus} label={t("colState")} t={t} onChange={(v) => setAll({ status: v })} className={`${cellInput(null)} w-auto min-w-[8rem]`} />
            </div>
            <div className={`overflow-x-auto rounded-2xl border ${lineFlagList(hard, "lines") ? "border-rose-400" : "border-line"}`}>
              <table className="w-full min-w-[74rem] border-collapse text-[12.5px]">
                <thead>
                  <tr className="border-b border-line bg-surface-subtle">
                    {(["lineCode", "lineDescription", "colDentist", "colState", "lineUnits", "linePerUnit", "lineGross", "lineUnitsApproved", "linePatientShare", "lineApproved", "comment"] as const).map((k) => (
                      <th key={k} className="px-2 py-2 text-start text-[10px] font-black uppercase tracking-wider text-ink-muted">
                        {t(k)}
                      </th>
                    ))}
                    <th className="w-8" />
                  </tr>
                </thead>
                <tbody>
                  {x.lines.map((l, i) => {
                    const rowFlag = lineFlag(i);
                    return (
                      <tr key={i} className={`border-t border-line ${rowFlag === "hard" ? "bg-rose-50/60" : rowFlag === "soft" ? "bg-amber-50/60" : ""}`}>
                        <td className="p-1">
                          <input value={l.code} onChange={(e) => setLine(i, { code: e.target.value.toUpperCase() })} className={cellInput(null)} dir="ltr" />
                        </td>
                        <td className="p-1">
                          <input value={l.description} onChange={(e) => setLine(i, { description: e.target.value })} className={`${cellInput(null)} min-w-[12rem]`} dir="ltr" />
                        </td>
                        <td className="p-1">
                          <DentistSelect value={meta[i]?.dentistId ?? ""} dentists={dentists} label={t("colDentist")} placeholder={t("pickDentist")} onChange={(v) => setLineMeta(i, { dentistId: v })} className={`${cellInput(null)} min-w-[9rem]`} />
                        </td>
                        <td className="p-1">
                          <StateSelect value={meta[i]?.status ?? "Completed"} label={t("colState")} t={t} onChange={(v) => setLineMeta(i, { status: v })} className={`${cellInput(null)} min-w-[7rem]`} />
                        </td>
                        {(["unitsRequested", "grossPerUnit", "grossTotal", "unitsApproved", "patientShare", "approvedAmount"] as const satisfies readonly LineNumber[]).map((f) => (
                          <td key={f} className="p-1">
                            <NumberBox value={l[f]} onChange={(v) => setLine(i, { [f]: v ?? 0 })} className={cellInput(f === "grossTotal" ? lineFlag(i, "grossTotal") === "hard" ? "hard" : null : null)} />
                          </td>
                        ))}
                        <td className="p-1">
                          <input value={l.comment} onChange={(e) => setLine(i, { comment: e.target.value })} className={cellInput(null)} dir="ltr" />
                        </td>
                        <td className="p-1 text-center">
                          <button type="button" onClick={() => removeLine(i)} className="rounded-lg p-1.5 text-ink-muted hover:bg-rose-50 hover:text-rose-700" aria-label={t("removeLine")}>
                            <Trash2 size={14} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <button type="button" onClick={addLine} className={`${smallButton} mt-2`}>
              <Plus size={13} /> {t("addLine")}
            </button>
          </div>

          <TextInput label={t("comment")} value={x.header.comment} flag={null} onChange={(v) => setText("comment", v)} ltr />

          {/* --- what the checks say ----------------------------------------------------------- */}
          <div className="space-y-2">
            {hard.length > 0 && <CheckList tone="hard" title={t("checksHard")} items={hard.map(say)} />}
            {soft.length > 0 && <CheckList tone="soft" title={t("checksSoft")} items={soft.map(say)} />}
            {membershipDiffers && (
              <p className="flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] font-semibold text-amber-900">
                <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {t("membershipDiffers")}
              </p>
            )}
            {checks.length === 0 && (
              <p className="flex items-center gap-2 text-[13px] font-bold text-emerald-700">
                <CheckCircle2 size={15} /> {t("checksClean")}
              </p>
            )}
          </div>

          {/* --- the patient ------------------------------------------------------------------- */}
          <div>
            <p className={groupTitle}>{t("patient")}</p>
            {picker.mode === "existing" && picker.locked ? (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-line bg-surface-subtle px-4 py-3">
                <div className="min-w-0">
                  <Link href={`/patients/${picker.patientId}`} target="_blank" className="font-black text-ink hover:underline">
                    {chosenName || "…"}
                  </Link>
                  <p className="text-[12px] font-semibold text-ink-muted">{t("matchedExact")}</p>
                </div>
                <button type="button" onClick={() => setPicker({ mode: "existing", patientId: picker.patientId, locked: false })} className={smallButton}>
                  {t("change")}
                </button>
              </div>
            ) : (
              <div className="space-y-2 rounded-2xl border border-line p-3">
                {candidates.length > 0 && <p className="text-[12px] font-bold text-ink-muted">{t("candidatesHint")}</p>}
                {candidates.map((c) => (
                  <Choice
                    key={c.patientId}
                    checked={picker.mode === "existing" && picker.patientId === c.patientId}
                    onPick={() => setPicker({ mode: "existing", patientId: c.patientId, locked: false })}
                  >
                    <span className="font-black text-ink">{c.name}</span>
                    <span className="text-[12px] font-semibold text-ink-muted">
                      {Math.round(c.score * 100)}% {t("similarity")}
                    </span>
                  </Choice>
                ))}
                <div className="relative">
                  <Search size={14} className="absolute start-3 top-1/2 -translate-y-1/2 text-ink-muted" />
                  <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("searchPatients")} className={`${fieldInput(null)} ps-9`} />
                </div>
                {search.trim() && searchResults.length === 0 && <p className="px-1 text-[12px] font-semibold text-ink-muted">{t("noPatientsFound")}</p>}
                {searchResults.map((p) => (
                  <Choice
                    key={p.id}
                    checked={picker.mode === "existing" && picker.patientId === p.id}
                    onPick={() => setPicker({ mode: "existing", patientId: p.id, locked: false })}
                  >
                    <span className="font-black text-ink">{p.name}</span>
                    {p.phone && (
                      <span className="text-[12px] font-semibold text-ink-muted" dir="ltr">
                        {p.phone}
                      </span>
                    )}
                  </Choice>
                ))}
                {/* A picked patient from an earlier search stays visible after the search is cleared. */}
                {picker.mode === "existing" &&
                  picker.patientId &&
                  !candidates.some((c) => c.patientId === picker.patientId) &&
                  !searchResults.some((p) => p.id === picker.patientId) && (
                    <Choice checked onPick={() => {}}>
                      <span className="font-black text-ink">{chosenName || "…"}</span>
                    </Choice>
                  )}
                <Choice checked={picker.mode === "create"} onPick={() => setPicker({ mode: "create" })}>
                  <span className="font-black text-ink">{t("createPatient")}</span>
                </Choice>
                {picker.mode === "create" && (
                  <div className="grid gap-2 ps-7 sm:grid-cols-2">
                    <Labelled label={t("newPatientName")}>
                      <input value={newName} onChange={(e) => setNewName(e.target.value)} className={fieldInput(newName.trim() ? null : "hard")} />
                    </Labelled>
                    <Labelled label={t("newPatientPhone")}>
                      <input value={newPhone} onChange={(e) => setNewPhone(e.target.value)} className={fieldInput(null)} dir="ltr" inputMode="tel" />
                    </Labelled>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* --- wording for codes the clinic has not named yet -------------------------------- */}
          {unworded.length > 0 && (
            <div className="space-y-2 rounded-2xl border border-line bg-surface-subtle p-4">
              <p className="text-[13px] font-black text-ink">{t("wordingTitle")}</p>
              <p className="text-[12px] font-semibold text-ink-muted">{t("wordingHint")}</p>
              {unworded.map(({ code, suggestion }) => (
                <label key={code} className="grid items-center gap-2 sm:grid-cols-[6rem_1fr]">
                  <span className="font-display text-[13px] font-black text-ink" dir="ltr">
                    {code}
                  </span>
                  <input
                    value={wordingDraft[code] ?? suggestion}
                    onChange={(e) => setWordingDraft((prev) => ({ ...prev, [code]: e.target.value }))}
                    className={fieldInput(null)}
                    dir="auto"
                  />
                </label>
              ))}
            </div>
          )}

          {/* --- save -------------------------------------------------------------------------- */}
          {problem && (problem.kind === "error" || problem.kind === "checks") && (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-[13px] font-bold text-rose-800">
              <p>{problem.error || t("saveFailed")}</p>
              {problem.kind === "checks" && (
                <ul className="mt-1 list-disc ps-5 font-semibold">
                  {problem.checks.filter((c) => c.severity === "hard").map((c, i) => (
                    <li key={`${c.id}-${i}`}>{say(c)}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <div className="flex flex-wrap items-center justify-end gap-2">
            {!patientReady && <span className="text-[12px] font-semibold text-ink-muted">{t("pickPatient")}</span>}
            <button type="button" onClick={onDismiss} className={smallButton}>
              {t("cancel")}
            </button>
            <button
              type="button"
              onClick={save}
              disabled={!canSave}
              className="inline-flex items-center gap-2 rounded-xl bg-accent px-5 py-2.5 text-[13px] font-black text-ink-on-accent transition-colors hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving && <Loader2 size={14} className="animate-spin" />}
              {saving ? t("saving") : t("save")}
            </button>
          </div>
        </div>
      </div>
    </article>
  );
}

// --- small pieces -----------------------------------------------------------------------------

const groupTitle = "mb-2 text-[10.5px] font-black uppercase tracking-wider text-ink-muted";
const smallButton =
  "inline-flex items-center gap-1.5 rounded-xl border border-line px-3 py-1.5 text-[12px] font-black text-ink-body transition-colors hover:bg-surface-subtle hover:text-ink";

function outline(flag: "hard" | "soft" | null): string {
  return flag === "hard" ? "border-rose-400 ring-2 ring-rose-100" : flag === "soft" ? "border-amber-400 ring-2 ring-amber-100" : "border-line";
}

function fieldInput(flag: "hard" | "soft" | null): string {
  return `w-full rounded-xl border bg-surface-subtle px-3 py-2 text-sm font-bold text-ink outline-none transition-colors focus:border-ink focus:bg-surface ${outline(flag)}`;
}

function cellInput(flag: "hard" | "soft" | null): string {
  return `w-full min-w-[4.5rem] rounded-lg border bg-surface px-2 py-1.5 text-[12.5px] font-bold text-ink outline-none focus:border-ink ${outline(flag)}`;
}

function lineFlagList(hard: Check[], field: string): boolean {
  return hard.some((c) => c.field === field);
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className={groupTitle}>{title}</p>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{children}</div>
    </div>
  );
}

function Labelled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block min-w-0">
      <span className="mb-1 block text-[11px] font-bold text-ink-muted">{label}</span>
      {children}
    </label>
  );
}

function TextInput({ label, value, flag, onChange, ltr, hint }: { label: string; value: string; flag: "hard" | "soft" | null; onChange: (v: string) => void; ltr?: boolean; hint?: string }) {
  return (
    <Labelled label={label}>
      <input value={value} onChange={(e) => onChange(e.target.value)} className={fieldInput(flag)} dir={ltr ? "ltr" : undefined} />
      {hint ? <p className="mt-1 text-xs text-amber-700">{hint}</p> : null}
    </Labelled>
  );
}

function DateInput({ label, value, flag, onChange }: { label: string; value: string | null; flag: "hard" | "soft" | null; onChange: (v: string) => void }) {
  return (
    <Labelled label={label}>
      <input type="date" value={value ?? ""} onChange={(e) => onChange(e.target.value)} className={fieldInput(flag)} dir="ltr" />
    </Labelled>
  );
}

function MoneyInput({ label, value, flag, onChange }: { label: string; value: number | null; flag: "hard" | "soft" | null; onChange: (v: number | null) => void }) {
  return (
    <Labelled label={label}>
      <NumberBox value={value} onChange={onChange} className={fieldInput(flag)} />
    </Labelled>
  );
}

/** "" or a finite number; anything half-typed ("1.", "-") is held as text until it parses. */
function parseNumber(text: string): number | null | undefined {
  const t = text.replace(/,/g, "").trim();
  if (t === "") return null;
  if (!/^-?(\d+(\.\d*)?|\.\d+)$/.test(t)) return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * A number field that keeps what is being typed. A plain controlled `type=number` turns a cleared
 * box into 0 and fights the cursor; this holds the text and reports a number whenever it parses.
 */
function NumberBox({ value, onChange, className }: { value: number | null; onChange: (v: number | null) => void; className: string }) {
  const [text, setText] = useState(value === null ? "" : String(value));
  const [shown, setShown] = useState(value);
  // The value changed from outside (not from this box): show it.
  if (shown !== value) {
    setShown(value);
    if (parseNumber(text) !== value) setText(value === null ? "" : String(value));
  }
  return (
    <input
      value={text}
      inputMode="decimal"
      dir="ltr"
      onChange={(e) => {
        setText(e.target.value);
        const n = parseNumber(e.target.value);
        if (n !== undefined) {
          setShown(n);
          onChange(n);
        }
      }}
      className={className}
    />
  );
}

function DentistSelect({
  value,
  dentists,
  label,
  placeholder,
  onChange,
  className,
}: {
  value: string;
  dentists: Array<{ id: string; name: string }>;
  label: string;
  placeholder: string;
  onChange: (v: string) => void;
  className: string;
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} className={className}>
      <option value="">{placeholder}</option>
      {dentists.map((d) => (
        <option key={d.id} value={d.id}>
          {d.name}
        </option>
      ))}
    </select>
  );
}

function StateSelect({ value, label, t, onChange, className }: { value: LineStatus; label: string; t: (k: TextKey) => string; onChange: (v: LineStatus) => void; className: string }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value as LineStatus)} aria-label={label} className={className}>
      {LINE_STATUSES.map((s) => (
        <option key={s} value={s}>
          {t(STATE_KEY[s])}
        </option>
      ))}
    </select>
  );
}

function Choice({ checked, onPick, children }: { checked: boolean; onPick: () => void; children: React.ReactNode }) {
  return (
    <label className={`flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2 transition-colors ${checked ? "border-ink bg-surface-subtle" : "border-line hover:bg-surface-subtle"}`}>
      <input type="radio" checked={checked} onChange={onPick} className="size-4 accent-current" />
      <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">{children}</span>
    </label>
  );
}

function CheckList({ tone, title, items }: { tone: "hard" | "soft"; title: string; items: string[] }) {
  const box = tone === "hard" ? "border-rose-200 bg-rose-50 text-rose-800" : "border-amber-200 bg-amber-50 text-amber-900";
  return (
    <div className={`rounded-2xl border px-4 py-3 ${box}`}>
      <p className="flex items-center gap-2 text-[12px] font-black uppercase tracking-wider">
        <AlertTriangle size={13} /> {title}
      </p>
      <ul className="mt-1 list-disc space-y-0.5 ps-5 text-[13px] font-semibold">
        {items.map((m, i) => (
          <li key={i}>{m}</li>
        ))}
      </ul>
    </div>
  );
}

function DocLink({ url, label }: { url: string; label: string }) {
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-1.5 text-[12px] font-black text-ink-body hover:text-ink hover:underline">
      <ExternalLink size={13} /> {label}
    </a>
  );
}
