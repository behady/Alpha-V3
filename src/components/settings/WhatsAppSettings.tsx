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
import type { WhatsAppCloudStatus } from "@/types/whatsappCloud";
import { useClinic } from "@/context/ClinicContext";
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
  const { showToast, confirm } = useUI();
  const { clinicId } = useClinic();

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

  const [metaPhoneNumberId, setMetaPhoneNumberId] = useState("");
  const [metaWabaId, setMetaWabaId] = useState("");
  const [metaTokenDraft, setMetaTokenDraft] = useState("");
  const [metaStatus, setMetaStatus] = useState<WhatsAppCloudStatus | null>(null);
  const [metaLoading, setMetaLoading] = useState(true);
  const [metaSaving, setMetaSaving] = useState(false);

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
      metaCard: language === "ar" ? "ربط واتساب" : "WhatsApp connection",
      metaHint:
        language === "ar"
          ? "اربط رقم واتساب الأعمال الخاص بعيادتك من Meta. تُحفظ البيانات لهذه العيادة وحدها."
          : "Connect your clinic’s own WhatsApp Business number from Meta. Credentials are stored for this clinic only.",
      phoneNumberId: language === "ar" ? "معرّف رقم الهاتف" : "Phone Number ID",
      wabaId: language === "ar" ? "معرّف حساب الأعمال (اختياري)" : "Business Account ID (optional)",
      accessToken: language === "ar" ? "رمز الوصول" : "Access token",
      tokenPlaceholder:
        language === "ar"
          ? metaStatus?.tokenSet
            ? "اتركه فارغاً للإبقاء على الرمز الحالي"
            : "الصق الرمز من لوحة Meta"
          : metaStatus?.tokenSet
            ? "Leave blank to keep current token"
            : "Paste token from the Meta console",
      connect: language === "ar" ? "ربط والتحقق" : "Connect and verify",
      disconnect: language === "ar" ? "فصل" : "Disconnect",
      connectionSaved: language === "ar" ? "تم ربط واتساب بنجاح" : "WhatsApp connected",
      disconnected: language === "ar" ? "تم فصل واتساب" : "WhatsApp disconnected",
      statusClinic: language === "ar" ? "متصل" : "Connected",
      statusEnv: language === "ar" ? "يستخدم الرقم التجريبي المشترك" : "Using shared test number",
      statusNone: language === "ar" ? "غير مُعدّ" : "Not connected",
      testNumberWarning:
        language === "ar"
          ? "الرقم التجريبي يرسل إلى 5 أرقام مسجلة فقط، والرمز ينتهي خلال 24 ساعة."
          : "The test number only sends to 5 registered recipients, and its token expires in 24 hours.",
      needClinic: language === "ar" ? "اختر عيادة أولاً" : "Select a clinic first",
    }),
    [language, metaStatus?.tokenSet]
  );

  const loadMetaStatus = useCallback(async () => {
    const firebaseUser = auth.currentUser;
    if (!firebaseUser || !clinicId) {
      setMetaLoading(false);
      return;
    }
    setMetaLoading(true);
    try {
      const idToken = await firebaseUser.getIdToken();
      const res = await fetch(`/api/admin/whatsapp-connection?clinicId=${encodeURIComponent(clinicId)}`, {
        headers: { Authorization: `Bearer ${idToken}` },
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) throw new Error(data?.error || "Failed to load");

      setMetaStatus(data as WhatsAppCloudStatus);
      setMetaPhoneNumberId(typeof data.phoneNumberId === "string" ? data.phoneNumberId : "");
      setMetaWabaId(typeof data.wabaId === "string" ? data.wabaId : "");
      // Never prefill the token — the API only ever returns whether one is set, not its value.
      setMetaTokenDraft("");
    } catch (e) {
      console.error(e);
      setMetaStatus(null);
    } finally {
      setMetaLoading(false);
    }
  }, [clinicId]);

  useEffect(() => {
    void loadMetaStatus();
  }, [loadMetaStatus]);

  const handleConnectMeta = async () => {
    const firebaseUser = auth.currentUser;
    if (!firebaseUser) {
      showToast(txt.testNeedAuth, "error");
      return;
    }
    if (!clinicId) {
      showToast(txt.needClinic, "error");
      return;
    }
    if (!metaPhoneNumberId.trim()) {
      showToast(language === "ar" ? "أدخل معرّف رقم الهاتف" : "Enter the Phone Number ID", "error");
      return;
    }
    if (!metaTokenDraft.trim()) {
      showToast(language === "ar" ? "أدخل رمز الوصول" : "Enter the access token", "error");
      return;
    }

    setMetaSaving(true);
    try {
      const idToken = await firebaseUser.getIdToken();
      const res = await fetch("/api/admin/whatsapp-connection", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          clinicId,
          phoneNumberId: metaPhoneNumberId.trim(),
          wabaId: metaWabaId.trim() || undefined,
          accessToken: metaTokenDraft.trim(),
        }),
      });
      const data = await res.json();
      // The API verifies against Meta before saving, so a failure here means the credentials are
      // genuinely wrong — surface Meta's reason rather than a generic "save failed".
      if (!res.ok || !data?.ok) throw new Error(data?.error || "Connection failed");

      showToast(`${txt.connectionSaved}${data.displayPhoneNumber ? ` — ${data.displayPhoneNumber}` : ""}`, "success");
      setMetaTokenDraft("");
      await loadMetaStatus();
      await logActivity(
        { uid: user?.uid, name: user?.name, role: user?.role },
        "WhatsApp connected",
        `clinic ${clinicId}`
      );
    } catch (e) {
      console.error(e);
      showToast(e instanceof Error ? e.message : language === "ar" ? "فشل الربط" : "Connection failed", "error");
    } finally {
      setMetaSaving(false);
    }
  };

  const handleDisconnectMeta = async () => {
    const firebaseUser = auth.currentUser;
    if (!firebaseUser || !clinicId) return;

    const ok = await confirm(
      language === "ar"
        ? "سيتوقف إرسال أي رسائل واتساب من هذه العيادة. متابعة؟"
        : "This clinic will stop sending any WhatsApp messages. Continue?"
    );
    if (!ok) return;

    setMetaSaving(true);
    try {
      const idToken = await firebaseUser.getIdToken();
      const res = await fetch(`/api/admin/whatsapp-connection?clinicId=${encodeURIComponent(clinicId)}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${idToken}` },
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) throw new Error(data?.error || "Disconnect failed");

      showToast(txt.disconnected, "success");
      await loadMetaStatus();
      await logActivity(
        { uid: user?.uid, name: user?.name, role: user?.role },
        "WhatsApp disconnected",
        `clinic ${clinicId}`
      );
    } catch (e) {
      console.error(e);
      showToast(e instanceof Error ? e.message : "Disconnect failed", "error");
    } finally {
      setMetaSaving(false);
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
      await setDoc(
        getClinicDoc("whatsappSettings", "config"),
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
              <h3 className="text-sm font-black uppercase tracking-wider text-slate-800">{txt.metaCard}</h3>
              <p className="text-xs text-slate-500 font-medium mt-0.5 max-w-xl">{txt.metaHint}</p>
            </div>
          </div>
          {metaLoading ? (
            <Loader2 size={18} className="animate-spin text-violet-500" />
          ) : metaStatus?.configured ? (
            <span className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-3 py-1.5 rounded-full">
              <CheckCircle2 size={14} />
              {metaStatus.source === "clinic" ? txt.statusClinic : txt.statusEnv}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-xs font-bold text-amber-800 bg-amber-50 border border-amber-200 px-3 py-1.5 rounded-full">
              <AlertCircle size={14} />
              {txt.statusNone}
            </span>
          )}
        </div>

        {/* Once connected, show what Meta reported back — this is the clinic's proof that the
            number the app sends from is the one they expect. */}
        {metaStatus?.configured && metaStatus.displayPhoneNumber && (
          <div className="rounded-xl bg-emerald-50/60 border border-emerald-200 px-4 py-3">
            <p className="text-sm font-bold text-emerald-900">{metaStatus.displayPhoneNumber}</p>
            {metaStatus.verifiedName && (
              <p className="text-xs font-semibold text-emerald-700 mt-0.5">{metaStatus.verifiedName}</p>
            )}
          </div>
        )}

        {metaStatus?.source === "env" && (
          <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 flex items-start gap-2.5">
            <AlertCircle size={15} className="text-amber-600 shrink-0 mt-0.5" />
            <p className="text-xs font-semibold text-amber-900 leading-relaxed">{txt.testNumberWarning}</p>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <label className="block">
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">{txt.phoneNumberId}</span>
            <input
              value={metaPhoneNumberId}
              onChange={(e) => setMetaPhoneNumberId(e.target.value)}
              inputMode="numeric"
              autoComplete="off"
              className="mt-1.5 w-full py-3 px-4 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-800 outline-none focus:bg-white focus:border-violet-500 focus:ring-2 focus:ring-violet-500/15"
              placeholder="1142062985667803"
            />
          </label>
          <label className="block">
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">{txt.wabaId}</span>
            <input
              value={metaWabaId}
              onChange={(e) => setMetaWabaId(e.target.value)}
              inputMode="numeric"
              autoComplete="off"
              className="mt-1.5 w-full py-3 px-4 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-800 outline-none focus:bg-white focus:border-violet-500 focus:ring-2 focus:ring-violet-500/15"
              placeholder="28691607737106880"
            />
          </label>
        </div>

        <label className="block">
          <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">{txt.accessToken}</span>
          <input
            type="password"
            value={metaTokenDraft}
            onChange={(e) => setMetaTokenDraft(e.target.value)}
            autoComplete="new-password"
            className="mt-1.5 w-full py-3 px-4 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-800 outline-none focus:bg-white focus:border-violet-500 focus:ring-2 focus:ring-violet-500/15"
            placeholder={txt.tokenPlaceholder}
          />
        </label>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void handleConnectMeta()}
            disabled={metaSaving || metaLoading}
            className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-violet-600 text-white text-xs font-black uppercase tracking-widest hover:bg-violet-700 disabled:opacity-50 transition-all"
          >
            {metaSaving ? <Loader2 size={16} className="animate-spin" /> : <Plug size={16} />}
            {txt.connect}
          </button>

          {metaStatus?.source === "clinic" && (
            <button
              type="button"
              onClick={() => void handleDisconnectMeta()}
              disabled={metaSaving || metaLoading}
              className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl border border-slate-200 text-slate-600 hover:border-rose-300 hover:text-rose-600 text-xs font-black uppercase tracking-widest disabled:opacity-50 transition-all"
            >
              {txt.disconnect}
            </button>
          )}
        </div>
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
