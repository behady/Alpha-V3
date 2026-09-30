"use client";

import { useEffect, useMemo, useState } from "react";
import { onSnapshot, query, updateDoc, where } from "firebase/firestore";
import { AlertTriangle, ChevronDown, ChevronRight, GraduationCap, Loader2, Lock, ScanLine, Sparkles, X } from "lucide-react";
import { getClinicCollection, getClinicDoc } from "@/lib/db-utils";
import { useClinic } from "@/context/ClinicContext";
import { useLanguage } from "@/context/LanguageContext";
import { useUI } from "@/context/UIContext";
import { featureInfo, isUnlocked, SUPPORT_WHATSAPP } from "@/lib/featureCatalog";
import { normalizeLandmarkBias, normalizeNormOverrides, type CephNormOverrides, type LandmarkBiasStats } from "@/lib/orthoCeph";
import {
  findingsHaveContent,
  normalizeClinicalFindings,
  normalizeLesson,
  ORTHO_AI_CREDITS,
  ORTHO_AI_FEATURE_KEY,
  ORTHO_AI_REPORTS_COLLECTION,
  ORTHO_COACHING_BIAS_DOC,
  ORTHO_COACHING_COLLECTION,
  ORTHO_COACHING_NORMS_DOC,
  ORTHO_DEEP_MULTIPLIER,
  ORTHO_MAX_PHOTOS,
  ORTHO_PHOTO_EXTRA_CREDITS,
  orthoLabel,
  type LessonKind,
  type LessonSuggestion,
  type OrthoAiKind,
  type OrthoClinicalFindings,
  type OrthoLesson,
} from "@/lib/orthoAi";
import OrthoFindingsForm from "./OrthoFindingsForm";
import OrthoReportView from "./OrthoReportView";
import OrthoCoachPanel from "./OrthoCoachPanel";
import { callOrthoApi, errMessage, reportDate, type SavedOrthoReport } from "./orthoAiClient";

interface MediaRow {
  id: string;
  url: string;
  filename?: string;
  category?: string;
  createdAt?: { toDate?: () => Date } | null;
}

export interface OrthoCaseForAi {
  clinicalFindings?: unknown;
  visits?: unknown[];
  diagnosis?: string;
  startDate?: string;
  status?: string;
}

type Tab = OrthoAiKind | "coach";
const TABS: Tab[] = ["ceph", "diagnosis", "plan", "followup", "coach"];

/**
 * The AI half of the ortho workspace, under the case record on /ortho/[id].
 *
 * Four report kinds and the lesson book, each a tab. Reports are a live query on
 * `ortho_ai_reports`; the clinical examination is saved on the ortho case from here (it is the
 * dentist's, client-writable like the rest of the case); every report and every lesson is
 * written by the server routes, so this file writes nothing to those collections itself.
 */
export default function OrthoAiPanel({ patientId, patientName, orthoCase }: { patientId: string; patientName: string; orthoCase: OrthoCaseForAi }) {
  const { language } = useLanguage();
  const { clinic, clinicId } = useClinic();
  const { showToast, confirm } = useUI();
  const ar = language === "ar";
  const lang = ar ? "ar" : "en";
  const unlocked = clinic ? isUnlocked(clinic, ORTHO_AI_FEATURE_KEY) : null;

  const [tab, setTab] = useState<Tab>("diagnosis");
  const [reports, setReports] = useState<SavedOrthoReport[]>([]);
  const [media, setMedia] = useState<MediaRow[]>([]);
  const [lessons, setLessons] = useState<OrthoLesson[]>([]);
  const [norms, setNorms] = useState<CephNormOverrides>({});
  const [bias, setBias] = useState<LandmarkBiasStats>({});
  const [biasReports, setBiasReports] = useState(0);
  const [picked, setPicked] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [deep, setDeep] = useState(false);
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [findings, setFindings] = useState<OrthoClinicalFindings>(normalizeClinicalFindings(orthoCase.clinicalFindings));
  const [savingFindings, setSavingFindings] = useState(false);
  const [teach, setTeach] = useState<{ reportId: string; suggestions: (LessonSuggestion & { on: boolean })[]; corrections: string[] } | null>(null);

  useEffect(() => {
    setFindings(normalizeClinicalFindings(orthoCase.clinicalFindings));
  }, [orthoCase.clinicalFindings]);

  useEffect(() => {
    if (!clinicId || !patientId || unlocked === false) return;
    const unsubs = [
      onSnapshot(
        query(getClinicCollection(ORTHO_AI_REPORTS_COLLECTION), where("patientId", "==", patientId)),
        (snap) => {
          const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<SavedOrthoReport, "id">) }));
          rows.sort((a, b) => (reportDate(b)?.getTime() || 0) - (reportDate(a)?.getTime() || 0));
          setReports(rows);
        },
        (err) => console.error("Could not load ortho AI reports", err)
      ),
      onSnapshot(
        query(getClinicCollection("patient_media"), where("patientId", "==", patientId)),
        (snap) => {
          const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<MediaRow, "id">) }));
          rows.sort((a, b) => (b.createdAt?.toDate?.()?.getTime() || 0) - (a.createdAt?.toDate?.()?.getTime() || 0));
          setMedia(rows);
        },
        (err) => console.error("Could not load patient media", err)
      ),
      onSnapshot(
        getClinicCollection(ORTHO_COACHING_COLLECTION),
        (snap) => {
          const ls: OrthoLesson[] = [];
          let n: CephNormOverrides = {};
          let b: LandmarkBiasStats = {};
          let br = 0;
          for (const d of snap.docs) {
            const data = d.data();
            if (d.id === ORTHO_COACHING_NORMS_DOC) n = normalizeNormOverrides(data.norms);
            else if (d.id === ORTHO_COACHING_BIAS_DOC) {
              b = normalizeLandmarkBias(data.stats);
              br = Number(data.reports) || 0;
            } else {
              const l = normalizeLesson(d.id, data);
              if (l) ls.push(l);
            }
          }
          ls.sort((a, b2) => a.createdAt.localeCompare(b2.createdAt));
          setLessons(ls);
          setNorms(n);
          setBias(b);
          setBiasReports(br);
        },
        (err) => console.error("Could not load ortho coaching", err)
      ),
    ];
    return () => unsubs.forEach((u) => u());
  }, [clinicId, patientId, unlocked]);

  const findingsDirty = JSON.stringify(findings) !== JSON.stringify(normalizeClinicalFindings(orthoCase.clinicalFindings));
  const saveFindings = async () => {
    setSavingFindings(true);
    try {
      await updateDoc(getClinicDoc("ortho_cases", patientId), { clinicalFindings: findings });
      showToast(ar ? "اتحفظ الفحص." : "Examination saved.", "success");
    } catch (e) {
      showToast(errMessage(e, lang), "error");
    } finally {
      setSavingFindings(false);
    }
  };

  const kindReports = (k: OrthoAiKind) => reports.filter((r) => r.kind === k);
  const credits = (k: OrthoAiKind) => (ORTHO_AI_CREDITS[k] + (k !== "ceph" && k !== "plan" && picked.length ? ORTHO_PHOTO_EXTRA_CREDITS : 0)) * (deep ? ORTHO_DEEP_MULTIPLIER : 1);

  const run = async (k: OrthoAiKind) => {
    if (busy) return;
    if (k === "ceph" && picked.length !== 1) {
      showToast(ar ? "اختار صورة السيفالو الجانبية." : "Pick the lateral ceph.", "error");
      return;
    }
    if (k === "diagnosis" && findingsDirty) await saveFindings();
    setBusy(true);
    try {
      const res = await callOrthoApi<{ reportId: string; credits: number }>(
        "analyze",
        {
          clinicId,
          patientId,
          kind: k,
          note: note.trim() || undefined,
          mode: deep ? "deep" : "standard",
          mediaIds: k === "plan" ? [] : picked,
          ...(k === "diagnosis" ? { findings } : {}),
        },
        lang
      );
      showToast(ar ? `تم — خُصم ${res.credits} رصيد` : `Done — ${res.credits} credits used`, "success");
      setNote("");
      setPicked([]);
      setExpanded((e) => ({ ...e, [res.reportId]: true }));
    } catch (e) {
      showToast(errMessage(e, lang), "error");
    } finally {
      setBusy(false);
    }
  };

  const patchReport = async (reportId: string, patch: Record<string, unknown>) => {
    if (patch.sign && !(await confirm(ar ? "توقيع التقرير؟ بعد التوقيع مينفعش يتعدل، وتصحيحات النقاط بتتسجل للتعلّم." : "Sign this report? It cannot be edited afterwards, and landmark corrections are tallied for learning."))) return;
    setBusy(true);
    try {
      await callOrthoApi("review", { clinicId, reportId, ...patch }, lang);
      showToast(patch.sign ? (ar ? "اتوقّع التقرير." : "Report signed.") : ar ? "اتحفظت المراجعة." : "Review saved.", "success");
    } catch (e) {
      showToast(errMessage(e, lang), "error");
    } finally {
      setBusy(false);
    }
  };

  const startTeach = async (reportId: string) => {
    setBusy(true);
    try {
      const res = await callOrthoApi<{ suggestions: LessonSuggestion[]; corrections: string[] }>("coach", { clinicId, action: "learn", reportId }, lang);
      setTeach({ reportId, suggestions: res.suggestions.map((s) => ({ ...s, on: true })), corrections: res.corrections });
    } catch (e) {
      showToast(errMessage(e, lang), "error");
    } finally {
      setBusy(false);
    }
  };

  const coach = async (body: Record<string, unknown>, okMsg: string) => {
    setBusy(true);
    try {
      await callOrthoApi("coach", { clinicId, ...body }, lang);
      if (okMsg) showToast(okMsg, "success");
    } catch (e) {
      showToast(errMessage(e, lang), "error");
    } finally {
      setBusy(false);
    }
  };

  const monthsIn = useMemo(() => {
    if (!orthoCase.startDate) return null;
    const t = new Date(orthoCase.startDate).getTime();
    return isNaN(t) ? null : Math.max(0, Math.round((Date.now() - t) / (30.4 * 86400000)));
  }, [orthoCase.startDate]);

  const L = {
    title: ar ? "الذكاء الاصطناعي للتقويم" : "AI Orthodontics",
    subtitle: ar ? "تحليل سيفالو، تشخيص، خطة علاج، ومتابعة — كل تقرير بيتراجع ويتوقّع منك، وبتقدر تعلّم الذكاء الاصطناعي طريقتك." : "Ceph analysis, diagnosis, treatment plan and follow-up — every report is yours to review and sign, and you can teach the model your way.",
    pickCeph: ar ? "اختار الأشعة السيفالومترية الجانبية" : "Pick the lateral cephalogram",
    pickPhotos: ar ? `اختار صور (حتى ${ORTHO_MAX_PHOTOS}) — داخل الفم والبروفايل` : `Pick photographs (up to ${ORTHO_MAX_PHOTOS}) — intraoral views and the profile`,
    noMedia: ar ? "مفيش صور مرفوعة للمريض. ارفع من تبويب الأشعة والصور في ملفه." : "No pictures uploaded for this patient. Upload from the X-Rays & Photos tab in their file.",
    note: ar ? "ملاحظة للذكاء الاصطناعي (اختياري)" : "A note for the model (optional)",
    planNote: ar ? "قيودك أو رغباتك للخطة (اختياري): «بدون خلع لو أمكن»، «المريض عايز شفاف»…" : "Your constraints or wishes for the plan (optional): “no extractions if possible”, “patient wants aligners”…",
    followNote: ar ? "ملاحظة من الكرسي النهارده (اختياري)" : "A note from the chair today (optional)",
    deep: ar ? "قراءة عميقة (×3 رصيد)" : "Deep read (×3 credits)",
    run: { ceph: ar ? "حلّل السيفالو" : "Analyse the ceph", diagnosis: ar ? "اكتب التشخيص" : "Write the diagnosis", plan: ar ? "اقترح خطة العلاج" : "Propose the treatment plan", followup: ar ? "قيّم التقدّم" : "Review progress" } as Record<OrthoAiKind, string>,
    credits: ar ? "رصيد" : "credits",
    past: ar ? "تقارير سابقة" : "Earlier reports",
    none: ar ? "مفيش تقارير من النوع ده لسه." : "No reports of this kind yet.",
    planFrom: (n: number, has: boolean) => (ar ? (n ? `الخطة هتتبني على آخر تشخيص (${n} تشخيص)` : has ? "الخطة هتتبني على التشخيص المكتوب في ملف الحالة" : "اكتب التشخيص الأول (أو التشخيص في ملف الحالة).") : n ? `The plan builds on the latest diagnosis (${n} on file)` : has ? "The plan builds on the diagnosis written in the case file" : "Run the diagnosis first (or write one in the case file)."),
    followFrom: ar ? `المتابعة بتقرأ ${(orthoCase.visits || []).length} زيارة${monthsIn !== null ? ` و${monthsIn} شهر في العلاج` : ""} وآخر خطة.` : `The review reads ${(orthoCase.visits || []).length} visits${monthsIn !== null ? `, ${monthsIn} months in treatment,` : ""} and the latest plan.`,
    findingsFirst: ar ? "سجّل الفحص السريري (أو اختار صور) قبل التشخيص." : "Enter the clinical examination (or pick photographs) before diagnosing.",
    lockedTitle: ar ? "غير مفعّل في اشتراكك" : "Not in your subscription",
    lockedCta: ar ? "اطلب التفعيل على واتساب" : "Ask for it on WhatsApp",
    teachTitle: ar ? "دروس مقترحة من مراجعتك" : "Lessons suggested from your review",
    teachHint: ar ? "الذكاء الاصطناعي لخّص تصحيحاتك في قواعد عامة. عدّل الصياغة، شيل اللي مش عايزه، واحفظ — مفيش حاجة بتتحفظ من غيرك." : "The model distilled your corrections into general rules. Edit the wording, untick what you do not want, and save — nothing is stored without you.",
    teachNone: ar ? "التصحيحات دي خاصة بالمريض ومفيهاش قاعدة عامة. تقدر تكتب درس بنفسك في تبويب «علّم الذكاء الاصطناعي»." : "These corrections are patient-specific and teach nothing general. You can write a lesson yourself in the Teach tab.",
    teachSave: ar ? "حفظ الدروس المختارة" : "Save selected lessons",
    corrections: ar ? "التصحيحات اللي اتقرت" : "Corrections read",
    close: ar ? "إغلاق" : "Close",
  };

  if (unlocked === null) return null;
  if (unlocked === false) {
    const info = featureInfo(ORTHO_AI_FEATURE_KEY);
    const msg = ar ? `أهلاً، عايز أفعّل "${info.labelAr}" في عيادتي على ألفا.` : `Hi, I would like to activate "${info.labelEn}" for my clinic on Alpha.`;
    return (
      <div className="bg-surface rounded-[2rem] border border-slate-100 shadow-sm p-6 md:p-8 flex flex-col md:flex-row items-start gap-4">
        <div className="w-12 h-12 rounded-2xl bg-ink-slab text-white grid place-items-center shrink-0">
          <Lock size={20} />
        </div>
        <div className="flex-1">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{L.lockedTitle}</p>
          <h3 className="text-lg font-black text-ink">{ar ? info.labelAr : info.labelEn}</h3>
          <p className="text-sm font-medium text-ink-muted mt-1">{ar ? info.descAr : info.descEn}</p>
        </div>
        <a href={`https://wa.me/${SUPPORT_WHATSAPP.replace(/\D/g, "")}?text=${encodeURIComponent(msg)}`} target="_blank" rel="noreferrer" className="px-4 py-2.5 rounded-xl bg-emerald-600 text-white font-black text-xs uppercase tracking-wider shrink-0">
          {L.lockedCta}
        </a>
      </div>
    );
  }

  const MediaPicker = ({ single }: { single: boolean }) => (
    <div>
      <div className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1.5">{single ? L.pickCeph : L.pickPhotos}</div>
      {media.length === 0 ? (
        <p className="text-xs font-bold text-slate-400">{L.noMedia}</p>
      ) : (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {media.map((m) => {
            const on = picked.includes(m.id);
            return (
              <button
                key={m.id}
                type="button"
                onClick={() =>
                  setPicked((cur) => {
                    if (single) return on ? [] : [m.id];
                    if (on) return cur.filter((x) => x !== m.id);
                    return cur.length >= ORTHO_MAX_PHOTOS ? cur : [...cur, m.id];
                  })
                }
                className={`relative shrink-0 w-24 h-24 rounded-xl overflow-hidden border-2 transition-all ${on ? "border-purple-600 ring-2 ring-purple-200" : "border-line hover:border-purple-300"}`}
                title={m.filename || m.category}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={m.url} alt="" className="w-full h-full object-cover" />
                {m.category && <span className="absolute bottom-0 inset-x-0 bg-black/60 text-white text-[9px] font-bold px-1 py-0.5 truncate">{m.category}</span>}
                {on && <span className="absolute top-1 end-1 w-5 h-5 rounded-full bg-purple-600 text-white text-[10px] font-black grid place-items-center">{single ? "✓" : picked.indexOf(m.id) + 1}</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );

  const RunBar = ({ k, disabled, placeholder }: { k: OrthoAiKind; disabled?: boolean; placeholder: string }) => (
    <div className="flex flex-col md:flex-row gap-2 md:items-center">
      <input value={note} onChange={(e) => setNote(e.target.value.slice(0, 500))} placeholder={placeholder} className="flex-1 p-2.5 bg-surface border border-line rounded-xl outline-none text-sm font-bold" />
      <label className="flex items-center gap-1.5 text-xs font-bold text-slate-500 shrink-0">
        <input type="checkbox" checked={deep} onChange={(e) => setDeep(e.target.checked)} /> {L.deep}
      </label>
      <button type="button" disabled={busy || disabled} onClick={() => run(k)} className="px-5 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-700 text-white font-black text-xs uppercase tracking-wider flex items-center justify-center gap-2 disabled:opacity-50 shrink-0">
        {busy ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />} {L.run[k]} · {credits(k)} {L.credits}
      </button>
    </div>
  );

  const ReportList = ({ k }: { k: OrthoAiKind }) => {
    const list = kindReports(k);
    if (list.length === 0) return <p className="text-sm font-bold text-slate-400 text-center py-6">{L.none}</p>;
    return (
      <div className="space-y-3">
        {list.map((r, i) => {
          const open = expanded[r.id] ?? i === 0;
          const when = reportDate(r);
          return (
            <div key={r.id} className={`rounded-2xl border ${r.signed ? "border-emerald-200" : "border-line"} bg-surface`}>
              <button type="button" onClick={() => setExpanded((e) => ({ ...e, [r.id]: !open }))} className="w-full flex items-center gap-2 px-4 py-3 text-start">
                {open ? <ChevronDown size={16} className="text-slate-400" /> : <ChevronRight size={16} className="text-slate-400" />}
                <span className="font-black text-sm text-ink">{orthoLabel("kind", k, lang)}</span>
                <span className="text-xs font-bold text-slate-400">{when ? when.toLocaleDateString() : ""}</span>
                {r.signed ? <span className="ms-auto text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded bg-emerald-50 text-emerald-700">{ar ? "موقّع" : "signed"}</span> : <span className="ms-auto text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded bg-amber-50 text-amber-700">{ar ? "في انتظار المراجعة" : "awaiting review"}</span>}
              </button>
              {open && (
                <div className="px-4 pb-4 border-t border-line pt-3">
                  <OrthoReportView saved={r} ar={ar} norms={norms} busy={busy} onPatch={(p) => patchReport(r.id, p)} onTeach={() => startTeach(r.id)} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  const diagCount = kindReports("diagnosis").length;
  const awaiting = reports.filter((r) => !r.signed).length;

  return (
    <div className="bg-surface rounded-[2rem] border border-slate-100 shadow-sm p-5 md:p-8 space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-5">
        <div>
          <h2 className="text-xl font-black text-ink flex items-center gap-2">
            <Sparkles className="text-purple-500" size={22} /> {L.title}
            {awaiting > 0 && <span className="text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded bg-amber-50 text-amber-700">{awaiting} {ar ? "في انتظار المراجعة" : "awaiting review"}</span>}
          </h2>
          <p className="text-xs font-bold text-slate-400 mt-1">{L.subtitle}</p>
        </div>
      </div>

      <div className="flex bg-surface-subtle border border-line rounded-2xl p-1 overflow-x-auto">
        {TABS.map((t) => {
          const n = t === "coach" ? lessons.filter((l) => l.active).length : kindReports(t).length;
          return (
            <button key={t} type="button" onClick={() => setTab(t)} className={`flex-1 px-3 py-2 rounded-xl text-xs font-black whitespace-nowrap flex items-center justify-center gap-1.5 transition-all ${tab === t ? "bg-purple-600 text-white shadow-sm" : "text-slate-500 hover:text-slate-800"}`}>
              {t === "coach" ? <GraduationCap size={14} /> : t === "ceph" ? <ScanLine size={14} /> : null}
              {t === "coach" ? (ar ? "علّم الذكاء الاصطناعي" : "Teach the AI") : orthoLabel("kind", t, lang)}
              {n > 0 && <span className={`text-[9px] px-1.5 rounded-full ${tab === t ? "bg-white/20" : "bg-slate-200 text-slate-600"}`}>{n}</span>}
            </button>
          );
        })}
      </div>

      {tab === "ceph" && (
        <div className="space-y-4">
          <MediaPicker single />
          <RunBar k="ceph" disabled={picked.length !== 1} placeholder={L.note} />
          <ReportList k="ceph" />
        </div>
      )}
      {tab === "diagnosis" && (
        <div className="space-y-4">
          <OrthoFindingsForm value={findings} onChange={setFindings} onSave={saveFindings} saving={savingFindings} dirty={findingsDirty} ar={ar} />
          <MediaPicker single={false} />
          {!findingsHaveContent(findings) && picked.length === 0 && (
            <p className="text-xs font-bold text-amber-700 flex items-center gap-1.5">
              <AlertTriangle size={13} /> {L.findingsFirst}
            </p>
          )}
          <RunBar k="diagnosis" disabled={!findingsHaveContent(findings) && picked.length === 0} placeholder={L.note} />
          <ReportList k="diagnosis" />
        </div>
      )}
      {tab === "plan" && (
        <div className="space-y-4">
          <p className="text-xs font-bold text-slate-500">{L.planFrom(diagCount, !!(orthoCase.diagnosis || "").trim() || findingsHaveContent(findings))}</p>
          <RunBar k="plan" disabled={diagCount === 0 && !(orthoCase.diagnosis || "").trim() && !findingsHaveContent(findings)} placeholder={L.planNote} />
          <ReportList k="plan" />
        </div>
      )}
      {tab === "followup" && (
        <div className="space-y-4">
          <p className="text-xs font-bold text-slate-500">{L.followFrom}</p>
          <MediaPicker single={false} />
          <RunBar k="followup" placeholder={L.followNote} />
          <ReportList k="followup" />
        </div>
      )}
      {tab === "coach" && (
        <OrthoCoachPanel
          lessons={lessons}
          norms={norms}
          bias={bias}
          biasReports={biasReports}
          ar={ar}
          busy={busy}
          onAdd={(text, kind) => coach({ action: "add", lessons: [{ text, kind }] }, ar ? "اتحفظ الدرس." : "Lesson saved.")}
          onToggle={(id, active) => coach({ action: "toggle", lessonId: id, active }, "")}
          onDelete={async (id) => {
            if (await confirm(ar ? "حذف الدرس ده؟" : "Delete this lesson?")) await coach({ action: "delete", lessonId: id }, ar ? "اتحذف." : "Deleted.");
          }}
          onSaveNorms={(n) => coach({ action: "norms", norms: n }, ar ? "اتحفظت القواعد." : "Norms saved.")}
          onResetBias={async () => {
            if (await confirm(ar ? "تصفير تصحيحات النقاط؟" : "Reset the landmark tally?")) await coach({ action: "reset_bias" }, ar ? "اتصفّرت." : "Reset.");
          }}
        />
      )}

      {teach && (
        <div className="fixed inset-0 z-[80] bg-black/50 flex items-end sm:items-center justify-center p-3" onClick={() => setTeach(null)}>
          <div className="bg-surface rounded-3xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-5 md:p-6 space-y-4" dir={ar ? "rtl" : "ltr"} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="font-black text-ink flex items-center gap-2">
                  <GraduationCap size={18} className="text-amber-600" /> {L.teachTitle}
                </h3>
                <p className="text-xs font-bold text-slate-400 mt-1">{L.teachHint}</p>
              </div>
              <button type="button" onClick={() => setTeach(null)} className="p-2 rounded-xl hover:bg-surface-subtle text-slate-400">
                <X size={18} />
              </button>
            </div>
            {teach.suggestions.length === 0 ? (
              <p className="text-sm font-bold text-slate-500 bg-surface-subtle rounded-xl p-4">{L.teachNone}</p>
            ) : (
              <ul className="space-y-2">
                {teach.suggestions.map((s, i) => (
                  <li key={i} className={`rounded-xl border p-3 space-y-2 ${s.on ? "border-amber-300 bg-amber-50/40" : "border-line opacity-60"}`}>
                    <div className="flex items-start gap-2">
                      <input type="checkbox" checked={s.on} onChange={(e) => setTeach((t) => t && { ...t, suggestions: t.suggestions.map((x, xi) => (xi === i ? { ...x, on: e.target.checked } : x)) })} className="mt-1" />
                      <textarea value={s.text} onChange={(e) => setTeach((t) => t && { ...t, suggestions: t.suggestions.map((x, xi) => (xi === i ? { ...x, text: e.target.value } : x)) })} className="flex-1 p-2 bg-surface border border-line rounded-lg text-sm font-bold min-h-[50px]" />
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500 font-bold ps-6">
                      <select value={s.kind} onChange={(e) => setTeach((t) => t && { ...t, suggestions: t.suggestions.map((x, xi) => (xi === i ? { ...x, kind: e.target.value as LessonKind } : x)) })} className="p-1.5 bg-surface border border-line rounded-lg">
                        {(["general", "ceph", "diagnosis", "plan", "followup"] as LessonKind[]).map((k) => (
                          <option key={k} value={k}>
                            {orthoLabel("lessonKind", k, lang)}
                          </option>
                        ))}
                      </select>
                      {s.why && <span className="italic">— {s.why}</span>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {teach.corrections.length > 0 && (
              <details className="text-xs">
                <summary className="font-black text-slate-400 uppercase tracking-widest cursor-pointer">{L.corrections}</summary>
                <ul className="list-disc ps-5 mt-1 text-slate-500 font-medium space-y-0.5">{teach.corrections.map((c, i) => <li key={i}>{c}</li>)}</ul>
              </details>
            )}
            <div className="flex items-center justify-end gap-2">
              <button type="button" onClick={() => setTeach(null)} className="px-4 py-2 rounded-xl border border-line font-black text-xs text-slate-500">
                {L.close}
              </button>
              {teach.suggestions.some((s) => s.on && s.text.trim()) && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={async () => {
                    await coach({ action: "add", reportId: teach.reportId, lessons: teach.suggestions.filter((s) => s.on && s.text.trim()).map((s) => ({ text: s.text.trim(), kind: s.kind })) }, ar ? "اتحفظت الدروس." : "Lessons saved.");
                    setTeach(null);
                    setTab("coach");
                  }}
                  className="px-4 py-2 rounded-xl bg-amber-500 text-white font-black text-xs uppercase tracking-wider flex items-center gap-1.5 disabled:opacity-50"
                >
                  {busy ? <Loader2 size={13} className="animate-spin" /> : <GraduationCap size={13} />} {L.teachSave}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
