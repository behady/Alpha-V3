"use client";

import { useState } from "react";
import { GraduationCap, Loader2, Plus, RotateCcw, Save, Trash2 } from "lucide-react";
import { CEPH_LANDMARKS, CEPH_MEASUREMENTS, landmarkBiasHints, type CephNormOverrides, type LandmarkBiasStats } from "@/lib/orthoCeph";
import { LESSON_KINDS, ORTHO_LESSON_MAX_CHARS, orthoLabel, type LessonKind, type OrthoLesson } from "@/lib/orthoAi";

/**
 * The lesson book: what this clinic's orthodontist has taught the model, the clinic's own
 * cephalometric norms, and the tally of where the model's landmarks keep being moved. Everything
 * here is read into the next prompt — which is why every write goes through the coach route.
 */
function draftFromNorms(norms: CephNormOverrides): Record<string, { mean: string; sd: string }> {
  const d: Record<string, { mean: string; sd: string }> = {};
  for (const m of CEPH_MEASUREMENTS) {
    const o = norms[m.id];
    d[m.id] = { mean: o ? String(o.mean) : "", sd: o ? String(o.sd) : "" };
  }
  return d;
}

export default function OrthoCoachPanel({
  lessons,
  norms,
  bias,
  biasReports,
  ar,
  busy,
  onAdd,
  onToggle,
  onDelete,
  onSaveNorms,
  onResetBias,
}: {
  lessons: OrthoLesson[];
  norms: CephNormOverrides;
  bias: LandmarkBiasStats;
  biasReports: number;
  ar: boolean;
  busy: boolean;
  onAdd: (text: string, kind: LessonKind) => Promise<void>;
  onToggle: (id: string, active: boolean) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onSaveNorms: (norms: CephNormOverrides) => Promise<void>;
  onResetBias: () => Promise<void>;
}) {
  const [text, setText] = useState("");
  const [kind, setKind] = useState<LessonKind>("general");
  const [normDraft, setNormDraft] = useState<Record<string, { mean: string; sd: string }>>(() => draftFromNorms(norms));
  const [seedNorms, setSeedNorms] = useState(norms);
  if (seedNorms !== norms) {
    setSeedNorms(norms);
    setNormDraft(draftFromNorms(norms));
  }
  const [showNorms, setShowNorms] = useState(false);
  const lang = ar ? "ar" : "en";

  const normsDirty = CEPH_MEASUREMENTS.some((m) => {
    const o = norms[m.id];
    const d = normDraft[m.id];
    if (!d) return false;
    return (o ? String(o.mean) : "") !== d.mean || (o ? String(o.sd) : "") !== d.sd;
  });

  const L = {
    title: ar ? "علّم الذكاء الاصطناعي" : "Teach the AI",
    hint: ar
      ? "كل درس هنا بيتقرأ في كل تقرير تقويم جاي. اكتب بصيغة الأمر: تفضيلاتك، حدودك، طريقتك. الذكاء الاصطناعي بيقدّم الدروس دي على الكتاب."
      : "Every lesson here is read into every later ortho report. Write in the imperative: your preferences, your thresholds, your way. The model puts these above the textbook.",
    placeholder: ar ? "مثال: «فضّل عدم الخلع مع IPR لما التزاحم السفلي أقل من 5 مم»" : "e.g. “Prefer non-extraction with IPR when lower crowding is under 5 mm”",
    applies: ar ? "ينطبق على" : "Applies to",
    add: ar ? "إضافة درس" : "Add lesson",
    empty: ar ? "مفيش دروس لسه. الذكاء الاصطناعي شغال بالكتاب بس." : "No lessons yet. The model is working from the textbook alone.",
    fromReview: ar ? "من مراجعة" : "from a review",
    manual: ar ? "مكتوب يدوياً" : "written by hand",
    off: ar ? "موقوف" : "paused",
    on: ar ? "شغّال" : "active",
    norms: ar ? "قواعد العيادة السيفالومترية" : "The clinic's cephalometric norms",
    normsHint: ar ? "سيب الخانة فاضية عشان تستخدم القاعدة الافتراضية. اللي تكتبه هنا هو اللي كل تحليل هيتقاس عليه." : "Leave a cell blank to keep the textbook value. What you enter here is what every analysis is judged against.",
    mean: ar ? "المتوسط" : "Mean",
    sd: ar ? "الانحراف" : "SD",
    default: ar ? "الافتراضي" : "Default",
    saveNorms: ar ? "حفظ القواعد" : "Save norms",
    bias: ar ? "تصحيحات النقاط" : "Landmark corrections",
    biasHint: ar
      ? "كل ما توقّع تحليل سيفالو بعد ما تحرّك نقطة، الفرق بيتسجل هنا. لما نقطة تتحرك في نفس الاتجاه 3 مرات، الذكاء الاصطناعي بيتقاله يحطها هناك من الأول."
      : "Every time you sign a ceph after moving a dot, the difference is tallied here. Once a landmark has moved the same way three times, the model is told to place it there from the start.",
    biasEmpty: ar ? "مفيش تصحيحات متسجلة لسه." : "No corrections tallied yet.",
    reset: ar ? "تصفير" : "Reset",
    hints: ar ? "اللي الذكاء الاصطناعي بيتقاله دلوقتي:" : "What the model is currently told:",
    reports: ar ? "تقرير" : "reports",
  };

  const hints = landmarkBiasHints(bias);

  return (
    <div className="space-y-5">
      <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4">
        <div className="flex items-center gap-2 font-black text-amber-900">
          <GraduationCap size={18} /> {L.title}
        </div>
        <p className="text-xs font-bold text-amber-800/80 mt-1">{L.hint}</p>
        <div className="mt-3 flex flex-col md:flex-row gap-2">
          <input
            value={text}
            onChange={(e) => setText(e.target.value.slice(0, ORTHO_LESSON_MAX_CHARS))}
            placeholder={L.placeholder}
            className="flex-1 p-2.5 bg-surface border border-line rounded-xl outline-none text-sm font-bold"
            onKeyDown={(e) => {
              if (e.key === "Enter" && text.trim() && !busy) {
                onAdd(text.trim(), kind).then(() => setText(""));
              }
            }}
          />
          <select value={kind} onChange={(e) => setKind(e.target.value as LessonKind)} className="p-2.5 bg-surface border border-line rounded-xl text-sm font-bold">
            {LESSON_KINDS.map((k) => (
              <option key={k} value={k}>
                {L.applies}: {orthoLabel("lessonKind", k, lang)}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={!text.trim() || busy}
            onClick={() => onAdd(text.trim(), kind).then(() => setText(""))}
            className="px-4 py-2.5 rounded-xl bg-amber-500 text-white font-black text-xs uppercase tracking-wider flex items-center justify-center gap-1.5 disabled:opacity-50"
          >
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />} {L.add}
          </button>
        </div>
      </div>

      {lessons.length === 0 ? (
        <p className="text-sm font-bold text-slate-400 text-center py-4">{L.empty}</p>
      ) : (
        <ul className="space-y-1.5">
          {lessons
            .slice()
            .reverse()
            .map((l) => (
              <li key={l.id} className={`flex items-start gap-3 rounded-xl border px-3 py-2.5 ${l.active ? "border-line bg-surface" : "border-line bg-surface-subtle opacity-60"}`}>
                <button type="button" onClick={() => onToggle(l.id, !l.active)} disabled={busy} className={`shrink-0 mt-0.5 w-9 h-5 rounded-full relative transition-colors ${l.active ? "bg-emerald-500" : "bg-slate-300"}`} title={l.active ? L.on : L.off}>
                  <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${l.active ? "start-4" : "start-0.5"}`} />
                </button>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-slate-700">{l.text}</p>
                  <p className="text-[10px] font-bold text-slate-400 mt-0.5">
                    {orthoLabel("lessonKind", l.kind, lang)} · {l.source === "correction" ? L.fromReview : L.manual} · {l.createdByName}
                    {l.createdAt ? ` · ${l.createdAt.slice(0, 10)}` : ""}
                  </p>
                </div>
                <button type="button" onClick={() => onDelete(l.id)} disabled={busy} className="shrink-0 p-1.5 rounded-md text-slate-400 hover:text-rose-600 hover:bg-rose-50">
                  <Trash2 size={14} />
                </button>
              </li>
            ))}
        </ul>
      )}

      <div className="bg-surface rounded-2xl border border-line">
        <button type="button" onClick={() => setShowNorms((s) => !s)} className="w-full text-start px-4 py-3 font-black text-sm text-ink flex items-center justify-between">
          {L.norms}
          <span className="text-slate-400">{showNorms ? "▾" : "▸"}</span>
        </button>
        {showNorms && (
          <div className="px-4 pb-4 space-y-3">
            <p className="text-[11px] font-bold text-slate-400">{L.normsHint}</p>
            <table className="w-full text-xs">
              <thead>
                <tr className="text-[9px] uppercase tracking-widest text-slate-400">
                  <th className="text-start py-1 font-black">{ar ? "القياس" : "Measurement"}</th>
                  <th className="text-end py-1 font-black">{L.default}</th>
                  <th className="text-end py-1 font-black">{L.mean}</th>
                  <th className="text-end py-1 font-black">{L.sd}</th>
                </tr>
              </thead>
              <tbody>
                {CEPH_MEASUREMENTS.map((m) => (
                  <tr key={m.id} className="border-t border-line/60">
                    <td className="py-1 font-bold text-slate-700">
                      {ar ? m.ar : m.en} <span className="text-slate-400 font-medium">({m.unit})</span>
                    </td>
                    <td className="py-1 text-end text-slate-400 font-bold tabular-nums">{m.norm ? `${m.norm.mean} ± ${m.norm.sd}` : "—"}</td>
                    <td className="py-1 text-end">
                      <input type="number" step="0.5" value={normDraft[m.id]?.mean ?? ""} onChange={(e) => setNormDraft((d) => ({ ...d, [m.id]: { ...(d[m.id] || { mean: "", sd: "" }), mean: e.target.value } }))} className="w-16 p-1 bg-surface-subtle border border-line rounded-md text-end font-bold" />
                    </td>
                    <td className="py-1 text-end">
                      <input type="number" step="0.5" value={normDraft[m.id]?.sd ?? ""} onChange={(e) => setNormDraft((d) => ({ ...d, [m.id]: { ...(d[m.id] || { mean: "", sd: "" }), sd: e.target.value } }))} className="w-14 p-1 bg-surface-subtle border border-line rounded-md text-end font-bold" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button
              type="button"
              disabled={!normsDirty || busy}
              onClick={() => {
                const out: CephNormOverrides = {};
                for (const m of CEPH_MEASUREMENTS) {
                  const d = normDraft[m.id];
                  if (!d) continue;
                  const mean = Number(d.mean);
                  const sd = Number(d.sd);
                  if (d.mean.trim() !== "" && d.sd.trim() !== "" && Number.isFinite(mean) && Number.isFinite(sd) && sd > 0) out[m.id] = { mean, sd };
                }
                onSaveNorms(out);
              }}
              className="px-4 py-2 rounded-xl bg-emerald-600 text-white font-black text-xs uppercase tracking-wider flex items-center gap-1.5 disabled:bg-slate-100 disabled:text-slate-400"
            >
              {busy ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} {L.saveNorms}
            </button>
          </div>
        )}
      </div>

      <div className="bg-surface rounded-2xl border border-line p-4 space-y-2">
        <div className="flex items-center justify-between">
          <div className="font-black text-sm text-ink">
            {L.bias} {biasReports > 0 && <span className="text-slate-400 font-bold">· {biasReports} {L.reports}</span>}
          </div>
          {Object.keys(bias).length > 0 && (
            <button type="button" disabled={busy} onClick={onResetBias} className="text-xs font-bold text-slate-400 hover:text-rose-600 flex items-center gap-1">
              <RotateCcw size={12} /> {L.reset}
            </button>
          )}
        </div>
        <p className="text-[11px] font-bold text-slate-400">{L.biasHint}</p>
        {Object.keys(bias).length === 0 ? (
          <p className="text-xs font-bold text-slate-400">{L.biasEmpty}</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {CEPH_LANDMARKS.filter((l) => bias[l.id]).map((l) => {
              const s = bias[l.id]!;
              return (
                <span key={l.id} className="px-2 py-1 rounded-lg bg-surface-subtle border border-line text-[11px] font-bold text-slate-600 tabular-nums">
                  {l.id}: n={s.n}, Δx {Math.round(s.sumDx / s.n)}, Δy {Math.round(s.sumDy / s.n)}
                </span>
              );
            })}
          </div>
        )}
        {hints.length > 0 && (
          <div className="text-xs font-medium text-slate-600 bg-purple-50 rounded-xl px-3 py-2">
            <div className="font-black text-purple-800 mb-1">{L.hints}</div>
            <ul className="list-disc ps-4 space-y-0.5">{hints.map((h) => <li key={h}>{h}</li>)}</ul>
          </div>
        )}
      </div>
    </div>
  );
}
