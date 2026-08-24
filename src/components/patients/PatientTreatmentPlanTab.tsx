"use client";
import { patientMediaPath } from "@/lib/storagePaths";

import { deleteRecord, RecycleBinError } from "@/lib/recycleBinApi";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ClipboardList, Plus, Sparkles, Printer, Download, MessageCircle, Edit2, Trash2, X,
  Loader2, AlertTriangle, ChevronDown, Check, CalendarDays, Languages,
  Stethoscope, ImagePlus, Paperclip, Send, ArrowRight, Zap, Rocket,
} from "lucide-react";
import { onSnapshot, query, where, orderBy, addDoc, updateDoc, deleteDoc, serverTimestamp } from "firebase/firestore";
import { ref as storageRef, uploadBytes, getDownloadURL } from "firebase/storage";
import { auth, storage } from "@/lib/firebase";
import { getClinicCollection, getClinicDoc } from "@/lib/db-utils";
import { useLanguage } from "@/context/LanguageContext";
import { useUI } from "@/context/UIContext";
import { useAuth } from "@/context/AuthContext";
import { useClinic } from "@/context/ClinicContext";
import { logActivity } from "@/lib/logger";
import ServiceCombobox, { type ComboboxService } from "@/components/shared/ServiceCombobox";
import { handleWhatsAppApiResult } from "@/lib/whatsappManual";
import {
  buildTreatmentPlanSrcDoc,
  treatmentPlanSrcDocToPdfBlob,
  printTreatmentPlan,
  type TreatmentPlanPdfPayload,
} from "@/lib/treatmentPlanPdfHtml";

type PlanStep = {
  id: string;
  serviceId: string;
  serviceName: string;
  teeth: string;
  quantity: number;
  unitPrice: number;
  /** Total chair time for this step in minutes; 0 = not set. */
  estimatedMinutes: number;
  note: string;
};

type PlanTranslation = {
  title: string;
  description: string;
  visits: Array<{ label: string; steps: Array<{ serviceName: string; teeth: string; note: string }> }>;
};

type PlanVisit = {
  id: string;
  label: string;
  /** YYYY-MM-DD, or "" when not scheduled yet. */
  date: string;
  time: string;
  steps: PlanStep[];
};

type TreatmentPlan = {
  id: string;
  patientId: string;
  patientName: string;
  title: string;
  description: string;
  status: "draft" | "presented" | "accepted" | "declined";
  source: "manual" | "ai";
  currency: string;
  visits: PlanVisit[];
  total: number;
  doctorName?: string;
  createdAt?: { toDate?: () => Date };
  /** AI translations cached per language by /api/ai/translate-treatment-plan. */
  translations?: Partial<Record<"en" | "ar", PlanTranslation>>;
};

type AiStep = PlanStep & { unmatched?: boolean };
type AiVisit = {
  label: string;
  date: string;
  time: string;
  daysFromPrevious: number;
  durationMinutes: number;
  suggestedTimes: string[];
  steps: AiStep[];
};
type AiOption = { title: string; description: string; visits: AiVisit[]; total: number };

type FreeDay = { date: string; dayName: string; times: string[] };

type DiagMessage = { role: "user" | "assistant"; content: string; images?: string[] };
/** An image queued for the next diagnosis message: uploaded bytes or a gallery link. */
type PendingImage = { kind: "data" | "url"; value: string; preview: string };
type MediaRow = { id: string; url: string; category: string; filename: string; createdMs: number };
type AiMode = "power" | "super";
type DiagSession = { id: string; title: string; messages: DiagMessage[]; updatedMs: number; mode: AiMode };

function normalizeDiagMessages(raw: unknown): DiagMessage[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((m: any) => ({
      role: m?.role === "assistant" ? ("assistant" as const) : ("user" as const),
      content: String(m?.content || ""),
      images: Array.isArray(m?.images) ? m.images.filter((u: unknown) => typeof u === "string") : [],
    }))
    .filter((m) => m.content || (m.images && m.images.length));
}

type DiagFormField = {
  id: string;
  label: string;
  type: "text" | "number" | "yesno" | "choice";
  options: string[];
  unit: string;
};
type DiagForm = { title: string; fields: DiagFormField[] };

/**
 * Pulls the machine-readable form out of an assistant reply. The model appends it as a
 * ```form fenced JSON block; the prose renders normally and the block becomes real inputs.
 * Anything malformed degrades to plain text — a broken form must never hide the reply.
 */
function extractDiagForm(content: string): { text: string; form: DiagForm | null } {
  const m = content.match(/```form\s*([\s\S]*?)```/);
  if (!m) return { text: content, form: null };
  let form: DiagForm | null = null;
  try {
    const raw = JSON.parse(m[1]);
    const fields = (Array.isArray(raw?.fields) ? raw.fields : [])
      .slice(0, 10)
      .map((f: any, i: number) => {
        const options = Array.isArray(f?.options)
          ? f.options.map((o: unknown) => String(o)).filter(Boolean).slice(0, 8)
          : [];
        let type: DiagFormField["type"] =
          f?.type === "number" || f?.type === "yesno" || f?.type === "choice" ? f.type : "text";
        if (type === "choice" && options.length < 2) type = "text";
        return {
          id: typeof f?.id === "string" && f.id ? f.id : `f_${i}`,
          label: String(f?.label || "").trim(),
          type,
          options,
          unit: String(f?.unit || "").trim(),
        };
      })
      .filter((f: DiagFormField) => f.label);
    if (fields.length > 0) {
      form = { title: String(raw?.title || "").trim(), fields };
    }
  } catch {
    /* fall through to plain text */
  }
  return { text: content.replace(m[0], "").trim(), form };
}

/** Inline **bold** spans without any raw HTML. */
function inlineBold(text: string): ReactNode {
  const parts = text.split(/\*\*(.+?)\*\*/g);
  if (parts.length === 1) return text;
  return parts.map((p, i) => (i % 2 === 1 ? <strong key={i} className="font-black">{p}</strong> : p));
}

/**
 * Minimal renderer for the markdown the diagnostician writes — headings, bullets, bold,
 * separators. Plain React nodes, no HTML injection, unknown syntax falls through as text.
 */
function RichText({ text }: { text: string }) {
  const lines = text.split("\n");
  return (
    <div className="space-y-1">
      {lines.map((raw, i) => {
        const t = raw.trim();
        if (!t) return <div key={i} className="h-1" />;
        if (/^[-—_]{3,}$/.test(t)) return <hr key={i} className="border-slate-200 my-1.5" />;
        const heading = t.match(/^#{1,4}\s+(.*)$/);
        if (heading) {
          return (
            <p key={i} className="font-black text-[16px] tracking-wide mt-2.5 mb-0.5">
              {inlineBold(heading[1])}
            </p>
          );
        }
        const bullet = t.match(/^(?:[*•-]|\d+\.)\s+(.*)$/);
        if (bullet) {
          const numbered = t.match(/^(\d+)\./);
          return (
            <p key={i} className="relative ps-5 text-[15px] font-medium leading-7">
              <span className="absolute start-0 font-black">{numbered ? `${numbered[1]}.` : "•"}</span>
              {inlineBold(bullet[1])}
            </p>
          );
        }
        return (
          <p key={i} className="text-[15px] font-medium leading-7">
            {inlineBold(t)}
          </p>
        );
      })}
    </div>
  );
}

const PLAN_STATUSES: Array<TreatmentPlan["status"]> = ["draft", "presented", "accepted", "declined"];

function newId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeSteps(raw: unknown): PlanStep[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((s: any, i: number) => ({
    id: typeof s?.id === "string" ? s.id : `step_${i}`,
    serviceId: String(s?.serviceId ?? ""),
    serviceName: String(s?.serviceName ?? ""),
    teeth: String(s?.teeth ?? ""),
    quantity: Math.max(1, Math.round(Number(s?.quantity) || 1)),
    unitPrice: Number(s?.unitPrice) || 0,
    estimatedMinutes: Number(s?.estimatedMinutes) > 0 ? Math.round(Number(s.estimatedMinutes)) : 0,
    note: String(s?.note ?? ""),
  }));
}

function stepsMinutes(steps: Array<{ estimatedMinutes?: number }>): number {
  return steps.reduce((sum, s) => sum + (Number(s.estimatedMinutes) || 0), 0);
}

/** Which language the plan's own text is written in — Arabic script anywhere means Arabic. */
function planContentLang(plan: TreatmentPlan): "en" | "ar" {
  const sample = [
    plan.title,
    plan.description,
    ...plan.visits.flatMap((v) => [v.label, ...v.steps.map((s) => `${s.serviceName} ${s.note}`)]),
  ].join(" ");
  return /[؀-ۿ]/.test(sample) ? "ar" : "en";
}

/** Overlays a cached translation onto the plan, index-aligned, falling back to the original text. */
function applyTranslation(plan: TreatmentPlan, tr: PlanTranslation): TreatmentPlan {
  return {
    ...plan,
    title: tr.title || plan.title,
    description: tr.description ?? plan.description,
    visits: plan.visits.map((v, vi) => {
      const tv = tr.visits?.[vi];
      if (!tv) return v;
      return {
        ...v,
        label: tv.label ?? v.label,
        steps: v.steps.map((s, si) => {
          const ts = tv.steps?.[si];
          if (!ts) return s;
          return {
            ...s,
            serviceName: ts.serviceName || s.serviceName,
            teeth: ts.teeth || s.teeth,
            note: ts.note ?? s.note,
          };
        }),
      };
    }),
  };
}

/** Plans saved before the visit split carry a flat steps array — wrap it in one unlabeled visit. */
function normalizeVisits(data: any): PlanVisit[] {
  if (Array.isArray(data?.visits) && data.visits.length > 0) {
    return data.visits.map((v: any, i: number) => ({
      id: typeof v?.id === "string" ? v.id : `visit_${i}`,
      label: String(v?.label ?? ""),
      date: String(v?.date ?? ""),
      time: String(v?.time ?? ""),
      steps: normalizeSteps(v?.steps),
    }));
  }
  const flat = normalizeSteps(data?.steps);
  return flat.length ? [{ id: "visit_0", label: "", date: "", time: "", steps: flat }] : [];
}

function visitsTotal(visits: Array<{ steps: PlanStep[] }>): number {
  return visits.reduce(
    (sum, v) => sum + v.steps.reduce((s2, s) => s2 + (Number(s.unitPrice) || 0) * (Number(s.quantity) || 1), 0),
    0
  );
}

function money(n: number): string {
  return (Number(n) || 0).toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function formatDateLabel(ymd: string, lang: "en" | "ar"): string {
  if (!ymd) return "";
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return ymd;
  return new Date(y, m - 1, d).toLocaleDateString(lang === "ar" ? "ar-EG" : "en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default function PatientTreatmentPlanTab({
  patientId,
  patient,
  clinicInfo,
}: {
  patientId: string;
  patient: any;
  clinicInfo: Record<string, unknown> | null;
}) {
  const { language, isRTL } = useLanguage();
  const { showToast, confirm } = useUI();
  const { user } = useAuth();
  const { clinicId } = useClinic();
  const ar = language === "ar";

  const [plans, setPlans] = useState<TreatmentPlan[]>([]);
  const [plansLoading, setPlansLoading] = useState(true);
  const [services, setServices] = useState<ComboboxService[]>([]);

  // Editor modal (create or edit)
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingPlanId, setEditingPlanId] = useState<string | null>(null);
  const [formTitle, setFormTitle] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formVisits, setFormVisits] = useState<PlanVisit[]>([]);
  const [saving, setSaving] = useState(false);

  // Free-slot picker inside the editor (one visit at a time)
  const [slotPickerVisitId, setSlotPickerVisitId] = useState<string | null>(null);
  const [slotDays, setSlotDays] = useState<FreeDay[]>([]);
  const [slotLoading, setSlotLoading] = useState(false);

  // AI modal
  const [aiOpen, setAiOpen] = useState(false);
  const [aiInstructions, setAiInstructions] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiOptions, setAiOptions] = useState<AiOption[] | null>(null);
  const [aiSavingIdx, setAiSavingIdx] = useState<number | null>(null);
  const [aiMode, setAiMode] = useState<AiMode>("power");
  // The Q&A loop: questions the AI asked, the dentist's answers, and a compact summary of the
  // previous round so a refinement request carries its own context.
  const [aiQuestions, setAiQuestions] = useState<string[]>([]);
  const [aiAnswers, setAiAnswers] = useState("");
  const [aiPrevSummary, setAiPrevSummary] = useState("");

  // Diagnosis discussion modal. Discussions are saved per patient in `diagnosis_chats`,
  // so a case can be picked up again days later exactly where it stopped.
  const [diagOpen, setDiagOpen] = useState(false);
  const [diagView, setDiagView] = useState<"list" | "chat">("list");
  const [diagChatId, setDiagChatId] = useState<string | null>(null);
  const [diagSessions, setDiagSessions] = useState<DiagSession[]>([]);
  const [diagMode, setDiagMode] = useState<AiMode>("power");
  const [diagMessages, setDiagMessages] = useState<DiagMessage[]>([]);
  const [diagInput, setDiagInput] = useState("");
  const [diagSending, setDiagSending] = useState(false);
  const [diagSummarizing, setDiagSummarizing] = useState(false);
  const [diagPendingImages, setDiagPendingImages] = useState<PendingImage[]>([]);
  const [diagGalleryOpen, setDiagGalleryOpen] = useState(false);
  // Answers typed into in-chat forms, keyed by the message index the form arrived in.
  const [diagFormValues, setDiagFormValues] = useState<Record<number, Record<string, string>>>({});
  const [patientMedia, setPatientMedia] = useState<MediaRow[]>([]);
  const diagFileRef = useRef<HTMLInputElement>(null);
  const diagScrollRef = useRef<HTMLDivElement>(null);

  // Per-plan busy flags + per-plan PDF language choice
  const [busyPlanId, setBusyPlanId] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<"" | "print" | "pdf" | "whatsapp">("");
  const [pdfLangByPlan, setPdfLangByPlan] = useState<Record<string, "en" | "ar">>({});

  const currency = String((clinicInfo as any)?.currency || "EGP");

  const defaultVisitLabel = (n: number) => (ar ? `الزيارة ${n}` : `Visit ${n}`);

  const txt = {
    tabTitle: ar ? "خطط العلاج" : "Treatment Plans",
    subtitle: ar
      ? "خطط علاج مقسمة على زيارات بمواعيد مقترحة من مواعيد العيادة المتاحة — تتطبع وتتبعت كـ PDF بالعربي أو الإنجليزي."
      : "Treatment plans divided into visits with dates suggested from the clinic's free calendar slots — printable as PDF in Arabic or English.",
    newPlan: ar ? "خطة جديدة" : "New Plan",
    aiSuggest: ar ? "اقتراح بالذكاء الاصطناعي" : "AI Suggest",
    empty: ar
      ? "لا توجد خطط علاج بعد. اعمل خطة يدوياً أو خلّي الذكاء الاصطناعي يقترح خطط من تشخيص الأسنان."
      : "No treatment plans yet. Create one manually, or let the AI suggest options from the charted diagnosis.",
    visit: ar ? "زيارة" : "Visit",
    addVisit: ar ? "إضافة زيارة" : "Add visit",
    visitLabelPh: ar ? "هدف الزيارة (مثال: تسكين الألم وتنظيف)" : "Visit goal (e.g. Pain relief & cleaning)",
    suggestDates: ar ? "اقترح مواعيد" : "Suggest dates",
    loadingSlots: ar ? "بيدور على مواعيد فاضية..." : "Finding free slots...",
    noSlots: ar ? "مفيش مواعيد فاضية في المدة القادمة" : "No free slots found in the coming weeks",
    notScheduled: ar ? "يُحدد لاحقاً" : "To be scheduled",
    procedure: ar ? "الإجراء" : "Procedure",
    teeth: ar ? "الأسنان" : "Teeth",
    qty: ar ? "العدد" : "Qty",
    unitPrice: ar ? "سعر الوحدة" : "Unit price",
    lineTotal: ar ? "الإجمالي" : "Total",
    visitSubtotal: ar ? "إجمالي الزيارة" : "Visit subtotal",
    total: ar ? "الإجمالي الكلي" : "Grand total",
    edit: ar ? "تعديل" : "Edit",
    print: ar ? "طباعة" : "Print",
    downloadPdf: ar ? "تحميل PDF" : "Download PDF",
    sendWhatsApp: ar ? "إرسال واتساب" : "Send WhatsApp",
    delete: ar ? "حذف" : "Delete",
    pdfLang: ar ? "لغة الملف" : "PDF language",
    planTitle: ar ? "عنوان الخطة" : "Plan title",
    planTitlePh: ar ? "مثال: الخيار الأول — علاج شامل" : "e.g. Option A — Comprehensive treatment",
    description: ar ? "وصف الخطة (اختياري)" : "Plan description (optional)",
    descriptionPh: ar
      ? "شرح مبسط للمريض عن الهدف من الخطة..."
      : "A short explanation of this plan for the patient...",
    addStep: ar ? "إضافة خطوة" : "Add step",
    teethPh: ar ? "مثال: 16 أو 11, 21" : "e.g. 16 or 11, 21",
    notePh: ar ? "وصف مبسط للمريض عن الإجراء ده (اختياري)" : "Patient-friendly description of this step (optional)",
    save: ar ? "حفظ الخطة" : "Save plan",
    cancel: ar ? "إلغاء" : "Cancel",
    needTitle: ar ? "اكتب عنوان للخطة" : "Give the plan a title",
    needSteps: ar ? "أضف خطوة واحدة على الأقل باسم إجراء" : "Add at least one step with a procedure name",
    aiModalTitle: ar ? "اقتراح خطط علاج بالذكاء الاصطناعي" : "AI Treatment Plan Suggestions",
    aiHint: ar
      ? "الذكاء الاصطناعي بيقرأ تشخيص الأسنان وتاريخ العلاج وقائمة أسعار العيادة، وبيقترح خطط بديلة مقسمة على زيارات — ومواعيد الزيارات بتتاخد من المواعيد الفاضية فعلاً في أجندة العيادة. الأسعار بتتحسب من قايمة أسعار العيادة نفسها، مش من الذكاء الاصطناعي."
      : "The AI reads the charted diagnosis, treatment history, and your price list, then proposes alternative plans divided into visits — with visit dates taken from real free slots in the clinic calendar. Prices always come from your own price list, never invented by the AI.",
    aiInstructionsPh: ar
      ? "اختياري: اكتب شكوى المريض أو اللي محتاج تخطط له (مثال: المريض عايز يظبط الضحكة قبل فرحه بعد ٣ شهور)"
      : "Optional: describe the chief complaint or what you want planned (e.g. patient wants a smile makeover before their wedding in 3 months)",
    generate: ar ? "اقترح خطط" : "Suggest plans",
    generating: ar ? "بيفكر في الخطط وبيدور على مواعيد فاضية... ممكن ياخد دقيقة" : "Thinking through options and checking the calendar... this can take up to a minute",
    saveOption: ar ? "حفظ كخطة" : "Save as plan",
    tryAgain: ar ? "جرب تاني" : "Regenerate",
    aiQuestionsTitle: ar ? "الذكاء الاصطناعي محتاج يسألك:" : "The AI needs to ask you:",
    aiAnswersPh: ar
      ? "جاوب هنا — مثال: الحشوة بتاخد معايا ٢٠ دقيقة، وقسّم الحشوات على زيارتين..."
      : "Answer here — e.g. a filling takes me 20 minutes, and split the fillings over two visits...",
    refine: ar ? "عدّل الخطط حسب إجاباتي" : "Refine plans with my answers",
    minutesPh: ar ? "دقايق" : "min",
    minutesTitle: ar ? "مدة الإجراء بالدقايق" : "Estimated minutes for this step",
    translating: ar ? "بيترجم الخطة... ثواني" : "Translating the plan... one moment",
    aiDiagnosis: ar ? "مناقشة التشخيص" : "AI Diagnosis",
    diagModalTitle: ar ? "مناقشة التشخيص مع الذكاء الاصطناعي" : "AI Diagnosis Discussion",
    diagHint: ar
      ? "ناقش الحالة زي ما بتناقش زميل: ابعت صور إكلينيكية أو أشعة، وهو هيقراها ويسألك عن الاختبارات اللي محتاجها — حساسية بارد/سخن، طرق، مجس، جيوب — لحد ما توصلوا لتشخيص مظبوط. صوّر بكاميرا تطبيق الأندرويد من صفحة المريض وهتلاقي الصورة هنا في معرض الصور فوراً."
      : "Discuss the case like you would with a colleague: attach clinical photos or x-rays, and it will read them and ask you for the chairside tests it needs — cold/heat sensitivity, percussion, probing catch, pockets — until you reach a solid diagnosis. Shoot with the Android app's camera on the patient's page and the photo appears in the gallery picker here instantly.",
    diagInputPh: ar
      ? "اكتب الشكوى أو نتيجة الاختبار... (مثال: سنة 36 بتوجع مع البارد والألم بيكمل ثواني)"
      : "Type the complaint or a test result... (e.g. tooth 36 hurts with cold, pain lingers a few seconds)",
    diagAttach: ar ? "رفع صورة" : "Upload photo",
    diagGallery: ar ? "من صور المريض" : "From patient gallery",
    diagGalleryEmpty: ar
      ? "لا توجد صور لهذا المريض بعد. صوّر بتطبيق الأندرويد أو ارفع من تبويب الأشعة والصور."
      : "No photos for this patient yet. Shoot with the Android app or upload in the X-Rays & Photos tab.",
    diagSend: ar ? "إرسال" : "Send",
    diagThinking: ar ? "بيفحص ويفكر..." : "Examining and thinking...",
    diagUseInPlan: ar ? "استخدم التشخيص في خطة العلاج" : "Use diagnosis in treatment plan",
    diagSummarizing: ar ? "بيلخص التشخيص..." : "Summarizing the diagnosis...",
    diagStart: ar
      ? "ابدأ بوصف الشكوى أو ابعت صورة. مثال: «مريض جه بألم في الناحية اليمين تحت من يومين»"
      : "Start by describing the complaint or attaching a photo. e.g. \"Patient presented with lower-right pain for two days\"",
    diagImageTooBig: ar ? "الصورة أكبر من 4 ميجا" : "Image is larger than 4 MB",
    diagMaxImages: ar ? "٣ صور كحد أقصى في الرسالة" : "Up to 3 images per message",
    diagNew: ar ? "مناقشة جديدة" : "New discussion",
    diagNoSessions: ar ? "لا توجد مناقشات محفوظة لهذا المريض بعد" : "No saved discussions for this patient yet",
    diagMsgCount: ar ? "رسالة" : "messages",
    diagBack: ar ? "رجوع للمناقشات" : "Back to discussions",
    formDefaultTitle: ar ? "نتائج الفحص" : "Findings",
    formSend: ar ? "إرسال الإجابات" : "Send answers",
    formSent: ar ? "تم الإرسال ✓" : "Sent ✓",
    formNeedOne: ar ? "املأ إجابة واحدة على الأقل" : "Fill in at least one answer",
    formYes: ar ? "نعم" : "Yes",
    formNo: ar ? "لا" : "No",
    modePower: ar ? "قوي" : "Powerful",
    modeSuper: ar ? "خارق" : "Super",
    diagModeHintPower: ar
      ? "١ رصيد للرسالة (٣ بالصور) — سريع ومباشر: تشخيص مبدئي من أول رد وأقل أسئلة"
      : "1 credit per message (3 with photos) — fast and decisive: a working diagnosis from the first reply, minimal questions",
    diagModeHintSuper: ar
      ? "٣ رصيد للرسالة (٩ بالصور) — فحص شامل للحالات المعقدة: تفكير أعمق وأسئلة واختبارات أكتر"
      : "3 credits per message (9 with photos) — exhaustive workup for complex cases: deeper thinking, more tests and views",
    planModeHintPower: ar ? "٢ رصيد لكل توليد" : "2 credits per generation",
    planModeHintSuper: ar
      ? "٦ رصيد لكل توليد — تحليل أعمق للحالات المعقدة"
      : "6 credits per generation — deeper analysis for complex cases",
    priceMissing: ar ? "السعر مش في القائمة — حدده يدوياً" : "Not in price list — set price manually",
    aiBadge: ar ? "ذكاء اصطناعي" : "AI",
    manualBadge: ar ? "يدوي" : "Manual",
    statusLabels: {
      draft: ar ? "مسودة" : "Draft",
      presented: ar ? "معروضة على المريض" : "Presented",
      accepted: ar ? "مقبولة" : "Accepted",
      declined: ar ? "مرفوضة" : "Declined",
    } as Record<TreatmentPlan["status"], string>,
  };

  // Live plans for this patient. No orderBy — a where+orderBy pair needs a composite index;
  // sorting a handful of plans client-side is free.
  useEffect(() => {
    if (!patientId) return;
    const q = query(getClinicCollection("treatment_plans"), where("patientId", "==", patientId));
    const unsub = onSnapshot(q, (snap) => {
      const rows = snap.docs.map((d) => {
        const data = d.data() as any;
        const visits = normalizeVisits(data);
        return {
          id: d.id,
          patientId: String(data.patientId || ""),
          patientName: String(data.patientName || ""),
          title: String(data.title || ""),
          description: String(data.description || ""),
          status: PLAN_STATUSES.includes(data.status) ? data.status : "draft",
          source: data.source === "ai" ? "ai" : "manual",
          currency: String(data.currency || "EGP"),
          visits,
          total: Number(data.total) || visitsTotal(visits),
          doctorName: typeof data.doctorName === "string" ? data.doctorName : "",
          createdAt: data.createdAt,
          translations: data.translations && typeof data.translations === "object" ? data.translations : undefined,
        } as TreatmentPlan;
      });
      rows.sort((a, b) => (b.createdAt?.toDate?.()?.getTime() || 0) - (a.createdAt?.toDate?.()?.getTime() || 0));
      setPlans(rows);
      setPlansLoading(false);
    });
    return () => unsub();
  }, [patientId]);

  // The clinic price list feeds the step picker.
  useEffect(() => {
    const q = query(getClinicCollection("services"), orderBy("name"));
    const unsub = onSnapshot(q, (snap) =>
      setServices(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })))
    );
    return () => unsub();
  }, []);

  // Saved diagnosis discussions for this patient, live while the modal is open.
  useEffect(() => {
    if (!diagOpen || !patientId) return;
    const q = query(getClinicCollection("diagnosis_chats"), where("patientId", "==", patientId));
    const unsub = onSnapshot(q, (snap) => {
      const rows = snap.docs.map((d) => {
        const data = d.data() as any;
        return {
          id: d.id,
          title: String(data.title || ""),
          messages: normalizeDiagMessages(data.messages),
          updatedMs: data.updatedAt?.toMillis?.() || data.createdAt?.toMillis?.() || 0,
          mode: data.mode === "super" ? "super" : "power",
        } as DiagSession;
      });
      rows.sort((a, b) => b.updatedMs - a.updatedMs);
      setDiagSessions(rows);
    });
    return () => unsub();
  }, [diagOpen, patientId]);

  // The patient's photo gallery, live while the diagnosis modal is open — a photo taken with
  // the Android app's camera lands in patient_media and shows up in the picker within seconds.
  useEffect(() => {
    if (!diagOpen || !patientId) return;
    const q = query(getClinicCollection("patient_media"), where("patientId", "==", patientId));
    const unsub = onSnapshot(q, (snap) => {
      const rows = snap.docs
        .map((d) => {
          const m = d.data() as any;
          return {
            id: d.id,
            url: String(m.url || ""),
            category: String(m.category || ""),
            filename: String(m.filename || ""),
            createdMs: m.createdAt?.toMillis?.() || 0,
          };
        })
        .filter((m) => m.url);
      rows.sort((a, b) => b.createdMs - a.createdMs);
      setPatientMedia(rows);
    });
    return () => unsub();
  }, [diagOpen, patientId]);

  // Keep the discussion scrolled to the newest message.
  useEffect(() => {
    const el = diagScrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [diagMessages, diagSending]);

  const calculateAge = (dob: string): string => {
    if (!dob) return "?";
    const t = Date.parse(dob);
    if (Number.isNaN(t)) return "?";
    return String(Math.abs(new Date(Date.now() - t).getUTCFullYear() - 1970));
  };

  const buildPdfPayload = (plan: TreatmentPlan, pdfLang: "en" | "ar"): TreatmentPlanPdfPayload => {
    const ci = (clinicInfo || {}) as Record<string, unknown>;
    const clinicName =
      (typeof ci.name === "string" && ci.name.trim()) ||
      (typeof ci.clinicName === "string" && (ci.clinicName as string).trim()) ||
      "Dental Clinic";
    const agePart =
      patient?.dateOfBirth ? calculateAge(String(patient.dateOfBirth))
        : patient?.age != null && String(patient.age).trim() !== "" ? String(patient.age)
        : "?";
    const ageSex = `${agePart} Y / ${String(patient?.gender || "U").charAt(0) || "U"}`;
    const createdDate = plan.createdAt?.toDate?.() || new Date();
    return {
      clinicName,
      rxHeader:
        (typeof ci.rxHeader === "string" && ci.rxHeader.trim()) ||
        (plan.doctorName ? `Dr. ${plan.doctorName}` : ""),
      address: typeof ci.address === "string" ? (ci.address as string) : "",
      phone: typeof ci.phone === "string" ? (ci.phone as string) : "",
      dateLabel: createdDate.toLocaleDateString("en-GB"),
      patientName: String(plan.patientName || patient?.name || "Patient"),
      ageSex,
      doctor: plan.doctorName || "",
      planTitle: plan.title,
      planDescription: plan.description,
      visits: plan.visits.map((v, i) => {
        let label = v.label || (plan.visits.length > 1 ? (pdfLang === "ar" ? `الزيارة ${i + 1}` : `Visit ${i + 1}`) : "");
        const mins = stepsMinutes(v.steps);
        if (label && mins > 0) label += pdfLang === "ar" ? ` · حوالي ${mins} دقيقة` : ` · ~${mins} min`;
        return {
          label,
          dateLabel: v.date ? formatDateLabel(v.date, pdfLang) : "",
          time: v.time,
          steps: v.steps.map((s) => ({
            serviceName: s.serviceName,
            teeth: s.teeth,
            quantity: s.quantity,
            unitPrice: s.unitPrice,
            note: s.note,
          })),
        };
      }),
      total: visitsTotal(plan.visits),
      currency: plan.currency || currency,
      language: pdfLang,
    };
  };

  const pdfLangFor = (planId: string): "en" | "ar" => pdfLangByPlan[planId] || language as "en" | "ar";

  // ---------- Editor ----------

  const blankStep = (): PlanStep => ({ id: newId("step"), serviceId: "", serviceName: "", teeth: "", quantity: 1, unitPrice: 0, estimatedMinutes: 0, note: "" });
  const blankVisit = (n: number): PlanVisit => ({ id: newId("visit"), label: defaultVisitLabel(n), date: "", time: "", steps: [blankStep()] });

  const openNewEditor = () => {
    setEditingPlanId(null);
    setFormTitle("");
    setFormDescription("");
    setFormVisits([blankVisit(1)]);
    setSlotPickerVisitId(null);
    setEditorOpen(true);
  };

  const openEditEditor = (plan: TreatmentPlan) => {
    setEditingPlanId(plan.id);
    setFormTitle(plan.title);
    setFormDescription(plan.description);
    setFormVisits(
      plan.visits.length
        ? plan.visits.map((v) => ({ ...v, steps: v.steps.map((s) => ({ ...s })) }))
        : [blankVisit(1)]
    );
    setSlotPickerVisitId(null);
    setEditorOpen(true);
  };

  const updateVisit = (visitId: string, patch: Partial<PlanVisit>) => {
    setFormVisits((prev) => prev.map((v) => (v.id === visitId ? { ...v, ...patch } : v)));
  };

  const updateStep = (visitId: string, stepId: string, patch: Partial<PlanStep>) => {
    setFormVisits((prev) =>
      prev.map((v) =>
        v.id === visitId
          ? { ...v, steps: v.steps.map((s) => (s.id === stepId ? { ...s, ...patch } : s)) }
          : v
      )
    );
  };

  const openSlotPicker = async (visit: PlanVisit) => {
    if (slotPickerVisitId === visit.id) {
      setSlotPickerVisitId(null);
      return;
    }
    const u = auth.currentUser;
    if (!u || !clinicId) return;
    setSlotPickerVisitId(visit.id);
    setSlotDays([]);
    setSlotLoading(true);
    try {
      // Start looking after the previous visit's date so visit order stays realistic.
      const idx = formVisits.findIndex((v) => v.id === visit.id);
      let fromDate = "";
      for (let i = idx - 1; i >= 0; i--) {
        if (formVisits[i].date) { fromDate = formVisits[i].date; break; }
      }
      const token = await u.getIdToken();
      // Only offer gaps this visit actually fits in, when its steps carry durations.
      const durationMinutes = stepsMinutes(visit.steps) || undefined;
      const res = await fetch("/api/appointments/free-slots", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ clinicId, fromDate: fromDate || undefined, maxDays: 4, durationMinutes }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) throw new Error(typeof data?.error === "string" ? data.error : "Failed");
      setSlotDays(Array.isArray(data.days) ? data.days : []);
    } catch (e) {
      showToast(e instanceof Error ? e.message : ar ? "فشل تحميل المواعيد" : "Could not load free slots", "error");
      setSlotPickerVisitId(null);
    } finally {
      setSlotLoading(false);
    }
  };

  const handleSavePlan = async () => {
    const title = formTitle.trim();
    if (!title) {
      showToast(txt.needTitle, "error");
      return;
    }
    const visits = formVisits
      .map((v) => ({
        ...v,
        label: v.label.trim(),
        steps: v.steps
          .map((s) => ({ ...s, serviceName: s.serviceName.trim(), teeth: s.teeth.trim(), note: s.note.trim() }))
          .filter((s) => s.serviceName),
      }))
      .filter((v) => v.steps.length > 0);
    if (visits.length === 0) {
      showToast(txt.needSteps, "error");
      return;
    }
    setSaving(true);
    try {
      const flatSteps = visits.flatMap((v) => v.steps);
      const payload = {
        patientId,
        patientName: String(patient?.name || ""),
        title,
        description: formDescription.trim(),
        visits,
        // Flat copy kept alongside the visit split, so anything reading the old shape still works.
        steps: flatSteps,
        total: visitsTotal(visits),
        currency,
        // The text just changed, so any cached AI translation of the old text is now wrong.
        translations: {},
        updatedAt: serverTimestamp(),
      };
      if (editingPlanId) {
        await updateDoc(getClinicDoc("treatment_plans", editingPlanId), payload as any);
        await logActivity(
          { uid: user?.uid, name: user?.name, role: user?.role },
          "Treatment Plan Updated",
          `Updated treatment plan "${title}" for ${patient?.name || patientId}`
        );
      } else {
        await addDoc(getClinicCollection("treatment_plans"), {
          ...payload,
          status: "draft",
          source: "manual",
          doctorName: user?.name || "",
          createdBy: user?.uid || "",
          createdAt: serverTimestamp(),
        } as any);
        await logActivity(
          { uid: user?.uid, name: user?.name, role: user?.role },
          "Treatment Plan Created",
          `Created treatment plan "${title}" for ${patient?.name || patientId}`
        );
      }
      setEditorOpen(false);
      showToast(ar ? "تم حفظ الخطة" : "Plan saved", "success");
    } catch (e) {
      console.error(e);
      showToast(ar ? "فشل حفظ الخطة" : "Failed to save the plan", "error");
    } finally {
      setSaving(false);
    }
  };

  const handleDeletePlan = async (plan: TreatmentPlan) => {
    const ok = await confirm(
      ar
        ? `هتحذف خطة "${plan.title}" نهائياً؟`
        : `Permanently delete the plan "${plan.title}"?`,
      {
        title: ar ? "حذف خطة العلاج" : "Delete treatment plan",
        confirmLabel: ar ? "احذف" : "Delete",
        tone: "danger",
      }
    );
    if (!ok) return;
    try {
      await deleteRecord(clinicId || "", "treatment_plans", plan.id);
      await logActivity(
        { uid: user?.uid, name: user?.name, role: user?.role },
        "Treatment Plan Deleted",
        `Deleted treatment plan "${plan.title}" for ${patient?.name || patientId}`
      );
      showToast(ar ? "تم النقل إلى المحذوفات" : "Moved to Recently Deleted", "success");
    } catch (e) {
      console.error(e);
      showToast(ar ? "فشل الحذف" : "Failed to delete", "error");
    }
  };

  const handleSetStatus = async (plan: TreatmentPlan, status: TreatmentPlan["status"]) => {
    if (plan.status === status) return;
    try {
      await updateDoc(getClinicDoc("treatment_plans", plan.id), { status, updatedAt: serverTimestamp() });
    } catch (e) {
      console.error(e);
      showToast(ar ? "فشل تغيير الحالة" : "Failed to change status", "error");
    }
  };

  // ---------- Print / PDF / WhatsApp ----------

  /**
   * The plan in the language the PDF toggle asks for. Content already in that language is used
   * as-is; otherwise a cached AI translation is applied, and failing that one is fetched once
   * (the route stores it on the plan doc, so every later print of this plan is instant).
   */
  const preparePlanForPdf = async (plan: TreatmentPlan): Promise<TreatmentPlan> => {
    const target = pdfLangFor(plan.id);
    if (planContentLang(plan) === target) return plan;
    const cached = plan.translations?.[target];
    if (cached && Array.isArray(cached.visits)) return applyTranslation(plan, cached);

    const u = auth.currentUser;
    if (!u || !clinicId) return plan;
    showToast(txt.translating, "info");
    const token = await u.getIdToken();
    const res = await fetch("/api/ai/translate-treatment-plan", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ clinicId, planId: plan.id, targetLanguage: target }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.ok || !data?.translation) {
      throw new Error(typeof data?.error === "string" ? data.error : "Translation failed");
    }
    return applyTranslation(plan, data.translation as PlanTranslation);
  };

  const handlePrint = async (plan: TreatmentPlan) => {
    setBusyPlanId(plan.id);
    setBusyAction("print");
    try {
      const prepared = await preparePlanForPdf(plan);
      printTreatmentPlan(buildPdfPayload(prepared, pdfLangFor(plan.id)));
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Print failed", "error");
    } finally {
      setBusyPlanId(null);
      setBusyAction("");
    }
  };

  const handleDownloadPdf = async (plan: TreatmentPlan) => {
    setBusyPlanId(plan.id);
    setBusyAction("pdf");
    try {
      const prepared = await preparePlanForPdf(plan);
      const srcDoc = buildTreatmentPlanSrcDoc(buildPdfPayload(prepared, pdfLangFor(plan.id)));
      const blob = await treatmentPlanSrcDocToPdfBlob(srcDoc);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `TreatmentPlan-${String(plan.id).slice(0, 8)}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      showToast(ar ? "تم تحميل الملف" : "PDF downloaded.", "success");
    } catch (e) {
      showToast(e instanceof Error ? e.message : ar ? "فشل PDF" : "PDF failed", "error");
    } finally {
      setBusyPlanId(null);
      setBusyAction("");
    }
  };

  const handleSendWhatsApp = async (plan: TreatmentPlan) => {
    const u = auth.currentUser;
    if (!u) {
      showToast(ar ? "سجّل الدخول" : "Sign in required", "error");
      return;
    }
    setBusyPlanId(plan.id);
    setBusyAction("whatsapp");
    try {
      const prepared = await preparePlanForPdf(plan);
      const srcDoc = buildTreatmentPlanSrcDoc(buildPdfPayload(prepared, pdfLangFor(plan.id)));
      const blob = await treatmentPlanSrcDocToPdfBlob(srcDoc);
      const dataUrl: string = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error("Failed to read PDF"));
        reader.readAsDataURL(blob);
      });
      const comma = dataUrl.indexOf(",");
      const pdfBase64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
      const token = await u.getIdToken();
      const res = await fetch("/api/whatsapp/send-treatment-plan-pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ patientId, pdfBase64, clinicId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        throw new Error(typeof data?.error === "string" ? data.error : "WhatsApp send failed");
      }
      if (data.manual) {
        handleWhatsAppApiResult(data, patient?.name);
        showToast(
          ar
            ? "افتح واتساب من الرسالة عشان تبعت — المريض هيستلم رابط خطة العلاج"
            : "Open WhatsApp from the prompt — the patient will receive a link to the plan",
          "info"
        );
      } else {
        showToast(ar ? "تم إرسال خطة العلاج على واتساب" : "Treatment plan sent on WhatsApp.", "success");
      }
      // Sending it to the patient is what "presented" means — but never demote an accepted plan.
      if (plan.status === "draft") {
        handleSetStatus(plan, "presented");
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : ar ? "فشل الإرسال" : "Send failed", "error");
    } finally {
      setBusyPlanId(null);
      setBusyAction("");
    }
  };

  // ---------- AI ----------

  /** Compact text form of the current proposals, sent back with the dentist's answers on refine. */
  const summarizeOptionsForRefine = (options: AiOption[]): string =>
    options
      .map(
        (o, i) =>
          `Plan ${i + 1}: ${o.title}\n` +
          o.visits
            .map(
              (v, vi) =>
                `  Visit ${vi + 1} (${v.label}; gap ${v.daysFromPrevious}d; ~${v.durationMinutes}min): ` +
                v.steps.map((s) => `${s.serviceName} x${s.quantity} (${s.estimatedMinutes || "?"}min)`).join(", ")
            )
            .join("\n")
      )
      .join("\n");

  const handleGenerateAi = async (refine = false) => {
    const u = auth.currentUser;
    if (!u || !clinicId) {
      showToast(ar ? "سجّل الدخول" : "Sign in required", "error");
      return;
    }
    setAiLoading(true);
    if (!refine) {
      setAiOptions(null);
      setAiQuestions([]);
    }
    try {
      const token = await u.getIdToken();
      const res = await fetch("/api/ai/treatment-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          clinicId,
          patientId,
          instructions: aiInstructions,
          language,
          mode: aiMode,
          ...(refine && (aiPrevSummary || aiAnswers.trim())
            ? { refinement: { previous: aiPrevSummary, answers: aiAnswers.trim() } }
            : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        throw new Error(typeof data?.error === "string" ? data.error : "AI suggestion failed");
      }
      const options: AiOption[] = (Array.isArray(data.options) ? data.options : []).map((o: any) => ({
        title: String(o.title || ""),
        description: String(o.description || ""),
        total: Number(o.total) || 0,
        visits: (Array.isArray(o.visits) ? o.visits : []).map((v: any, vi: number) => ({
          label: String(v.label || "") || defaultVisitLabel(vi + 1),
          date: String(v.date || ""),
          time: String(v.time || ""),
          daysFromPrevious: Math.max(0, Math.round(Number(v.daysFromPrevious) || 0)),
          durationMinutes: Math.max(0, Math.round(Number(v.durationMinutes) || 0)),
          suggestedTimes: Array.isArray(v.suggestedTimes) ? v.suggestedTimes.map(String) : [],
          steps: normalizeSteps(v.steps).map((s, si) => ({
            ...s,
            unmatched: Array.isArray(v.steps) && v.steps[si]?.unmatched === true,
          })),
        })),
      }));
      setAiOptions(options);
      setAiQuestions(
        (Array.isArray(data.questions) ? data.questions : []).filter(
          (q: unknown): q is string => typeof q === "string" && q.trim().length > 0
        )
      );
      setAiPrevSummary(summarizeOptionsForRefine(options));
      if (refine) setAiAnswers("");
    } catch (e) {
      showToast(e instanceof Error ? e.message : ar ? "فشل الاقتراح" : "AI suggestion failed", "error");
    } finally {
      setAiLoading(false);
    }
  };

  const handleSaveAiOption = async (option: AiOption, idx: number) => {
    setAiSavingIdx(idx);
    try {
      const visits: PlanVisit[] = option.visits.map((v) => ({
        id: newId("visit"),
        label: v.label,
        date: v.date,
        time: v.time,
        steps: v.steps.map((s) => ({
          id: s.id || newId("step"),
          serviceId: s.serviceId,
          serviceName: s.serviceName,
          teeth: s.teeth,
          quantity: s.quantity,
          unitPrice: s.unitPrice,
          estimatedMinutes: s.estimatedMinutes || 0,
          note: s.note,
        })),
      }));
      await addDoc(getClinicCollection("treatment_plans"), {
        patientId,
        patientName: String(patient?.name || ""),
        title: option.title,
        description: option.description,
        visits,
        steps: visits.flatMap((v) => v.steps),
        total: visitsTotal(visits),
        currency,
        status: "draft",
        source: "ai",
        doctorName: user?.name || "",
        createdBy: user?.uid || "",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      } as any);
      await logActivity(
        { uid: user?.uid, name: user?.name, role: user?.role },
        "Treatment Plan Created",
        `Saved AI-suggested treatment plan "${option.title}" for ${patient?.name || patientId}`
      );
      showToast(ar ? "تم حفظ الخطة — راجعها وعدّل الأسعار الناقصة" : "Plan saved — review it and fill any missing prices", "success");
    } catch (e) {
      console.error(e);
      showToast(ar ? "فشل الحفظ" : "Failed to save", "error");
    } finally {
      setAiSavingIdx(null);
    }
  };

  // ---------- Diagnosis discussion ----------

  const handleDiagFiles = (files: FileList | null) => {
    if (!files) return;
    const room = 3 - diagPendingImages.length;
    if (room <= 0) {
      showToast(txt.diagMaxImages, "error");
      return;
    }
    Array.from(files).slice(0, room).forEach((file) => {
      if (!file.type.startsWith("image/")) return;
      if (file.size > 4 * 1024 * 1024) {
        showToast(txt.diagImageTooBig, "error");
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = String(reader.result || "");
        if (dataUrl.startsWith("data:image/")) {
          setDiagPendingImages((prev) =>
            prev.length >= 3 ? prev : [...prev, { kind: "data", value: dataUrl, preview: dataUrl }]
          );
        }
      };
      reader.readAsDataURL(file);
    });
  };

  const openDiagSession = (session: DiagSession | null) => {
    setDiagChatId(session?.id || null);
    setDiagMessages(session ? session.messages : []);
    setDiagMode(session?.mode || "power");
    setDiagPendingImages([]);
    setDiagInput("");
    setDiagGalleryOpen(false);
    setDiagView("chat");
  };

  const handleDeleteDiagSession = async (session: DiagSession) => {
    const ok = await confirm(
      ar ? `هتحذف مناقشة "${session.title}" نهائياً؟` : `Permanently delete the discussion "${session.title}"?`,
      { title: ar ? "حذف المناقشة" : "Delete discussion", confirmLabel: ar ? "احذف" : "Delete", tone: "danger" }
    );
    if (!ok) return;
    try {
      await deleteRecord(clinicId || "", "diagnosis_chats", session.id);
      if (diagChatId === session.id) openDiagSession(null);
      // This delete wrote no activity-log line at all, so a removed differential diagnosis left
      // no trace of who removed it.
      await logActivity(
        { uid: user?.uid, name: user?.name, role: user?.role },
        "Diagnosis Chat Deleted",
        `Moved discussion "${session.title}" to Recently Deleted for ${patient?.name || patientId}`
      );
      showToast(ar ? "تم النقل إلى المحذوفات" : "Moved to Recently Deleted", "success");
    } catch (e) {
      showToast(
        e instanceof RecycleBinError ? e.message : ar ? "فشل الحذف" : "Failed to delete",
        "error"
      );
    }
  };

  /** Writes the whole discussion back to its doc, creating it on the first exchange. */
  const persistDiagChat = async (messages: DiagMessage[]): Promise<void> => {
    const stored = messages.map((m) => ({ role: m.role, content: m.content, images: m.images || [] }));
    const title =
      (messages.find((m) => m.role === "user")?.content || "").replace(/\s+/g, " ").trim().slice(0, 70) ||
      (ar ? "مناقشة تشخيص" : "Diagnosis discussion");
    if (diagChatId) {
      await updateDoc(getClinicDoc("diagnosis_chats", diagChatId), {
        messages: stored,
        title,
        mode: diagMode,
        updatedAt: serverTimestamp(),
      });
    } else {
      const docRef = await addDoc(getClinicCollection("diagnosis_chats"), {
        patientId,
        patientName: String(patient?.name || ""),
        title,
        mode: diagMode,
        messages: stored,
        createdBy: user?.uid || "",
        createdByName: user?.name || "",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      setDiagChatId(docRef.id);
    }
  };

  const sendDiagMessage = async (overrideText?: string) => {
    const text = (overrideText ?? diagInput).trim();
    if (!text && diagPendingImages.length === 0) return;
    const u = auth.currentUser;
    if (!u || !clinicId) {
      showToast(ar ? "سجّل الدخول" : "Sign in required", "error");
      return;
    }
    const pending = diagPendingImages;
    if (!overrideText) setDiagInput("");
    setDiagPendingImages([]);
    setDiagGalleryOpen(false);
    setDiagSending(true);

    // Optimistic bubble with local previews; replaced by the stored-URL version on success.
    const optimistic: DiagMessage = {
      role: "user",
      content: text || (ar ? "(صورة مرفقة)" : "(image attached)"),
      images: pending.map((p) => p.preview),
    };
    setDiagMessages((prev) => [...prev, optimistic]);

    try {
      // Uploaded photos go to Storage first (the same patient path the gallery uses), so the
      // saved discussion carries small URLs instead of megabytes of base64 — Firestore documents
      // cap at 1MB, and a single inline photo would blow straight past it.
      const imageUrls: string[] = [];
      for (let i = 0; i < pending.length; i++) {
        const p = pending[i];
        if (p.kind === "url") {
          imageUrls.push(p.value);
        } else {
          const blob = await (await fetch(p.value)).blob();
          const ext = (blob.type.split("/")[1] || "jpg").replace(/[^a-z0-9]/gi, "") || "jpg";
          const sref = storageRef(storage, patientMediaPath(clinicId, patientId, ext, "diag_"));
          await uploadBytes(sref, blob);
          imageUrls.push(await getDownloadURL(sref));
        }
      }

      const outgoing: DiagMessage = { ...optimistic, images: imageUrls };
      const history = diagMessages.map((m) => ({ role: m.role, content: m.content }));

      const token = await u.getIdToken();
      const res = await fetch("/api/ai/diagnosis-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          clinicId,
          patientId,
          message: outgoing.content,
          history,
          imageUrls,
          language,
          mode: diagMode,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        throw new Error(typeof data?.error === "string" ? data.error : "Diagnosis chat failed");
      }
      const reply: DiagMessage = { role: "assistant", content: String(data.reply || "") };
      const finalMessages = [...diagMessages, outgoing, reply];
      setDiagMessages(finalMessages);
      // Saved after every successful exchange, so closing the tab never loses the case.
      try {
        await persistDiagChat(finalMessages);
      } catch (persistErr) {
        console.error("Failed to save diagnosis chat:", persistErr);
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : ar ? "فشل الإرسال" : "Send failed", "error");
      // Put the failed message's text back so it is not lost (form answers stay in their fields).
      setDiagMessages((prev) => prev.filter((m) => m !== optimistic));
      if (!overrideText) setDiagInput(text);
      setDiagPendingImages(pending);
    } finally {
      setDiagSending(false);
    }
  };

  /** Sends a filled in-chat form back as one structured message the AI (and the record) can read. */
  const submitDiagForm = (msgIndex: number, form: DiagForm) => {
    const values = diagFormValues[msgIndex] || {};
    const lines = form.fields
      .map((f) => {
        const v = String(values[f.id] ?? "").trim();
        if (!v) return null;
        return `- ${f.label}: ${v}${f.unit ? ` ${f.unit}` : ""}`;
      })
      .filter(Boolean) as string[];
    if (lines.length === 0) {
      showToast(txt.formNeedOne, "error");
      return;
    }
    sendDiagMessage(`${form.title || txt.formDefaultTitle}:\n${lines.join("\n")}`);
  };

  /** Ends the discussion with a structured diagnosis summary and hands it to treatment planning. */
  const handleUseDiagnosisInPlan = async () => {
    const u = auth.currentUser;
    if (!u || !clinicId || diagMessages.length === 0) return;
    setDiagSummarizing(true);
    try {
      const token = await u.getIdToken();
      const res = await fetch("/api/ai/diagnosis-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          clinicId,
          patientId,
          summarize: true,
          history: diagMessages.map((m) => ({ role: m.role, content: m.content })),
          language,
          mode: diagMode,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        throw new Error(typeof data?.error === "string" ? data.error : "Summary failed");
      }
      const summary = String(data.reply || "").trim();
      setAiInstructions(summary);
      setDiagOpen(false);
      setAiOptions(null);
      setAiQuestions([]);
      setAiOpen(true);
      showToast(
        ar ? "التشخيص اتحط في خانة التعليمات — اضغط «اقترح خطط»" : "Diagnosis placed in the instructions box — press \"Suggest plans\"",
        "success"
      );
    } catch (e) {
      showToast(e instanceof Error ? e.message : ar ? "فشل التلخيص" : "Summary failed", "error");
    } finally {
      setDiagSummarizing(false);
    }
  };

  const statusChipClass = (status: TreatmentPlan["status"]) => {
    switch (status) {
      case "accepted": return "bg-emerald-50 text-emerald-700 border-emerald-200";
      case "presented": return "bg-blue-50 text-blue-700 border-blue-200";
      case "declined": return "bg-rose-50 text-rose-600 border-rose-200";
      default: return "bg-slate-100 text-slate-600 border-slate-200";
    }
  };

  const formTotal = useMemo(() => visitsTotal(formVisits), [formVisits]);

  const renderVisitBadge = (v: { date: string; time: string }, subtle = false) => (
    <span className={`flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1 rounded-full border whitespace-nowrap ${
      v.date ? "bg-emerald-50 text-emerald-700 border-emerald-200" : subtle ? "bg-slate-50 text-slate-400 border-slate-200" : "bg-amber-50 text-amber-600 border-amber-200"
    }`}>
      <CalendarDays size={12} />
      {v.date ? `${formatDateLabel(v.date, language as "en" | "ar")}${v.time ? ` · ${v.time}` : ""}` : txt.notScheduled}
    </span>
  );

  const renderStepsTable = (steps: Array<PlanStep & { unmatched?: boolean }>, planCurrency: string, showTotal: boolean) => (
    <div className="overflow-x-auto rounded-xl border border-slate-100">
      <table className="w-full text-sm min-w-[560px]">
        <thead>
          <tr className="bg-slate-50 text-[10px] font-bold text-slate-500 uppercase tracking-widest">
            <th className="px-3 py-2.5 text-start w-8">#</th>
            <th className="px-3 py-2.5 text-start">{txt.procedure}</th>
            <th className="px-3 py-2.5 text-start">{txt.teeth}</th>
            <th className="px-3 py-2.5 text-center">{txt.qty}</th>
            <th className="px-3 py-2.5 text-end">{txt.unitPrice}</th>
            <th className="px-3 py-2.5 text-end">{txt.lineTotal}</th>
          </tr>
        </thead>
        <tbody>
          {steps.map((s, i) => (
            <tr key={s.id || i} className="border-t border-slate-100">
              <td className="px-3 py-2.5 font-bold text-slate-400">{i + 1}</td>
              <td className="px-3 py-2.5">
                <span className="font-bold text-slate-800">{s.serviceName}</span>
                {s.note && <div className="text-xs text-slate-500 font-medium mt-0.5 leading-relaxed">{s.note}</div>}
                {s.unmatched && (
                  <div className="flex items-center gap-1 text-[11px] font-bold text-amber-600 mt-1">
                    <AlertTriangle size={12} /> {txt.priceMissing}
                  </div>
                )}
              </td>
              <td className="px-3 py-2.5 font-semibold text-slate-600 whitespace-nowrap">{s.teeth || "—"}</td>
              <td className="px-3 py-2.5 text-center font-semibold text-slate-600">{s.quantity}</td>
              <td className="px-3 py-2.5 text-end font-semibold text-slate-600 whitespace-nowrap">{money(s.unitPrice)}</td>
              <td className="px-3 py-2.5 text-end font-black text-slate-800 whitespace-nowrap">{money(s.unitPrice * s.quantity)}</td>
            </tr>
          ))}
          {showTotal && (
            <tr className="border-t-2 border-slate-200 bg-slate-50/60">
              <td colSpan={5} className="px-3 py-2.5 text-end text-[10px] font-black text-slate-500 uppercase tracking-widest">{txt.visitSubtotal}</td>
              <td className="px-3 py-2.5 text-end font-black text-slate-700 whitespace-nowrap">
                {money(stepsSum(steps))} {planCurrency}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );

  function stepsSum(steps: PlanStep[]): number {
    return steps.reduce((sum, s) => sum + (Number(s.unitPrice) || 0) * (Number(s.quantity) || 1), 0);
  }

  const renderVisits = (
    visits: Array<{ id?: string; label: string; date: string; time: string; steps: Array<PlanStep & { unmatched?: boolean }> }>,
    planCurrency: string
  ) => {
    const multi = visits.length > 1;
    return (
      <div className="space-y-4">
        {visits.map((v, vi) => (
          <div key={v.id || vi}>
            {(multi || v.label || v.date) && (
              <div className="flex flex-wrap items-center justify-between gap-2 mb-2 bg-slate-50 border border-slate-100 rounded-xl px-3.5 py-2">
                <span className="text-sm font-black text-slate-700 flex items-center gap-2 flex-wrap">
                  {v.label || `${txt.visit} ${vi + 1}`}
                  {stepsMinutes(v.steps) > 0 && (
                    <span className="text-[10px] font-black text-slate-400 bg-white border border-slate-200 rounded-full px-2 py-0.5">
                      ~{stepsMinutes(v.steps)} {txt.minutesPh}
                    </span>
                  )}
                </span>
                {renderVisitBadge(v, !multi)}
              </div>
            )}
            {renderStepsTable(v.steps, planCurrency, multi)}
          </div>
        ))}
        <div className="flex justify-end">
          <div className="bg-slate-900 text-white rounded-xl px-4 py-2.5 flex items-center gap-3">
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">{txt.total}</span>
            <span className="text-base font-black">{money(visitsTotal(visits as any))} {planCurrency}</span>
          </div>
        </div>
      </div>
    );
  };

  /** Powerful vs Super: the fast model at base price, or the deep-thinking model at double credits. */
  const renderModeToggle = (value: AiMode, onChange: (m: AiMode) => void, hint: string, disabled: boolean) => (
    <div className="flex items-center justify-between gap-3 flex-wrap">
      <div className="flex rounded-xl border border-slate-200 overflow-hidden shrink-0">
        <button
          onClick={() => onChange("power")}
          disabled={disabled}
          className={`flex items-center gap-1.5 px-3.5 py-2 text-xs font-black transition-colors disabled:opacity-60 ${
            value === "power" ? "bg-slate-800 text-white" : "bg-white text-slate-500 hover:bg-slate-50"
          }`}
        >
          <Zap size={13} /> {txt.modePower}
        </button>
        <button
          onClick={() => onChange("super")}
          disabled={disabled}
          className={`flex items-center gap-1.5 px-3.5 py-2 text-xs font-black transition-colors disabled:opacity-60 ${
            value === "super" ? "bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white" : "bg-white text-slate-500 hover:bg-slate-50"
          }`}
        >
          <Rocket size={13} /> {txt.modeSuper} <span className="opacity-80">×3</span>
        </button>
      </div>
      <span className="text-[11px] font-semibold text-slate-400 min-w-0">{hint}</span>
    </div>
  );

  const pdfLangToggle = (planId: string) => {
    const current = pdfLangFor(planId);
    return (
      <div className="flex items-center gap-1.5">
        <Languages size={14} className="text-slate-400" />
        <div className="flex rounded-lg border border-slate-200 overflow-hidden">
          {(["en", "ar"] as const).map((lng) => (
            <button
              key={lng}
              onClick={() => setPdfLangByPlan((prev) => ({ ...prev, [planId]: lng }))}
              title={txt.pdfLang}
              className={`px-2.5 py-1 text-[11px] font-black transition-colors ${
                current === lng ? "bg-slate-800 text-white" : "bg-white text-slate-500 hover:bg-slate-50"
              }`}
            >
              {lng === "en" ? "EN" : "ع"}
            </button>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="animate-in fade-in duration-300 space-y-6" dir={isRTL ? "rtl" : "ltr"}>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h3 className="text-lg font-black text-slate-800 flex items-center gap-2">
            <ClipboardList size={20} className="text-[#27ae60]" /> {txt.tabTitle}
          </h3>
          <p className="text-sm font-medium text-slate-500 mt-1">{txt.subtitle}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          <button
            onClick={() => { setDiagOpen(true); setDiagView("list"); }}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-sky-50 text-sky-700 border border-sky-200 text-sm font-bold hover:bg-sky-100 transition-colors"
          >
            <Stethoscope size={16} /> {txt.aiDiagnosis}
          </button>
          <button
            onClick={() => { setAiOpen(true); setAiOptions(null); }}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-violet-50 text-violet-700 border border-violet-200 text-sm font-bold hover:bg-violet-100 transition-colors"
          >
            <Sparkles size={16} /> {txt.aiSuggest}
          </button>
          <button
            onClick={openNewEditor}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#27ae60] text-white text-sm font-bold hover:bg-[#219653] transition-colors shadow-sm"
          >
            <Plus size={16} /> {txt.newPlan}
          </button>
        </div>
      </div>

      {/* Plans list */}
      {plansLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="animate-spin text-[#27ae60]" size={28} /></div>
      ) : plans.length === 0 ? (
        <div className="bg-white rounded-2xl border border-dashed border-slate-200 p-12 text-center">
          <ClipboardList size={36} className="mx-auto text-slate-300 mb-3" />
          <p className="text-sm font-semibold text-slate-500 max-w-md mx-auto leading-relaxed">{txt.empty}</p>
        </div>
      ) : (
        <div className="space-y-5">
          {plans.map((plan) => {
            const busy = busyPlanId === plan.id;
            return (
              <div key={plan.id} className="bg-white rounded-2xl border border-slate-100 shadow-[0_2px_10px_-3px_rgba(6,81,237,0.05)] p-5">
                <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h4 className="text-base font-black text-slate-800">{plan.title}</h4>
                      <span className={`text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full border ${
                        plan.source === "ai" ? "bg-violet-50 text-violet-600 border-violet-200" : "bg-slate-50 text-slate-500 border-slate-200"
                      }`}>
                        {plan.source === "ai" ? txt.aiBadge : txt.manualBadge}
                      </span>
                    </div>
                    <p className="text-xs font-semibold text-slate-400 mt-1">
                      {plan.createdAt?.toDate?.()?.toLocaleDateString(ar ? "ar-EG" : "en-GB", { day: "numeric", month: "short", year: "numeric" }) || ""}
                      {plan.doctorName ? ` · ${ar ? "د." : "Dr."} ${plan.doctorName}` : ""}
                    </p>
                  </div>
                  {/* Status selector */}
                  <div className="relative shrink-0">
                    <select
                      value={plan.status}
                      onChange={(e) => handleSetStatus(plan, e.target.value as TreatmentPlan["status"])}
                      className={`appearance-none cursor-pointer text-xs font-bold border rounded-full ps-3 pe-8 py-1.5 outline-none transition-colors ${statusChipClass(plan.status)}`}
                    >
                      {PLAN_STATUSES.map((s) => (
                        <option key={s} value={s}>{txt.statusLabels[s]}</option>
                      ))}
                    </select>
                    <ChevronDown size={13} className="absolute end-2.5 top-1/2 -translate-y-1/2 pointer-events-none opacity-60" />
                  </div>
                </div>

                {plan.description && (
                  <p className="text-sm font-medium text-slate-600 leading-relaxed mb-4 whitespace-pre-wrap">{plan.description}</p>
                )}

                {renderVisits(plan.visits, plan.currency || currency)}

                <div className="flex flex-wrap items-center gap-2 mt-4">
                  <button
                    onClick={() => openEditEditor(plan)}
                    className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold bg-slate-50 text-slate-600 border border-slate-200 hover:bg-slate-100 transition-colors"
                  >
                    <Edit2 size={14} /> {txt.edit}
                  </button>
                  {pdfLangToggle(plan.id)}
                  <button
                    onClick={() => handlePrint(plan)}
                    disabled={busy}
                    className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold bg-slate-50 text-slate-600 border border-slate-200 hover:bg-slate-100 transition-colors disabled:opacity-50"
                  >
                    {busy && busyAction === "print" ? <Loader2 size={14} className="animate-spin" /> : <Printer size={14} />} {txt.print}
                  </button>
                  <button
                    onClick={() => handleDownloadPdf(plan)}
                    disabled={busy}
                    className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold bg-slate-50 text-slate-600 border border-slate-200 hover:bg-slate-100 transition-colors disabled:opacity-50"
                  >
                    {busy && busyAction === "pdf" ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />} {txt.downloadPdf}
                  </button>
                  <button
                    onClick={() => handleSendWhatsApp(plan)}
                    disabled={busy}
                    className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 transition-colors disabled:opacity-50"
                  >
                    {busy && busyAction === "whatsapp" ? <Loader2 size={14} className="animate-spin" /> : <MessageCircle size={14} />} {txt.sendWhatsApp}
                  </button>
                  <button
                    onClick={() => handleDeletePlan(plan)}
                    className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold bg-rose-50 text-rose-600 border border-rose-100 hover:bg-rose-100 transition-colors ms-auto"
                  >
                    <Trash2 size={14} /> {txt.delete}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ---------- Editor modal ---------- */}
      {editorOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4" dir={isRTL ? "rtl" : "ltr"}>
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-4xl max-h-[92vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
              <h3 className="font-black text-slate-800 flex items-center gap-2">
                <ClipboardList size={18} className="text-[#27ae60]" />
                {editingPlanId ? (ar ? "تعديل خطة العلاج" : "Edit Treatment Plan") : (ar ? "خطة علاج جديدة" : "New Treatment Plan")}
              </h3>
              <button onClick={() => setEditorOpen(false)} className="p-2 rounded-xl text-slate-400 hover:bg-slate-100 transition-colors"><X size={18} /></button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5">{txt.planTitle}</label>
                  <input
                    value={formTitle}
                    onChange={(e) => setFormTitle(e.target.value)}
                    placeholder={txt.planTitlePh}
                    className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm font-bold text-slate-900 outline-none focus:border-[#27ae60] focus:ring-2 focus:ring-emerald-100 transition-all"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5">{txt.description}</label>
                  <input
                    value={formDescription}
                    onChange={(e) => setFormDescription(e.target.value)}
                    placeholder={txt.descriptionPh}
                    className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-800 outline-none focus:border-[#27ae60] focus:ring-2 focus:ring-emerald-100 transition-all"
                  />
                </div>
              </div>

              {/* Visits */}
              <div className="space-y-4">
                {formVisits.map((visit, vIdx) => (
                  <div key={visit.id} className="border border-slate-200 rounded-2xl overflow-hidden">
                    <div className="bg-slate-50 px-4 py-3 flex flex-wrap items-center gap-2 border-b border-slate-100">
                      <span className="w-7 h-7 shrink-0 rounded-full bg-[#27ae60] text-white text-xs font-black flex items-center justify-center">{vIdx + 1}</span>
                      <input
                        value={visit.label}
                        onChange={(e) => updateVisit(visit.id, { label: e.target.value })}
                        placeholder={txt.visitLabelPh}
                        className="flex-1 min-w-[160px] rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-800 outline-none focus:border-[#27ae60] transition-all"
                      />
                      {stepsMinutes(visit.steps) > 0 && (
                        <span className="text-[10px] font-black text-slate-500 bg-white border border-slate-200 rounded-full px-2 py-1 whitespace-nowrap">
                          ~{stepsMinutes(visit.steps)} {txt.minutesPh}
                        </span>
                      )}
                      <input
                        type="date"
                        value={visit.date}
                        onChange={(e) => updateVisit(visit.id, { date: e.target.value })}
                        className="rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs font-bold text-slate-700 outline-none focus:border-[#27ae60] transition-all"
                      />
                      <input
                        value={visit.time}
                        onChange={(e) => updateVisit(visit.id, { time: e.target.value })}
                        placeholder={ar ? "الوقت" : "Time"}
                        className="w-24 rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs font-bold text-slate-700 outline-none focus:border-[#27ae60] transition-all"
                      />
                      <button
                        onClick={() => openSlotPicker(visit)}
                        className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold border transition-colors ${
                          slotPickerVisitId === visit.id
                            ? "bg-[#27ae60] text-white border-[#27ae60]"
                            : "bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100"
                        }`}
                      >
                        <CalendarDays size={13} /> {txt.suggestDates}
                      </button>
                      {formVisits.length > 1 && (
                        <button
                          onClick={() => setFormVisits((prev) => prev.filter((v) => v.id !== visit.id))}
                          className="p-2 rounded-lg text-rose-400 hover:bg-rose-50 transition-colors"
                          title={txt.delete}
                        >
                          <Trash2 size={15} />
                        </button>
                      )}
                    </div>

                    {/* Free-slot picker */}
                    {slotPickerVisitId === visit.id && (
                      <div className="px-4 py-3 bg-emerald-50/40 border-b border-emerald-100">
                        {slotLoading ? (
                          <div className="flex items-center gap-2 text-xs font-bold text-slate-500 py-1">
                            <Loader2 size={14} className="animate-spin" /> {txt.loadingSlots}
                          </div>
                        ) : slotDays.length === 0 ? (
                          <p className="text-xs font-bold text-slate-500 py-1">{txt.noSlots}</p>
                        ) : (
                          <div className="space-y-2">
                            {slotDays.map((day) => (
                              <div key={day.date} className="flex flex-wrap items-center gap-1.5">
                                <span className="text-xs font-black text-slate-600 min-w-[120px]">
                                  {formatDateLabel(day.date, language as "en" | "ar")}
                                </span>
                                {day.times.slice(0, 6).map((time) => (
                                  <button
                                    key={time}
                                    onClick={() => {
                                      updateVisit(visit.id, { date: day.date, time });
                                      setSlotPickerVisitId(null);
                                    }}
                                    className="px-2.5 py-1 rounded-lg bg-white border border-emerald-200 text-[11px] font-bold text-emerald-700 hover:bg-emerald-600 hover:text-white hover:border-emerald-600 transition-colors"
                                  >
                                    {time}
                                  </button>
                                ))}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Steps in this visit */}
                    <div className="p-3.5 space-y-3">
                      {visit.steps.map((step) => (
                        <div key={step.id} className="bg-slate-50/70 border border-slate-100 rounded-2xl p-3.5">
                          <div className="flex items-start gap-2">
                            <div className="flex-1 grid grid-cols-1 md:grid-cols-12 gap-2">
                              <div className="md:col-span-5">
                                <ServiceCombobox
                                  services={services}
                                  value={step.serviceId || step.serviceName}
                                  valueKey={step.serviceId ? "id" : "name"}
                                  allowFreeText
                                  language={language}
                                  onChange={(value, service) => {
                                    if (service) {
                                      updateStep(visit.id, step.id, {
                                        serviceId: String(service.id),
                                        serviceName: service.name,
                                        unitPrice: Number(service.price) || 0,
                                      });
                                    } else {
                                      updateStep(visit.id, step.id, { serviceId: "", serviceName: value });
                                    }
                                  }}
                                />
                              </div>
                              <input
                                value={step.teeth}
                                onChange={(e) => updateStep(visit.id, step.id, { teeth: e.target.value })}
                                placeholder={txt.teethPh}
                                className="md:col-span-3 rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm font-semibold text-slate-800 outline-none focus:border-[#27ae60] transition-all"
                              />
                              <input
                                type="number"
                                min={1}
                                value={step.quantity}
                                onChange={(e) => updateStep(visit.id, step.id, { quantity: Math.max(1, Math.round(Number(e.target.value) || 1)) })}
                                title={txt.qty}
                                className="md:col-span-2 rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm font-semibold text-slate-800 outline-none focus:border-[#27ae60] transition-all"
                              />
                              <input
                                type="number"
                                min={0}
                                value={step.unitPrice}
                                onChange={(e) => updateStep(visit.id, step.id, { unitPrice: Math.max(0, Number(e.target.value) || 0) })}
                                title={txt.unitPrice}
                                className="md:col-span-2 rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm font-semibold text-slate-800 outline-none focus:border-[#27ae60] transition-all"
                              />
                              <input
                                value={step.note}
                                onChange={(e) => updateStep(visit.id, step.id, { note: e.target.value })}
                                placeholder={txt.notePh}
                                className="md:col-span-9 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs font-semibold text-slate-700 outline-none focus:border-[#27ae60] transition-all"
                              />
                              <div className="md:col-span-3 relative">
                                <input
                                  type="number"
                                  min={0}
                                  value={step.estimatedMinutes || ""}
                                  onChange={(e) => updateStep(visit.id, step.id, { estimatedMinutes: Math.max(0, Math.round(Number(e.target.value) || 0)) })}
                                  placeholder={txt.minutesPh}
                                  title={txt.minutesTitle}
                                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 pe-12 text-xs font-semibold text-slate-700 outline-none focus:border-[#27ae60] transition-all"
                                />
                                <span className="absolute end-3 top-1/2 -translate-y-1/2 text-[10px] font-bold text-slate-400 pointer-events-none">{txt.minutesPh}</span>
                              </div>
                            </div>
                            <button
                              onClick={() => updateVisit(visit.id, { steps: visit.steps.filter((s) => s.id !== step.id) })}
                              className="mt-2.5 p-2 rounded-lg text-rose-400 hover:bg-rose-50 transition-colors shrink-0"
                              title={txt.delete}
                            >
                              <Trash2 size={15} />
                            </button>
                          </div>
                          <div className="text-end text-xs font-black text-slate-500 mt-2">
                            {money(step.unitPrice * step.quantity)} {currency}
                          </div>
                        </div>
                      ))}
                      <button
                        onClick={() => updateVisit(visit.id, { steps: [...visit.steps, blankStep()] })}
                        className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 transition-colors"
                      >
                        <Plus size={14} /> {txt.addStep}
                      </button>
                    </div>
                  </div>
                ))}

                <button
                  onClick={() => setFormVisits((prev) => [...prev, blankVisit(prev.length + 1)])}
                  className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-2xl text-sm font-bold border-2 border-dashed border-slate-200 text-slate-500 hover:border-[#27ae60] hover:text-[#27ae60] transition-colors"
                >
                  <Plus size={16} /> {txt.addVisit}
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between gap-3 px-6 py-4 border-t border-slate-100 bg-slate-50/60 rounded-b-3xl">
              <div className="text-sm font-black text-slate-700">
                {txt.total}: <span className="text-[#27ae60]">{money(formTotal)} {currency}</span>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => setEditorOpen(false)} className="px-4 py-2.5 rounded-xl text-sm font-bold text-slate-500 hover:bg-slate-100 transition-colors">
                  {txt.cancel}
                </button>
                <button
                  onClick={handleSavePlan}
                  disabled={saving}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#27ae60] text-white text-sm font-bold hover:bg-[#219653] transition-colors disabled:opacity-60"
                >
                  {saving ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />} {txt.save}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ---------- Diagnosis discussion modal ---------- */}
      {diagOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-2 sm:p-4" dir={isRTL ? "rtl" : "ltr"}>
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-6xl h-[94vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 shrink-0">
              <h3 className="font-black text-slate-800 flex items-center gap-2 min-w-0">
                {diagView === "chat" && (
                  <button
                    onClick={() => setDiagView("list")}
                    title={txt.diagBack}
                    className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 transition-colors shrink-0"
                  >
                    <ArrowRight size={16} className={isRTL ? "" : "-scale-x-100"} />
                  </button>
                )}
                <Stethoscope size={18} className="text-sky-500 shrink-0" /> <span className="truncate">{txt.diagModalTitle}</span>
              </h3>
              <button onClick={() => setDiagOpen(false)} className="p-2 rounded-xl text-slate-400 hover:bg-slate-100 transition-colors"><X size={18} /></button>
            </div>

            {/* Saved discussions for this patient */}
            {diagView === "list" && (
              <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3 bg-slate-50/50">
                <p className="text-[13px] font-medium text-slate-500 leading-6 bg-sky-50 border border-sky-100 rounded-2xl px-4 py-3">
                  {txt.diagHint}
                </p>
                <button
                  onClick={() => openDiagSession(null)}
                  className="w-full flex items-center justify-center gap-2 px-4 py-3.5 rounded-2xl bg-sky-600 text-white text-sm font-bold hover:bg-sky-700 transition-colors"
                >
                  <Plus size={16} /> {txt.diagNew}
                </button>
                {diagSessions.length === 0 ? (
                  <p className="text-sm font-semibold text-slate-400 text-center py-8">{txt.diagNoSessions}</p>
                ) : (
                  diagSessions.map((s) => (
                    <div
                      key={s.id}
                      className="bg-white border border-slate-200 rounded-2xl px-4 py-3 flex items-center gap-3 hover:border-sky-300 transition-colors cursor-pointer"
                      onClick={() => openDiagSession(s)}
                    >
                      <Stethoscope size={16} className="text-sky-400 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-slate-800 truncate">{s.title}</p>
                        <p className="text-xs font-semibold text-slate-400">
                          {s.updatedMs
                            ? new Date(s.updatedMs).toLocaleDateString(ar ? "ar-EG" : "en-GB", { day: "numeric", month: "short", year: "numeric" })
                            : ""}
                          {" · "}
                          {s.messages.length} {txt.diagMsgCount}
                        </p>
                      </div>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDeleteDiagSession(s); }}
                        className="p-2 rounded-lg text-rose-400 hover:bg-rose-50 transition-colors shrink-0"
                        title={txt.delete}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))
                )}
              </div>
            )}

            {/* Messages */}
            {diagView === "chat" && (
            <div ref={diagScrollRef} className="flex-1 overflow-y-auto px-5 md:px-10 py-5 space-y-4 bg-slate-50/50">
              {diagMessages.length === 0 && (
                <>
                  <p className="text-[13px] font-medium text-slate-500 leading-6 bg-sky-50 border border-sky-100 rounded-2xl px-4 py-3">
                    {txt.diagHint}
                  </p>
                  <p className="text-sm font-semibold text-slate-400 text-center py-8">{txt.diagStart}</p>
                </>
              )}
              {diagMessages.map((m, i) => {
                const parsed = m.role === "assistant" ? extractDiagForm(m.content) : null;
                const form = parsed?.form || null;
                // A form is live only while it is the latest exchange — once the dentist has
                // sent anything after it, its answers are already in the conversation.
                const formAnswered = form ? diagMessages.some((mm, mi) => mi > i && mm.role === "user") : false;
                const values = diagFormValues[i] || {};
                const setValue = (fieldId: string, v: string) =>
                  setDiagFormValues((prev) => ({ ...prev, [i]: { ...(prev[i] || {}), [fieldId]: v } }));
                return (
                <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div className={`${m.role === "user" ? "max-w-[80%] bg-sky-600 text-white" : "max-w-[95%] md:max-w-[88%] bg-white border border-slate-200 text-slate-800"} rounded-2xl px-5 py-4`}>
                    {m.images && m.images.length > 0 && (
                      <div className="flex gap-2 mb-2.5 flex-wrap">
                        {m.images.map((src, si) => (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img key={si} src={src} alt="" className="w-24 h-24 object-cover rounded-lg border border-white/30" loading="lazy" />
                        ))}
                      </div>
                    )}
                    {m.role === "assistant" ? (
                      <>
                        <RichText text={parsed?.text || m.content} />
                        {form && (
                          <div className={`mt-3.5 rounded-2xl border p-4 ${formAnswered ? "border-slate-100 bg-slate-50/60 opacity-70" : "border-sky-200 bg-sky-50/50"}`}>
                            <div className="flex items-center justify-between gap-2 mb-3">
                              <p className="text-[13px] font-black text-sky-800 uppercase tracking-wide">
                                {form.title || txt.formDefaultTitle}
                              </p>
                              {formAnswered && (
                                <span className="text-[11px] font-black text-emerald-600">{txt.formSent}</span>
                              )}
                            </div>
                            <div className="space-y-3">
                              {form.fields.map((f) => (
                                <div key={f.id}>
                                  <label className="block text-[13px] font-bold text-slate-600 mb-1">{f.label}</label>
                                  {f.type === "yesno" || f.type === "choice" ? (
                                    <div className="flex flex-wrap gap-1.5">
                                      {(f.type === "yesno" ? [txt.formYes, txt.formNo] : f.options).map((opt) => (
                                        <button
                                          key={opt}
                                          disabled={formAnswered}
                                          onClick={() => setValue(f.id, values[f.id] === opt ? "" : opt)}
                                          className={`px-3.5 py-1.5 rounded-lg text-[13px] font-bold border transition-colors disabled:cursor-default ${
                                            values[f.id] === opt
                                              ? "bg-sky-600 text-white border-sky-600"
                                              : "bg-white text-slate-600 border-slate-200 hover:border-sky-300"
                                          }`}
                                        >
                                          {opt}
                                        </button>
                                      ))}
                                    </div>
                                  ) : (
                                    <div className="relative max-w-xs">
                                      <input
                                        type={f.type === "number" ? "number" : "text"}
                                        disabled={formAnswered}
                                        value={values[f.id] || ""}
                                        onChange={(e) => setValue(f.id, e.target.value)}
                                        className={`w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-[14px] font-semibold text-slate-800 outline-none focus:border-sky-400 transition-all disabled:bg-slate-50 ${f.unit ? "pe-12" : ""}`}
                                      />
                                      {f.unit && (
                                        <span className="absolute end-3 top-1/2 -translate-y-1/2 text-[11px] font-bold text-slate-400 pointer-events-none">{f.unit}</span>
                                      )}
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                            {!formAnswered && (
                              <button
                                onClick={() => submitDiagForm(i, form)}
                                disabled={diagSending}
                                className="mt-4 flex items-center gap-2 px-4 py-2.5 rounded-xl bg-sky-600 text-white text-[13px] font-bold hover:bg-sky-700 transition-colors disabled:opacity-60"
                              >
                                <Check size={14} /> {txt.formSend}
                              </button>
                            )}
                          </div>
                        )}
                      </>
                    ) : (
                      <p className="text-[15px] font-medium leading-7 whitespace-pre-wrap">{m.content}</p>
                    )}
                  </div>
                </div>
                );
              })}
              {diagSending && (
                <div className="flex justify-start">
                  <div className="bg-white border border-slate-200 rounded-2xl px-4 py-3 flex items-center gap-2 text-sm font-semibold text-slate-500">
                    <Loader2 size={14} className="animate-spin" /> {txt.diagThinking}
                  </div>
                </div>
              )}
            </div>
            )}

            {/* Gallery picker */}
            {diagView === "chat" && diagGalleryOpen && (
              <div className="border-t border-slate-100 px-5 py-3 max-h-44 overflow-y-auto shrink-0 bg-white">
                {patientMedia.length === 0 ? (
                  <p className="text-xs font-semibold text-slate-400 py-2">{txt.diagGalleryEmpty}</p>
                ) : (
                  <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
                    {patientMedia.map((m) => {
                      const selected = diagPendingImages.some((p) => p.value === m.url);
                      return (
                        <button
                          key={m.id}
                          onClick={() => {
                            if (selected) {
                              setDiagPendingImages((prev) => prev.filter((p) => p.value !== m.url));
                            } else if (diagPendingImages.length >= 3) {
                              showToast(txt.diagMaxImages, "error");
                            } else {
                              setDiagPendingImages((prev) => [...prev, { kind: "url", value: m.url, preview: m.url }]);
                            }
                          }}
                          className={`relative aspect-square rounded-xl overflow-hidden border-2 transition-all ${
                            selected ? "border-sky-500 ring-2 ring-sky-200" : "border-slate-200 hover:border-sky-300"
                          }`}
                          title={m.filename || m.category}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={m.url} alt={m.filename} className="w-full h-full object-cover" loading="lazy" />
                          {selected && (
                            <span className="absolute top-1 end-1 bg-sky-500 text-white rounded-full p-0.5"><Check size={12} /></span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Pending attachments */}
            {diagView === "chat" && diagPendingImages.length > 0 && (
              <div className="flex gap-2 px-5 py-2 border-t border-slate-100 shrink-0 bg-white">
                {diagPendingImages.map((p, pi) => (
                  <div key={pi} className="relative">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p.preview} alt="" className="w-14 h-14 object-cover rounded-lg border border-slate-200" />
                    <button
                      onClick={() => setDiagPendingImages((prev) => prev.filter((_, i) => i !== pi))}
                      className="absolute -top-1.5 -end-1.5 bg-rose-500 text-white rounded-full p-0.5"
                    >
                      <X size={11} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Input row */}
            {diagView === "chat" && (
            <div className="px-5 py-3.5 border-t border-slate-100 shrink-0 bg-white rounded-b-3xl">
              <div className="mb-2.5">
                {renderModeToggle(
                  diagMode,
                  setDiagMode,
                  diagMode === "super" ? txt.diagModeHintSuper : txt.diagModeHintPower,
                  diagSending || diagSummarizing
                )}
              </div>
              <div className="flex items-end gap-2">
                <input
                  ref={diagFileRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(e) => { handleDiagFiles(e.target.files); e.target.value = ""; }}
                />
                <button
                  onClick={() => diagFileRef.current?.click()}
                  disabled={diagSending}
                  title={txt.diagAttach}
                  className="p-2.5 rounded-xl text-slate-500 bg-slate-50 border border-slate-200 hover:bg-slate-100 transition-colors disabled:opacity-50 shrink-0"
                >
                  <Paperclip size={17} />
                </button>
                <button
                  onClick={() => setDiagGalleryOpen((v) => !v)}
                  disabled={diagSending}
                  title={txt.diagGallery}
                  className={`p-2.5 rounded-xl border transition-colors disabled:opacity-50 shrink-0 ${
                    diagGalleryOpen ? "bg-sky-500 text-white border-sky-500" : "text-slate-500 bg-slate-50 border-slate-200 hover:bg-slate-100"
                  }`}
                >
                  <ImagePlus size={17} />
                </button>
                <textarea
                  value={diagInput}
                  onChange={(e) => setDiagInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      if (!diagSending) sendDiagMessage();
                    }
                  }}
                  placeholder={txt.diagInputPh}
                  rows={1}
                  disabled={diagSending}
                  className="flex-1 rounded-xl border border-slate-200 px-4 py-3 text-[15px] font-semibold text-slate-800 outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100 transition-all resize-none disabled:opacity-60"
                />
                <button
                  onClick={() => sendDiagMessage()}
                  disabled={diagSending || (!diagInput.trim() && diagPendingImages.length === 0)}
                  className="p-3 rounded-xl bg-sky-600 text-white hover:bg-sky-700 transition-colors disabled:opacity-50 shrink-0"
                  title={txt.diagSend}
                >
                  <Send size={17} className={isRTL ? "-scale-x-100" : ""} />
                </button>
              </div>
              {diagMessages.some((m) => m.role === "assistant") && (
                <button
                  onClick={handleUseDiagnosisInPlan}
                  disabled={diagSummarizing || diagSending}
                  className="mt-2.5 w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-violet-600 text-white text-sm font-bold hover:bg-violet-700 transition-colors disabled:opacity-60"
                >
                  {diagSummarizing ? (
                    <><Loader2 size={15} className="animate-spin" /> {txt.diagSummarizing}</>
                  ) : (
                    <><ArrowRight size={15} className={isRTL ? "-scale-x-100" : ""} /> {txt.diagUseInPlan}</>
                  )}
                </button>
              )}
            </div>
            )}
          </div>
        </div>
      )}

      {/* ---------- AI modal ---------- */}
      {aiOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4" dir={isRTL ? "rtl" : "ltr"}>
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-3xl max-h-[92vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
              <h3 className="font-black text-slate-800 flex items-center gap-2">
                <Sparkles size={18} className="text-violet-500" /> {txt.aiModalTitle}
              </h3>
              <button onClick={() => setAiOpen(false)} className="p-2 rounded-xl text-slate-400 hover:bg-slate-100 transition-colors"><X size={18} /></button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
              {!aiOptions && (
                <>
                  <p className="text-sm font-medium text-slate-500 leading-relaxed bg-violet-50/60 border border-violet-100 rounded-2xl px-4 py-3">
                    {txt.aiHint}
                  </p>
                  <textarea
                    value={aiInstructions}
                    onChange={(e) => setAiInstructions(e.target.value)}
                    placeholder={txt.aiInstructionsPh}
                    rows={3}
                    disabled={aiLoading}
                    className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-800 outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 transition-all resize-y disabled:opacity-60"
                  />
                  {renderModeToggle(
                    aiMode,
                    setAiMode,
                    aiMode === "super" ? txt.planModeHintSuper : txt.planModeHintPower,
                    aiLoading
                  )}
                  <button
                    onClick={() => handleGenerateAi(false)}
                    disabled={aiLoading}
                    className="w-full flex items-center justify-center gap-2 px-5 py-3.5 rounded-2xl bg-violet-600 text-white text-sm font-bold hover:bg-violet-700 transition-colors disabled:opacity-70"
                  >
                    {aiLoading ? (
                      <><Loader2 size={16} className="animate-spin" /> {txt.generating}</>
                    ) : (
                      <><Sparkles size={16} /> {txt.generate}</>
                    )}
                  </button>
                </>
              )}

              {aiOptions && (
                <>
                  {renderModeToggle(
                    aiMode,
                    setAiMode,
                    aiMode === "super" ? txt.planModeHintSuper : txt.planModeHintPower,
                    aiLoading || aiSavingIdx !== null
                  )}
                  {/* The AI's questions about durations and visit division — answering refines the plans. */}
                  {aiQuestions.length > 0 && (
                    <div className="border border-amber-200 bg-amber-50/60 rounded-2xl p-4 space-y-3">
                      <h5 className="text-sm font-black text-amber-800">{txt.aiQuestionsTitle}</h5>
                      <ol className="space-y-1.5 ps-5 list-decimal">
                        {aiQuestions.map((q, qi) => (
                          <li key={qi} className="text-sm font-semibold text-amber-900 leading-relaxed">{q}</li>
                        ))}
                      </ol>
                      <textarea
                        value={aiAnswers}
                        onChange={(e) => setAiAnswers(e.target.value)}
                        placeholder={txt.aiAnswersPh}
                        rows={3}
                        disabled={aiLoading}
                        className="w-full rounded-xl border border-amber-200 bg-white px-4 py-3 text-sm font-semibold text-slate-800 outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100 transition-all resize-y disabled:opacity-60"
                      />
                      <button
                        onClick={() => handleGenerateAi(true)}
                        disabled={aiLoading || !aiAnswers.trim()}
                        className="w-full flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-amber-500 text-white text-sm font-bold hover:bg-amber-600 transition-colors disabled:opacity-60"
                      >
                        {aiLoading ? (
                          <><Loader2 size={15} className="animate-spin" /> {txt.generating}</>
                        ) : (
                          <><Check size={15} /> {txt.refine}</>
                        )}
                      </button>
                    </div>
                  )}

                  <div className="space-y-5">
                    {aiOptions.map((option, idx) => (
                      <div key={idx} className="border border-violet-100 rounded-2xl p-4 bg-violet-50/30">
                        <div className="flex flex-wrap items-start justify-between gap-3 mb-2">
                          <h4 className="text-base font-black text-slate-800">{option.title}</h4>
                          <button
                            onClick={() => handleSaveAiOption(option, idx)}
                            disabled={aiSavingIdx !== null}
                            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold bg-violet-600 text-white hover:bg-violet-700 transition-colors disabled:opacity-60 shrink-0"
                          >
                            {aiSavingIdx === idx ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} {txt.saveOption}
                          </button>
                        </div>
                        {option.description && (
                          <p className="text-sm font-medium text-slate-600 leading-relaxed mb-3 whitespace-pre-wrap">{option.description}</p>
                        )}
                        {renderVisits(option.visits, currency)}
                      </div>
                    ))}
                  </div>
                  <button
                    onClick={() => { setAiOptions(null); setAiQuestions([]); setAiAnswers(""); }}
                    disabled={aiLoading || aiSavingIdx !== null}
                    className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-xs font-bold bg-slate-50 text-slate-600 border border-slate-200 hover:bg-slate-100 transition-colors disabled:opacity-60"
                  >
                    <Sparkles size={14} /> {txt.tryAgain}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
