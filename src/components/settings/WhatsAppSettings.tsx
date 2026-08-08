"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { MessageCircle, Save, Loader2, Sparkles, Send, Plug, CheckCircle2, AlertCircle } from "lucide-react";
import { doc, onSnapshot, setDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { WHATSAPP_DIAL_COUNTRIES, buildE164FromDialAndNational } from "@/lib/whatsappDialCountries";
import { useLanguage } from "@/context/LanguageContext";
import { useAuth } from "@/context/AuthContext";
import { useUI } from "@/context/UIContext";
import { logActivity } from "@/lib/logger";
import type {
  OwnerAlertKey,
  WhatsAppMessageTemplate,
  WhatsAppSettingsDocument,
  WhatsAppTemplateType,
} from "@/types/whatsapp";
import { WHATSAPP_SETTINGS_DOC_REF } from "@/types/whatsapp";
import { WHATSAPP_DEFAULT_BODIES } from "@/lib/whatsappDefaultBodies";
import type { WapilotConfigStatus } from "@/types/wapilot";
import { getClinicCollection, getClinicDoc } from "@/lib/db-utils";


const OWNER_ALERT_MATRIX: { module: "appointments" | "finance"; labelEn: string; labelAr: string; keys: OwnerAlertKey[] }[] = [
  {
    module: "appointments",
    labelEn: "Appointments",
    labelAr: "المواعيد",
    keys: ["appointment_add", "appointment_edit", "appointment_delete"],
  },
  {
    module: "finance",
    labelEn: "Finance",
    labelAr: "المالية",
    keys: ["finance_add", "finance_edit", "finance_delete"],
  },
];

const ACTION_HEADERS = [
  { key: "add" as const, labelEn: "Add", labelAr: "إضافة" },
  { key: "edit" as const, labelEn: "Edit", labelAr: "تعديل" },
  { key: "delete" as const, labelEn: "Delete", labelAr: "حذف" },
];

function newId() {
  return typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `tpl_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

const ALL_TEMPLATE_TYPES: WhatsAppTemplateType[] = [
  "new",
  "edit",
  "cancel",
  "invoice",
  "treatment",
  "reminder24h",
  "google_review",
];

function isTemplateType(v: unknown): v is WhatsAppTemplateType {
  return (
    v === "new" ||
    v === "edit" ||
    v === "cancel" ||
    v === "invoice" ||
    v === "treatment" ||
    v === "reminder24h" ||
    v === "google_review"
  );
}

function defaultBodyForType(type: WhatsAppTemplateType): Omit<WhatsAppMessageTemplate, "id"> {
  return {
    type,
    message: WHATSAPP_DEFAULT_BODIES[type] || "",
    isActive: true,
  };
}

function defaultTemplates(): WhatsAppMessageTemplate[] {
  return ALL_TEMPLATE_TYPES.map((type) => ({
    id: newId(),
    ...defaultBodyForType(type),
  }));
}

function normalizeFromFirestore(data: Record<string, unknown> | undefined): WhatsAppSettingsDocument {
  const templatesRaw = Array.isArray(data?.templates) ? data!.templates : [];
  const fromDb = new Map<WhatsAppTemplateType, WhatsAppMessageTemplate>();

  for (const t of templatesRaw) {
    const row = t as Record<string, unknown>;
    if (!isTemplateType(row.type)) continue;
    const message = typeof row.message === "string" ? row.message : "";
    if (!message.trim()) continue;
    fromDb.set(row.type, {
      id: typeof row.id === "string" ? row.id : newId(),
      type: row.type,
      message,
      isActive: row.isActive !== false,
    });
  }

  const templates: WhatsAppMessageTemplate[] = ALL_TEMPLATE_TYPES.map((type) => {
    const existing = fromDb.get(type);
    if (existing) return existing;
    return { id: newId(), ...defaultBodyForType(type) };
  });

  const ownerAlerts =
    data?.ownerAlerts && typeof data.ownerAlerts === "object" && data.ownerAlerts !== null
      ? (data.ownerAlerts as WhatsAppSettingsDocument["ownerAlerts"])
      : {};

  return {
    isPatientAutomationEnabled: Boolean(data?.isPatientAutomationEnabled),
    templates,
    ownerNumber: typeof data?.ownerNumber === "string" ? data.ownerNumber : "",
    ownerAlerts,
  };
}

export default function WhatsAppSettings() {
  const { language, isRTL } = useLanguage();
  const { user } = useAuth();
  const { showToast } = useUI();

  const [hasLoaded, setHasLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [state, setState] = useState<WhatsAppSettingsDocument>({
    isPatientAutomationEnabled: false,
    templates: defaultTemplates(),
    ownerNumber: "",
    ownerAlerts: {},
  });

  const [templateType, setTemplateType] = useState<WhatsAppTemplateType>("new");
  const [draftMessage, setDraftMessage] = useState("");
  const [draftActive, setDraftActive] = useState(true);

  const [testCountryIso, setTestCountryIso] = useState("EG");
  const [testNational, setTestNational] = useState("");
  const [testMessage, setTestMessage] = useState("");
  const [testSending, setTestSending] = useState(false);

  const [wapilotInstanceId, setWapilotInstanceId] = useState("");
  const [wapilotTokenDraft, setWapilotTokenDraft] = useState("");
  const [wapilotApiBaseUrl, setWapilotApiBaseUrl] = useState("");
  const [wapilotPhoneHint, setWapilotPhoneHint] = useState("");
  const [wapilotStatus, setWapilotStatus] = useState<WapilotConfigStatus | null>(null);
  const [wapilotLoading, setWapilotLoading] = useState(true);
  const [wapilotSaving, setWapilotSaving] = useState(false);
  const [showAdvancedWapilot, setShowAdvancedWapilot] = useState(false);

  const testDial = useMemo(() => WHATSAPP_DIAL_COUNTRIES.find((c) => c.iso === testCountryIso)?.dial ?? "20", [testCountryIso]);
  const testE164Preview = useMemo(() => buildE164FromDialAndNational(testDial, testNational), [testDial, testNational]);

  const txt = useMemo(
    () => ({
      title: language === "ar" ? "واتساب" : "WhatsApp",
      subtitle:
        language === "ar"
          ? "أتمتة رسائل المرضى وتنبيهات المالك"
          : "Patient automation & owner alerts",
      patientCard: language === "ar" ? "أتمتة رسائل المرضى" : "Patient automation",
      patientToggle: language === "ar" ? "تفعيل الرسائل التلقائية للمرضى" : "Enable automated patient messages",
      templateType: language === "ar" ? "نوع القالب" : "Template type",
      templateHint:
        language === "ar"
          ? "متغيرات: {{patient_name}} {{date}} {{time}} {{doctor}} {{clinic_name}} {{google_link}} — الفاتورة والعلاج كما سبق."
          : "Variables: {{patient_name}} {{date}} {{time}} {{doctor}} {{clinic_name}} {{google_link}} — invoice/treatment unchanged.",
      invoiceHint:
        language === "ar"
          ? "عند تسجيل دفعة يُرسل هذا القالب تلقائياً. المتغيرات: {{patient_name}} {{amount}} {{method}} {{description}} {{balance}} {{clinic_name}}"
          : "Sent automatically when you record a payment. Variables: {{patient_name}} {{amount}} {{method}} {{description}} {{balance}} {{clinic_name}}",
      paymentAutomationHint:
        language === "ar"
          ? "المواعيد تستخدم «موعد جديد». الدفعات تستخدم «فاتورة / سجل مالي». التذكير قبل ٢٤ ساعة يستخدم «تذكير قبل ٢٤ ساعة» ويُرسل يومياً تلقائياً لمواعيد الغد (بعد النشر على Vercel)."
          : "Appointments use \"New appointment\". Payments use \"Invoice / ledger line\". The 24h reminder uses \"24h reminder (scheduled)\" and runs daily for tomorrow's visits (after Vercel deploy).",
      reminder24hHint:
        language === "ar"
          ? "يُرسل تلقائياً مرة يومياً (~٩ صباحاً بتوقيت العيادة) لكل موعد غداً. المتغيرات: {{patient_name}} {{date}} {{time}} {{doctor}} {{clinic_name}}"
          : "Sent automatically once per day (~9 AM clinic time) for every appointment dated tomorrow. Variables: {{patient_name}} {{date}} {{time}} {{doctor}} {{clinic_name}}",
      googleReviewHint:
        language === "ar"
          ? "{{patient_name}}، {{clinic_name}}، {{google_link}} — يُملأ من رابط التقييم في إعدادات العيادة (وليس رابط الخرائط فقط). احذف {{google_link}} إن لم ترغب بالرابط."
          : "{{patient_name}}, {{clinic_name}}, {{google_link}} — filled from the Google review link in Clinic settings (direct review URL). Remove {{google_link}} if you don’t want a link.",
      message: language === "ar" ? "نص الرسالة" : "Message",
      active: language === "ar" ? "نشط" : "Active",
      saveTemplate: language === "ar" ? "حفظ القالب" : "Save template",
      ownerCard: language === "ar" ? "تنبيهات المالك" : "Owner alerts",
      ownerNumber: language === "ar" ? "رقم واتساب المالك" : "Owner WhatsApp number",
      ownerHint: language === "ar" ? "صيغة دولية مفضلة (+2010...)" : "Prefer E.164 format (+2010...)",
      alertGrid: language === "ar" ? "قواعد التنبيه" : "Alert rules",
      saveAll: language === "ar" ? "حفظ الإعدادات" : "Save settings",
      saved: language === "ar" ? "تم الحفظ" : "Saved",
      failed: language === "ar" ? "فشل الحفظ" : "Save failed",
      templateSaved: language === "ar" ? "تم تحديث القالب" : "Template updated",
      types: {
        new: language === "ar" ? "موعد جديد" : "New appointment",
        edit: language === "ar" ? "إعادة جدولة / تحديث" : "Reschedule / update",
        cancel: language === "ar" ? "إلغاء موعد" : "Cancel appointment",
        invoice: language === "ar" ? "فاتورة / سجل مالي" : "Invoice / ledger line",
        treatment: language === "ar" ? "ملخص علاج (ملاحظة سريرية)" : "Treatment (clinical note)",
        reminder24h: language === "ar" ? "تذكير قبل ٢٤ ساعة (آلي)" : "24h reminder (scheduled)",
        google_review: language === "ar" ? "طلب تقييم جوجل" : "Google review request",
      },
      testCard: language === "ar" ? "اختبار واتساب" : "WhatsApp API test",
      testHint:
        language === "ar"
          ? "اختر الدولة ثم أدخل الرقم المحلي (بدون كود الدولة). سيتم إرسال رسالة تجريبية."
          : "Pick country, enter local number (no country code). Sends one test message.",
      testCountry: language === "ar" ? "الدولة" : "Country",
      testNational: language === "ar" ? "رقم واتساب (محلي)" : "WhatsApp number (local)",
      testNationalPh: language === "ar" ? "مثال: 1001234567 أو 01001234567" : "e.g. 1001234567 or 01001234567",
      testPreview: language === "ar" ? "المعاينة" : "Preview",
      testMessage: language === "ar" ? "نص اختياري" : "Optional message",
      testSend: language === "ar" ? "إرسال اختبار" : "Send test",
      testOk: language === "ar" ? "تم إرسال الاختبار" : "Test message sent",
      testFail: language === "ar" ? "فشل الإرسال" : "Send failed",
      testNeedPhone: language === "ar" ? "أدخل رقمًا صالحًا" : "Enter a valid number",
      testNeedAuth: language === "ar" ? "سجّل الدخول أولاً" : "Sign in required",
      wapilotCard: language === "ar" ? "اتصال Wapilot" : "Wapilot connection",
      wapilotHint:
        language === "ar"
          ? "يُحفظ في قاعدة بيانات العيادة (لا حاجة لإعادة نشر Vercel عند تغيير التوكن). متغيرات البيئة اختيارية كنسخة احتياطية."
          : "Saved in this clinic’s database (no Vercel redeploy when you rotate the token). Environment variables are optional fallback.",
      instanceId: language === "ar" ? "معرّف المثيل (Instance ID)" : "Instance ID",
      apiToken: language === "ar" ? "رمز API (Token)" : "API token",
      tokenPlaceholder:
        language === "ar"
          ? wapilotStatus?.tokenSet
            ? "اتركه فارغاً للإبقاء على التوكن الحالي"
            : "الصق التوكن من لوحة Wapilot"
          : wapilotStatus?.tokenSet
            ? "Leave blank to keep current token"
            : "Paste token from Wapilot dashboard",
      saveConnection: language === "ar" ? "حفظ الاتصال" : "Save connection",
      connectionSaved: language === "ar" ? "تم حفظ اتصال Wapilot" : "Wapilot connection saved",
      advanced: language === "ar" ? "إعدادات متقدمة" : "Advanced",
      apiBaseUrl: language === "ar" ? "رابط API (اختياري)" : "API base URL (optional)",
      phoneHint: language === "ar" ? "رقم واتساب المرسل (للعرض فقط)" : "Sender WhatsApp number (display only)",
      statusFirestore: language === "ar" ? "محفوظ في قاعدة البيانات" : "Saved in database",
      statusEnv: language === "ar" ? "يستخدم متغيرات Vercel" : "Using Vercel env fallback",
      statusNone: language === "ar" ? "غير مُعدّ" : "Not configured",
    }),
    [language, wapilotStatus?.tokenSet]
  );

  const loadWapilotStatus = useCallback(async () => {
    const firebaseUser = auth.currentUser;
    if (!firebaseUser) {
      setWapilotLoading(false);
      return;
    }
    setWapilotLoading(true);
    try {
      const idToken = await firebaseUser.getIdToken();
      const res = await fetch("/api/admin/wapilot-config", {
        headers: { Authorization: `Bearer ${idToken}` },
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) throw new Error(data?.error || "Failed to load");
      const status: WapilotConfigStatus = {
        configured: Boolean(data.configured),
        source: data.source || "none",
        instanceId: typeof data.instanceId === "string" ? data.instanceId : "",
        tokenSet: Boolean(data.tokenSet),
        apiBaseUrl: data.apiBaseUrl,
        sendPath: data.sendPath,
        sendDocumentPath: data.sendDocumentPath,
        connectedPhoneHint: data.connectedPhoneHint,
        updatedAt: data.updatedAt,
      };
      setWapilotStatus(status);
      setWapilotInstanceId(status.instanceId);
      setWapilotApiBaseUrl(status.apiBaseUrl || "");
      setWapilotPhoneHint(status.connectedPhoneHint || "");
      setWapilotTokenDraft("");
    } catch (e) {
      console.error(e);
      setWapilotStatus(null);
    } finally {
      setWapilotLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadWapilotStatus();
  }, [loadWapilotStatus]);

  const handleSaveWapilotConnection = async () => {
    const firebaseUser = auth.currentUser;
    if (!firebaseUser) {
      showToast(txt.testNeedAuth, "error");
      return;
    }
    if (!wapilotInstanceId.trim()) {
      showToast(language === "ar" ? "أدخل معرّف المثيل" : "Enter Instance ID", "error");
      return;
    }
    if (!wapilotStatus?.tokenSet && !wapilotTokenDraft.trim()) {
      showToast(language === "ar" ? "أدخل رمز API" : "Enter API token", "error");
      return;
    }
    setWapilotSaving(true);
    try {
      const idToken = await firebaseUser.getIdToken();
      const res = await fetch("/api/admin/wapilot-config", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          instanceId: wapilotInstanceId.trim(),
          apiToken: wapilotTokenDraft.trim() || undefined,
          apiBaseUrl: wapilotApiBaseUrl.trim() || undefined,
          connectedPhoneHint: wapilotPhoneHint.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) throw new Error(data?.error || "Save failed");
      showToast(txt.connectionSaved, "success");
      setWapilotTokenDraft("");
      await loadWapilotStatus();
      await logActivity(
        { uid: user?.uid, name: user?.name, role: user?.role },
        "Wapilot connection updated",
        "settings/wapilot"
      );
    } catch (e) {
      console.error(e);
      showToast(
        `${language === "ar" ? "فشل الحفظ" : "Save failed"}: ${e instanceof Error ? e.message : ""}`.trim(),
        "error"
      );
    } finally {
      setWapilotSaving(false);
    }
  };

  const syncDraftFromType = useCallback(
    (type: WhatsAppTemplateType, templates: WhatsAppMessageTemplate[]) => {
      const found = templates.find((t) => t.type === type);
      setDraftMessage(found?.message ?? "");
      setDraftActive(found?.isActive ?? true);
    },
    []
  );

  useEffect(() => {
    const unsub = onSnapshot(getClinicDoc(WHATSAPP_SETTINGS_DOC_REF.collection, WHATSAPP_SETTINGS_DOC_REF.docId), (snap) => {
      const next = normalizeFromFirestore(snap.exists() ? (snap.data() as Record<string, unknown>) : undefined);
      setState(next);
      setHasLoaded(true);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    syncDraftFromType(templateType, state.templates);
  }, [templateType, state.templates, syncDraftFromType]);

  const persist = async (next: WhatsAppSettingsDocument, toastMode: "default" | "template" | "silent" | "none" = "default") => {
    setSaving(true);
    try {
      // Must be the same doc the listener above reads (settings/whatsapp). This wrote to
      // `whatsappSettings/config` — a path with no readers anywhere in the app or the API
      // routes — so every template and owner-alert toggle saved here was silently discarded,
      // and the assistant's trigger_whatsapp_appointment tool always loaded an empty config.
      await setDoc(
        getClinicDoc(WHATSAPP_SETTINGS_DOC_REF.collection, WHATSAPP_SETTINGS_DOC_REF.docId),
        {
          ...next,
          updatedAt: new Date().toISOString(),
        },
        { merge: true }
      );
      await logActivity(
        { uid: user?.uid, name: user?.name, role: user?.role },
        "WhatsApp settings updated",
        "settings/whatsapp"
      );
      if (toastMode === "default") showToast(txt.saved, "success");
      if (toastMode === "template") showToast(txt.templateSaved, "success");
      /* silent | none: no toast (used when auto-saving toggles so we don't spam) */
    } catch (e) {
      console.error(e);
      showToast(txt.failed, "error");
    } finally {
      setSaving(false);
    }
  };

  const handleSaveTemplate = () => {
    const trimmed = draftMessage.trim();
    if (!trimmed) {
      showToast(language === "ar" ? "أدخل نص الرسالة" : "Enter a message", "error");
      return;
    }
    const others = state.templates.filter((t) => t.type !== templateType);
    const existing = state.templates.find((t) => t.type === templateType);
    const merged: WhatsAppMessageTemplate[] = [
      ...others,
      {
        id: existing?.id ?? newId(),
        type: templateType,
        message: trimmed,
        isActive: draftActive,
      },
    ];
    const next = { ...state, templates: merged };
    setState(next);
    void persist(next, "template");
  };

  const toggleOwnerAlert = (key: OwnerAlertKey, value: boolean) => {
    setState((prev) => ({
      ...prev,
      ownerAlerts: { ...prev.ownerAlerts, [key]: value },
    }));
  };

  const handleSendTest = async () => {
    const e164 = testE164Preview;
    if (!e164 || e164.length < 10) {
      showToast(txt.testNeedPhone, "error");
      return;
    }
    const firebaseUser = auth.currentUser;
    if (!firebaseUser) {
      showToast(txt.testNeedAuth, "error");
      return;
    }
    setTestSending(true);
    try {
      const idToken = await firebaseUser.getIdToken();
      const res = await fetch("/api/whatsapp/test", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          dialCode: testDial,
          nationalNumber: testNational,
          message: testMessage.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || "Request failed");
      }
      showToast(txt.testOk, "success");
    } catch (e) {
      console.error(e);
      showToast(`${txt.testFail}: ${e instanceof Error ? e.message : ""}`.trim(), "error");
    } finally {
      setTestSending(false);
    }
  };

  if (!hasLoaded) {
    return (
      <div className="flex items-center justify-center py-24 text-slate-500">
        <Loader2 className="animate-spin w-8 h-8 text-primary-500" />
      </div>
    );
  }

  return (
    <div className="space-y-6" dir={isRTL ? "rtl" : "ltr"}>
      <div className="flex items-start gap-4">
        <div className="bg-primary-50 p-3 rounded-2xl text-primary-600 border border-primary-100 shrink-0">
          <MessageCircle size={24} />
        </div>
        <div>
          <h2 className="text-xl font-black text-slate-900 tracking-tight">{txt.title}</h2>
          <p className="text-sm text-slate-500 font-medium mt-1">{txt.subtitle}</p>
        </div>
      </div>

      <section className="rounded-2xl xl:rounded-3xl bg-white border border-violet-200/80 shadow-sm ring-1 ring-violet-100 p-5 xl:p-6 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-2 text-violet-700">
            <Plug size={18} />
            <div>
              <h3 className="text-sm font-black uppercase tracking-wider text-slate-800">{txt.wapilotCard}</h3>
              <p className="text-xs text-slate-500 font-medium mt-0.5 max-w-xl">{txt.wapilotHint}</p>
            </div>
          </div>
          {wapilotLoading ? (
            <Loader2 size={18} className="animate-spin text-violet-500" />
          ) : wapilotStatus?.configured ? (
            <span className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-3 py-1.5 rounded-full">
              <CheckCircle2 size={14} />
              {wapilotStatus.source === "firestore" ? txt.statusFirestore : txt.statusEnv}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-xs font-bold text-amber-800 bg-amber-50 border border-amber-200 px-3 py-1.5 rounded-full">
              <AlertCircle size={14} />
              {txt.statusNone}
            </span>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <label className="block">
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">{txt.instanceId}</span>
            <input
              value={wapilotInstanceId}
              onChange={(e) => setWapilotInstanceId(e.target.value)}
              className="mt-1.5 w-full py-3 px-4 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-800 outline-none focus:bg-white focus:border-violet-500 focus:ring-2 focus:ring-violet-500/15"
              placeholder="e.g. your-wapilot-instance-id"
            />
          </label>
          <label className="block">
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">{txt.apiToken}</span>
            <input
              type="password"
              value={wapilotTokenDraft}
              onChange={(e) => setWapilotTokenDraft(e.target.value)}
              autoComplete="new-password"
              className="mt-1.5 w-full py-3 px-4 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-800 outline-none focus:bg-white focus:border-violet-500 focus:ring-2 focus:ring-violet-500/15"
              placeholder={txt.tokenPlaceholder}
            />
          </label>
        </div>

        <button
          type="button"
          onClick={() => setShowAdvancedWapilot((v) => !v)}
          className="text-xs font-bold text-violet-600 hover:text-violet-800"
        >
          {txt.advanced} {showAdvancedWapilot ? "▲" : "▼"}
        </button>

        {showAdvancedWapilot && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label className="block">
              <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">{txt.apiBaseUrl}</span>
              <input
                value={wapilotApiBaseUrl}
                onChange={(e) => setWapilotApiBaseUrl(e.target.value)}
                className="mt-1.5 w-full py-3 px-4 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-800 outline-none focus:bg-white focus:border-violet-500"
                placeholder="https://api.wapilot.net/api/v2"
              />
            </label>
            <label className="block">
              <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">{txt.phoneHint}</span>
              <input
                value={wapilotPhoneHint}
                onChange={(e) => setWapilotPhoneHint(e.target.value)}
                className="mt-1.5 w-full py-3 px-4 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-800 outline-none focus:bg-white focus:border-violet-500"
                placeholder="+20..."
              />
            </label>
          </div>
        )}

        <button
          type="button"
          onClick={() => void handleSaveWapilotConnection()}
          disabled={wapilotSaving || wapilotLoading}
          className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-violet-600 text-white text-xs font-black uppercase tracking-widest hover:bg-violet-700 disabled:opacity-50 transition-all"
        >
          {wapilotSaving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
          {txt.saveConnection}
        </button>
      </section>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* Patient automation */}
        <section className="rounded-2xl xl:rounded-3xl bg-white border border-slate-200/80 shadow-sm ring-1 ring-slate-100 p-5 xl:p-6 flex flex-col gap-5">
          <div className="flex items-center gap-2 text-primary-600">
            <Sparkles size={18} />
            <h3 className="text-sm font-black uppercase tracking-wider text-slate-800">{txt.patientCard}</h3>
          </div>

          <label className="flex items-center justify-between gap-4 cursor-pointer rounded-xl border border-slate-200 bg-slate-50/80 px-4 py-3">
            <span className="text-sm font-bold text-slate-700">{txt.patientToggle}</span>
            <input
              type="checkbox"
              className="h-5 w-5 rounded border-slate-300 text-primary-600 focus:ring-primary-500 shrink-0"
              checked={state.isPatientAutomationEnabled}
              onChange={(e) => {
                const checked = e.target.checked;
                setState((s) => {
                  const next = { ...s, isPatientAutomationEnabled: checked };
                  void persist(next, "silent");
                  return next;
                });
              }}
            />
          </label>

          <p className="text-xs text-slate-600 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2.5 leading-relaxed">
            {txt.paymentAutomationHint}
          </p>

          <div className="space-y-3">
            <label className="block">
              <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">{txt.templateType}</span>
              <select
                value={templateType}
                onChange={(e) => setTemplateType(e.target.value as WhatsAppTemplateType)}
                className="mt-1.5 w-full py-3 px-4 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-800 outline-none focus:bg-white focus:border-primary-500 focus:ring-2 focus:ring-primary-500/15"
              >
                <option value="new">{txt.types.new}</option>
                <option value="edit">{txt.types.edit}</option>
                <option value="cancel">{txt.types.cancel}</option>
                <option value="invoice">{txt.types.invoice}</option>
                <option value="treatment">{txt.types.treatment}</option>
                <option value="reminder24h">{txt.types.reminder24h}</option>
                <option value="google_review">{txt.types.google_review}</option>
              </select>
            </label>
            <p className="text-xs text-slate-400 font-medium">
              {templateType === "google_review"
                ? txt.googleReviewHint
                : templateType === "invoice"
                  ? txt.invoiceHint
                  : templateType === "reminder24h"
                    ? txt.reminder24hHint
                    : txt.templateHint}
            </p>
            <label className="block">
              <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">{txt.message}</span>
              <textarea
                value={draftMessage}
                onChange={(e) => setDraftMessage(e.target.value)}
                rows={5}
                className="mt-1.5 w-full py-3 px-4 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-800 outline-none focus:bg-white focus:border-primary-500 focus:ring-2 focus:ring-primary-500/15 resize-y min-h-[120px]"
              />
            </label>
            <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
              <input
                type="checkbox"
                checked={draftActive}
                onChange={(e) => setDraftActive(e.target.checked)}
                className="rounded border-slate-300 text-primary-600 focus:ring-primary-500"
              />
              {txt.active}
            </label>
            <button
              type="button"
              onClick={handleSaveTemplate}
              disabled={saving}
              className="inline-flex items-center justify-center gap-2 w-full sm:w-auto px-5 py-3 rounded-xl bg-slate-900 text-white text-xs font-black uppercase tracking-widest hover:bg-slate-800 disabled:opacity-50 transition-all"
            >
              <Save size={16} />
              {txt.saveTemplate}
            </button>
          </div>
        </section>

        {/* Owner alerts */}
        <section className="rounded-2xl xl:rounded-3xl bg-white border border-slate-200/80 shadow-sm ring-1 ring-slate-100 p-5 xl:p-6 flex flex-col gap-5">
          <h3 className="text-sm font-black uppercase tracking-wider text-slate-800">{txt.ownerCard}</h3>

          <label className="block">
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">{txt.ownerNumber}</span>
            <input
              type="tel"
              value={state.ownerNumber}
              onChange={(e) => setState((s) => ({ ...s, ownerNumber: e.target.value }))}
              placeholder="+2010..."
              className="mt-1.5 w-full py-3 px-4 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-800 outline-none focus:bg-white focus:border-primary-500 focus:ring-2 focus:ring-primary-500/15"
            />
            <p className="text-xs text-slate-400 mt-1">{txt.ownerHint}</p>
          </label>

          <div>
            <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-3">{txt.alertGrid}</p>
            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="w-full min-w-[320px] text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    <th className="text-start px-3 py-2.5 text-[10px] font-black uppercase tracking-wider text-slate-500">
                      {language === "ar" ? "الوحدة" : "Module"}
                    </th>
                    {ACTION_HEADERS.map((h) => (
                      <th key={h.key} className="text-center px-2 py-2.5 text-[10px] font-black uppercase tracking-wider text-slate-500">
                        {language === "ar" ? h.labelAr : h.labelEn}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {OWNER_ALERT_MATRIX.map((row) => (
                    <tr key={row.module} className="border-b border-slate-100 last:border-0">
                      <td className="px-3 py-3 font-bold text-slate-800">
                        {language === "ar" ? row.labelAr : row.labelEn}
                      </td>
                      {row.keys.map((key) => (
                        <td key={key} className="text-center py-3">
                          <input
                            type="checkbox"
                            className="w-4 h-4 rounded border-slate-300 text-primary-600 focus:ring-primary-500 cursor-pointer"
                            checked={Boolean(state.ownerAlerts[key])}
                            onChange={(e) => toggleOwnerAlert(key, e.target.checked)}
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </div>

      <section className="rounded-2xl xl:rounded-3xl bg-white border border-slate-200/80 shadow-sm ring-1 ring-slate-100 p-5 xl:p-6 flex flex-col gap-4">
        <div className="flex items-center gap-2 text-primary-600">
          <Send size={18} />
          <h3 className="text-sm font-black uppercase tracking-wider text-slate-800">{txt.testCard}</h3>
        </div>
        <p className="text-xs text-slate-500 font-medium">{txt.testHint}</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <label className="block">
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">{txt.testCountry}</span>
            <select
              value={testCountryIso}
              onChange={(e) => setTestCountryIso(e.target.value)}
              className="mt-1.5 w-full py-3 px-4 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-800 outline-none focus:bg-white focus:border-primary-500 focus:ring-2 focus:ring-primary-500/15"
            >
              {WHATSAPP_DIAL_COUNTRIES.map((c) => (
                <option key={c.iso} value={c.iso}>
                  {language === "ar" ? c.nameAr : c.nameEn} (+{c.dial})
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">{txt.testNational}</span>
            <input
              type="tel"
              inputMode="numeric"
              autoComplete="tel-national"
              value={testNational}
              onChange={(e) => setTestNational(e.target.value)}
              placeholder={txt.testNationalPh}
              className="mt-1.5 w-full py-3 px-4 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-800 outline-none focus:bg-white focus:border-primary-500 focus:ring-2 focus:ring-primary-500/15"
            />
          </label>
        </div>
        <p className="text-xs font-mono text-slate-600 bg-slate-50 border border-slate-200 rounded-xl px-4 py-2">
          {txt.testPreview}: <span className="font-bold text-slate-900">{testE164Preview || "—"}</span>
        </p>
        <label className="block">
          <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">{txt.testMessage}</span>
          <textarea
            value={testMessage}
            onChange={(e) => setTestMessage(e.target.value)}
            rows={2}
            placeholder="Alpha Dental — test..."
            className="mt-1.5 w-full py-3 px-4 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-800 outline-none focus:bg-white focus:border-primary-500 focus:ring-2 focus:ring-primary-500/15 resize-y"
          />
        </label>
        <div>
          <button
            type="button"
            onClick={() => void handleSendTest()}
            disabled={testSending}
            className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-emerald-600 text-white text-xs font-black uppercase tracking-widest hover:bg-emerald-700 disabled:opacity-50 transition-all shadow-md shadow-emerald-600/15"
          >
            {testSending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
            {txt.testSend}
          </button>
        </div>
      </section>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => void persist(state)}
          disabled={saving}
          className="inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl bg-primary-600 text-white text-xs font-black uppercase tracking-widest hover:bg-primary-700 shadow-md shadow-primary-600/20 disabled:opacity-50 transition-all"
        >
          {saving ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
          {txt.saveAll}
        </button>
      </div>
    </div>
  );
}
