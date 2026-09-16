"use client";

import React, { useEffect, useMemo, useState } from "react";
import { onSnapshot, query, where } from "firebase/firestore";
import {
  AlertTriangle,
  ClipboardCopy,
  FileDown,
  Loader2,
  Lock,
  MessageCircle,
  ScanLine,
  Sparkles,
  Trash2,
  X,
  ChevronRight,
} from "lucide-react";
import { auth } from "@/lib/firebase";
import { getClinicCollection } from "@/lib/db-utils";
import { useClinic } from "@/context/ClinicContext";
import { useUI } from "@/context/UIContext";
import { deleteRecord, RecycleBinError } from "@/lib/recycleBinApi";
import { featureInfo, isUnlocked, SUPPORT_WHATSAPP } from "@/lib/featureCatalog";
import {
  XRAY_DEEP_MULTIPLIER,
  XRAY_LABELS,
  XRAY_MAX_IMAGES,
  XRAY_REPORT_CREDITS,
  XRAY_REPORTS_COLLECTION,
  xrayDisclaimer,
  xrayReportToText,
  worstSeverity,
  type XrayReport,
  type XraySeverity,
} from "@/lib/xrayReport";
import type { MediaItem } from "./PatientMediaGallery";

/**
 * AI radiograph reading, as it appears in the patient's X-Rays & Photos tab.
 *
 * Three pieces: the dialog that runs a reading over the pictures the dentist picked, the report
 * view (shared by a fresh result and a saved one), and the list of past reports for this patient.
 * The list is a live query on `xray_reports`; the report itself is only ever written by the
 * server route, so this file has no Firestore writes at all — a delete goes through the recycle
 * bin like every other patient record.
 */

type Lang = "ar" | "en";

const errMessage = (e: unknown, lang: Lang) =>
  e instanceof Error && e.message ? e.message : lang === "ar" ? "حصل خطأ. جرّب تاني." : "Something went wrong. Please try again.";

export interface SavedXrayReport {
  id: string;
  patientId: string;
  patientName?: string;
  media?: { id: string; url: string; category?: string; filename?: string }[];
  language?: Lang;
  mode?: "deep" | "standard";
  note?: string;
  report: XrayReport;
  credits?: number;
  createdByName?: string;
  createdAt?: { toDate?: () => Date } | null;
}

const SEVERITY_TONE: Record<XraySeverity, string> = {
  normal: "bg-emerald-50 text-emerald-700 border-emerald-200",
  mild: "bg-slate-100 text-slate-700 border-slate-200",
  moderate: "bg-amber-50 text-amber-800 border-amber-200",
  severe: "bg-orange-50 text-orange-800 border-orange-200",
  urgent: "bg-rose-50 text-rose-700 border-rose-200",
};

const label = (group: keyof typeof XRAY_LABELS, value: string, lang: Lang) => {
  const table = XRAY_LABELS[group] as Record<string, { en: string; ar: string }>;
  return (table[value] || { en: value, ar: value })[lang];
};

/** Whether this clinic can run readings. Null until the clinic document has arrived. */
export function useXrayFeature(): boolean | null {
  const { clinic } = useClinic();
  if (!clinic) return null;
  return isUnlocked(clinic, "aiXray");
}

// ----------------------------------------------------------------------------------------------
// The "Read with AI" button, in its locked and unlocked forms
// ----------------------------------------------------------------------------------------------

export function XrayReadButton({
  count,
  language,
  onClick,
  compact,
  className = "",
}: {
  count: number;
  language: Lang;
  onClick: () => void;
  compact?: boolean;
  className?: string;
}) {
  const unlocked = useXrayFeature();
  const ar = language === "ar";
  const tooMany = count > XRAY_MAX_IMAGES;
  const disabled = count === 0 || tooMany;
  const title = tooMany
    ? ar
      ? `اختار ${XRAY_MAX_IMAGES} صور كحد أقصى`
      : `Pick at most ${XRAY_MAX_IMAGES} images`
    : ar
      ? "قراءة الأشعة بالذكاء الاصطناعي"
      : "Read the x-rays with AI";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      data-tour="xray-ai-read"
      className={`inline-flex items-center gap-1.5 rounded-xl px-3.5 py-1.5 text-xs font-black transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
        unlocked === false
          ? "bg-white/10 text-white hover:bg-white/20"
          : "bg-accent text-ink hover:bg-accent-strong shadow-md"
      } ${className}`}
    >
      {unlocked === false ? <Lock size={14} /> : <ScanLine size={15} />}
      <span className={compact ? "hidden sm:inline" : ""}>{ar ? "قراءة بالذكاء الاصطناعي" : "Read with AI"}</span>
    </button>
  );
}

// ----------------------------------------------------------------------------------------------
// The reading dialog
// ----------------------------------------------------------------------------------------------

export function XrayReadModal({
  patientId,
  patientName,
  items,
  language,
  onClose,
}: {
  patientId: string;
  patientName: string;
  items: MediaItem[];
  language: Lang;
  onClose: () => void;
}) {
  const { clinicId, clinic } = useClinic();
  const { showToast } = useUI();
  const unlocked = useXrayFeature();
  const ar = language === "ar";
  const [note, setNote] = useState("");
  const [deep, setDeep] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ reportId: string; report: XrayReport; credits: number } | null>(null);

  const credits = XRAY_REPORT_CREDITS * (deep ? XRAY_DEEP_MULTIPLIER : 1);
  const chosen = items.slice(0, XRAY_MAX_IMAGES);

  const run = async () => {
    const u = auth.currentUser;
    if (!u || !clinicId) return;
    setBusy(true);
    setError(null);
    try {
      const token = await u.getIdToken();
      const res = await fetch("/api/ai/xray-report", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          clinicId,
          patientId,
          mediaIds: chosen.map((m) => m.id),
          language,
          note: note.trim() || undefined,
          mode: deep ? "deep" : "standard",
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        throw new Error(String(data?.error || (ar ? "فشلت القراءة" : "The reading failed")));
      }
      setResult({ reportId: data.reportId, report: data.report, credits: data.credits });
      showToast(ar ? `تم — خُصم ${data.credits} رصيد` : `Done — ${data.credits} credits used`, "success");
    } catch (e) {
      setError(errMessage(e, language));
    } finally {
      setBusy(false);
    }
  };

  if (unlocked === false) {
    return (
      <Shell onClose={onClose} ar={ar} title={ar ? "قراءة الأشعة بالذكاء الاصطناعي" : "AI X-ray Reading"}>
        <LockedNote language={language} />
      </Shell>
    );
  }

  if (result) {
    return (
      <Shell
        onClose={onClose}
        ar={ar}
        title={ar ? "تقرير قراءة الأشعة" : "X-ray reading report"}
        wide
      >
        <XrayReportView
          saved={{
            id: result.reportId,
            patientId,
            patientName,
            media: chosen.map((m) => ({ id: m.id, url: m.url, category: m.category, filename: m.filename })),
            language,
            mode: deep ? "deep" : "standard",
            note,
            report: result.report,
            credits: result.credits,
            createdAt: null,
          }}
          language={language}
          clinicName={clinic?.name}
          onDeleted={onClose}
        />
      </Shell>
    );
  }

  return (
    <Shell onClose={onClose} ar={ar} title={ar ? "قراءة الأشعة بالذكاء الاصطناعي" : "AI X-ray Reading"}>
      <p className="text-sm text-ink-body leading-relaxed">
        {ar
          ? "الذكاء الاصطناعي هيقرأ الصور المختارة ويكتب تقرير أشعة منظم: نوع الصورة وجودتها، ملخص، النتائج لكل سن، العظم والآفات، والخطوات التالية. التقرير مساعدة للطبيب وليس تشخيصاً."
          : "The AI reads the chosen images and writes a structured radiographic report: image type and quality, a summary, per-tooth findings, bone and pathology, and next steps. It is decision support for the dentist, not a diagnosis."}
      </p>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        {chosen.map((m) => (
          <div key={m.id} className="relative aspect-video rounded-xl overflow-hidden bg-slate-900 border border-slate-200">
            <img src={m.url} alt={m.filename || ""} className="w-full h-full object-cover" />
            <span className="absolute bottom-1.5 start-1.5 bg-slate-950/80 text-white text-[10px] font-black px-2 py-0.5 rounded-md">
              {m.category || "X-Ray"}
            </span>
          </div>
        ))}
      </div>
      {items.length > XRAY_MAX_IMAGES && (
        <p className="text-xs font-bold text-amber-700 flex items-center gap-1.5">
          <AlertTriangle size={14} />
          {ar ? `هيتقرأ أول ${XRAY_MAX_IMAGES} صور بس.` : `Only the first ${XRAY_MAX_IMAGES} images will be read.`}
        </p>
      )}

      <label className="block">
        <span className="text-[11px] font-black uppercase tracking-wider text-ink-muted">
          {ar ? "سؤالك للقارئ (اختياري)" : "Your question for the reader (optional)"}
        </span>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value.slice(0, 500))}
          rows={2}
          placeholder={ar ? "مثال: المريض بيشتكي من ألم في الفك السفلي يمين" : "e.g. patient complains of pain lower right"}
          className="mt-1.5 w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent"
        />
      </label>

      <label className="flex items-start gap-3 rounded-xl border border-line bg-surface-subtle p-3 cursor-pointer">
        <input type="checkbox" checked={deep} onChange={(e) => setDeep(e.target.checked)} className="mt-1 accent-[var(--accent)]" />
        <span className="min-w-0">
          <span className="block text-sm font-black text-ink">
            {ar ? "قراءة عميقة" : "Deep read"}{" "}
            <span className="text-xs font-bold text-ink-muted">
              ({ar ? `${XRAY_REPORT_CREDITS * XRAY_DEEP_MULTIPLIER} رصيد` : `${XRAY_REPORT_CREDITS * XRAY_DEEP_MULTIPLIER} credits`})
            </span>
          </span>
          <span className="block text-xs text-ink-body mt-0.5">
            {ar
              ? "النموذج الأكبر، يفحص كل سن في الصورة ويذكر النتائج العرضية. للحالات المعقدة أو البانوراما."
              : "The larger model, considers every tooth in view and lists incidental findings. For complex cases or panoramics."}
          </span>
        </span>
      </label>

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700 flex items-start gap-2">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="flex items-center justify-between gap-3 pt-1">
        <span className="text-xs font-bold text-ink-muted">
          {ar ? `التكلفة: ${credits} رصيد ذكاء اصطناعي` : `Cost: ${credits} AI credits`}
        </span>
        <button
          type="button"
          onClick={run}
          disabled={busy || chosen.length === 0 || unlocked === null}
          className="inline-flex items-center gap-2 rounded-xl bg-ink-slab px-5 py-2.5 text-sm font-black text-white hover:bg-black transition-colors disabled:opacity-50"
        >
          {busy ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
          {busy ? (ar ? "بيقرأ..." : "Reading...") : ar ? "اقرأ الآن" : "Read now"}
        </button>
      </div>
    </Shell>
  );
}

// ----------------------------------------------------------------------------------------------
// One report, rendered
// ----------------------------------------------------------------------------------------------

export function XrayReportView({
  saved,
  language,
  clinicName,
  onDeleted,
}: {
  saved: SavedXrayReport;
  language: Lang;
  clinicName?: string;
  onDeleted?: () => void;
}) {
  const { clinicId } = useClinic();
  const { showToast, confirm } = useUI();
  const ar = language === "ar";
  const r = saved.report;
  const [pdfBusy, setPdfBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const worst = worstSeverity(r);
  const when = saved.createdAt?.toDate ? saved.createdAt.toDate() : null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(xrayReportToText(r, language));
      showToast(ar ? "تم نسخ التقرير" : "Report copied", "success");
    } catch {
      showToast(ar ? "تعذّر النسخ" : "Could not copy", "error");
    }
  };

  const pdf = async () => {
    setPdfBusy(true);
    try {
      await downloadXrayReportPdf(saved, language, clinicName);
    } catch (e) {
      showToast(errMessage(e, language), "error");
    } finally {
      setPdfBusy(false);
    }
  };

  const remove = async () => {
    if (!clinicId) return;
    const ok = await confirm(ar ? "حذف التقرير؟ هيتنقل إلى المحذوفات مؤخراً." : "Delete this report? It moves to Recently Deleted.");
    if (!ok) return;
    setDeleting(true);
    try {
      await deleteRecord(clinicId, XRAY_REPORTS_COLLECTION, saved.id);
      showToast(ar ? "تم نقل التقرير إلى المحذوفات" : "Report moved to Recently Deleted", "success");
      onDeleted?.();
    } catch (e) {
      showToast(e instanceof RecycleBinError ? e.message : errMessage(e, language), "error");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Header strip */}
      <div className="flex flex-wrap items-center gap-2 text-xs font-bold">
        <span className="rounded-lg bg-ink-slab text-white px-2.5 py-1">{label("imageType", r.imageType, language)}</span>
        <span className={`rounded-lg border px-2.5 py-1 ${r.quality === "poor" ? SEVERITY_TONE.severe : r.quality === "acceptable" ? SEVERITY_TONE.moderate : SEVERITY_TONE.normal}`}>
          {ar ? "الجودة" : "Quality"}: {label("quality", r.quality, language)}
        </span>
        <span className={`rounded-lg border px-2.5 py-1 ${SEVERITY_TONE[worst]}`}>
          {ar ? "أعلى خطورة" : "Highest severity"}: {label("severity", worst, language)}
        </span>
        {saved.mode === "deep" && (
          <span className="rounded-lg border border-violet-200 bg-violet-50 text-violet-800 px-2.5 py-1">{ar ? "قراءة عميقة" : "Deep read"}</span>
        )}
        <span className="ms-auto text-ink-muted font-medium">
          {[when ? when.toLocaleString(ar ? "ar-EG" : "en-GB") : ar ? "الآن" : "Just now", saved.createdByName].filter(Boolean).join(" · ")}
        </span>
      </div>

      {/* The pictures that were read */}
      {saved.media && saved.media.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {saved.media.map((m) => (
            <a key={m.id} href={m.url} target="_blank" rel="noreferrer" className="relative h-20 w-32 shrink-0 rounded-lg overflow-hidden bg-slate-900 border border-slate-200">
              <img src={m.url} alt={m.filename || ""} className="w-full h-full object-cover" />
            </a>
          ))}
        </div>
      )}

      {r.qualityNotes && (
        <p className="text-xs text-ink-body bg-surface-subtle rounded-xl px-3.5 py-2.5 border border-line">
          <span className="font-black">{ar ? "ملاحظات الجودة: " : "Quality notes: "}</span>
          {r.qualityNotes}
        </p>
      )}

      <Section title={ar ? "الملخص" : "Summary"}>
        <p className="text-sm leading-relaxed text-ink whitespace-pre-line">{r.summary}</p>
      </Section>

      {saved.note && (
        <p className="text-xs text-ink-muted">
          <span className="font-black">{ar ? "سؤال الطبيب: " : "Dentist's question: "}</span>
          {saved.note}
        </p>
      )}

      {r.teeth.length > 0 && (
        <Section title={ar ? "النتائج لكل سن" : "Findings per tooth"}>
          <div className="overflow-x-auto rounded-xl border border-line">
            <table className="w-full text-sm">
              <thead className="bg-surface-subtle text-[11px] uppercase tracking-wider text-ink-muted">
                <tr>
                  <th className="px-3 py-2 text-start w-16">{ar ? "السن" : "Tooth"}</th>
                  <th className="px-3 py-2 text-start">{ar ? "النتيجة" : "Finding"}</th>
                  <th className="px-3 py-2 text-start w-28">{ar ? "الخطورة" : "Severity"}</th>
                  <th className="px-3 py-2 text-start w-24">{ar ? "الثقة" : "Confidence"}</th>
                </tr>
              </thead>
              <tbody>
                {r.teeth.map((t, i) => (
                  <tr key={`${t.tooth}-${i}`} className="border-t border-line align-top">
                    <td className="px-3 py-2 font-display font-black tabular-nums text-ink">{t.tooth}</td>
                    <td className="px-3 py-2 text-ink-body leading-relaxed">{t.finding}</td>
                    <td className="px-3 py-2">
                      <span className={`inline-block rounded-md border px-2 py-0.5 text-[11px] font-black ${SEVERITY_TONE[t.severity]}`}>
                        {label("severity", t.severity, language)}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs font-bold text-ink-muted">{label("confidence", t.confidence, language)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      <Bullets title={ar ? "نتائج عامة" : "General findings"} items={r.general} />
      <Bullets title={ar ? "نتائج عرضية" : "Incidental findings"} items={r.incidental} />
      <Bullets title={ar ? "اختلافات عن مخطط الأسنان" : "Differences from the chart"} items={r.chartDiscrepancies} tone="amber" />
      <Bullets title={ar ? "التوصيات" : "Recommendations"} items={r.recommendations} tone="accent" />

      {r.limitations && (
        <Section title={ar ? "حدود القراءة" : "Limitations"}>
          <p className="text-sm text-ink-body leading-relaxed">{r.limitations}</p>
        </Section>
      )}

      <p className="text-xs font-bold text-ink-muted border-t border-dashed border-line pt-3 flex items-start gap-2">
        <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-600" />
        {xrayDisclaimer(language)}
      </p>

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <button type="button" onClick={pdf} disabled={pdfBusy} className="inline-flex items-center gap-1.5 rounded-xl bg-ink-slab px-4 py-2 text-xs font-black text-white hover:bg-black disabled:opacity-50">
          {pdfBusy ? <Loader2 size={14} className="animate-spin" /> : <FileDown size={14} />}
          {ar ? "تحميل PDF" : "Download PDF"}
        </button>
        <button type="button" onClick={copy} className="inline-flex items-center gap-1.5 rounded-xl border border-line bg-surface px-4 py-2 text-xs font-black text-ink hover:bg-surface-subtle">
          <ClipboardCopy size={14} />
          {ar ? "نسخ النص" : "Copy text"}
        </button>
        <button type="button" onClick={remove} disabled={deleting} className="ms-auto inline-flex items-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-black text-rose-700 hover:bg-rose-100 disabled:opacity-50">
          {deleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
          {ar ? "حذف" : "Delete"}
        </button>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------------------------
// Past reports for this patient
// ----------------------------------------------------------------------------------------------

export function XrayReportsSection({ patientId, language }: { patientId: string; language: Lang }) {
  const { clinicId, clinic } = useClinic();
  const ar = language === "ar";
  const [rows, setRows] = useState<SavedXrayReport[]>([]);
  const [open, setOpen] = useState<SavedXrayReport | null>(null);

  useEffect(() => {
    if (!clinicId || !patientId) return;
    // No orderBy: that would need a composite index for every clinic. Sorted in the browser.
    const q = query(getClinicCollection(XRAY_REPORTS_COLLECTION), where("patientId", "==", patientId));
    return onSnapshot(
      q,
      (snap) => {
        const list = snap.docs
          .map((d) => ({ id: d.id, ...(d.data() as Omit<SavedXrayReport, "id">) }))
          .filter((r) => r.report && typeof r.report.summary === "string");
        list.sort((a, b) => (b.createdAt?.toDate?.()?.getTime() || 0) - (a.createdAt?.toDate?.()?.getTime() || 0));
        setRows(list);
        setOpen((cur) => (cur ? list.find((r) => r.id === cur.id) || null : cur));
      },
      () => setRows([])
    );
  }, [clinicId, patientId]);

  const sorted = useMemo(() => rows, [rows]);
  if (sorted.length === 0) return null;

  return (
    <div className="bg-surface rounded-2xl border border-slate-200/80 p-4 sm:p-5" data-tour="xray-ai-reports">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-8 h-8 rounded-xl bg-ink-slab text-white grid place-items-center">
          <ScanLine size={16} />
        </div>
        <h4 className="text-sm font-black text-ink">{ar ? "تقارير قراءة الأشعة" : "AI x-ray reports"}</h4>
        <span className="text-[10px] font-black bg-slate-100 text-slate-600 rounded-full px-2 py-0.5">{sorted.length}</span>
      </div>
      <ul className="divide-y divide-line">
        {sorted.map((r) => {
          const worst = worstSeverity(r.report);
          const when = r.createdAt?.toDate ? r.createdAt.toDate() : null;
          return (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => setOpen(r)}
                className="w-full flex items-center gap-3 py-2.5 text-start hover:bg-surface-subtle rounded-lg px-2 transition-colors"
              >
                {r.media?.[0]?.url ? (
                  <img src={r.media[0].url} alt="" className="h-10 w-14 rounded-md object-cover bg-slate-900 shrink-0" />
                ) : (
                  <div className="h-10 w-14 rounded-md bg-slate-100 shrink-0" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-black text-ink truncate">
                    {label("imageType", r.report.imageType, language)}
                    {r.media && r.media.length > 1 ? ` · ${r.media.length} ${ar ? "صور" : "images"}` : ""}
                  </div>
                  <div className="text-xs text-ink-muted truncate">
                    {[when ? when.toLocaleDateString(ar ? "ar-EG" : "en-GB") : "", r.createdByName, r.report.teeth.length ? `${r.report.teeth.length} ${ar ? "سن" : "teeth"}` : ""]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                </div>
                <span className={`hidden sm:inline-block rounded-md border px-2 py-0.5 text-[11px] font-black ${SEVERITY_TONE[worst]}`}>
                  {label("severity", worst, language)}
                </span>
                <ChevronRight size={16} className={`text-slate-400 ${ar ? "rotate-180" : ""}`} />
              </button>
            </li>
          );
        })}
      </ul>

      {open && (
        <Shell onClose={() => setOpen(null)} ar={ar} title={ar ? "تقرير قراءة الأشعة" : "X-ray reading report"} wide>
          <XrayReportView saved={open} language={language} clinicName={clinic?.name} onDeleted={() => setOpen(null)} />
        </Shell>
      )}
    </div>
  );
}

// ----------------------------------------------------------------------------------------------
// Bits
// ----------------------------------------------------------------------------------------------

function Shell({ title, ar, onClose, children, wide }: { title: string; ar: boolean; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center bg-slate-950/70 backdrop-blur-sm p-0 sm:p-6 animate-in fade-in duration-150" dir={ar ? "rtl" : "ltr"}>
      <div className={`w-full ${wide ? "max-w-3xl" : "max-w-xl"} max-h-[92vh] overflow-hidden rounded-t-3xl sm:rounded-3xl bg-surface shadow-2xl flex flex-col`}>
        <div className="flex items-center justify-between gap-3 bg-ink-slab text-white px-5 py-4">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-white/10 border border-white/15 grid place-items-center">
              <ScanLine size={16} />
            </div>
            <h3 className="font-display text-base font-black tracking-tight">{title}</h3>
          </div>
          <button type="button" onClick={onClose} className="p-2 rounded-xl text-white/70 hover:text-white hover:bg-white/10">
            <X size={20} />
          </button>
        </div>
        <div className="overflow-y-auto p-5 space-y-4">{children}</div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h5 className="text-[11px] font-black uppercase tracking-[0.14em] text-ink-muted mb-1.5">{title}</h5>
      {children}
    </div>
  );
}

function Bullets({ title, items, tone }: { title: string; items: string[]; tone?: "amber" | "accent" }) {
  if (!items.length) return null;
  const dot = tone === "amber" ? "bg-amber-500" : tone === "accent" ? "bg-accent" : "bg-slate-400";
  return (
    <Section title={title}>
      <ul className="space-y-1.5">
        {items.map((it, i) => (
          <li key={i} className="flex items-start gap-2 text-sm text-ink-body leading-relaxed">
            <span className={`mt-2 h-1.5 w-1.5 rounded-full shrink-0 ${dot}`} />
            <span>{it}</span>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function LockedNote({ language }: { language: Lang }) {
  const ar = language === "ar";
  const info = featureInfo("aiXray");
  const message = ar ? `أهلاً، عايز أفعّل "${info.labelAr}" في عيادتي على ألفا.` : `Hi, I would like to activate "${info.labelEn}" for my clinic on Alpha.`;
  const href = `https://wa.me/${SUPPORT_WHATSAPP.replace(/\D/g, "")}?text=${encodeURIComponent(message)}`;
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="grid size-11 place-items-center rounded-2xl bg-surface-subtle border border-line">
          <Lock size={20} className="text-ink" />
        </div>
        <div>
          <p className="text-[11px] font-black uppercase tracking-[0.18em] text-ink-muted">{ar ? "غير مفعّل في اشتراكك" : "Not in your subscription"}</p>
          <h4 className="font-display text-xl font-black text-ink">{ar ? info.labelAr : info.labelEn}</h4>
        </div>
      </div>
      <p className="text-sm text-ink-body leading-relaxed">{ar ? info.descAr : info.descEn}</p>
      <p className="text-sm text-ink-body leading-relaxed">
        {ar
          ? "الخاصية دي إضافة بتتفعّل لكل عيادة على حدة. كلّم فريق ألفا وهنفعّلها لك في نفس اليوم."
          : "This is an add-on switched on per clinic. Write to the Alpha team and it is activated the same day."}
      </p>
      <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-xl bg-accent px-5 py-3 text-sm font-black text-ink-on-accent hover:bg-accent-strong">
        <MessageCircle size={16} />
        {ar ? "كلّمنا على واتساب" : "Contact us on WhatsApp"}
      </a>
    </div>
  );
}

// ----------------------------------------------------------------------------------------------
// PDF
// ----------------------------------------------------------------------------------------------

const esc = (s: string) => (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * The report as an A4 PDF, through the same iframe + html2canvas path the diagnosis report uses.
 * Text only: the pictures are remote Storage URLs, which that renderer times out on and drops
 * (see diagnosisReportPdf.ts), so the PDF names the images and leaves them in the patient's file.
 */
export async function downloadXrayReportPdf(saved: SavedXrayReport, language: Lang, clinicName?: string): Promise<void> {
  const ar = language === "ar";
  const r = saved.report;
  const when = saved.createdAt?.toDate ? saved.createdAt.toDate() : new Date();
  const L = (g: keyof typeof XRAY_LABELS, v: string) => esc(label(g, v, language));
  const align = ar ? "right" : "left";

  const bullets = (title: string, items: string[]) =>
    items.length
      ? `<h3 style="font-size:13px;font-weight:800;color:#334155;margin:18px 0 6px;border-bottom:2px solid #e2e8f0;padding-bottom:4px;">${esc(title)}</h3>
         <ul style="margin:0;padding-${ar ? "right" : "left"}:18px;font-size:12px;line-height:1.6;color:#1e293b;">${items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>`
      : "";

  const { htmlToPdfBlob, buildReportHtmlBase } = await import("@/components/reports/reportPdfHtmlUtils");
  const { getClinicLogo, clinicLogoImgHtml } = await import("@/lib/clinicLogo");
  const logo = await getClinicLogo().catch(() => undefined);
  const logoImg = logo ? clinicLogoImgHtml(logo, { maxHeight: 40, maxWidth: 96 }) : "";

  const html = `
    <div id="xray-report-container" style="font-family:'Tajawal',system-ui,sans-serif;padding:32px;color:#0f172a;direction:${ar ? "rtl" : "ltr"};text-align:${align};">
      <div style="display:flex;align-items:center;justify-content:space-between;background:#0f172a;color:#fff;padding:16px 20px;border-radius:14px;margin-bottom:22px;">
        <div style="display:flex;align-items:center;gap:14px;">
          ${logoImg ? `<div style="background:#fff;border-radius:8px;padding:6px;display:flex;align-items:center;">${logoImg}</div>` : ""}
          <div>
            <div style="font-size:11px;letter-spacing:.14em;text-transform:uppercase;opacity:.6;">${esc(clinicName || "")}</div>
            <div style="font-size:20px;font-weight:900;">${ar ? "تقرير قراءة الأشعة" : "Radiographic Reading Report"}</div>
          </div>
        </div>
        <div style="font-size:11px;opacity:.75;text-align:${ar ? "left" : "right"};">
          <div>${esc(saved.patientName || "")}</div>
          <div>${esc(when.toLocaleString(ar ? "ar-EG" : "en-GB"))}</div>
          ${saved.createdByName ? `<div>${esc(saved.createdByName)}</div>` : ""}
        </div>
      </div>

      <table style="width:100%;font-size:12px;border-collapse:collapse;margin-bottom:14px;">
        <tr>
          <td style="padding:6px 0;color:#64748b;width:32%;">${ar ? "نوع الصورة" : "Image type"}</td><td style="padding:6px 0;font-weight:700;">${L("imageType", r.imageType)}</td>
        </tr>
        <tr>
          <td style="padding:6px 0;color:#64748b;">${ar ? "جودة الصورة" : "Image quality"}</td><td style="padding:6px 0;font-weight:700;">${L("quality", r.quality)}${r.qualityNotes ? ` — <span style="font-weight:500;">${esc(r.qualityNotes)}</span>` : ""}</td>
        </tr>
        <tr>
          <td style="padding:6px 0;color:#64748b;">${ar ? "الصور المقروءة" : "Images read"}</td><td style="padding:6px 0;">${esc((saved.media || []).map((m) => m.filename || m.category || m.id).join(", ") || String(saved.media?.length || 0))}</td>
        </tr>
        ${saved.note ? `<tr><td style="padding:6px 0;color:#64748b;">${ar ? "سؤال الطبيب" : "Dentist's question"}</td><td style="padding:6px 0;">${esc(saved.note)}</td></tr>` : ""}
      </table>

      <h3 style="font-size:13px;font-weight:800;color:#334155;margin:14px 0 6px;border-bottom:2px solid #e2e8f0;padding-bottom:4px;">${ar ? "الملخص" : "Summary"}</h3>
      <p style="font-size:12.5px;line-height:1.7;margin:0;white-space:pre-line;">${esc(r.summary)}</p>

      ${
        r.teeth.length
          ? `<h3 style="font-size:13px;font-weight:800;color:#334155;margin:18px 0 8px;border-bottom:2px solid #e2e8f0;padding-bottom:4px;">${ar ? "النتائج لكل سن" : "Findings per tooth"}</h3>
        <table style="width:100%;border-collapse:collapse;font-size:11.5px;">
          <thead><tr style="background:#f8fafc;color:#475569;">
            <th style="padding:8px;text-align:center;border-bottom:2px solid #e2e8f0;width:44px;">${ar ? "السن" : "Tooth"}</th>
            <th style="padding:8px;text-align:${align};border-bottom:2px solid #e2e8f0;">${ar ? "النتيجة" : "Finding"}</th>
            <th style="padding:8px;text-align:${align};border-bottom:2px solid #e2e8f0;width:80px;">${ar ? "الخطورة" : "Severity"}</th>
            <th style="padding:8px;text-align:${align};border-bottom:2px solid #e2e8f0;width:80px;">${ar ? "الثقة" : "Confidence"}</th>
          </tr></thead>
          <tbody>${r.teeth
            .map(
              (t) => `<tr>
              <td style="padding:8px;text-align:center;border-bottom:1px solid #e2e8f0;font-weight:900;">${esc(t.tooth)}</td>
              <td style="padding:8px;border-bottom:1px solid #e2e8f0;line-height:1.5;">${esc(t.finding)}</td>
              <td style="padding:8px;border-bottom:1px solid #e2e8f0;font-weight:700;">${L("severity", t.severity)}</td>
              <td style="padding:8px;border-bottom:1px solid #e2e8f0;color:#475569;">${L("confidence", t.confidence)}</td>
            </tr>`
            )
            .join("")}</tbody>
        </table>`
          : ""
      }

      ${bullets(ar ? "نتائج عامة" : "General findings", r.general)}
      ${bullets(ar ? "نتائج عرضية" : "Incidental findings", r.incidental)}
      ${bullets(ar ? "اختلافات عن مخطط الأسنان" : "Differences from the chart", r.chartDiscrepancies)}
      ${bullets(ar ? "التوصيات" : "Recommendations", r.recommendations)}
      ${r.limitations ? `<h3 style="font-size:13px;font-weight:800;color:#334155;margin:18px 0 6px;border-bottom:2px solid #e2e8f0;padding-bottom:4px;">${ar ? "حدود القراءة" : "Limitations"}</h3><p style="font-size:12px;line-height:1.6;margin:0;">${esc(r.limitations)}</p>` : ""}

      <p style="margin-top:26px;padding-top:12px;border-top:1px dashed #cbd5e1;font-size:11px;color:#64748b;line-height:1.6;">${esc(xrayDisclaimer(language))}</p>
      <div style="margin-top:28px;display:flex;justify-content:${ar ? "flex-start" : "flex-end"};font-size:11px;color:#475569;">
        <div style="border-top:1px solid #94a3b8;padding-top:6px;min-width:200px;text-align:center;">${ar ? "توقيع الطبيب المعالج" : "Treating dentist's signature"}</div>
      </div>
    </div>`;

  const fullHtml = buildReportHtmlBase(ar ? "تقرير قراءة الأشعة" : "Radiographic Reading Report", language, html);
  const blob = await htmlToPdfBlob(fullHtml, "xray-report-container");
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const safeName = (saved.patientName || "patient").replace(/[^\w؀-ۿ -]/g, "").trim() || "patient";
  a.download = `Xray_Report_${safeName}_${when.toISOString().slice(0, 10)}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
