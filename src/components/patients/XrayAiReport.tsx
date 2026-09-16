"use client";

import React, { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { onSnapshot, query, where } from "firebase/firestore";
import { AlertTriangle, Loader2, Lock, MessageCircle, ScanLine, Sparkles, X, ChevronRight, GitCompareArrows } from "lucide-react";
import { auth } from "@/lib/firebase";
import { getClinicCollection } from "@/lib/db-utils";
import { useClinic } from "@/context/ClinicContext";
import { useUI } from "@/context/UIContext";
import { featureInfo, isUnlocked, SUPPORT_WHATSAPP } from "@/lib/featureCatalog";
import { XRAY_DEEP_MULTIPLIER, XRAY_MAX_IMAGES, XRAY_REPORT_CREDITS, XRAY_REPORTS_COLLECTION, worstSeverity, type XrayReport } from "@/lib/xrayReport";
import type { MediaItem } from "./PatientMediaGallery";
import { XrayReportView, SEVERITY_TONE, label, errMessage, type Lang, type SavedXrayReport } from "./XrayReportView";

export type { SavedXrayReport, Lang } from "./XrayReportView";
export { XrayReportView, AnnotatedImage, renderAnnotatedJpeg, downloadXrayReportPdf } from "./XrayReportView";

/**
 * AI radiograph reading, as it appears in the patient's X-Rays & Photos tab.
 *
 * Three pieces: the dialog that runs a reading over the pictures the dentist picked, the report
 * view (shared by a fresh result and a saved one), and the list of past reports for this patient.
 * The list is a live query on `xray_reports`; the report itself is only ever written by the
 * server route, so this file has no Firestore writes at all — a delete goes through the recycle
 * bin like every other patient record.
 */

/** True once on the client, false during server rendering — without a setState-in-effect. */
const noSubscribe = () => () => {};
export const useMounted = () => useSyncExternalStore(noSubscribe, () => true, () => false);

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
  compareByDefault,
}: {
  patientId: string;
  patientName: string;
  items: MediaItem[];
  language: Lang;
  onClose: () => void;
  /** Opened from "Compare over time": the checkbox starts ticked. */
  compareByDefault?: boolean;
}) {
  const { clinicId, clinic } = useClinic();
  const { showToast } = useUI();
  const unlocked = useXrayFeature();
  const ar = language === "ar";
  const [note, setNote] = useState("");
  const [deep, setDeep] = useState(false);
  const [compare, setCompare] = useState(compareByDefault === true);
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
          compare: compare && chosen.length === 2,
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
            compare: compare && chosen.length === 2,
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

      {chosen.length === 2 && (
        <label className="flex items-start gap-3 rounded-xl border border-line bg-surface-subtle p-3 cursor-pointer">
          <input type="checkbox" checked={compare} onChange={(e) => setCompare(e.target.checked)} className="mt-1 accent-[var(--accent)]" />
          <span className="min-w-0">
            <span className="block text-sm font-black text-ink inline-flex items-center gap-1.5">
              <GitCompareArrows size={14} /> {ar ? "مقارنة زمنية" : "Compare over time"}
            </span>
            <span className="block text-xs text-ink-body mt-0.5">
              {ar
                ? "الصورتين لنفس المنطقة في تاريخين مختلفين: التقرير هيقول إيه اللي اتغير — هل الآفة بتخف بعد العلاج، هل العظم بيتراجع. بيترتبوا بتاريخ الرفع، الأقدم الأول."
                : "Two pictures of the same area on different dates: the report says what changed — is the lesion healing after treatment, is the bone loss progressing. Ordered by upload date, older first."}
            </span>
          </span>
        </label>
      )}

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
// Past reports for this patient
// ----------------------------------------------------------------------------------------------

export type XrayReportsState = {
  reports: SavedXrayReport[];
  /** Report ids per picture, newest first — so a card or the lightbox can say "this one has a report". */
  byMedia: Map<string, SavedXrayReport[]>;
  /** The listener's error, shown rather than swallowed: a blank panel over a permission error is a bug nobody can report. */
  error: string | null;
  loaded: boolean;
};

/** Live list of this patient's reports. One subscription, shared by the panel, the cards and the lightbox. */
export function useXrayReports(patientId: string): XrayReportsState {
  const { clinicId } = useClinic();
  const [reports, setReports] = useState<SavedXrayReport[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!clinicId || !patientId) return;
    let q;
    try {
      // No orderBy: that would need a composite index for every clinic. Sorted in the browser.
      q = query(getClinicCollection(XRAY_REPORTS_COLLECTION), where("patientId", "==", patientId));
    } catch (e) {
      // Deferred: a synchronous setState inside an effect is what the hooks lint forbids, and the
      // only thing that throws here is "no clinic selected", which a re-render does not fix anyway.
      const message = e instanceof Error ? e.message : String(e);
      const t = setTimeout(() => setError(message), 0);
      return () => clearTimeout(t);
    }
    return onSnapshot(
      q,
      (snap) => {
        const list = snap.docs
          .map((d) => ({ id: d.id, ...(d.data() as Omit<SavedXrayReport, "id">) }))
          .filter((r) => r.report && typeof r.report.summary === "string");
        list.sort((a, b) => (b.createdAt?.toDate?.()?.getTime() || 0) - (a.createdAt?.toDate?.()?.getTime() || 0));
        setReports(list);
        setError(null);
        setLoaded(true);
      },
      (e) => {
        setError(e instanceof Error ? e.message : String(e));
        setLoaded(true);
      }
    );
  }, [clinicId, patientId]);

  const byMedia = useMemo(() => {
    const m = new Map<string, SavedXrayReport[]>();
    for (const r of reports) {
      const ids = Array.isArray((r as any).mediaIds) ? ((r as any).mediaIds as string[]) : (r.media || []).map((x) => x.id);
      for (const id of ids) m.set(id, [...(m.get(id) || []), r]);
    }
    return m;
  }, [reports]);

  return { reports, byMedia, error, loaded };
}

/** A saved report in its dialog — what the lightbox, a card badge and the panel all open. */
export function XrayReportDialog({ report, language, onClose }: { report: SavedXrayReport; language: Lang; onClose: () => void }) {
  const { clinic } = useClinic();
  const ar = language === "ar";
  return (
    <Shell onClose={onClose} ar={ar} title={ar ? "تقرير قراءة الأشعة" : "X-ray reading report"} wide>
      <XrayReportView saved={report} language={language} clinicName={clinic?.name} onDeleted={onClose} />
    </Shell>
  );
}

export function XrayReportsSection({
  patientId,
  language,
  state,
}: {
  patientId: string;
  language: Lang;
  /** From useXrayReports(patientId). The gallery owns it so the cards and the lightbox share it. */
  state: XrayReportsState;
}) {
  const ar = language === "ar";
  const unlocked = useXrayFeature();
  const [openId, setOpenId] = useState<string | null>(null);
  const sorted = state.reports;
  // Derived, not copied: the dialog always shows the live document, and closes by itself if the
  // report was deleted elsewhere.
  const open = openId ? sorted.find((r) => r.id === openId) || null : null;
  const setOpen = (r: SavedXrayReport | null) => setOpenId(r ? r.id : null);

  // Nothing to say to a clinic without the add-on: the padlocked button explains itself.
  if (sorted.length === 0 && !state.error && unlocked !== true) return null;

  return (
    <div className="bg-surface rounded-2xl border border-slate-200/80 p-4 sm:p-5" data-tour="xray-ai-reports">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-8 h-8 rounded-xl bg-ink-slab text-white grid place-items-center">
          <ScanLine size={16} />
        </div>
        <h4 className="text-sm font-black text-ink">{ar ? "تقارير قراءة الأشعة" : "AI x-ray reports"}</h4>
        <span className="text-[10px] font-black bg-slate-100 text-slate-600 rounded-full px-2 py-0.5">{sorted.length}</span>
      </div>
      {state.error && (
        <p className="mb-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700">
          {ar ? "تعذّر تحميل التقارير: " : "Could not load the reports: "}
          {state.error}
        </p>
      )}
      {sorted.length === 0 && !state.error && (
        <p className="text-xs text-ink-muted leading-relaxed">
          {ar
            ? "مفيش تقارير لسه. افتح أي أشعة ودوس «قراءة الأشعة بالذكاء الاصطناعي» — التقرير بيتحفظ هنا وعلى الصورة نفسها."
            : "No reports yet. Open any x-ray and press “Read this x-ray with AI” — the report is saved here and on the picture itself."}
        </p>
      )}
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

      {open && <XrayReportDialog report={open} language={language} onClose={() => setOpen(null)} />}
    </div>
  );
}

// ----------------------------------------------------------------------------------------------
// Bits
// ----------------------------------------------------------------------------------------------

function Shell({ title, ar, onClose, children, wide }: { title: string; ar: boolean; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  // Rendered through a portal: the dashboard's <main> is a stacking context, and a fixed dialog
  // drawn inline inside it sits under the black band with its head cut off (see the note on
  // <main> in the dashboard layout). document.body is the only ancestor that outranks nothing.
  const mounted = useMounted();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  if (!mounted) return null;
  return createPortal(
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
    </div>,
    document.body
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

