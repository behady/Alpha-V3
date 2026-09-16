"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { getBlob, ref as storageRef } from "firebase/storage";
import {
  AlertTriangle,
  Check,
  ClipboardCopy,
  FileDown,
  FileText,
  Loader2,
  MessageCircle,
  Pencil,
  PenLine,
  PlusSquare,
  RotateCcw,
  SlidersHorizontal,
  Trash2,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { auth, storage } from "@/lib/firebase";
import { useClinic } from "@/context/ClinicContext";
import { useUI } from "@/context/UIContext";
import { deleteRecord, RecycleBinError } from "@/lib/recycleBinApi";
import { isUnlocked } from "@/lib/featureCatalog";
import { handleWhatsAppApiResult } from "@/lib/whatsappManual";
import { DIAGNOSIS_OPTIONS, findOption } from "@/lib/diagnosisCatalog";
import {
  effectiveFinding,
  reviewProgress,
  SEVERITY_COLORS,
  XRAY_LABELS,
  XRAY_REPORTS_COLLECTION,
  xrayDisclaimer,
  xrayReportToText,
  worstSeverity,
  type XrayBox,
  type XrayReport,
  type XrayReview,
  type XrayReviewPatch,
  type XraySeverity,
  type XrayToothFinding,
  type XrayVerdict,
} from "@/lib/xrayReport";

/**
 * One AI x-ray report, as the dentist works on it.
 *
 * The model's text is never edited in place. Everything the dentist does — confirm, reject,
 * reword, redraw an outline, chart a finding, sign — goes through /api/ai/xray-report/review and
 * lands under `review`, and this view shows the two layered: the model's row, the dentist's
 * verdict on it. That is what makes a report a clinical document rather than a chatbot answer,
 * and it is also the only honest way to learn how accurate the reader is on this clinic's
 * patients.
 */

export type Lang = "ar" | "en";

export const errMessage = (e: unknown, lang: Lang) =>
  e instanceof Error && e.message ? e.message : lang === "ar" ? "حصل خطأ. جرّب تاني." : "Something went wrong. Please try again.";

export interface SavedXrayReport {
  id: string;
  patientId: string;
  patientName?: string;
  media?: { id: string; url: string; category?: string; filename?: string; takenAt?: string }[];
  language?: Lang;
  mode?: "deep" | "standard";
  compare?: boolean;
  note?: string;
  report: XrayReport;
  review?: XrayReview | null;
  signed?: boolean;
  credits?: number;
  createdByName?: string;
  createdAt?: { toDate?: () => Date } | null;
  sentToPatientAt?: { toDate?: () => Date } | null;
}

export const SEVERITY_TONE: Record<XraySeverity, string> = {
  normal: "bg-emerald-50 text-emerald-700 border-emerald-200",
  mild: "bg-slate-100 text-slate-700 border-slate-200",
  moderate: "bg-amber-50 text-amber-800 border-amber-200",
  severe: "bg-orange-50 text-orange-800 border-orange-200",
  urgent: "bg-rose-50 text-rose-700 border-rose-200",
};

export const label = (group: keyof typeof XRAY_LABELS, value: string, lang: Lang) => {
  const table = XRAY_LABELS[group] as Record<string, { en: string; ar: string }>;
  return (table[value] || { en: value, ar: value })[lang];
};

const esc = (s: string) => (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// ----------------------------------------------------------------------------------------------
// The picture with its outlines: zoom, pan, brightness/contrast, and redrawing an outline
// ----------------------------------------------------------------------------------------------

/**
 * Boxes are percentages of the rendered image (box/10), so they follow the picture at any zoom.
 * Zoom and pan are one CSS transform on the layer that holds both picture and outlines, so they
 * can never drift apart. Brightness and contrast are a filter on the picture alone.
 *
 * Drawing: when `drawFor` names a row, a drag on the picture draws a new outline for it and calls
 * `onDrawn` with the box on the 0–1000 grid. The drag is measured against the transformed
 * layer's own bounding box, which is why zooming in first gives a more precise outline.
 */
export function AnnotatedImage({
  src,
  alt,
  findings,
  activeTooth,
  onHover,
  caption,
  tools = true,
  drawFor,
  onDrawn,
  onCancelDraw,
  language = "en",
}: {
  src: string;
  alt?: string;
  findings: (XrayToothFinding & { index?: number })[];
  activeTooth?: string | null;
  onHover?: (tooth: string | null) => void;
  caption?: string;
  tools?: boolean;
  /** The row (by index) whose outline is being redrawn, or null. */
  drawFor?: number | null;
  onDrawn?: (index: number, box: XrayBox) => void;
  onCancelDraw?: () => void;
  language?: Lang;
}) {
  const ar = language === "ar";
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [brightness, setBrightness] = useState(100);
  const [contrast, setContrast] = useState(100);
  const [showSliders, setShowSliders] = useState(false);
  const layerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startX: number; startY: number; panX: number; panY: number } | null>(null);
  const drawRef = useRef<{ x0: number; y0: number } | null>(null);
  const [draft, setDraft] = useState<XrayBox | null>(null);
  const [panning, setPanning] = useState(false);
  const drawing = drawFor !== null && drawFor !== undefined;

  const reset = () => {
    setScale(1);
    setPan({ x: 0, y: 0 });
  };
  const zoomBy = (f: number) => setScale((s) => Math.min(5, Math.max(1, +(s * f).toFixed(2))));

  // Percent position of a pointer inside the (transformed) picture layer.
  const pct = (e: React.MouseEvent): { x: number; y: number } | null => {
    const el = layerRef.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * 1000;
    const y = ((e.clientY - r.top) / r.height) * 1000;
    return { x: Math.max(0, Math.min(1000, x)), y: Math.max(0, Math.min(1000, y)) };
  };

  const onMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    if (drawing) {
      const p = pct(e);
      if (!p) return;
      drawRef.current = { x0: p.x, y0: p.y };
      setDraft([p.y, p.x, p.y, p.x]);
      e.preventDefault();
      return;
    }
    if (scale > 1) {
      dragRef.current = { startX: e.clientX, startY: e.clientY, panX: pan.x, panY: pan.y };
      setPanning(true);
      e.preventDefault();
    }
  };
  const onMouseMove = (e: React.MouseEvent) => {
    if (drawing && drawRef.current) {
      const p = pct(e);
      if (!p) return;
      const { x0, y0 } = drawRef.current;
      setDraft([Math.min(y0, p.y), Math.min(x0, p.x), Math.max(y0, p.y), Math.max(x0, p.x)]);
      return;
    }
    if (dragRef.current) {
      setPan({ x: dragRef.current.panX + (e.clientX - dragRef.current.startX), y: dragRef.current.panY + (e.clientY - dragRef.current.startY) });
    }
  };
  const onMouseUp = () => {
    if (drawing && drawRef.current && draft) {
      drawRef.current = null;
      const [ymin, xmin, ymax, xmax] = draft.map(Math.round) as XrayBox;
      setDraft(null);
      if (ymax - ymin >= 10 && xmax - xmin >= 10 && drawFor !== null && drawFor !== undefined) onDrawn?.(drawFor, [ymin, xmin, ymax, xmax]);
      return;
    }
    dragRef.current = null;
    setPanning(false);
  };
  const onWheel = (e: React.WheelEvent) => {
    if (!tools) return;
    if (!e.ctrlKey && scale === 1 && e.deltaY > 0) return; // let the page scroll until the user zooms in
    e.preventDefault();
    zoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15);
  };

  return (
    <figure className="m-0">
      <div
        className={`relative w-full rounded-xl overflow-hidden bg-slate-950 border border-slate-200 leading-[0] select-none ${
          drawing ? "cursor-crosshair ring-2 ring-accent" : scale > 1 ? "cursor-grab active:cursor-grabbing" : ""
        }`}
        onWheel={onWheel}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
      >
        <div
          ref={layerRef}
          className="relative w-full"
          style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`, transformOrigin: "0 0", transition: panning ? "none" : "transform 120ms" }}
        >
          <img
            src={src}
            alt={alt || ""}
            className="w-full h-auto block pointer-events-none"
            draggable={false}
            style={{ filter: `brightness(${brightness}%) contrast(${contrast}%)` }}
          />
          {findings.map((t, i) => {
            if (!t.box) return null;
            const [ymin, xmin, ymax, xmax] = t.box;
            const color = SEVERITY_COLORS[t.severity];
            const active = activeTooth === t.tooth;
            const dim = activeTooth !== null && activeTooth !== undefined && !active;
            const beingRedrawn = drawing && t.index === drawFor;
            return (
              <div
                key={`${t.tooth}-${i}`}
                onMouseEnter={() => onHover?.(t.tooth)}
                onMouseLeave={() => onHover?.(null)}
                title={`${t.tooth}: ${t.finding}`}
                className="absolute rounded-md transition-all duration-150"
                style={{
                  top: `${ymin / 10}%`,
                  left: `${xmin / 10}%`,
                  width: `${(xmax - xmin) / 10}%`,
                  height: `${(ymax - ymin) / 10}%`,
                  border: `${active ? 3 : 2}px ${beingRedrawn ? "dashed" : "solid"} ${color}`,
                  boxShadow: active ? `0 0 0 2px rgba(255,255,255,.55), 0 0 18px ${color}` : `0 0 0 1px rgba(0,0,0,.55)`,
                  background: active ? `${color}22` : "transparent",
                  opacity: dim || beingRedrawn ? 0.35 : 1,
                  pointerEvents: drawing ? "none" : "auto",
                }}
              >
                <span
                  className="absolute -top-2.5 start-0 -translate-y-full rounded-md px-1.5 py-0.5 text-[10px] font-black leading-none shadow"
                  style={{ background: color, color: t.severity === "mild" ? "#0f172a" : "#fff" }}
                >
                  {t.tooth}
                </span>
              </div>
            );
          })}
          {draft && (
            <div
              className="absolute rounded-md border-2 border-dashed border-white pointer-events-none"
              style={{ top: `${draft[0] / 10}%`, left: `${draft[1] / 10}%`, width: `${(draft[3] - draft[1]) / 10}%`, height: `${(draft[2] - draft[0]) / 10}%`, background: "rgba(255,255,255,.15)" }}
            />
          )}
        </div>

        {tools && (
          <div className="absolute top-2 end-2 flex items-center gap-1 leading-none" onMouseDown={(e) => e.stopPropagation()}>
            <IconBtn onClick={() => zoomBy(1.25)} title={ar ? "تكبير" : "Zoom in"}><ZoomIn size={14} /></IconBtn>
            <IconBtn onClick={() => zoomBy(1 / 1.25)} title={ar ? "تصغير" : "Zoom out"}><ZoomOut size={14} /></IconBtn>
            <IconBtn onClick={reset} title={ar ? "إعادة الضبط" : "Reset view"}><RotateCcw size={14} /></IconBtn>
            <IconBtn onClick={() => setShowSliders((v) => !v)} title={ar ? "الإضاءة والتباين" : "Brightness & contrast"} active={showSliders}><SlidersHorizontal size={14} /></IconBtn>
          </div>
        )}
        {tools && showSliders && (
          <div className="absolute bottom-2 start-2 end-2 flex flex-wrap items-center gap-3 rounded-lg bg-slate-950/80 px-3 py-2 text-[11px] font-bold text-white leading-none" onMouseDown={(e) => e.stopPropagation()}>
            <label className="flex items-center gap-2">
              {ar ? "إضاءة" : "Brightness"}
              <input type="range" min={40} max={200} value={brightness} onChange={(e) => setBrightness(Number(e.target.value))} className="w-24 accent-[var(--accent)]" />
            </label>
            <label className="flex items-center gap-2">
              {ar ? "تباين" : "Contrast"}
              <input type="range" min={40} max={250} value={contrast} onChange={(e) => setContrast(Number(e.target.value))} className="w-24 accent-[var(--accent)]" />
            </label>
            <button type="button" onClick={() => { setBrightness(100); setContrast(100); }} className="ms-auto underline">{ar ? "افتراضي" : "Default"}</button>
          </div>
        )}
        {drawing && (
          <div className="absolute top-2 start-2 flex items-center gap-2 rounded-lg bg-accent px-3 py-1.5 text-[11px] font-black text-ink leading-none" onMouseDown={(e) => e.stopPropagation()}>
            <PenLine size={12} />
            {ar ? "ارسم الإطار الصحيح بالسحب على الصورة" : "Drag on the picture to draw the correct outline"}
            <button type="button" onClick={onCancelDraw} className="ms-1 rounded bg-ink/10 p-0.5" title={ar ? "إلغاء" : "Cancel"}><X size={12} /></button>
          </div>
        )}
      </div>
      {caption && <figcaption className="mt-1 text-[11px] font-bold text-ink-muted">{caption}</figcaption>}
    </figure>
  );
}

function IconBtn({ children, onClick, title, active }: { children: React.ReactNode; onClick: () => void; title: string; active?: boolean }) {
  return (
    <button type="button" onClick={onClick} title={title} className={`rounded-md p-1.5 text-white transition-colors ${active ? "bg-accent text-ink" : "bg-slate-950/70 hover:bg-slate-950"}`}>
      {children}
    </button>
  );
}

export function SeverityLegend({ language }: { language: Lang }) {
  const order: XraySeverity[] = ["normal", "mild", "moderate", "severe", "urgent"];
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] font-bold text-ink-muted">
      {order.map((sv) => (
        <span key={sv} className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: SEVERITY_COLORS[sv] }} />
          {label("severity", sv, language)}
        </span>
      ))}
    </div>
  );
}

// ----------------------------------------------------------------------------------------------
// The report
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
  const { clinicId, clinic } = useClinic();
  const { showToast, confirm } = useUI();
  const ar = language === "ar";
  const r = saved.report;

  // The review as it stands: the live document's, with unsaved local changes layered on until
  // the next save answers. A fresh reading arrives with no review at all.
  const [review, setReview] = useState<XrayReview | null>(saved.review || null);
  useEffect(() => setReviewFromDoc(saved.review || null), [saved.review]);
  function setReviewFromDoc(next: XrayReview | null) {
    setReview(next);
  }
  const [saving, setSaving] = useState<string | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [activeTooth, setActiveTooth] = useState<string | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const [editText, setEditText] = useState("");
  const [drawFor, setDrawFor] = useState<number | null>(null);
  const [chartPick, setChartPick] = useState<number | null>(null);
  const [patientText, setPatientText] = useState(saved.review?.patientSummary ?? r.patientSummary ?? "");
  useEffect(() => setPatientText(saved.review?.patientSummary ?? r.patientSummary ?? ""), [saved.review?.patientSummary, r.patientSummary]);

  const worst = worstSeverity(r);
  const when = saved.createdAt?.toDate ? saved.createdAt.toDate() : null;
  const rows = useMemo(() => r.teeth.map((_, i) => ({ ...effectiveFinding(r, review, i), index: i })), [r, review]);
  const hasBoxes = rows.some((t) => t.box);
  const progress = reviewProgress(r, review);
  const signed = review?.signed === true;
  const canSendToPatient = signed && isUnlocked(clinic, "clinicalPdfs");

  // ---- the one door: /api/ai/xray-report/review -------------------------------------------------
  const post = async (patch: XrayReviewPatch, busyKey: string): Promise<boolean> => {
    const u = auth.currentUser;
    if (!u || !clinicId) return false;
    setSaving(busyKey);
    try {
      const token = await u.getIdToken();
      const res = await fetch("/api/ai/xray-report/review", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ clinicId, reportId: saved.id, ...patch }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) throw new Error(String(data?.error || (ar ? "تعذّر الحفظ" : "Could not save")));
      setReview(data.review as XrayReview);
      if (typeof data.charted === "number" && data.charted > 0) {
        showToast(ar ? `اتضاف ${data.charted} على مخطط الأسنان` : `${data.charted} added to the teeth chart`, "success");
      }
      return true;
    } catch (e) {
      showToast(errMessage(e, language), "error");
      return false;
    } finally {
      setSaving(null);
    }
  };

  const verdict = (i: number, v: XrayVerdict) => {
    if (v === "edited") {
      setEditing(i);
      setEditText(rows[i].finding);
      return;
    }
    void post({ verdicts: { [String(i)]: v } }, `v${i}`);
  };
  const saveEdit = async (i: number) => {
    const text = editText.trim();
    if (!text) return;
    const ok = await post({ verdicts: { [String(i)]: "edited" }, edits: { [String(i)]: text } }, `v${i}`);
    if (ok) setEditing(null);
  };
  const drawn = (i: number, box: XrayBox) => {
    setDrawFor(null);
    void post({ boxes: { [String(i)]: box } }, `b${i}`);
  };
  const removeBox = (i: number) => void post({ boxes: { [String(i)]: null } }, `b${i}`);
  const chart = (i: number, statusId: string) => {
    setChartPick(null);
    void post({ chart: { [String(i)]: statusId }, verdicts: review?.verdicts[String(i)] ? {} : { [String(i)]: "confirmed" } }, `c${i}`);
  };
  const confirmAll = () => {
    const verdicts: Record<string, XrayVerdict> = {};
    r.teeth.forEach((_, i) => {
      if (!review?.verdicts[String(i)]) verdicts[String(i)] = "confirmed";
    });
    void post({ verdicts }, "all");
  };
  const sign = async () => {
    if (!progress.complete && r.teeth.length > 0) {
      const ok = await confirm(
        ar
          ? `لسه ${progress.total - progress.decided} نتيجة من غير قرار. توقيع التقرير هيعتبرها مؤكدة. تكمل؟`
          : `${progress.total - progress.decided} finding(s) have no verdict yet. Signing counts them as confirmed. Continue?`
      );
      if (!ok) return;
    }
    const verdicts: Record<string, XrayVerdict> = {};
    r.teeth.forEach((_, i) => {
      if (!review?.verdicts[String(i)]) verdicts[String(i)] = "confirmed";
    });
    const patientSummary = patientText.trim() !== (r.patientSummary || "").trim() ? patientText.trim() : undefined;
    const ok = await post({ verdicts, sign: true, ...(patientSummary !== undefined ? { patientSummary } : {}) }, "sign");
    if (ok) showToast(ar ? "تم توقيع التقرير" : "Report signed", "success");
  };
  const savePatientText = () => void post({ patientSummary: patientText.trim() }, "ptext");

  // ---- outputs --------------------------------------------------------------------------------
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(xrayReportToText(r, language, review));
      showToast(ar ? "تم نسخ التقرير" : "Report copied", "success");
    } catch {
      showToast(ar ? "تعذّر النسخ" : "Could not copy", "error");
    }
  };
  const pdf = async () => {
    setPdfBusy(true);
    try {
      await downloadXrayReportPdf({ ...saved, review }, language, clinicName);
    } catch (e) {
      showToast(errMessage(e, language), "error");
    } finally {
      setPdfBusy(false);
    }
  };
  const sendToPatient = async () => {
    const u = auth.currentUser;
    if (!u || !clinicId) return;
    const ok = await confirm(
      ar
        ? "هيتبعت للمريض على واتساب: الصورة بإطاراتها + الشرح المبسّط اللي فوق. متأكد؟"
        : "This sends the patient, on WhatsApp, the outlined picture and the plain-words explanation above. Continue?"
    );
    if (!ok) return;
    setSending(true);
    try {
      const blob = await buildPatientExplainerPdf({ ...saved, review }, patientText.trim() || r.patientSummary, language, clinicName);
      const dataUrl: string = await new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(String(fr.result));
        fr.onerror = () => reject(new Error("read failed"));
        fr.readAsDataURL(blob);
      });
      const comma = dataUrl.indexOf(",");
      const pdfBase64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
      const token = await u.getIdToken();
      const res = await fetch("/api/whatsapp/send-xray-explainer-pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ clinicId, patientId: saved.patientId, reportId: saved.id, pdfBase64 }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) throw new Error(typeof data?.error === "string" ? data.error : ar ? "فشل الإرسال" : "Send failed");
      if (data.manual) {
        handleWhatsAppApiResult(data, saved.patientName);
        showToast(ar ? "افتح واتساب من الرسالة عشان تبعت — المريض هيستلم رابط الشرح" : "Open WhatsApp from the prompt — the patient will receive a link to the explanation", "info");
      } else {
        showToast(ar ? "اتبعت للمريض على واتساب" : "Sent to the patient on WhatsApp", "success");
      }
    } catch (e) {
      showToast(errMessage(e, language), "error");
    } finally {
      setSending(false);
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

  const verdictTone: Record<XrayVerdict, string> = {
    confirmed: "bg-emerald-50 text-emerald-700 border-emerald-200",
    rejected: "bg-rose-50 text-rose-700 border-rose-200 line-through",
    edited: "bg-sky-50 text-sky-800 border-sky-200",
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
        {saved.mode === "deep" && <span className="rounded-lg border border-violet-200 bg-violet-50 text-violet-800 px-2.5 py-1">{ar ? "قراءة عميقة" : "Deep read"}</span>}
        {saved.compare && <span className="rounded-lg border border-sky-200 bg-sky-50 text-sky-800 px-2.5 py-1">{ar ? "مقارنة زمنية" : "Over time"}</span>}
        {signed ? (
          <span className="rounded-lg border border-emerald-300 bg-emerald-600 text-white px-2.5 py-1 inline-flex items-center gap-1">
            <Check size={12} /> {ar ? "موقّع" : "Signed"} · {review?.signedByName}
          </span>
        ) : (
          <span className="rounded-lg border border-amber-200 bg-amber-50 text-amber-800 px-2.5 py-1">
            {ar ? `في انتظار التأكيد · ${progress.decided}/${progress.total}` : `Awaiting confirmation · ${progress.decided}/${progress.total}`}
          </span>
        )}
        <span className="ms-auto text-ink-muted font-medium">
          {[when ? when.toLocaleString(ar ? "ar-EG" : "en-GB") : ar ? "الآن" : "Just now", saved.createdByName].filter(Boolean).join(" · ")}
        </span>
      </div>

      {/* The pictures, with every localised finding outlined in its severity colour */}
      {saved.media && saved.media.length > 0 && (
        <div className="space-y-3">
          <div className={saved.media.length > 1 ? "grid grid-cols-1 sm:grid-cols-2 gap-3" : ""}>
            {saved.media.map((m, i) => (
              <AnnotatedImage
                key={m.id}
                src={m.url}
                alt={m.filename || ""}
                findings={rows.filter((t) => t.box && (t.image || 1) === i + 1 && t.verdict !== "rejected")}
                activeTooth={activeTooth}
                onHover={setActiveTooth}
                language={language}
                caption={
                  saved.media!.length > 1
                    ? `${i + 1} · ${m.category || ""}${m.takenAt ? ` · ${new Date(m.takenAt).toLocaleDateString(ar ? "ar-EG" : "en-GB")}` : ""}${saved.compare ? (i === 0 ? (ar ? " · الأقدم" : " · older") : ar ? " · الأحدث" : " · newer") : ""}`
                    : undefined
                }
                drawFor={drawFor !== null && (rows[drawFor]?.image || 1) === i + 1 ? drawFor : null}
                onDrawn={drawn}
                onCancelDraw={() => setDrawFor(null)}
              />
            ))}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            {hasBoxes ? (
              <SeverityLegend language={language} />
            ) : (
              <p className="text-[11px] text-ink-muted">{ar ? "القارئ ما قدرش يحدد مكان النتائج على الصورة دي." : "The reader could not place its findings on this picture."}</p>
            )}
            <p className="text-[11px] text-ink-muted">{ar ? "عجلة الماوس للتكبير، اسحب للتحريك" : "Scroll to zoom, drag to pan"}</p>
          </div>
        </div>
      )}

      {/* Over time */}
      {r.comparison && (
        <Section title={ar ? "المقارنة مع الصورة الأقدم" : "Compared with the older picture"}>
          <div className="rounded-xl border border-sky-200 bg-sky-50/60 p-3.5 space-y-2">
            <span
              className={`inline-block rounded-md border px-2 py-0.5 text-[11px] font-black ${
                r.comparison.verdict === "improved" ? SEVERITY_TONE.normal : r.comparison.verdict === "worse" ? SEVERITY_TONE.urgent : r.comparison.verdict === "stable" ? SEVERITY_TONE.mild : SEVERITY_TONE.moderate
              }`}
            >
              {label("comparison", r.comparison.verdict, language)}
            </span>
            {r.comparison.changes.length > 0 && (
              <ul className="space-y-1.5">
                {r.comparison.changes.map((c, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-ink-body leading-relaxed">
                    <span className="mt-2 h-1.5 w-1.5 rounded-full shrink-0 bg-sky-500" />
                    <span>{c}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Section>
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

      {/* Findings, each with the dentist's verdict */}
      {r.teeth.length > 0 && (
        <Section
          title={ar ? "النتائج لكل سن" : "Findings per tooth"}
          right={
            !signed && progress.decided < progress.total ? (
              <button type="button" onClick={confirmAll} disabled={saving !== null} className="text-[11px] font-black text-emerald-700 hover:underline disabled:opacity-50">
                {ar ? "تأكيد الباقي كله" : "Confirm all remaining"}
              </button>
            ) : undefined
          }
        >
          <div className="overflow-x-auto rounded-xl border border-line">
            <table className="w-full text-sm">
              <thead className="bg-surface-subtle text-[11px] uppercase tracking-wider text-ink-muted">
                <tr>
                  <th className="px-3 py-2 text-start w-16">{ar ? "السن" : "Tooth"}</th>
                  <th className="px-3 py-2 text-start">{ar ? "النتيجة" : "Finding"}</th>
                  <th className="px-3 py-2 text-start w-24">{ar ? "الخطورة" : "Severity"}</th>
                  <th className="px-3 py-2 text-start w-56">{ar ? "قرار الطبيب" : "Dentist's verdict"}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((t) => {
                  const i = t.index;
                  const k = String(i);
                  const busy = saving === `v${i}` || saving === `b${i}` || saving === `c${i}`;
                  const chartedAs = review?.charted[k];
                  const canChart = /^\d{2}$/.test(t.tooth) && t.verdict !== "rejected";
                  return (
                    <tr
                      key={`${t.tooth}-${i}`}
                      onMouseEnter={() => setActiveTooth(t.tooth)}
                      onMouseLeave={() => setActiveTooth(null)}
                      className={`border-t border-line align-top transition-colors ${activeTooth === t.tooth ? "bg-surface-subtle" : ""} ${t.verdict === "rejected" ? "opacity-60" : ""}`}
                    >
                      <td className="px-3 py-2 font-display font-black tabular-nums text-ink">
                        <span className="inline-flex items-center gap-1.5">
                          <span className="inline-block h-2.5 w-2.5 rounded-sm shrink-0" style={{ background: SEVERITY_COLORS[t.severity], opacity: t.box ? 1 : 0.25 }} />
                          {t.tooth}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-ink-body leading-relaxed">
                        {editing === i ? (
                          <div className="space-y-1.5">
                            <textarea value={editText} onChange={(e) => setEditText(e.target.value.slice(0, 600))} rows={3} className="w-full rounded-lg border border-line bg-surface px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-accent/20" />
                            <div className="flex gap-2">
                              <button type="button" onClick={() => saveEdit(i)} disabled={busy} className="rounded-lg bg-ink-slab px-3 py-1 text-[11px] font-black text-white disabled:opacity-50">{ar ? "حفظ" : "Save"}</button>
                              <button type="button" onClick={() => setEditing(null)} className="rounded-lg border border-line px-3 py-1 text-[11px] font-black text-ink">{ar ? "إلغاء" : "Cancel"}</button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <span className={t.verdict === "rejected" ? "line-through" : ""}>{t.finding}</span>
                            {t.verdict === "edited" && <span className="ms-1 text-[10px] font-black text-sky-700">({ar ? "معدّل" : "edited"})</span>}
                            {t.category && (
                              <span className="block mt-0.5 text-[10px] font-bold text-ink-muted">
                                {ar ? findOption(t.category)?.labelAr : findOption(t.category)?.labelEn}
                              </span>
                            )}
                            {chartedAs && (
                              <span className="block mt-0.5 text-[10px] font-black text-emerald-700 inline-flex items-center gap-1">
                                <Check size={10} /> {ar ? "على المخطط" : "On the chart"}: {ar ? findOption(chartedAs)?.labelAr : findOption(chartedAs)?.labelEn}
                              </span>
                            )}
                          </>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <span className={`inline-block rounded-md border px-2 py-0.5 text-[11px] font-black ${SEVERITY_TONE[t.severity]}`}>{label("severity", t.severity, language)}</span>
                        <span className="block mt-1 text-[10px] font-bold text-ink-muted">{label("confidence", t.confidence, language)}</span>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap items-center gap-1">
                          {busy ? (
                            <Loader2 size={14} className="animate-spin text-ink-muted" />
                          ) : (
                            <>
                              {t.verdict && (
                                <span className={`rounded-md border px-1.5 py-0.5 text-[10px] font-black ${verdictTone[t.verdict]}`}>{label("verdict", t.verdict, language)}</span>
                              )}
                              {!signed && (
                                <>
                                  <MiniBtn on={t.verdict === "confirmed"} tone="emerald" title={ar ? "صحيح" : "Correct"} onClick={() => verdict(i, "confirmed")}><Check size={13} /></MiniBtn>
                                  <MiniBtn on={t.verdict === "rejected"} tone="rose" title={ar ? "غلط" : "Wrong"} onClick={() => verdict(i, "rejected")}><X size={13} /></MiniBtn>
                                  <MiniBtn on={t.verdict === "edited"} tone="sky" title={ar ? "تعديل الصياغة" : "Reword"} onClick={() => verdict(i, "edited")}><Pencil size={13} /></MiniBtn>
                                  {t.verdict !== "rejected" && (
                                    <MiniBtn on={drawFor === i} tone="amber" title={t.box ? (ar ? "إعادة رسم الإطار" : "Redraw outline") : ar ? "ارسم إطار" : "Draw outline"} onClick={() => setDrawFor(drawFor === i ? null : i)}><PenLine size={13} /></MiniBtn>
                                  )}
                                </>
                              )}
                              {canChart && !chartedAs && (
                                <div className="relative">
                                  <MiniBtn on={chartPick === i} tone="slate" title={ar ? "أضف لمخطط الأسنان" : "Add to teeth chart"} onClick={() => setChartPick(chartPick === i ? null : i)}><PlusSquare size={13} /></MiniBtn>
                                  {chartPick === i && (
                                    <ChartPicker language={language} suggested={t.category} onPick={(id) => chart(i, id)} onClose={() => setChartPick(null)} />
                                  )}
                                </div>
                              )}
                            </>
                          )}
                        </div>
                        {t.box && !signed && review?.boxes[k] && (
                          <button type="button" onClick={() => removeBox(i)} className="mt-1 text-[10px] font-bold text-ink-muted hover:text-rose-700">{ar ? "إزالة الإطار" : "Remove outline"}</button>
                        )}
                      </td>
                    </tr>
                  );
                })}
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

      {/* For the patient */}
      {(r.patientSummary || review?.patientSummary) && (
        <Section title={ar ? "شرح للمريض" : "For the patient"}>
          <div className="rounded-xl border border-line bg-surface-subtle p-3.5 space-y-2">
            <p className="text-[11px] text-ink-muted">
              {ar
                ? "بكلمات بسيطة من غير أرقام أسنان ولا مصطلحات. عدّله لو حابب — مش هيتبعت لحد إلا بعد ما توقّع التقرير."
                : "In plain words, no tooth numbers, no jargon. Edit it if you like — nothing is sent until you sign the report."}
            </p>
            <textarea
              value={patientText}
              onChange={(e) => setPatientText(e.target.value.slice(0, 1200))}
              rows={4}
              disabled={signed}
              className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm leading-relaxed outline-none focus:ring-2 focus:ring-accent/20 disabled:opacity-80"
            />
            <div className="flex flex-wrap items-center gap-2">
              {!signed && patientText.trim() !== (review?.patientSummary ?? r.patientSummary ?? "").trim() && (
                <button type="button" onClick={savePatientText} disabled={saving === "ptext"} className="rounded-lg border border-line bg-surface px-3 py-1.5 text-[11px] font-black text-ink disabled:opacity-50">
                  {saving === "ptext" ? <Loader2 size={12} className="animate-spin inline" /> : ar ? "حفظ الصياغة" : "Save wording"}
                </button>
              )}
              <button
                type="button"
                onClick={sendToPatient}
                disabled={!canSendToPatient || sending}
                title={!signed ? (ar ? "وقّع التقرير الأول" : "Sign the report first") : !isUnlocked(clinic, "clinicalPdfs") ? (ar ? "يحتاج إضافة ملفات PDF على واتساب" : "Needs the Clinical PDFs on WhatsApp add-on") : ""}
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-1.5 text-[11px] font-black text-white hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {sending ? <Loader2 size={12} className="animate-spin" /> : <MessageCircle size={12} />}
                {ar ? "ابعت للمريض على واتساب" : "Send to patient on WhatsApp"}
              </button>
              {saved.sentToPatientAt?.toDate && (
                <span className="text-[10px] font-bold text-emerald-700">{ar ? "اتبعت" : "Sent"} · {saved.sentToPatientAt.toDate().toLocaleString(ar ? "ar-EG" : "en-GB")}</span>
              )}
            </div>
          </div>
        </Section>
      )}

      {/* Sign-off */}
      <div className={`rounded-xl border p-3.5 flex flex-wrap items-center gap-3 ${signed ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}`}>
        {signed ? (
          <p className="text-xs font-bold text-emerald-800 flex items-center gap-2">
            <Check size={14} />
            {ar ? `راجعه وأكده ${review?.signedByName}` : `Reviewed and confirmed by ${review?.signedByName}`}
            {review?.signedAt ? ` · ${new Date(review.signedAt).toLocaleString(ar ? "ar-EG" : "en-GB")}` : ""}
          </p>
        ) : (
          <>
            <p className="text-xs font-bold text-amber-900 flex-1 min-w-[12rem]">
              {ar
                ? "راجع كل نتيجة (صح / غلط / تعديل) وبعدين وقّع. التوقيع هو اللي يخلي التقرير مستند طبي."
                : "Give every finding a verdict (correct / wrong / reword), then sign. The signature is what makes this a clinical document."}
            </p>
            <button type="button" onClick={sign} disabled={saving !== null} className="inline-flex items-center gap-1.5 rounded-xl bg-ink-slab px-4 py-2 text-xs font-black text-white hover:bg-black disabled:opacity-50">
              {saving === "sign" ? <Loader2 size={14} className="animate-spin" /> : <PenLine size={14} />}
              {ar ? "توقيع التقرير" : "Sign report"}
            </button>
          </>
        )}
      </div>

      <p className="text-xs font-bold text-ink-muted border-t border-dashed border-line pt-3 flex items-start gap-2">
        <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-600" />
        {xrayDisclaimer(language)}
      </p>

      {!when && (
        <p className="text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2 flex items-start gap-2">
          <FileText size={14} className="mt-0.5 shrink-0" />
          {ar
            ? "اتحفظ في ملف المريض: هتلاقيه على الصورة نفسها (زرار «التقرير») وفي لوحة «تقارير قراءة الأشعة» أعلى التبويب."
            : "Saved to the patient's file: find it on the picture itself (the “Report” button) and in the “AI x-ray reports” panel at the top of the tab."}
        </p>
      )}

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
// Bits
// ----------------------------------------------------------------------------------------------

function MiniBtn({ children, onClick, title, on, tone }: { children: React.ReactNode; onClick: () => void; title: string; on?: boolean; tone: "emerald" | "rose" | "sky" | "amber" | "slate" }) {
  const tones = {
    emerald: on ? "bg-emerald-600 text-white border-emerald-600" : "hover:bg-emerald-50 hover:text-emerald-700 hover:border-emerald-200",
    rose: on ? "bg-rose-600 text-white border-rose-600" : "hover:bg-rose-50 hover:text-rose-700 hover:border-rose-200",
    sky: on ? "bg-sky-600 text-white border-sky-600" : "hover:bg-sky-50 hover:text-sky-700 hover:border-sky-200",
    amber: on ? "bg-amber-500 text-ink border-amber-500" : "hover:bg-amber-50 hover:text-amber-800 hover:border-amber-200",
    slate: on ? "bg-ink-slab text-white border-ink-slab" : "hover:bg-surface-subtle hover:border-slate-300",
  };
  return (
    <button type="button" onClick={onClick} title={title} className={`rounded-md border border-line bg-surface p-1.5 text-ink-muted transition-colors ${tones[tone]}`}>
      {children}
    </button>
  );
}

/** The catalogue, grouped, with the model's suggestion first. One tap charts the finding. */
function ChartPicker({ language, suggested, onPick, onClose }: { language: Lang; suggested?: string; onPick: (id: string) => void; onClose: () => void }) {
  const ar = language === "ar";
  const [q, setQ] = useState("");
  const options = DIAGNOSIS_OPTIONS.filter((o) => o.id !== "healthy");
  const filtered = q.trim()
    ? options.filter((o) => (ar ? o.labelAr : o.labelEn).toLowerCase().includes(q.trim().toLowerCase()) || o.id.includes(q.trim().toLowerCase()))
    : options;
  const sug = suggested ? findOption(suggested) : undefined;
  return (
    <div className="absolute z-30 end-0 top-full mt-1 w-72 rounded-xl border border-line bg-surface shadow-xl p-2 text-start" onMouseDown={(e) => e.stopPropagation()}>
      <div className="flex items-center gap-2 mb-1.5">
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={ar ? "ابحث في التشخيصات..." : "Search diagnoses..."} className="flex-1 rounded-lg border border-line bg-surface-subtle px-2.5 py-1.5 text-xs outline-none focus:ring-2 focus:ring-accent/20" />
        <button type="button" onClick={onClose} className="p-1 text-ink-muted hover:text-ink"><X size={14} /></button>
      </div>
      {sug && !q && (
        <button type="button" onClick={() => onPick(sug.id)} className="w-full rounded-lg bg-accent px-2.5 py-2 text-start text-xs font-black text-ink mb-1.5">
          {ar ? "اقتراح القارئ: " : "Reader's suggestion: "}
          {ar ? sug.labelAr : sug.labelEn}
        </button>
      )}
      <div className="max-h-56 overflow-y-auto divide-y divide-line">
        {filtered.map((o) => (
          <button key={o.id} type="button" onClick={() => onPick(o.id)} className="w-full px-2.5 py-1.5 text-start text-xs font-bold text-ink hover:bg-surface-subtle">
            {ar ? o.labelAr : o.labelEn}
          </button>
        ))}
        {filtered.length === 0 && <p className="px-2.5 py-2 text-xs text-ink-muted">{ar ? "مفيش نتائج" : "No matches"}</p>}
      </div>
    </div>
  );
}

function Section({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <h5 className="text-[11px] font-black uppercase tracking-[0.14em] text-ink-muted">{title}</h5>
        {right}
      </div>
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

// ----------------------------------------------------------------------------------------------
// PDFs
// ----------------------------------------------------------------------------------------------

/**
 * The picture with its outlines burned in, as a JPEG data URL for the PDF.
 *
 * Fetched through the Storage SDK rather than an <img>: html2canvas cannot rasterise a remote
 * Storage URL (it times out and drops the picture — see diagnosisReportPdf.ts), and a canvas drawn
 * from a cross-origin <img> is tainted. getBlob() goes through the SDK's own authenticated
 * request, and a blob is same-origin, so the canvas can export it.
 */
export async function renderAnnotatedJpeg(url: string, findings: XrayToothFinding[], maxWidth = 1400): Promise<string | null> {
  try {
    const blob = await getBlob(storageRef(storage, url));
    const bitmap = await createImageBitmap(blob);
    const scale = Math.min(1, maxWidth / bitmap.width);
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0, w, h);
    const stroke = Math.max(2, Math.round(w / 300));
    const fontPx = Math.max(12, Math.round(w / 45));
    for (const t of findings) {
      if (!t.box) continue;
      const [ymin, xmin, ymax, xmax] = t.box;
      const x = (xmin / 1000) * w;
      const y = (ymin / 1000) * h;
      const bw = ((xmax - xmin) / 1000) * w;
      const bh = ((ymax - ymin) / 1000) * h;
      const color = SEVERITY_COLORS[t.severity];
      ctx.lineWidth = stroke + 2;
      ctx.strokeStyle = "rgba(0,0,0,.6)";
      ctx.strokeRect(x, y, bw, bh);
      ctx.lineWidth = stroke;
      ctx.strokeStyle = color;
      ctx.strokeRect(x, y, bw, bh);
      ctx.font = `900 ${fontPx}px system-ui, sans-serif`;
      const padX = Math.round(fontPx * 0.4);
      const tw = ctx.measureText(t.tooth).width + padX * 2;
      const th = fontPx * 1.4;
      const ly = y - th - 2 < 0 ? y + 2 : y - th - 2;
      ctx.fillStyle = color;
      ctx.fillRect(x, ly, tw, th);
      ctx.fillStyle = t.severity === "mild" ? "#0f172a" : "#ffffff";
      ctx.textBaseline = "middle";
      ctx.fillText(t.tooth, x + padX, ly + th / 2);
    }
    return canvas.toDataURL("image/jpeg", 0.86);
  } catch {
    return null;
  }
}

async function annotatedPictures(saved: SavedXrayReport): Promise<string[]> {
  const r = saved.report;
  const review = saved.review || null;
  const out: string[] = [];
  for (const [i, m] of (saved.media || []).entries()) {
    const findings = r.teeth.map((_, idx) => effectiveFinding(r, review, idx)).filter((t) => t.box && (t.image || 1) === i + 1 && t.verdict !== "rejected");
    const data = await renderAnnotatedJpeg(m.url, findings);
    if (data) out.push(data);
  }
  return out;
}

const h3 = (t: string) => `<h3 style="font-size:13px;font-weight:800;color:#334155;margin:18px 0 6px;border-bottom:2px solid #e2e8f0;padding-bottom:4px;">${esc(t)}</h3>`;

function headerHtml(saved: SavedXrayReport, title: string, ar: boolean, clinicName: string | undefined, logoImg: string, when: Date) {
  return `<div style="display:flex;align-items:center;justify-content:space-between;background:#0f172a;color:#fff;padding:16px 20px;border-radius:14px;margin-bottom:22px;">
    <div style="display:flex;align-items:center;gap:14px;">
      ${logoImg ? `<div style="background:#fff;border-radius:8px;padding:6px;display:flex;align-items:center;">${logoImg}</div>` : ""}
      <div>
        <div style="font-size:11px;letter-spacing:.14em;text-transform:uppercase;opacity:.6;">${esc(clinicName || "")}</div>
        <div style="font-size:20px;font-weight:900;">${esc(title)}</div>
      </div>
    </div>
    <div style="font-size:11px;opacity:.75;text-align:${ar ? "left" : "right"};">
      <div>${esc(saved.patientName || "")}</div>
      <div>${esc(when.toLocaleString(ar ? "ar-EG" : "en-GB"))}</div>
      ${saved.createdByName ? `<div>${esc(saved.createdByName)}</div>` : ""}
    </div>
  </div>`;
}

/**
 * The clinical report as an A4 PDF: outlined pictures, the dentist's verdicts beside the model's
 * rows, and — once signed — the confirmation stamp above the signature line.
 */
export async function downloadXrayReportPdf(saved: SavedXrayReport, language: Lang, clinicName?: string): Promise<void> {
  const ar = language === "ar";
  const r = saved.report;
  const review = saved.review || null;
  const when = saved.createdAt?.toDate ? saved.createdAt.toDate() : new Date();
  const L = (g: keyof typeof XRAY_LABELS, v: string) => esc(label(g, v, language));
  const align = ar ? "right" : "left";
  const bullets = (title: string, items: string[]) =>
    items.length ? `${h3(title)}<ul style="margin:0;padding-${ar ? "right" : "left"}:18px;font-size:12px;line-height:1.6;color:#1e293b;">${items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>` : "";

  const pictures = await annotatedPictures(saved);
  const legend = (["normal", "mild", "moderate", "severe", "urgent"] as XraySeverity[])
    .map((sv) => `<span style="display:inline-flex;align-items:center;gap:5px;margin-${ar ? "left" : "right"}:14px;"><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${SEVERITY_COLORS[sv]};"></span>${L("severity", sv)}</span>`)
    .join("");
  const picturesHtml = pictures.length
    ? `<div style="display:grid;grid-template-columns:${pictures.length > 1 ? "1fr 1fr" : "1fr"};gap:10px;margin:0 0 8px;">${pictures.map((p) => `<img src="${p}" style="width:100%;height:auto;border-radius:10px;border:1px solid #cbd5e1;display:block;" />`).join("")}</div>
       <div style="font-size:10.5px;color:#475569;margin-bottom:16px;">${legend}</div>`
    : "";

  const { htmlToPdfBlob, buildReportHtmlBase } = await import("@/components/reports/reportPdfHtmlUtils");
  const { getClinicLogo, clinicLogoImgHtml } = await import("@/lib/clinicLogo");
  const logo = await getClinicLogo().catch(() => undefined);
  const logoImg = logo ? clinicLogoImgHtml(logo, { maxHeight: 40, maxWidth: 96 }) : "";

  const rows = r.teeth.map((_, i) => effectiveFinding(r, review, i));
  const stamp = review?.signed
    ? `<div style="margin-top:18px;padding:10px 14px;border:2px solid #10b981;border-radius:10px;background:#ecfdf5;font-size:12px;font-weight:800;color:#065f46;">${ar ? "راجعه وأكده" : "Reviewed and confirmed by"} ${esc(review.signedByName || "")}${review.signedAt ? ` — ${esc(new Date(review.signedAt).toLocaleString(ar ? "ar-EG" : "en-GB"))}` : ""}</div>`
    : `<div style="margin-top:18px;padding:10px 14px;border:2px dashed #f59e0b;border-radius:10px;background:#fffbeb;font-size:12px;font-weight:800;color:#92400e;">${ar ? "لم يُراجع بعد — في انتظار تأكيد الطبيب المعالج" : "Not yet reviewed — awaiting the treating dentist's confirmation"}</div>`;

  const html = `
    <div id="xray-report-container" style="font-family:'Tajawal',system-ui,sans-serif;padding:32px;color:#0f172a;direction:${ar ? "rtl" : "ltr"};text-align:${align};">
      ${headerHtml(saved, ar ? "تقرير قراءة الأشعة" : "Radiographic Reading Report", ar, clinicName, logoImg, when)}
      <table style="width:100%;font-size:12px;border-collapse:collapse;margin-bottom:14px;">
        <tr><td style="padding:6px 0;color:#64748b;width:32%;">${ar ? "نوع الصورة" : "Image type"}</td><td style="padding:6px 0;font-weight:700;">${L("imageType", r.imageType)}</td></tr>
        <tr><td style="padding:6px 0;color:#64748b;">${ar ? "جودة الصورة" : "Image quality"}</td><td style="padding:6px 0;font-weight:700;">${L("quality", r.quality)}${r.qualityNotes ? ` — <span style="font-weight:500;">${esc(r.qualityNotes)}</span>` : ""}</td></tr>
        <tr><td style="padding:6px 0;color:#64748b;">${ar ? "الصور المقروءة" : "Images read"}</td><td style="padding:6px 0;">${esc((saved.media || []).map((m) => m.filename || m.category || m.id).join(", ") || String(saved.media?.length || 0))}</td></tr>
        ${saved.note ? `<tr><td style="padding:6px 0;color:#64748b;">${ar ? "سؤال الطبيب" : "Dentist's question"}</td><td style="padding:6px 0;">${esc(saved.note)}</td></tr>` : ""}
      </table>
      ${picturesHtml}
      ${h3(ar ? "الملخص" : "Summary")}
      <p style="font-size:12.5px;line-height:1.7;margin:0;white-space:pre-line;">${esc(r.summary)}</p>
      ${
        r.comparison
          ? `${h3(ar ? "المقارنة مع الصورة الأقدم" : "Compared with the older picture")}<p style="font-size:12px;font-weight:800;margin:0 0 6px;">${L("comparison", r.comparison.verdict)}</p><ul style="margin:0;padding-${ar ? "right" : "left"}:18px;font-size:12px;line-height:1.6;">${r.comparison.changes.map((c) => `<li>${esc(c)}</li>`).join("")}</ul>`
          : ""
      }
      ${
        rows.length
          ? `${h3(ar ? "النتائج لكل سن" : "Findings per tooth")}
        <table style="width:100%;border-collapse:collapse;font-size:11.5px;">
          <thead><tr style="background:#f8fafc;color:#475569;">
            <th style="padding:8px;text-align:center;border-bottom:2px solid #e2e8f0;width:44px;">${ar ? "السن" : "Tooth"}</th>
            <th style="padding:8px;text-align:${align};border-bottom:2px solid #e2e8f0;">${ar ? "النتيجة" : "Finding"}</th>
            <th style="padding:8px;text-align:${align};border-bottom:2px solid #e2e8f0;width:70px;">${ar ? "الخطورة" : "Severity"}</th>
            <th style="padding:8px;text-align:${align};border-bottom:2px solid #e2e8f0;width:70px;">${ar ? "الثقة" : "Confidence"}</th>
            <th style="padding:8px;text-align:${align};border-bottom:2px solid #e2e8f0;width:70px;">${ar ? "قرار الطبيب" : "Verdict"}</th>
          </tr></thead>
          <tbody>${rows
            .map(
              (t) => `<tr style="${t.verdict === "rejected" ? "color:#94a3b8;text-decoration:line-through;" : ""}">
              <td style="padding:8px;text-align:center;border-bottom:1px solid #e2e8f0;font-weight:900;"><span style="display:inline-block;width:9px;height:9px;border-radius:2px;background:${SEVERITY_COLORS[t.severity]};margin-${ar ? "left" : "right"}:5px;vertical-align:middle;"></span>${esc(t.tooth)}</td>
              <td style="padding:8px;border-bottom:1px solid #e2e8f0;line-height:1.5;">${esc(t.finding)}${t.category ? `<div style="font-size:10px;color:#64748b;">${esc((ar ? findOption(t.category)?.labelAr : findOption(t.category)?.labelEn) || "")}</div>` : ""}</td>
              <td style="padding:8px;border-bottom:1px solid #e2e8f0;font-weight:700;">${L("severity", t.severity)}</td>
              <td style="padding:8px;border-bottom:1px solid #e2e8f0;color:#475569;">${L("confidence", t.confidence)}</td>
              <td style="padding:8px;border-bottom:1px solid #e2e8f0;font-weight:800;color:${t.verdict === "confirmed" ? "#047857" : t.verdict === "rejected" ? "#be123c" : t.verdict === "edited" ? "#0369a1" : "#94a3b8"};">${t.verdict ? L("verdict", t.verdict) : "—"}</td>
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
      ${r.limitations ? `${h3(ar ? "حدود القراءة" : "Limitations")}<p style="font-size:12px;line-height:1.6;margin:0;">${esc(r.limitations)}</p>` : ""}
      ${stamp}
      <p style="margin-top:18px;padding-top:12px;border-top:1px dashed #cbd5e1;font-size:11px;color:#64748b;line-height:1.6;">${esc(xrayDisclaimer(language))}</p>
      <div style="margin-top:28px;display:flex;justify-content:${ar ? "flex-start" : "flex-end"};font-size:11px;color:#475569;">
        <div style="border-top:1px solid #94a3b8;padding-top:6px;min-width:200px;text-align:center;">${ar ? "توقيع الطبيب المعالج" : "Treating dentist's signature"}${review?.signed && review.signedByName ? `<div style="font-weight:800;color:#0f172a;margin-top:4px;">${esc(review.signedByName)}</div>` : ""}</div>
      </div>
    </div>`;

  const fullHtml = buildReportHtmlBase(ar ? "تقرير قراءة الأشعة" : "Radiographic Reading Report", language, html);
  const blob = await htmlToPdfBlob(fullHtml, "xray-report-container");
  triggerDownload(blob, `Xray_Report_${safeName(saved.patientName)}_${when.toISOString().slice(0, 10)}.pdf`);
}

/**
 * The patient's copy: the outlined picture and the plain-words explanation, nothing clinical —
 * no severities, no confidences, no tooth table. Returned as a blob for the WhatsApp sender.
 */
export async function buildPatientExplainerPdf(saved: SavedXrayReport, text: string, language: Lang, clinicName?: string): Promise<Blob> {
  const ar = language === "ar";
  const when = saved.createdAt?.toDate ? saved.createdAt.toDate() : new Date();
  const pictures = await annotatedPictures(saved);
  const { htmlToPdfBlob, buildReportHtmlBase } = await import("@/components/reports/reportPdfHtmlUtils");
  const { getClinicLogo, clinicLogoImgHtml } = await import("@/lib/clinicLogo");
  const logo = await getClinicLogo().catch(() => undefined);
  const logoImg = logo ? clinicLogoImgHtml(logo, { maxHeight: 40, maxWidth: 96 }) : "";
  const signedBy = saved.review?.signedByName || saved.createdByName || "";
  const html = `
    <div id="xray-explainer-container" style="font-family:'Tajawal',system-ui,sans-serif;padding:32px;color:#0f172a;direction:${ar ? "rtl" : "ltr"};text-align:${ar ? "right" : "left"};">
      ${headerHtml(saved, ar ? "شرح صورة الأشعة" : "Your x-ray, explained", ar, clinicName, logoImg, when)}
      ${pictures.length ? `<div style="display:grid;grid-template-columns:${pictures.length > 1 ? "1fr 1fr" : "1fr"};gap:10px;margin:0 0 18px;">${pictures.map((p) => `<img src="${p}" style="width:100%;height:auto;border-radius:10px;border:1px solid #cbd5e1;display:block;" />`).join("")}</div>` : ""}
      <p style="font-size:14px;line-height:1.9;margin:0;white-space:pre-line;">${esc(text)}</p>
      <p style="margin-top:22px;font-size:12px;color:#334155;">${ar ? "الإطارات الملونة على الصورة بتوضح الأماكن اللي الدكتور بيتكلم عنها. لو عندك أي سؤال، اسألنا في أي وقت." : "The coloured outlines on the picture mark the places your dentist is talking about. If anything is unclear, just ask us."}</p>
      <div style="margin-top:26px;padding-top:12px;border-top:1px dashed #cbd5e1;font-size:11px;color:#64748b;line-height:1.6;">
        ${ar ? "شرح مبسّط راجعه" : "A plain-language explanation reviewed by"} ${esc(signedBy)} · ${esc(clinicName || "")}. ${ar ? "الشرح ده مش بديل عن الكشف والمناقشة مع الدكتور." : "It does not replace the examination and the conversation with your dentist."}
      </div>
    </div>`;
  const fullHtml = buildReportHtmlBase(ar ? "شرح صورة الأشعة" : "Your x-ray, explained", language, html);
  return htmlToPdfBlob(fullHtml, "xray-explainer-container");
}

function safeName(name?: string) {
  return (name || "patient").replace(/[^\w؀-ۿ -]/g, "").trim() || "patient";
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

