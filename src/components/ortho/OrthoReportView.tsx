"use client";

import { useMemo, useState } from "react";
import { Check, Copy, GraduationCap, Loader2, Pencil, PenLine, Save, X } from "lucide-react";
import type { CephNormOverrides } from "@/lib/orthoCeph";
import {
  EMPTY_REVIEW,
  orthoDisclaimer,
  orthoLabel,
  orthoReportToText,
  type OrthoCephReport,
  type OrthoDiagnosisReport,
  type OrthoFollowupReport,
  type OrthoPlanReport,
  type OrthoReview,
  type Verdict,
} from "@/lib/orthoAi";
import CephViewer from "./CephViewer";
import { reportDate, type SavedOrthoReport } from "./orthoAiClient";

/**
 * One saved report, with the dentist's review built into every row: confirm, reject, or rewrite
 * — and, at the bottom, sign it, or teach the model from what was changed. The model's text is
 * never edited in place; the dentist's wording is stored beside it and shown instead.
 */
export default function OrthoReportView({
  saved,
  ar,
  norms,
  busy,
  onPatch,
  onTeach,
}: {
  saved: SavedOrthoReport;
  ar: boolean;
  norms: CephNormOverrides;
  busy: boolean;
  onPatch: (patch: Record<string, unknown>) => Promise<void>;
  onTeach: () => void;
}) {
  const review: OrthoReview = saved.review || EMPTY_REVIEW;
  const [verdicts, setVerdicts] = useState<Record<string, Verdict>>(review.verdicts || {});
  const [edits, setEdits] = useState<Record<string, string>>(review.edits || {});
  const [editing, setEditing] = useState<string | null>(null);
  const [summary, setSummary] = useState(review.summary || "");
  const [patientSummary, setPatientSummary] = useState(review.patientSummary || "");
  const [note, setNote] = useState(review.note || "");
  const [chosen, setChosen] = useState<number | undefined>(review.chosenOption);
  const [showPatient, setShowPatient] = useState(false);
  const [copied, setCopied] = useState(false);

  // Re-seed the working copy when the stored review changes (after a save), during render so the
  // first paint already shows it.
  const [seed, setSeed] = useState<{ id: string; review: OrthoReview | null | undefined }>({ id: saved.id, review: saved.review });
  if (seed.id !== saved.id || seed.review !== saved.review) {
    const r = saved.review || EMPTY_REVIEW;
    setSeed({ id: saved.id, review: saved.review });
    setVerdicts(r.verdicts || {});
    setEdits(r.edits || {});
    setSummary(r.summary || "");
    setPatientSummary(r.patientSummary || "");
    setNote(r.note || "");
    setChosen(r.chosenOption);
  }

  const signed = saved.signed === true;
  const lang = ar ? "ar" : "en";
  const dirty = useMemo(() => {
    const r = saved.review || EMPTY_REVIEW;
    return (
      JSON.stringify(verdicts) !== JSON.stringify(r.verdicts || {}) ||
      JSON.stringify(edits) !== JSON.stringify(r.edits || {}) ||
      summary !== (r.summary || "") ||
      patientSummary !== (r.patientSummary || "") ||
      note !== (r.note || "") ||
      chosen !== r.chosenOption
    );
  }, [verdicts, edits, summary, patientSummary, note, chosen, saved.review]);

  const hasCorrections = Object.values(review.verdicts || {}).some((v) => v !== "confirmed") || !!review.note || !!review.summary || !!review.landmarks || (review.chosenOption !== undefined && !(saved.report as OrthoPlanReport).options?.[review.chosenOption]?.recommended);

  const patch = (extra: Record<string, unknown> = {}) => ({
    verdicts,
    edits,
    ...(summary ? { summary } : {}),
    ...(patientSummary ? { patientSummary } : {}),
    ...(note ? { note } : {}),
    ...(chosen !== undefined ? { chosenOption: chosen } : {}),
    ...extra,
  });

  const setVerdict = (path: string, v: Verdict) => {
    setVerdicts((cur) => (cur[path] === v && v !== "edited" ? omit(cur, path) : { ...cur, [path]: v }));
    if (v !== "edited") setEditing(null);
  };

  const L = {
    confirm: ar ? "تأكيد" : "Confirm",
    reject: ar ? "رفض" : "Reject",
    edit: ar ? "تعديل" : "Edit",
    summary: ar ? "الملخص" : "Summary",
    yourSummary: ar ? "اكتب ملخصك (اختياري — يحل محل ملخص الذكاء الاصطناعي)" : "Your summary (optional — replaces the AI's)",
    patient: ar ? "شرح للمريض" : "For the patient",
    note: ar ? "إيه اللي الذكاء الاصطناعي غلط فيه؟ (ملاحظة — نقطة البداية لدرس)" : "What did the AI get wrong? (a note — the seed of a lesson)",
    save: ar ? "حفظ المراجعة" : "Save review",
    sign: ar ? "توقيع التقرير" : "Sign report",
    signed: ar ? "موقّع" : "Signed",
    teach: ar ? "علّم الذكاء الاصطناعي من المراجعة دي" : "Teach the AI from this review",
    teachHint: ar ? "احفظ مراجعة فيها تعديل أو رفض أو ملاحظة الأول." : "Save a review with an edit, a rejection or a note first.",
    copy: ar ? "نسخ النص" : "Copy text",
    copied: ar ? "اتنسخ" : "Copied",
    limitations: ar ? "حدود التحليل" : "Limitations",
    keyFindings: ar ? "أهم القياسات" : "Key findings",
    implications: ar ? "الانعكاسات على العلاج" : "Treatment implications",
    problems: ar ? "قائمة المشاكل" : "Problem list",
    aetiology: ar ? "الأسباب المحتملة" : "Aetiology",
    missingInfo: ar ? "معلومات ناقصة" : "Missing information",
    objectives: ar ? "الأهداف" : "Objectives",
    option: ar ? "الخيار" : "Option",
    choose: ar ? "اختيار الخطة دي" : "Choose this plan",
    chosen: ar ? "المختارة" : "Chosen",
    recommended: ar ? "موصى به" : "Recommended",
    appliance: ar ? "الجهاز" : "Appliance",
    extractions: ar ? "الخلع" : "Extractions",
    anchorage: ar ? "الإرساء" : "Anchorage",
    duration: ar ? "المدة" : "Duration",
    months: ar ? "شهر" : "months",
    retention: ar ? "التثبيت" : "Retention",
    pros: ar ? "المميزات" : "Pros",
    cons: ar ? "العيوب" : "Cons",
    risks: ar ? "المخاطر" : "Risks",
    prerequisites: ar ? "قبل البدء" : "Before starting",
    records: ar ? "سجلات مطلوبة" : "Records needed",
    observations: ar ? "الملاحظات" : "Observations",
    concerns: ar ? "نقاط تحتاج انتباه" : "Concerns",
    thisVisit: ar ? "في الزيارة دي" : "This visit",
    nextVisit: ar ? "الزيارة القادمة بعد" : "Next visit in",
    weeks: ar ? "أسبوع" : "weeks",
    remaining: ar ? "متبقي تقريباً" : "About",
    hygiene: ar ? "تعليمات للمريض" : "For the patient",
    tracing: ar ? "التتبّع" : "Tracing",
    quality: ar ? "جودة الصورة" : "Film quality",
  };

  const ctx: RowCtx = { verdicts, edits, editing, signed, labels: { confirm: L.confirm, edit: L.edit, reject: L.reject }, setVerdict, setEditing, setEdits, setVerdicts };
  const sevBadge = (s: "mild" | "moderate" | "severe") => (
    <span className={`inline-block me-1.5 px-1.5 py-0.5 rounded text-[9px] font-black uppercase ${s === "severe" ? "bg-rose-100 text-rose-700" : s === "moderate" ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-600"}`}>{orthoLabel("severity", s, lang)}</span>
  );

  const body = () => {
    if (saved.kind === "ceph") {
      const r = saved.report as OrthoCephReport;
      const film = saved.media?.[0];
      return (
        <>
          {film && (
            <Section title={`${L.tracing}${saved.quality ? ` · ${L.quality}: ${saved.quality}${saved.qualityNotes ? ` — ${saved.qualityNotes}` : ""}` : ""}`}>
              <CephViewer
                imageUrl={film.url}
                imageSize={saved.imageSize || null}
                landmarks={review.landmarks || saved.landmarks || {}}
                calibration={review.calibration !== undefined ? review.calibration : saved.calibration || null}
                confidence={review.landmarks ? undefined : saved.landmarkConfidence}
                norms={norms}
                readOnly={signed}
                ar={ar}
                saving={busy}
                onSave={(landmarks, calibration) => onPatch({ landmarks, calibration })}
              />
            </Section>
          )}
          <ul className="space-y-1.5">
            {(["skeletal", "dental", "vertical", "softTissue"] as const).map((k) =>
              r[k] ? <RowItem key={k} ctx={ctx} path={k} text={r[k]} badge={<span className="block text-[9px] font-black uppercase tracking-widest text-slate-400 mb-0.5">{k === "softTissue" ? (ar ? "أنسجة رخوة" : "Soft tissue") : k === "skeletal" ? (ar ? "هيكلي" : "Skeletal") : k === "dental" ? (ar ? "سني" : "Dental") : ar ? "عمودي" : "Vertical"}</span>} /> : null
            )}
          </ul>
          {r.keyFindings.length > 0 && (
            <Section title={L.keyFindings}>
              <RowsList ctx={ctx} name="keyFindings" items={r.keyFindings} />
            </Section>
          )}
          {r.treatmentImplications.length > 0 && (
            <Section title={L.implications}>
              <RowsList ctx={ctx} name="treatmentImplications" items={r.treatmentImplications} />
            </Section>
          )}
          {r.limitations && (
            <Section title={L.limitations}>
              <p className="text-sm text-slate-500 font-medium">{r.limitations}</p>
            </Section>
          )}
        </>
      );
    }
    if (saved.kind === "diagnosis") {
      const r = saved.report as OrthoDiagnosisReport;
      return (
        <>
          <div className="flex flex-wrap gap-1.5">
            <Chip>{orthoLabel("angleClass", r.angleClass, lang)}</Chip>
            <Chip>{orthoLabel("skeletalClass", r.skeletalClass, lang)}</Chip>
            <Chip>{orthoLabel("verticalPattern", r.verticalPattern, lang)}</Chip>
            <Chip tone="slate">{orthoLabel("complexity", r.complexity, lang)}</Chip>
            {r.iotn > 0 && <Chip tone="slate">IOTN {r.iotn}</Chip>}
          </div>
          <Section title={L.problems}>
            <RowsList
              ctx={ctx}
              name="problems"
              items={r.problems.map((p) => `${p.problem}${p.evidence ? ` — ${p.evidence}` : ""}`)}
              badges={r.problems.map((p) => (
                <span key={p.problem}>
                  {sevBadge(p.severity)}
                  <span className="inline-block me-1.5 px-1.5 py-0.5 rounded text-[9px] font-black uppercase bg-purple-50 text-purple-700">{orthoLabel("area", p.area, lang)}</span>
                </span>
              ))}
            />
          </Section>
          {r.aetiology.length > 0 && (
            <Section title={L.aetiology}>
              <RowsList ctx={ctx} name="aetiology" items={r.aetiology} />
            </Section>
          )}
          {r.missingInformation.length > 0 && (
            <Section title={L.missingInfo}>
              <ul className="list-disc ps-5 text-sm text-slate-500 font-medium space-y-0.5">
                {r.missingInformation.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            </Section>
          )}
        </>
      );
    }
    if (saved.kind === "plan") {
      const r = saved.report as OrthoPlanReport;
      return (
        <>
          {r.objectives.length > 0 && (
            <Section title={L.objectives}>
              <RowsList ctx={ctx} name="objectives" items={r.objectives} />
            </Section>
          )}
          <div className="space-y-3">
            {r.options.map((o, i) => {
              const path = `options.${i}`;
              const v = verdicts[path];
              const isChosen = chosen === i;
              return (
                <div key={path} className={`rounded-2xl border p-4 space-y-2 ${isChosen ? "border-purple-400 bg-purple-50/40" : v === "rejected" ? "border-rose-200 opacity-60" : "border-line bg-surface"}`}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="font-black text-ink">
                        {L.option} {i + 1}: {o.title}
                      </div>
                      <div className="flex flex-wrap gap-1.5 mt-1">
                        <Chip>{orthoLabel("approach", o.approach, lang)}</Chip>
                        {o.recommended && <Chip tone="emerald">{L.recommended}</Chip>}
                        {isChosen && <Chip tone="purple">{L.chosen}</Chip>}
                        <Chip tone="slate">
                          {o.durationMonths} {L.months}
                        </Chip>
                      </div>
                    </div>
                    {!signed && (
                      <div className="flex items-center gap-1">
                        <button type="button" onClick={() => setChosen(isChosen ? undefined : i)} className={`px-3 py-1.5 rounded-lg text-xs font-black border ${isChosen ? "bg-purple-600 text-white border-purple-600" : "bg-surface border-line text-slate-600"}`}>
                          {L.choose}
                        </button>
                        <IconBtn on={v === "confirmed"} tone="emerald" title={L.confirm} onClick={() => setVerdict(path, "confirmed")}>
                          <Check size={13} />
                        </IconBtn>
                        <IconBtn on={v === "edited"} tone="amber" title={L.edit} onClick={() => setEditing(editing === path ? null : path)}>
                          <Pencil size={13} />
                        </IconBtn>
                        <IconBtn on={v === "rejected"} tone="rose" title={L.reject} onClick={() => setVerdict(path, "rejected")}>
                          <X size={13} />
                        </IconBtn>
                      </div>
                    )}
                  </div>
                  {editing === path && (
                    <textarea
                      autoFocus
                      defaultValue={edits[path] || ""}
                      placeholder={ar ? "تعديلك على الخيار ده…" : "Your changes to this option…"}
                      onBlur={(e) => {
                        const val = e.target.value.trim();
                        if (val) {
                          setEdits((cur) => ({ ...cur, [path]: val }));
                          setVerdict(path, "edited");
                        } else {
                          setEdits((cur) => omit(cur, path));
                          if (verdicts[path] === "edited") setVerdicts((cur) => omit(cur, path));
                        }
                        setEditing(null);
                      }}
                      className="w-full p-2 bg-surface border border-amber-300 rounded-lg outline-none text-sm font-medium min-h-[60px]"
                    />
                  )}
                  {edits[path] && editing !== path && <p className="text-sm font-bold text-amber-800 bg-amber-50 rounded-lg px-3 py-2">{edits[path]}</p>}
                  <div className="grid md:grid-cols-2 gap-x-6 gap-y-1 text-sm text-slate-700">
                    <p>
                      <b>{L.appliance}:</b> {o.appliance}
                    </p>
                    {o.extractions.length > 0 && (
                      <p>
                        <b>{L.extractions}:</b> {o.extractions.join(", ")}
                      </p>
                    )}
                    {o.anchorage && (
                      <p>
                        <b>{L.anchorage}:</b> {o.anchorage}
                      </p>
                    )}
                    {o.retention && (
                      <p>
                        <b>{L.retention}:</b> {o.retention}
                      </p>
                    )}
                  </div>
                  {o.phases.length > 0 && (
                    <ol className="space-y-1 text-sm">
                      {o.phases.map((p, pi) => (
                        <li key={pi} className="bg-surface-subtle rounded-lg px-3 py-2">
                          <div className="font-black text-slate-700">
                            {pi + 1}. {p.name} <span className="text-slate-400 font-bold">· {p.months} {L.months}</span>
                          </div>
                          <div className="text-slate-600">{p.goal}</div>
                          {p.steps.length > 0 && <ul className="list-disc ps-5 text-slate-500 mt-0.5">{p.steps.map((s, si) => <li key={si}>{s}</li>)}</ul>}
                        </li>
                      ))}
                    </ol>
                  )}
                  <div className="grid md:grid-cols-3 gap-2 text-xs">
                    {(
                      [
                        [L.pros, o.pros, "bg-emerald-50/60", "text-emerald-800"],
                        [L.cons, o.cons, "bg-amber-50/60", "text-amber-800"],
                        [L.risks, o.risks, "bg-rose-50/60", "text-rose-800"],
                      ] as [string, string[], string, string][]
                    ).map(([title, list, bg, fg]) =>
                      list.length ? (
                        <div key={title} className={`rounded-lg p-2 ${bg}`}>
                          <div className={`font-black ${fg} mb-0.5`}>{title}</div>
                          <ul className="list-disc ps-4 text-slate-600">{list.map((x, xi) => <li key={xi}>{x}</li>)}</ul>
                        </div>
                      ) : null
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          {r.prerequisites.length > 0 && (
            <Section title={L.prerequisites}>
              <RowsList ctx={ctx} name="prerequisites" items={r.prerequisites} />
            </Section>
          )}
          {r.recordsNeeded.length > 0 && (
            <Section title={L.records}>
              <ul className="list-disc ps-5 text-sm text-slate-500 font-medium">{r.recordsNeeded.map((m) => <li key={m}>{m}</li>)}</ul>
            </Section>
          )}
        </>
      );
    }
    const r = saved.report as OrthoFollowupReport;
    return (
      <>
        <div className="flex flex-wrap gap-1.5">
          <Chip>{orthoLabel("stage", r.stage, lang)}</Chip>
          <Chip tone={r.progress === "concern" ? "rose" : r.progress === "on_track" ? "emerald" : "amber"}>{orthoLabel("progress", r.progress, lang)}</Chip>
          <Chip tone="slate">
            {L.nextVisit} {r.nextVisitWeeks} {L.weeks}
          </Chip>
          {r.remainingMonths > 0 && (
            <Chip tone="slate">
              {L.remaining} {r.remainingMonths} {L.months}
            </Chip>
          )}
        </div>
        {r.observations.length > 0 && (
          <Section title={L.observations}>
            <RowsList ctx={ctx} name="observations" items={r.observations} />
          </Section>
        )}
        {r.concerns.length > 0 && (
          <Section title={L.concerns}>
            <RowsList ctx={ctx} name="concerns" items={r.concerns.map((c) => `${c.issue}${c.action ? ` → ${c.action}` : ""}`)} badges={r.concerns.map((c, i) => <span key={i}>{sevBadge(c.severity)}</span>)} />
          </Section>
        )}
        {r.thisVisit.length > 0 && (
          <Section title={L.thisVisit}>
            <RowsList ctx={ctx} name="thisVisit" items={r.thisVisit} />
          </Section>
        )}
        {r.hygieneAndCompliance.length > 0 && (
          <Section title={L.hygiene}>
            <ul className="list-disc ps-5 text-sm text-slate-500 font-medium">{r.hygieneAndCompliance.map((m) => <li key={m}>{m}</li>)}</ul>
          </Section>
        )}
      </>
    );
  };

  const when = reportDate(saved);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-[11px] font-bold text-slate-400">
        <span>{when ? when.toLocaleString() : ""}</span>
        {saved.createdByName && <span>· {saved.createdByName}</span>}
        {saved.mode === "deep" && <span className="text-purple-600">· {ar ? "قراءة عميقة" : "deep"}</span>}
        {typeof saved.lessonsUsed === "number" && saved.lessonsUsed > 0 && (
          <span className="text-purple-600">
            · {saved.lessonsUsed} {ar ? "درس مطبّق" : "lessons applied"}
          </span>
        )}
        {signed && (
          <span className="ms-auto inline-flex items-center gap-1 text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md">
            <PenLine size={11} /> {L.signed} · {review.signedByName}
          </span>
        )}
      </div>

      <Section title={L.summary}>
        <p className="text-sm font-medium text-slate-700 whitespace-pre-wrap">{saved.report.summary}</p>
        {!signed && <textarea value={summary} onChange={(e) => setSummary(e.target.value)} placeholder={L.yourSummary} className="mt-2 w-full p-2.5 bg-surface-subtle border border-line rounded-xl outline-none text-sm font-medium min-h-[50px]" />}
        {signed && summary && <p className="mt-2 text-sm font-bold text-amber-900 bg-amber-50 rounded-xl px-3 py-2">{summary}</p>}
      </Section>

      {body()}

      <div>
        <button type="button" onClick={() => setShowPatient((s) => !s)} className="text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-purple-600">
          {L.patient} {showPatient ? "▾" : "▸"}
        </button>
        {showPatient && (
          <div className="mt-1.5">
            <p className="text-sm text-slate-600 font-medium bg-surface-subtle rounded-xl px-3 py-2">{saved.report.patientSummary}</p>
            {!signed && <textarea value={patientSummary} onChange={(e) => setPatientSummary(e.target.value)} placeholder={ar ? "صياغتك للمريض (اختياري)" : "Your own wording for the patient (optional)"} className="mt-1.5 w-full p-2.5 bg-surface border border-line rounded-xl outline-none text-sm font-medium min-h-[50px]" />}
          </div>
        )}
      </div>

      {!signed && (
        <div>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder={L.note} className="w-full p-2.5 bg-surface-subtle border border-line rounded-xl outline-none text-sm font-medium min-h-[50px]" />
        </div>
      )}
      {signed && review.note && <p className="text-sm font-medium text-slate-600 bg-surface-subtle rounded-xl px-3 py-2">{review.note}</p>}

      <p className="text-[11px] font-bold text-slate-400 border-t border-line pt-3">{orthoDisclaimer(lang)}</p>

      <div className="flex flex-wrap items-center gap-2">
        {!signed && (
          <>
            <button type="button" disabled={!dirty || busy} onClick={() => onPatch(patch())} className="px-4 py-2 rounded-xl bg-emerald-600 text-white font-black text-xs uppercase tracking-wider flex items-center gap-1.5 disabled:bg-slate-100 disabled:text-slate-400">
              {busy ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} {L.save}
            </button>
            <button type="button" disabled={busy} onClick={() => onPatch(patch({ sign: true }))} className="px-4 py-2 rounded-xl bg-purple-600 text-white font-black text-xs uppercase tracking-wider flex items-center gap-1.5 disabled:opacity-50">
              <PenLine size={13} /> {L.sign}
            </button>
          </>
        )}
        <button
          type="button"
          disabled={busy || !hasCorrections || dirty}
          title={!hasCorrections || dirty ? L.teachHint : ""}
          onClick={onTeach}
          className="px-4 py-2 rounded-xl bg-amber-500 text-white font-black text-xs uppercase tracking-wider flex items-center gap-1.5 disabled:opacity-40"
        >
          <GraduationCap size={13} /> {L.teach}
        </button>
        <button
          type="button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(orthoReportToText(saved.kind, saved.report, lang, saved.review));
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            } catch {
              /* clipboard blocked */
            }
          }}
          className="ms-auto px-3 py-2 rounded-xl border border-line text-slate-500 font-black text-xs flex items-center gap-1.5"
        >
          <Copy size={13} /> {copied ? L.copied : L.copy}
        </button>
      </div>
    </div>
  );
}

const CHIP_TONES = {
  purple: "bg-purple-50 text-purple-800",
  slate: "bg-slate-100 text-slate-700",
  emerald: "bg-emerald-50 text-emerald-800",
  amber: "bg-amber-50 text-amber-800",
  rose: "bg-rose-50 text-rose-800",
} as const;

interface RowCtx {
  verdicts: Record<string, Verdict>;
  edits: Record<string, string>;
  editing: string | null;
  signed: boolean;
  labels: { confirm: string; edit: string; reject: string };
  setVerdict: (path: string, v: Verdict) => void;
  setEditing: (path: string | null) => void;
  setEdits: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  setVerdicts: React.Dispatch<React.SetStateAction<Record<string, Verdict>>>;
}

/** One reviewable line: the model's text (or the dentist's rewrite) and the three verdict buttons. */
function RowItem({ ctx, path, text, badge }: { ctx: RowCtx; path: string; text: string; badge?: React.ReactNode }) {
  const { verdicts, edits, editing, signed, labels, setVerdict, setEditing, setEdits, setVerdicts } = ctx;
  const v = verdicts[path];
  const isEditing = editing === path;
  const shown = v === "edited" && edits[path] ? edits[path] : text;
  return (
    <li className={`rounded-xl border px-3 py-2 text-sm ${v === "rejected" ? "border-rose-200 bg-rose-50/50 text-slate-400 line-through" : v === "confirmed" ? "border-emerald-200 bg-emerald-50/40" : v === "edited" ? "border-amber-200 bg-amber-50/40" : "border-line bg-surface"}`}>
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0 font-medium text-slate-700">
          {badge}
          {isEditing ? (
            <textarea
              autoFocus
              defaultValue={edits[path] || text}
              onBlur={(e) => {
                const val = e.target.value.trim();
                if (val && val !== text) {
                  setEdits((cur) => ({ ...cur, [path]: val }));
                  setVerdict(path, "edited");
                } else {
                  setEdits((cur) => omit(cur, path));
                  if (verdicts[path] === "edited") setVerdicts((cur) => omit(cur, path));
                }
                setEditing(null);
              }}
              className="w-full p-2 bg-surface border border-amber-300 rounded-lg outline-none text-sm font-medium min-h-[60px]"
            />
          ) : (
            <span className="whitespace-pre-wrap">{shown}</span>
          )}
          {v === "edited" && !isEditing && <div className="text-[10px] text-slate-400 mt-1 line-through">{text}</div>}
        </div>
        {!signed && (
          <div className="flex items-center gap-0.5 shrink-0">
            <IconBtn on={v === "confirmed"} tone="emerald" title={labels.confirm} onClick={() => setVerdict(path, "confirmed")}>
              <Check size={13} />
            </IconBtn>
            <IconBtn on={v === "edited"} tone="amber" title={labels.edit} onClick={() => setEditing(isEditing ? null : path)}>
              <Pencil size={13} />
            </IconBtn>
            <IconBtn on={v === "rejected"} tone="rose" title={labels.reject} onClick={() => setVerdict(path, "rejected")}>
              <X size={13} />
            </IconBtn>
          </div>
        )}
      </div>
    </li>
  );
}

function RowsList({ ctx, name, items, badges }: { ctx: RowCtx; name: string; items: string[]; badges?: React.ReactNode[] }) {
  return (
    <ul className="space-y-1.5">
      {items.map((t, i) => (
        <RowItem key={`${name}.${i}`} ctx={ctx} path={`${name}.${i}`} text={t} badge={badges?.[i]} />
      ))}
    </ul>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1.5">{title}</div>
      {children}
    </div>
  );
}

function Chip({ children, tone = "purple" }: { children: React.ReactNode; tone?: keyof typeof CHIP_TONES }) {
  return <span className={`px-2.5 py-1 rounded-lg text-xs font-black ${CHIP_TONES[tone]}`}>{children}</span>;
}

function IconBtn({ on, tone, title, onClick, children }: { on: boolean; tone: "emerald" | "amber" | "rose"; title: string; onClick: () => void; children: React.ReactNode }) {
  const tones = {
    emerald: on ? "bg-emerald-600 text-white" : "text-emerald-600 hover:bg-emerald-50",
    amber: on ? "bg-amber-500 text-white" : "text-amber-600 hover:bg-amber-50",
    rose: on ? "bg-rose-600 text-white" : "text-rose-600 hover:bg-rose-50",
  };
  return (
    <button type="button" title={title} onClick={onClick} className={`p-1.5 rounded-md transition-colors ${tones[tone]}`}>
      {children}
    </button>
  );
}

function omit<T extends Record<string, unknown>>(obj: T, key: string): T {
  const next = { ...obj };
  delete next[key];
  return next;
}
