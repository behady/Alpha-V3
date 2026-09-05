"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MessageCircle, Save, Loader2, Send, Plug, CheckCircle2, AlertCircle } from "lucide-react";
import { doc, onSnapshot, setDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import BotPlayground from "./BotPlayground";
import { WHATSAPP_DIAL_COUNTRIES, buildE164FromDialAndNational } from "@/lib/whatsappDialCountries";
import { useLanguage } from "@/context/LanguageContext";
import { useAuth } from "@/context/AuthContext";
import { useClinic } from "@/context/ClinicContext";
import { useUI } from "@/context/UIContext";
import { currentClinicId } from "@/lib/db-utils";
import { hasFeature } from "@/lib/subscriptions";
import { logActivity } from "@/lib/logger";
import { useDirtyFlag } from "@/context/UnsavedChangesContext";
import type {
  OwnerAlertKey,
  WhatsAppMessageTemplate,
  WhatsAppSettingsDocument,
  WhatsAppTemplateType,
} from "@/types/whatsapp";
import { WHATSAPP_SETTINGS_DOC_REF } from "@/types/whatsapp";
import {
  type WhatsAppTemplatePack,
  WHATSAPP_DEFAULT_BODIES,
  isTemplatePack,
  templatePackBodies,
} from "@/lib/whatsappDefaultBodies";
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
  "lead_welcome",
];

function isTemplateType(v: unknown): v is WhatsAppTemplateType {
  return (
    v === "new" ||
    v === "edit" ||
    v === "cancel" ||
    v === "invoice" ||
    v === "treatment" ||
    v === "lead_welcome" ||
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
    isLeadAutoReplyEnabled: Boolean(data?.isLeadAutoReplyEnabled),
    isRecallEnabled: Boolean(data?.isRecallEnabled),
    recallAfterMonths: Number(data?.recallAfterMonths) || 6,
    isReviewRequestEnabled: Boolean(data?.isReviewRequestEnabled),
    useReminderButtons: Boolean(data?.useReminderButtons),
    isLeadFollowupEnabled: Boolean(data?.isLeadFollowupEnabled),
    isCheckinEnabled: Boolean(data?.isCheckinEnabled),
    isNoShowRecoveryEnabled: Boolean(data?.isNoShowRecoveryEnabled),
    templates,
    ownerNumber: typeof data?.ownerNumber === "string" ? data.ownerNumber : "",
    ownerAlerts,
    // Same trap the deliveryMode comment below describes: a field dropped here is a setting that
    // saves, echoes back through this function without it, and appears on screen to have reset.
    templatePack: isTemplatePack(data?.templatePack) ? data.templatePack : "bilingual",
    // Absent means on. The footer is what keeps the number off Meta's report list, so the
    // default has to survive a document written before this setting existed.
    optOutFooterEnabled: data?.optOutFooterEnabled !== false,
    // Both default to off. A field dropped here would read back as off and look like the toggle
    // refused to save — the same trap deliveryMode fell into.
    botEnabled: data?.botEnabled === true,
    botAnswerStrangers: data?.botAnswerStrangers === true,
    botAutoConfirmBookings: data?.botAutoConfirmBookings === true,
    botAiEnabled: data?.botAiEnabled === true,
    botMode: data?.botMode === "ai_first" ? "ai_first" : "assisted",
    botClinicalMode: data?.botClinicalMode === "dentist" ? "dentist" : "handoff",
    ...(typeof data?.botAiMaxReplies === "number" ? { botAiMaxReplies: data.botAiMaxReplies } : {}),
    botCoaching: typeof data?.botCoaching === "string" ? data.botCoaching : "",
    botPersonaName: typeof data?.botPersonaName === "string" ? data.botPersonaName : "",
    botHumanTouch: data?.botHumanTouch !== false,
    ...(typeof data?.botHumanClaimMinutes === "number" ? { botHumanClaimMinutes: data.botHumanClaimMinutes } : {}),
    // Same rule as deliveryMode below: spread conditionally so an absent map stays absent. A key
    // holding `undefined` is rejected by Firestore on the next write, which reads on screen as a
    // save that silently did nothing.
    ...(data?.botFacts && typeof data.botFacts === "object" ? { botFacts: data.botFacts } : {}),
    // Dropping this field here is what made "manual" look unselectable: the click saved it,
    // the listener echoed the document back through this function, and the choice vanished
    // from the screen — while the server was already honouring it. Spread conditionally so an
    // absent field stays absent; a key holding `undefined` would poison the next setDoc.
    ...(data?.deliveryMode === "manual" || data?.deliveryMode === "auto"
      ? { deliveryMode: data.deliveryMode }
      : {}),
  };
}

/** The four jobs this page does, in the order someone new to it needs them. */
const WHATSAPP_TABS = ["connection", "assistant", "answers", "playground", "messages", "wording", "alerts"] as const;
type WhatsAppTab = (typeof WHATSAPP_TABS)[number];

export default function WhatsAppSettings() {
  const { language, isRTL } = useLanguage();
  const { user } = useAuth();
  const { showToast } = useUI();
  const { clinic } = useClinic();

  // The same check the server makes before using the gateway, so this screen cannot promise
  // something the API will then refuse.
  const canSendAutomatically = hasFeature(clinic, "whatsappIntegration");

  const [hasLoaded, setHasLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  /**
   * Why the last save was refused, if it was.
   *
   * These controls write optimistically and the document listener is the only
   * thing that corrects them — but a refused write changes no document, so
   * nothing fires and the screen keeps showing a choice the clinic does not
   * have. It looked exactly like the option had been selected, until the page
   * was next opened and it had silently gone back.
   */
  const [saveError, setSaveError] = useState<string | null>(null);
  const [tab, setTab] = useState<WhatsAppTab>("connection");
  /** The last state the server confirmed, to restore when a write is refused. */
  const serverState = useRef<WhatsAppSettingsDocument | null>(null);
  const [state, setState] = useState<WhatsAppSettingsDocument>({
    isPatientAutomationEnabled: false,
    isLeadAutoReplyEnabled: false,
    isRecallEnabled: false,
    recallAfterMonths: 6,
    isReviewRequestEnabled: false,
    useReminderButtons: false,
    isLeadFollowupEnabled: false,
    isCheckinEnabled: false,
    isNoShowRecoveryEnabled: false,
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

  // Official Meta Cloud API connection — the drop-proof channel. Mirrors the Wapilot block:
  // status is loaded (never the token), an empty token on save keeps the stored one.
  const [metaStatus, setMetaStatus] = useState<{ configured: boolean; phoneNumberId: string; tokenSet: boolean } | null>(null);
  const [metaLoading, setMetaLoading] = useState(true);
  const [metaSaving, setMetaSaving] = useState(false);
  const [metaPhoneNumberId, setMetaPhoneNumberId] = useState("");
  const [metaWabaId, setMetaWabaId] = useState("");
  const [metaTokenDraft, setMetaTokenDraft] = useState("");
  const [metaTestTo, setMetaTestTo] = useState("");
  // Registering a number on the Cloud API, from here rather than Meta's dashboard, because the
  // dashboard reports every failure as "Registration failed" and the API says why.
  const [metaPin, setMetaPin] = useState("");
  const [metaRegistering, setMetaRegistering] = useState(false);
  const [metaRegisterResult, setMetaRegisterResult] = useState<{ ok: boolean; text: string } | null>(null);

  const handleRegisterMetaNumber = async () => {
    if (!/^\d{5,20}$/.test(metaPhoneNumberId.trim()) || !/^\d{6}$/.test(metaPin.trim())) return;
    setMetaRegistering(true);
    setMetaRegisterResult(null);
    try {
      const u = auth.currentUser;
      if (!u) throw new Error("Not signed in");
      const idToken = await u.getIdToken();
      const res = await fetch("/api/admin/meta-whatsapp-register", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ clinicId: currentClinicId() || "", phoneNumberId: metaPhoneNumberId.trim(), pin: metaPin.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (data?.ok) {
        setMetaRegisterResult({ ok: true, text: `${language === "ar" ? "تم التسجيل ✅" : "Registered ✅"} ${data.phone || ""} — ${data.status || ""}` });
        setMetaPin("");
      } else {
        const code = data?.code ? ` (Meta ${data.code}${data.subcode ? `/${data.subcode}` : ""})` : "";
        setMetaRegisterResult({ ok: false, text: `${data?.error || "Failed"}${code}` });
      }
    } catch (e) {
      setMetaRegisterResult({ ok: false, text: e instanceof Error ? e.message : "Failed" });
    } finally {
      setMetaRegistering(false);
    }
  };

  const testDial = useMemo(() => WHATSAPP_DIAL_COUNTRIES.find((c) => c.iso === testCountryIso)?.dial ?? "20", [testCountryIso]);
  const testE164Preview = useMemo(() => buildE164FromDialAndNational(testDial, testNational), [testDial, testNational]);

  const txt = useMemo(
    () => ({
      railLiveBadge: language === "ar" ? "يعمل" : "Sending",
      railManualBadge: language === "ar" ? "يدوي" : "Manual",
      railOffBadge: language === "ar" ? "متوقف" : "Not sending",
      railLiveMeta: language === "ar"
        ? "الرسائل تُرسل تلقائياً من قناة واتساب الرسمية."
        : "Messages send automatically through the official WhatsApp channel.",
      railLiveOwn: language === "ar"
        ? "الرسائل تُرسل تلقائياً من رقم العيادة."
        : "Messages send automatically from the clinic's own number.",
      railManualMeta: language === "ar"
        ? "متصل، لكن كل رسالة تفتح في واتساب لترسلها بنفسك."
        : "Connected, but every message opens in WhatsApp for you to send.",
      railManualOwn: language === "ar"
        ? "متصل برقم العيادة، وكل رسالة تفتح لترسلها بنفسك."
        : "Connected to the clinic's number, but every message opens for you to send.",
      railOff: language === "ar" ? "لا يمكن إرسال أي رسالة الآن." : "No messages can be sent yet.",
      railOffDetail: language === "ar"
        ? "اربط قناة من تبويب الاتصال لتبدأ الرسائل في الوصول."
        : "Connect a channel under Connection and messages will start going out.",
      savingNow: language === "ar" ? "جارٍ الحفظ..." : "Saving...",
      savedAll: language === "ar" ? "كل التغييرات محفوظة" : "All changes saved",
      tab_connection: language === "ar" ? "الاتصال" : "Connection",
      tab_assistant: language === "ar" ? "المساعد" : "Assistant",
      tab_answers: language === "ar" ? "الردود الجاهزة" : "Ready answers",
      tab_playground: language === "ar" ? "جرّب البوت" : "Try it",
      tab_messages: language === "ar" ? "الرسائل التلقائية" : "Automations",
      tab_wording: language === "ar" ? "الصياغة" : "Wording",
      tab_alerts: language === "ar" ? "تنبيهات المالك" : "Owner alerts",
      tabHint_connection: language === "ar" ? "ربط رقم الواتساب بالنظام واختبار الإرسال." : "Link the clinic's WhatsApp number and test sending.",
      tabHint_assistant: language === "ar" ? "البوت اللي بيرد على المرضى: شغّله، اختار أسلوبه، واكتبله تعليماتك." : "The bot that answers patients: switch it on, choose its style, write it your instructions.",
      tabHint_answers: language === "ar" ? "إجابات بكلماتك للأسئلة اللي النظام معندوش بياناتها. كل خانة تملاها بتوفر رد بشري." : "Your own words for the questions the system has no data for. Every box you fill saves a staff reply.",
      tabHint_playground: language === "ar" ? "اتكلم مع البوت زي المريض وشوف بيرد إزاي. مفيش حاجة بتتبعت لحد." : "Chat with the bot as a patient and see what it says. Nothing is sent to anyone.",
      tabHint_messages: language === "ar" ? "الرسايل اللي العيادة بتبعتها لوحدها: تأكيدات، تذكيرات، متابعة بعد الزيارة، واسترجاع الغايبين." : "Messages the clinic sends by itself: confirmations, reminders, after-visit follow-ups, winning back the absent.",
      tabHint_wording: language === "ar" ? "نص كل رسالة تلقائية، بالعربي أو بلغتين." : "The text of each automatic message, Arabic or bilingual.",
      tabHint_alerts: language === "ar" ? "إيه اللي يوصلك انت على واتساب لما حاجة تحصل في النظام." : "What reaches you on WhatsApp when something happens in the system.",
      botOffFirst: language === "ar" ? "شغّل المساعد الأول من تبويب «المساعد»." : "Switch the assistant on first, in the Assistant tab.",
      groupAppointments: language === "ar" ? "المواعيد" : "Appointments",
      groupAfterVisit: language === "ar" ? "بعد الزيارة" : "After the visit",
      groupWinBack: language === "ar" ? "استرجاع اللي غابوا" : "Winning people back",
      title: language === "ar" ? "واتساب" : "WhatsApp",
      patientCard: language === "ar" ? "أتمتة رسائل المرضى" : "Patient automation",
    saveRefused:
      language === "ar"
        ? "لم يُحفظ هذا التغيير، وأُعيد ما هو مخزَّن بالفعل. إعدادات الواتساب لا يغيّرها إلا مدير العيادة، ولا تُحفظ إذا كان اشتراك العيادة منتهياً."
        : "That change was not saved, and the screen has been put back to what is stored. Only a clinic Admin can change WhatsApp settings, and nothing saves while the clinic's subscription has lapsed.",
      patientToggle: language === "ar" ? "تفعيل الرسائل التلقائية للمرضى" : "Enable automated patient messages",
      recallToggle: language === "ar" ? "رسالة \"وحشتنا\" للمرضى الغايبين" : "\"We miss you\" to patients who stopped coming",
      recallHint:
        language === "ar"
          ? "كل يوم أحد، رسالة واحدة لكل مريض عدّى على آخر زيارة مكتملة له المدة دي ومعندوش ميعاد قادم."
          : "Every Sunday, one message to each patient whose last completed visit is older than this and who has nothing booked.",
      recallMonths: language === "ar" ? "بعد كام شهر" : "After how many months",
      reviewToggle: language === "ar" ? "طلب تقييم جوجل بعد الزيارة" : "Ask for a Google review after visits",
      reviewHint:
        language === "ar"
          ? "صباح اليوم التالي لكل زيارة مكتملة. يحتاج رابط تقييم جوجل في ملف العيادة، ولا يتكرر لنفس المريض خلال شهر."
          : "The morning after each completed visit. Needs the Google review link in the clinic profile; never twice to the same patient within a month.",
      reminderButtonsToggle: language === "ar" ? "أزرار \"تأكيد الحضور\" و\"تعديل الميعاد\" في التذكير" : "Confirm / reschedule buttons on the reminder",
      reminderButtonsHint:
        language === "ar"
          ? "فعّلها بعد ما ميتا توافق على قالب alpha_appt_reminder_btn_ar. الضغطة بتأكد الميعاد أو تفتح خطوات التعديل في البوت."
          : "Turn on once Meta approves the alpha_appt_reminder_btn_ar template. A tap confirms the appointment or starts the reschedule steps in the assistant.",
      deliveryTitle: language === "ar" ? "طريقة الإرسال" : "How messages are sent",
      deliveryAuto: language === "ar" ? "إرسال تلقائي" : "Send automatically",
      deliveryAutoHint:
        language === "ar"
          ? "النظام يبعت الرسالة لوحده. محتاج باقة Premium واتصال واتساب مفعّل."
          : "The system sends on its own. Needs the Premium plan and a connected WhatsApp gateway.",
      deliveryLocked: language === "ar" ? "يتطلب الترقية" : "Premium",
      deliveryLockedHint:
        language === "ar"
          ? "باقتك الحالية لا تشمل الإرسال التلقائي، لذلك تنتظر الرسائل على هاتف العيادة ليضغط أحد الموظفين إرسال."
          : "Your plan does not include automatic sending, so messages wait on the clinic phone for a staff member to press send.",
      deliveryQueueTitle: language === "ar" ? "ما الذي يحدث الآن" : "What happens right now",
      deliveryQueueBody:
        language === "ar"
          ? "الرسائل التي يجهّزها النظام دون وجود موظف أمام الشاشة — مثل تذكير الغد الذي يعمل قبل الفجر — تظهر في تطبيق ألفا على هاتف العيادة تحت «رسائل للإرسال». هذه الرسائل كانت في السابق لا تُرسل إطلاقاً."
          : "Messages the system writes when nobody is at a screen — the next-day reminder runs before dawn — now appear in the Alpha app on the clinic phone under \"Messages to send\". Those messages previously went nowhere at all.",
      deliveryManual: language === "ar" ? "فتح واتساب للإرسال" : "Open WhatsApp to send",
      deliveryManualHint:
        language === "ar"
          ? "النظام يجهّز الرسالة ويفتح واتساب، والموظف يضغط إرسال. مناسب للعيادات من غير سجل تجاري، ومفيش خطر إيقاف الرقم."
          : "The system writes the message and opens WhatsApp; your staff press send. Works with no commercial registration, and nothing can get the number banned.",
      packTitle: language === "ar" ? "لغة الرسائل" : "Message language",
      packBilingual: language === "ar" ? "عربي + إنجليزي" : "Arabic + English",
      packBilingualHint:
        language === "ar"
          ? "عنوان إنجليزي وتحته سطر عربي. مناسب للعيادات اللي مرضاها بيقروا الاتنين."
          : "An English heading with an Arabic line under it. For clinics whose patients read both.",
      packArabic: language === "ar" ? "عربي فقط" : "Arabic only",
      packArabicHint:
        language === "ar"
          ? "الرسالة كلها بالعربي المصري. أقصر، وبتقرا كأن موظفة الاستقبال كاتباها."
          : "The whole message in Egyptian Arabic. Shorter, and reads as if your receptionist wrote it.",
      packApply: language === "ar" ? "استخدام هذه الصياغة" : "Use this wording",
      packConfirm:
        language === "ar"
          ? "ده هيستبدل نص كل القوالب بالصياغة الجديدة. أي تعديل كتبته بنفسك هيضيع. تكمل؟"
          : "This replaces the text of every template with the new wording. Any edits you wrote yourself will be lost. Continue?",
      packApplied: language === "ar" ? "تم تحديث كل القوالب" : "All templates updated",
      optOutTitle: language === "ar" ? "حماية الرقم من الإيقاف" : "Protecting your number",
      optOutToggle:
        language === "ar"
          ? "إضافة سطر «لإيقاف الرسائل أرسل: إيقاف» في آخر كل رسالة"
          : "Add a \"reply STOP to stop these messages\" line to every message",
      optOutHint:
        language === "ar"
          ? "لما المريض يرد بكلمة «إيقاف»، النظام بيوقف عنه رسائل الواتساب والرسائل النصية فوراً، وبيظهر ده في ملفه. تقدر ترجّعها من ملف المريض."
          : "When a patient replies with the stop word, the system switches off both WhatsApp and SMS for them immediately and records it on their profile. Staff can switch it back on from the patient's file.",
      optOutWarning:
        language === "ar"
          ? "اللي بيوقف رقم العيادة على واتساب هو إبلاغ المرضى عنه كـ«سبام». وجود طريقة واضحة للإيقاف هو اللي بيخلي المريض المنزعج يستخدمها بدل زر الإبلاغ. ننصح بشدة بتركها مفعّلة."
          : "What gets a clinic's number restricted is patients reporting it as spam. A visible way to stop the messages is what an irritated patient uses instead of the report button. Strongly recommended to leave this on.",
      optOutInboundPending:
        language === "ar"
          ? "الرد التلقائي على كلمة «إيقاف» بيشتغل بعد ربط رابط الاستقبال في لوحة Wapilot — كلّمنا لو محتاج ده."
          : "Acting on the reply automatically needs the inbound webhook connected in your Wapilot dashboard — ask us to switch it on.",
      botTitle: language === "ar" ? "الرد التلقائي على رسائل المرضى" : "Answering patients who write to you",
      botToggle:
        language === "ar"
          ? "خلي النظام يرد على المريض اللي يبعت للعيادة"
          : "Let the system reply when a patient messages the clinic",
      botHint:
        language === "ar"
          ? "بيرد بقائمة بسيطة: حجز، مواعيد وعنوان، أو التحويل للاستقبال. أي رسالة فيها ألم أو ورم أو نزيف بتتحول لموظف على طول، والبوت بيسكت لما حد من العيادة يدخل على المحادثة."
          : "Replies with a short menu: booking, hours and address, or hand over to reception. Anything mentioning pain, swelling or bleeding goes straight to a person, and the bot goes quiet once a staff member takes the thread.",
      botNeedsGateway:
        language === "ar"
          ? "محتاج «إرسال تلقائي» شغال. في وضع «فتح واتساب للإرسال» مفيش حد قدام الشاشة وقت ما المريض يكتب، فالرد مش هيتبعت."
          : "Needs automatic sending. In click-to-send mode nobody is at a screen when the patient writes, so no reply can go out.",
      botStrangers:
        language === "ar"
          ? "يرد كمان على الأرقام غير المسجلة كمرضى"
          : "Also answer numbers that are not patients",
      botStrangersHint:
        language === "ar"
          ? "ننصح تسيبها مقفولة. الرد على أرقام غريبة معناه الرد على أرقام غلط وإعلانات، وده بالظبط اللي بيخلي الرقم يتبلغ عنه."
          : "Recommended off. Answering unknown numbers means answering wrong numbers and spam — exactly the traffic that gets a number reported.",
      botAutoConfirm:
        language === "ar"
          ? "تأكيد حجوزات البوت تلقائياً"
          : "Auto-confirm bot bookings",
      botAutoConfirmHint:
        language === "ar"
          ? "مقفولة: الحجز بيوصل «غير مؤكد» والاستقبال بيراجعه — البوت مش هيملى الأجندة لوحده. مفتوحة: الحجز بيتأكد فوراً لحظة ما المريض يختار الميعاد."
          : "Off: bookings arrive Unconfirmed and the desk reviews them — the bot cannot fill the calendar alone. On: the booking is final the moment the patient picks a time.",
      botSales: language === "ar" ? "الذكاء الاصطناعي يقود المحادثة (وضع البائع)" : "AI leads the conversation (salesperson mode)",
      botSalesHint:
        language === "ar"
          ? "البوت بيكلم المريض زي موظف مبيعات شاطر: بيجاوب، بيسأل سؤال يفهم احتياجه، بيعرض القيمة، بيرد على «غالي» و«هفكر»، وبيفتح الحجز لما يحس إن المريض جاهز. الأزرار والكلمات الجاهزة بتفضل بس للأمان (الألم، الشكاوى، إيقاف الرسائل) وللأجندة. كل رد بياخد ١ كريدت."
          : "The bot talks like a good salesperson: answers, asks one question to understand the need, presents value, handles \"expensive\" and \"I'll think about it\", and opens the booking when the patient is ready. Fixed routes remain only for safety (pain, complaints, opt-out) and the calendar. Each reply costs 1 credit.",
      botAiCap: language === "ar" ? "أقصى عدد ردود ذكية في المحادثة الواحدة" : "Max AI replies per conversation",
      botAiCapUnlimited: language === "ar" ? "بدون حد" : "Unlimited",
      botAiCapHint:
        language === "ar"
          ? "بعد الحد، البوت بيحوّل لموظف. فاضية = ٣ في الوضع العادي، وبدون حد في وضع البائع."
          : "Past the cap the bot hands to a person. Empty = 3 in normal mode, unlimited in salesperson mode.",
      botPersona: language === "ar" ? "اسم البوت (بيعرّف بنفسه بيه مرة واحدة)" : "Bot name (introduces itself once)",
      botPersonaPh: language === "ar" ? "مثال: سارة" : "e.g. Sara",
      botHumanTouch: language === "ar" ? "لمسة إنسانية: ينتظر شوية قبل الرد، ويقسّم الرد الطويل على رسالتين، ومن غير أزرار تحت كل رسالة" : "Human touch: pauses before replying, splits long answers into two bubbles, no buttons under every message",
      botCoaching: language === "ar" ? "تعليماتك للبوت (زي ما تبرّف موظف جديد)" : "Your coaching notes (as you'd brief a new hire)",
      botCoachingPh:
        language === "ar"
          ? "مثال: دايماً اذكر إن الكشف مجاني. ركّز على التبييض الشهر ده. متستخدمش كلمة «حضرتك» كتير. لو حد سأل عن الزراعة قوله إنها بتتعمل على مرحلتين."
          : "e.g. Always mention the consultation is free. Push whitening this month. Don't overuse formal address. If someone asks about implants, say it's done in two stages.",
      botCoachingHint:
        language === "ar"
          ? "بتتطبق فوراً على كل رد. الإجابات اللي فريقك بيكتبها والكتيب اللي بيتعلمه البوت من النتايج موجودين في صفحة الذكاء ← تبويب البوت."
          : "Applies immediately to every reply. Staff-taught answers and the playbook learned from outcomes live on the Intelligence page → Bot tab.",
      botAi: language === "ar" ? "الرد الذكي على الأسئلة الحرة" : "AI answers for free-text questions",
      botAiHint:
        language === "ar"
          ? "لما المريض يكتب سؤال مش من الأزرار (زي «بتركبوا تقويم؟»)، الذكاء الاصطناعي يرد عليه رد قصير. بحد أقصى ٣ ردود في المحادثة، وكل رد بياخد ١ كريدت من رصيد الذكاء الاصطناعي الشهري. الأسعار بتتقال كنطاق فقط مع تأكيد الاستقبال، والشكاوى والأسئلة الطبية بتتحول لموظف فوراً."
          : "When a patient types a question the buttons don't cover (like \"do you do braces?\"), the AI answers briefly. Max 3 answers per conversation, 1 credit each from the monthly AI pool. Prices are quoted as ranges only; complaints and medical questions go straight to a person.",
      botLimits:
        language === "ar"
          ? "بحد أقصى ١٥ رد للرقم الواحد في الساعة، وبيوقف ويحوّل لموظف لو المحادثة طالت."
          : "At most 15 replies to one number per hour, and it stops and hands over if a conversation drags on.",
      botClaim: language === "ar" ? "البوت يسكت بعد رد الموظف لمدة" : "After a staff reply, the bot stays quiet for",
      botClaimUnit: language === "ar" ? "دقيقة (الافتراضي ١٥)" : "minutes (default 15)",
      botClaimHint:
        language === "ar"
          ? "لما حد من الفريق يرد على مريض من شاشة المحادثات، البوت بيبعد عن المحادثة دي المدة دي عشان ميتكلمش فوق الموظف. صفر يعني البوت يرد على الرسالة اللي بعدها على طول. زرار «رجّع البوت» في المحادثة بيلغي الانتظار في أي وقت."
          : "When a team member replies to a patient from the chat screen, the bot steps out of that conversation for this long so it never talks over a person. 0 means the bot answers the very next message. The \"Hand back to bot\" button in the chat ends the wait at any time.",
      botDentist: language === "ar" ? "يرد على الأعراض كطبيب أسنان أولاً، وبعدها يعرض الحجز" : "Answer symptoms like a dentist first, then offer a booking",
      botDentistHint:
        language === "ar"
          ? "لما المريض يقول «ضرسي بيوجعني» أو «لثتي وارمة»، بدل ما يوعده بمكالمة، الذكاء الاصطناعي يسأله سؤال أو اتنين (فين؟ بقاله قد إيه؟)، يطمّنه بنصايح عامة آمنة من غير تشخيص أو أدوية بالاسم، وبعدين يعرض عليه أقرب ميعاد. الحالات الطارئة (نزيف مش بيقف، ورم في الوش مع سخونية، إصابة، صعوبة بلع) ومرضى السكر والضغط بتتحول لموظف زي ما هي."
          : "When a patient says \"my tooth hurts\" or \"my gum is swollen\", instead of promising a call-back the AI asks one or two questions (where? since when?), reassures with safe general advice — no diagnosis, no drug names — and then offers the earliest appointment. Emergencies (bleeding that won't stop, facial swelling with fever, injuries, trouble swallowing) and diabetic or blood-pressure patients still go straight to a person.",
      factsTitle: language === "ar" ? "ردود جاهزة على أسئلة المرضى" : "Ready answers for common questions",
      factsHint:
        language === "ar"
          ? "دي الأسئلة اللي المرضى بيسألوها والنظام معندوش إجابتها. أي خانة تسيبها فاضية، البوت هيقول «الاستقبال هيتواصل معاك» ومش هيخمّن أبداً. أي خانة تملاها، البوت هيرد بيها فوراً وببلاش — من غير ما تدفع كريدت ومن غير ما موظف يرد."
          : "The questions patients ask that the system has no answer for. Leave a box empty and the bot says a person will follow up — it never guesses. Fill one in and the bot answers instantly and free, with no AI credit and no staff time.",
      factWalkIn: language === "ar" ? "الحضور من غير ميعاد" : "Walk-ins",
      factWalkInPh:
        language === "ar" ? "مثال: ينفع تيجي من غير ميعاد بس الأولوية للحجوزات، والانتظار ممكن يوصل ساعة." : "e.g. Walk-ins welcome, but booked patients come first.",
      factInstallments: language === "ar" ? "التقسيط" : "Instalments",
      factInstallmentsPh:
        language === "ar" ? "مثال: التقويم والتركيبات بتتقسط على 3 دفعات من غير فوايد." : "e.g. Braces and crowns can be paid over 3 instalments.",
      checkinToggle: language === "ar" ? "«إزيك النهارده؟» بعد العلاج" : "\"How are you feeling?\" after a procedure",
      checkinHint:
        language === "ar"
          ? "صباح اليوم التالي لكل علاج مكتمل (مش الكشف أو التنظيف)، مع تعليمات ما بعد العلاج لو مكتوبة. زرار «عندي ألم» بيروح لموظف فوراً. فعّلها بعد ما ميتا توافق على قالب alpha_checkin_ar. لما تكون شغالة، طلب التقييم بيتأجل يوم."
          : "The morning after every completed procedure (not check-ups or cleanings), with your aftercare line if written. \"I have pain\" goes straight to a person. Turn on once Meta approves alpha_checkin_ar. When on, the review request waits a day.",
      noshowToggle: language === "ar" ? "رسالة بعد الغياب عن الميعاد" : "Message after a no-show",
      noshowHint:
        language === "ar"
          ? "صباح اليوم التالي لأي ميعاد اتسجل «لم يحضر»، من غير لوم، بزرار حجز. مش بتتبعت لو المريض حجز تاني بالفعل. فعّلها بعد ما ميتا توافق على قالب alpha_noshow_ar."
          : "The morning after any appointment marked No Show, without blame, with a book button. Not sent if they already rebooked. Turn on once Meta approves alpha_noshow_ar.",
      leadFollowupToggle: language === "ar" ? "متابعة اللي سأل ومحجزش" : "Follow up leads who asked but didn't book",
      leadFollowupHint:
        language === "ar"
          ? "رسالة واحدة بس، بعد يوم من سؤاله عن سعر أو خدمة على واتساب من غير ما يحجز. فعّلها بعد ما ميتا توافق على قالب alpha_lead_followup_ar."
          : "One message, the day after someone asked about a price or service on WhatsApp without booking. Turn on once Meta approves the alpha_lead_followup_ar template.",
      factWhyUs: language === "ar" ? "ليه تختارنا (البوت بيقولها لما حد يتردد)" : "Why us (said when someone hesitates)",
      factWhyUsPh:
        language === "ar"
          ? "مثال: أطباء متخصصين، تعقيم كامل لكل مريض، وضمان سنة على التركيبات. السعر بيشمل المتابعة."
          : "e.g. Specialist dentists, full sterilisation for every patient, one-year warranty on crowns.",
      factConsultation: language === "ar" ? "الكشف (البوت بيختم بيه عرض الحجز)" : "Consultation terms (used in the booking invitation)",
      factConsultationPh:
        language === "ar" ? "مثال: الكشف مجاني / الكشف 200 ج.م وبيتخصم من العلاج" : "e.g. Consultation is free / 200 EGP, deducted from treatment",
      factOffersUntil: language === "ar" ? "العرض ساري لغاية" : "Offer valid until",
      factOffersUntilPh: "2026-12-31",
      factOffers: language === "ar" ? "العروض والخصومات" : "Offers and discounts",
      factOffersPh:
        language === "ar" ? "مثال: مفيش خصومات حالياً، والأسعار ثابتة للجميع." : "e.g. No current offers; prices are the same for everyone.",
      factMaps: language === "ar" ? "لينك اللوكيشن على الخريطة" : "Map link",
      factMapsPh: "https://maps.app.goo.gl/...",
      factParking: language === "ar" ? "الباركن والدخول" : "Parking and entrance",
      factParkingPh:
        language === "ar" ? "مثال: في باركن مجاني قدام العمارة، والعيادة في الدور الأول وفيه أسانسير." : "e.g. Free parking outside; first floor, lift available.",
      factInsurance: language === "ar" ? "التأمين الطبي" : "Insurance",
      factInsurancePh:
        language === "ar" ? "مثال: مابنتعاملش مع شركات تأمين، بس بنديك فاتورة تقدر تقدمها." : "e.g. We don't bill insurers, but we provide an invoice you can claim with.",
      factNotOffered: language === "ar" ? "خدمات إحنا مش بنعملها" : "Treatments you don't offer",
      factNotOfferedPh:
        language === "ar" ? "مثال: مابنعملش زراعة أسنان ولا جراحات الوجه والفكين." : "e.g. We don't do implants or oral surgery.",
      factDurations: language === "ar" ? "الجلسة بتاخد قد ايه" : "How long appointments take",
      factDurationsPh:
        language === "ar" ? "مثال: الكشف ١٥ دقيقة، التنظيف نص ساعة، الحشو من ٣٠ لـ ٤٥ دقيقة." : "e.g. Check-up 15 min, cleaning 30 min, filling 30–45 min.",
      factSessions: language === "ar" ? "عدد الجلسات" : "Number of sessions",
      factSessionsPh:
        language === "ar" ? "مثال: علاج العصب من جلستين لتلاتة، والتقويم زيارة كل شهر." : "e.g. Root canal 2–3 sessions; braces one visit a month.",
      factAftercare: language === "ar" ? "تعليمات بعد العلاج" : "Aftercare",
      factAftercarePh:
        language === "ar" ? "مثال: بعد الخلع، عض على الشاش نص ساعة ومتشربش بشفاطة ومتاكلش سخن النهاردة." : "e.g. After an extraction: bite on gauze for 30 min, no straws, nothing hot today.",
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
        lead_welcome: language === "ar" ? "رد فوري على عميل محتمل" : "Instant reply to a new lead",
      },
      leadCard: language === "ar" ? "الرد التلقائي على العملاء المحتملين" : "Lead auto-reply",
      leadToggle:
        language === "ar"
          ? "رد تلقائي على كل عميل محتمل جديد من إعلانات فيسبوك"
          : "Answer every new lead from Facebook ads automatically",
      leadHint:
        language === "ar"
          ? "بيستخدم نفس طريقة الإرسال المختارة فوق: «تلقائي» يبعت لوحده خلال ثواني، و«يدوي» بيجهّز الرسالة في قائمة الإرسال وحد بيدوس. الرسالة بتتبعت مرة واحدة لكل عميل، ومش بتتبعت لو مفيش رقم."
          : "Uses the same delivery method chosen above: Automatic sends within seconds on its own, Manual prepares the message in the send queue for a person to tap. One message per lead, ever — and none at all if the lead has no phone number.",
      leadWarning:
        language === "ar"
          ? "الشخص ده إدّى رقمه بنفسه ولسه سائل — وده أأمن وقت للتواصل. بس متبعتش رسايل جماعية من نفس الرقم، ده أسرع طريق لإيقاف رقم العيادة من واتساب."
          : "These people just handed you their number and asked to be contacted — the safest possible moment to message. Do not send bulk messages from the same number: that is the quickest way to get a clinic's WhatsApp restricted.",
      leadWelcomeHint:
        language === "ar"
          ? "أول رسالة بتوصل للعميل المحتمل بعد ما يسأل بثواني. المتغيرات: {{patient_name}} {{clinic_name}} {{interest}} — خليها قصيرة وشخصية وفيها سؤال، مش إعلان."
          : "The first message a lead receives, seconds after they ask. Variables: {{patient_name}} {{clinic_name}} {{interest}} — keep it short, personal and question-first, not an advert.",
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
      metaCard: language === "ar" ? "الواتساب الرسمي (Meta)" : "Official WhatsApp (Meta)",
      metaHint:
        language === "ar"
          ? "القناة الرسمية من ميتا: لا تنقطع، لا تحتاج مسح QR، وتتعرف على رقم المريض مباشرة. لما تتفعّل بتاخد الأولوية على Wapilot تلقائياً."
          : "Meta's official channel: never drops, no QR scans, and identifies the patient's number directly. When configured it automatically takes priority over Wapilot.",
      metaPhoneNumberId: language === "ar" ? "Phone Number ID (من لوحة Meta)" : "Phone Number ID (from the Meta dashboard)",
      metaWabaId: language === "ar" ? "WhatsApp Business Account ID (اختياري)" : "WhatsApp Business Account ID (optional)",
      metaToken: language === "ar" ? "Access Token (يُلصق هنا ولا يُعرض مرة أخرى)" : "Access token (pasted here, never shown again)",
      metaTokenKept: language === "ar" ? "التوكن محفوظ — اتركه فارغاً للإبقاء عليه" : "Token stored — leave empty to keep it",
      metaTestTo: language === "ar" ? "رقم لتجربة الإرسال بعد الحفظ (اختياري)" : "Number to send a test to after saving (optional)",
      metaConnected: language === "ar" ? "متصل" : "Connected",
      metaNotConnected: language === "ar" ? "غير متصل" : "Not connected",
      metaSaved: language === "ar" ? "تم حفظ الاتصال الرسمي" : "Official connection saved",
      metaTestSent: language === "ar" ? "تم إرسال رسالة التجربة ✅" : "Test message sent ✅",
      metaTestFailed: language === "ar" ? "الحفظ تم لكن رسالة التجربة فشلت: " : "Saved, but the test message failed: ",
      metaRegisterTitle: language === "ar" ? "تسجيل الرقم على Meta" : "Register the number with Meta",
      metaRegisterHint:
        language === "ar"
          ? "لوحة Meta بتقول «Registration failed» من غير سبب. الزرار ده بيكلم Meta مباشرة ويقولك السبب الحقيقي. الرقم السري (PIN) بيتبعت لـ Meta بس ومش بيتحفظ عندنا."
          : "Meta's dashboard says \"Registration failed\" and nothing else. This talks to Meta directly and shows the real reason. The PIN goes to Meta only and is never stored here.",
      metaPin: language === "ar" ? "الرقم السري (٦ أرقام)" : "6-digit PIN",
      metaRegister: language === "ar" ? "سجّل الرقم" : "Register number",
      metaRegistered: language === "ar" ? "تم التسجيل ✅ الرقم شغال على Meta" : "Registered ✅ the number is live on Meta",
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
      statusClinic: language === "ar" ? "رقم العيادة الخاص" : "This clinic's own number",
      statusPlatform:
        language === "ar" ? "رقم مشترك — وصّل رقم العيادة" : "Shared number — connect your own",
      statusNone: language === "ar" ? "غير مُعدّ" : "Not configured",
      sharedWarning:
        language === "ar"
          ? "رسائل المرضى بتتبعت دلوقتي من رقم مشترك، مش رقم العيادة. المريض هيشوف رقم مش معروف له، وأي رد منه مش هيوصلك. وصّل رقم العيادة من تحت."
          : "Patient messages are going out from a shared number, not this clinic's. Patients see a number they don't recognise, and their replies never reach you. Connect the clinic's own number below.",
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

  const loadMetaStatus = useCallback(async () => {
    try {
      const u = auth.currentUser;
      if (!u) return;
      const idToken = await u.getIdToken();
      const res = await fetch(`/api/admin/meta-whatsapp-config?clinicId=${encodeURIComponent(currentClinicId() || "")}`, {
        headers: { Authorization: `Bearer ${idToken}` },
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        setMetaStatus({ configured: data.configured === true, phoneNumberId: data.phoneNumberId || "", tokenSet: data.tokenSet === true });
        if (data.phoneNumberId) setMetaPhoneNumberId(data.phoneNumberId);
        if (data.wabaId) setMetaWabaId(data.wabaId);
      }
    } catch {
      /* the card simply shows not-connected */
    } finally {
      setMetaLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadMetaStatus();
  }, [loadMetaStatus]);

  const handleSaveMetaConnection = async () => {
    const u = auth.currentUser;
    if (!u) return;
    if (!metaPhoneNumberId.trim()) {
      showToast(language === "ar" ? "أدخل Phone Number ID" : "Enter the Phone Number ID", "error");
      return;
    }
    setMetaSaving(true);
    try {
      const idToken = await u.getIdToken();
      const res = await fetch("/api/admin/meta-whatsapp-config", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({
          clinicId: currentClinicId() || "",
          phoneNumberId: metaPhoneNumberId.trim(),
          wabaId: metaWabaId.trim(),
          token: metaTokenDraft.trim(),
          testTo: metaTestTo.trim(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || "Save failed");
      // Never keep a credential in component state longer than the save needs it.
      setMetaTokenDraft("");
      await loadMetaStatus();
      if (data.test?.attempted) {
        if (data.test.ok) showToast(txt.metaTestSent, "success");
        else showToast(txt.metaTestFailed + (data.test.error || ""), "error");
      } else {
        showToast(txt.metaSaved, "success");
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : txt.failed, "error");
    } finally {
      setMetaSaving(false);
    }
  };

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
      serverState.current = next;
      setState(next);
      setHasLoaded(true);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    syncDraftFromType(templateType, state.templates);
  }, [templateType, state.templates, syncDraftFromType]);

  /**
   * What is actually unsaved on this screen.
   *
   * Not the whole document: the toggles here persist the moment they are clicked, so treating the
   * settings object as a draft would report unsaved work permanently. The two things that really
   * do wait for a button are the message template being typed, and the credentials in the
   * connection forms — and a half-entered access token lost to a stray click means fetching it
   * from Meta again.
   */
  const storedTemplate = state.templates.find((t) => t.type === templateType);
  const templateDirty =
    hasLoaded &&
    (draftMessage !== (storedTemplate?.message ?? "") ||
      draftActive !== (storedTemplate?.isActive ?? true));
  const connectionDirty = Boolean(
    metaTokenDraft.trim() || wapilotTokenDraft.trim() || metaPhoneNumberId.trim() !== (metaStatus?.phoneNumberId ?? "")
  );
  useDirtyFlag("whatsapp", templateDirty || connectionDirty);

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
      setSaveError(null);
      if (toastMode === "default") showToast(txt.saved, "success");
      if (toastMode === "template") showToast(txt.templateSaved, "success");
      /* silent | none: no toast (used when auto-saving toggles so we don't spam) */
    } catch (e) {
      console.error(e);
      // Put the screen back to what is actually stored. Leaving the optimistic
      // value up is what made a refused change look like a saved one.
      if (serverState.current) setState(serverState.current);
      setSaveError(txt.saveRefused);
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

  /**
   * Rewrite every template from one of the built-in wordings.
   *
   * Confirmed first, because this is the only control on the screen that destroys work: a clinic
   * that spent an afternoon rewording its reminder would otherwise lose it to a curious click on
   * a language button. The active/inactive state of each template is kept — that is a decision
   * about which messages to send, not about how they are worded.
   */
  const applyTemplatePack = (pack: WhatsAppTemplatePack) => {
    if (state.templatePack === pack) return;
    if (!window.confirm(txt.packConfirm)) return;

    const bodies = templatePackBodies(pack);
    const next: WhatsAppSettingsDocument = {
      ...state,
      templatePack: pack,
      templates: state.templates.map((t) => ({ ...t, message: bodies[t.type] || t.message })),
    };
    setState(next);
    // The editor below shows a copy of the selected template, so it has to follow or it would
    // keep displaying the old wording and save it back over the new one.
    setDraftMessage(bodies[templateType] || "");
    void persist(next, "none");
    showToast(txt.packApplied, "success");
  };

  /**
   * Saves on change, like every other switch here.
   *
   * This was the one control on the page that did not, which is the entire reason a page-wide
   * Save button existed — and why it sat at the bottom of a very long scroll, minutes away from
   * the checkbox that needed it.
   */
  const toggleOwnerAlert = (key: OwnerAlertKey, value: boolean) => {
    setState((prev) => {
      const next = { ...prev, ownerAlerts: { ...prev.ownerAlerts, [key]: value } };
      void persist(next, "silent");
      return next;
    });
  };

  /**
   * What the rail says. Plain language, and the manual case is a first-class answer rather than a
   * footnote: a clinic on manual delivery IS connected, but nothing leaves without someone
   * pressing send, and not knowing that is how a day of reminders quietly goes nowhere.
   */
  const channel = (() => {
    const manual = state.deliveryMode === "manual";
    if (metaStatus?.configured) {
      return {
        live: true,
        badge: manual ? txt.railManualBadge : txt.railLiveBadge,
        headline: manual ? txt.railManualMeta : txt.railLiveMeta,
        number: metaStatus.phoneNumberId ? `ID ${metaStatus.phoneNumberId}` : "",
        detail: "",
      };
    }
    if (wapilotStatus?.configured) {
      return {
        live: true,
        badge: manual ? txt.railManualBadge : txt.railLiveBadge,
        headline: manual ? txt.railManualOwn : txt.railLiveOwn,
        number: wapilotStatus.connectedPhoneHint ? String(wapilotStatus.connectedPhoneHint) : "",
        detail: "",
      };
    }
    return {
      live: false,
      badge: txt.railOffBadge,
      headline: txt.railOff,
      number: "",
      detail: txt.railOffDetail,
    };
  })();

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
      <div className="flex items-center justify-center py-24 text-ink-muted">
        <Loader2 className="animate-spin w-8 h-8 text-accent" />
      </div>
    );
  }

  return (
    <div className="w-full space-y-10 pb-4" dir={isRTL ? "rtl" : "ltr"}>
      {/* The one question this screen exists to answer, answered before anything else: can the
          clinic send right now, through what, and from which number. The old page made you read
          two gateway cards and decode two status pills to work it out. The number is set in the
          figure face — the treatment money and counts get elsewhere — because it is a stated fact,
          not form data. */}
      <div className="rounded-[1.75rem] bg-ink-slab px-6 py-6 text-white shadow-lg shadow-ink-slab/15 sm:px-8">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 space-y-2">
            <p className="flex items-center gap-2 font-display text-[10px] font-black uppercase tracking-[0.22em] text-white/45">
              <MessageCircle size={12} />
              {txt.title}
            </p>
            <p className="font-display text-lg font-bold leading-snug text-white sm:text-xl">{channel.headline}</p>
            {channel.number ? (
              <p className="font-figure text-[15px] tracking-tight text-white/70" dir="ltr">
                {channel.number}
              </p>
            ) : (
              <p className="max-w-md text-[13px] leading-relaxed text-white/55">{channel.detail}</p>
            )}
          </div>

          <div className="flex items-center gap-3 sm:flex-col sm:items-end sm:gap-2">
            <span
              className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.14em] ${
                channel.live ? "bg-white/12 text-white" : "bg-amber-400/20 text-amber-200"
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${channel.live ? "bg-emerald-400" : "bg-amber-400"}`}
              />
              {channel.badge}
            </span>
            {/* Saving is reported here, where it is always in view, instead of by a button at the
                bottom of a long scroll. Everything on this page writes as you change it. */}
            <span className="text-[11px] font-semibold text-white/45">
              {saveError ? txt.saveRefused : saving ? txt.savingNow : txt.savedAll}
            </span>
          </div>
        </div>
      </div>

      <div className="border-b border-line">
        <div className="-mb-px flex gap-6 overflow-x-auto no-scrollbar">
          {WHATSAPP_TABS.map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              aria-current={tab === id ? "page" : undefined}
              className={`whitespace-nowrap border-b-2 pb-3 text-[13px] font-bold transition-colors ${
                tab === id
                  ? "border-accent text-ink"
                  : "border-transparent text-ink-muted hover:text-ink-body"
              }`}
            >
              {txt[`tab_${id}` as keyof typeof txt] as string}
            </button>
          ))}
        </div>
      </div>
      <p className="text-xs font-bold text-ink-muted leading-relaxed">{txt[`tabHint_${tab}` as keyof typeof txt] as string}</p>

      {tab === "connection" && (
        <div className="space-y-6">
        <section className="rounded-2xl xl:rounded-3xl bg-surface border border-line shadow-sm ring-1 ring-line p-5 xl:p-6 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-center gap-2 text-ink-body">
              <Plug size={18} />
              <div>
                <h3 className="text-sm font-black uppercase tracking-wider text-ink">{txt.wapilotCard}</h3>
                <p className="text-xs text-ink-muted font-medium mt-0.5 max-w-xl">{txt.wapilotHint}</p>
              </div>
            </div>
            {wapilotLoading ? (
              <Loader2 size={18} className="animate-spin text-ink-muted" />
            ) : wapilotStatus?.source === "clinic" ? (
              <span className="inline-flex items-center gap-1.5 text-xs font-bold text-ok bg-ok-tint border border-ok/25 px-3 py-1.5 rounded-full">
                <CheckCircle2 size={14} />
                {txt.statusClinic}
              </span>
            ) : wapilotStatus?.source === "platform" ? (
              // Deliberately not green. Messages do go out, but from a number that is not this
              // clinic's — that is a problem to fix, not a healthy state to reassure someone about.
              <span className="inline-flex items-center gap-1.5 text-xs font-bold text-warn bg-warn-tint border border-warn/25 px-3 py-1.5 rounded-full">
                <AlertCircle size={14} />
                {txt.statusPlatform}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-xs font-bold text-warn bg-warn-tint border border-warn/25 px-3 py-1.5 rounded-full">
                <AlertCircle size={14} />
                {txt.statusNone}
              </span>
            )}
          </div>

          {wapilotStatus?.source === "platform" && (
            <p className="text-xs text-warn bg-warn-tint border border-warn/25 rounded-xl px-3 py-2.5 leading-relaxed">
              {txt.sharedWarning}
            </p>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label className="block">
              <span className="text-[11px] font-bold text-ink-muted uppercase tracking-wider">{txt.instanceId}</span>
              <input
                value={wapilotInstanceId}
                onChange={(e) => setWapilotInstanceId(e.target.value)}
                className="mt-1.5 w-full py-3 px-4 bg-surface-subtle border border-line rounded-xl text-sm font-semibold text-ink outline-none focus:bg-surface focus:border-accent-soft focus:ring-2 focus:ring-accent-soft/20"
                placeholder="e.g. your-wapilot-instance-id"
              />
            </label>
            <label className="block">
              <span className="text-[11px] font-bold text-ink-muted uppercase tracking-wider">{txt.apiToken}</span>
              <input
                type="password"
                value={wapilotTokenDraft}
                onChange={(e) => setWapilotTokenDraft(e.target.value)}
                autoComplete="new-password"
                className="mt-1.5 w-full py-3 px-4 bg-surface-subtle border border-line rounded-xl text-sm font-semibold text-ink outline-none focus:bg-surface focus:border-accent-soft focus:ring-2 focus:ring-accent-soft/20"
                placeholder={txt.tokenPlaceholder}
              />
            </label>
          </div>

          <button
            type="button"
            onClick={() => setShowAdvancedWapilot((v) => !v)}
            className="text-xs font-bold text-ink-body hover:text-ink"
          >
            {txt.advanced} {showAdvancedWapilot ? "▲" : "▼"}
          </button>

          {showAdvancedWapilot && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <label className="block">
                <span className="text-[11px] font-bold text-ink-muted uppercase tracking-wider">{txt.apiBaseUrl}</span>
                <input
                  value={wapilotApiBaseUrl}
                  onChange={(e) => setWapilotApiBaseUrl(e.target.value)}
                  className="mt-1.5 w-full py-3 px-4 bg-surface-subtle border border-line rounded-xl text-sm font-semibold text-ink outline-none focus:bg-surface focus:border-accent-soft"
                  placeholder="https://api.wapilot.net/api/v2"
                />
              </label>
              <label className="block">
                <span className="text-[11px] font-bold text-ink-muted uppercase tracking-wider">{txt.phoneHint}</span>
                <input
                  value={wapilotPhoneHint}
                  onChange={(e) => setWapilotPhoneHint(e.target.value)}
                  className="mt-1.5 w-full py-3 px-4 bg-surface-subtle border border-line rounded-xl text-sm font-semibold text-ink outline-none focus:bg-surface focus:border-accent-soft"
                  placeholder="+20..."
                />
              </label>
            </div>
          )}

          <button
            type="button"
            onClick={() => void handleSaveWapilotConnection()}
            disabled={wapilotSaving || wapilotLoading}
            className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-ink-slab text-white text-xs font-black uppercase tracking-widest hover:bg-ink disabled:opacity-50 transition-all"
          >
            {wapilotSaving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
            {txt.saveConnection}
          </button>
        </section>

        {/* Official Meta Cloud API. Above the two-column grid, beside Wapilot's card: they are the
            same decision — how this clinic's messages leave — and reading one without seeing the
            other is how a clinic ends up configured twice or not at all. */}
        <section className="rounded-2xl xl:rounded-3xl bg-surface border border-line shadow-sm ring-1 ring-line p-5 xl:p-6 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-center gap-2 text-ok">
              <MessageCircle size={18} />
              <div>
                <h3 className="text-sm font-black uppercase tracking-wider text-ink">{txt.metaCard}</h3>
                <p className="text-xs text-ink-muted font-medium mt-0.5 max-w-xl">{txt.metaHint}</p>
              </div>
            </div>
            {metaLoading ? (
              <Loader2 size={18} className="animate-spin text-ok" />
            ) : metaStatus?.configured ? (
              <span className="inline-flex items-center gap-1.5 text-xs font-bold text-ok bg-ok-tint border border-ok/25 px-3 py-1.5 rounded-full">
                <CheckCircle2 size={14} />
                {txt.metaConnected}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-xs font-bold text-warn bg-warn-tint border border-warn/25 px-3 py-1.5 rounded-full">
                <AlertCircle size={14} />
                {txt.metaNotConnected}
              </span>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="text-[11px] font-bold text-ink-muted uppercase tracking-wider">{txt.metaPhoneNumberId}</span>
              <input
                type="text"
                value={metaPhoneNumberId}
                onChange={(e) => setMetaPhoneNumberId(e.target.value)}
                placeholder="1142062985667803"
                className="mt-1.5 w-full py-3 px-4 bg-surface-subtle border border-line rounded-xl text-sm font-semibold text-ink outline-none focus:bg-surface focus:border-accent focus:ring-2 focus:ring-accent/15"
              />
            </label>
            <label className="block">
              <span className="text-[11px] font-bold text-ink-muted uppercase tracking-wider">{txt.metaWabaId}</span>
              <input
                type="text"
                value={metaWabaId}
                onChange={(e) => setMetaWabaId(e.target.value)}
                className="mt-1.5 w-full py-3 px-4 bg-surface-subtle border border-line rounded-xl text-sm font-semibold text-ink outline-none focus:bg-surface focus:border-accent focus:ring-2 focus:ring-accent/15"
              />
            </label>
          </div>
          <label className="block">
            <span className="text-[11px] font-bold text-ink-muted uppercase tracking-wider">{txt.metaToken}</span>
            <input
              type="password"
              value={metaTokenDraft}
              onChange={(e) => setMetaTokenDraft(e.target.value)}
              placeholder={metaStatus?.tokenSet ? txt.metaTokenKept : "EAA..."}
              autoComplete="off"
              className="mt-1.5 w-full py-3 px-4 bg-surface-subtle border border-line rounded-xl text-sm font-semibold text-ink outline-none focus:bg-surface focus:border-accent focus:ring-2 focus:ring-accent/15"
            />
          </label>
          <label className="block">
            <span className="text-[11px] font-bold text-ink-muted uppercase tracking-wider">{txt.metaTestTo}</span>
            <input
              type="tel"
              value={metaTestTo}
              onChange={(e) => setMetaTestTo(e.target.value)}
              placeholder="+2010..."
              className="mt-1.5 w-full py-3 px-4 bg-surface-subtle border border-line rounded-xl text-sm font-semibold text-ink outline-none focus:bg-surface focus:border-accent focus:ring-2 focus:ring-accent/15"
            />
          </label>

          {/* Register the number on the Cloud API from here — Meta's dashboard hides the reason it fails. */}
          <div className="rounded-xl border border-line bg-surface-subtle p-3 space-y-2">
            <p className="text-[11px] font-bold text-ink-muted uppercase tracking-wider">{txt.metaRegisterTitle}</p>
            <p className="text-xs text-ink-body leading-relaxed">{txt.metaRegisterHint}</p>
            <div className="flex flex-wrap items-end gap-2">
              <label className="block">
                <span className="text-[11px] font-bold text-ink-muted uppercase tracking-wider">{txt.metaPin}</span>
                <input
                  type="password"
                  inputMode="numeric"
                  maxLength={6}
                  value={metaPin}
                  onChange={(e) => setMetaPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  autoComplete="off"
                  placeholder="••••••"
                  className="mt-1.5 w-40 py-2.5 px-4 bg-surface border border-line rounded-xl text-sm font-semibold text-ink tracking-[0.3em] outline-none focus:border-accent focus:ring-2 focus:ring-accent/15"
                />
              </label>
              <button
                type="button"
                onClick={() => void handleRegisterMetaNumber()}
                disabled={metaRegistering || metaPin.length !== 6 || !/^\d{5,20}$/.test(metaPhoneNumberId.trim())}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-accent text-white text-xs font-black uppercase tracking-wide hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {metaRegistering ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                {txt.metaRegister}
              </button>
            </div>
            {metaRegisterResult && (
              <p
                dir="auto"
                className={`text-xs font-bold rounded-lg px-3 py-2 ${
                  metaRegisterResult.ok ? "bg-ok-tint text-ok border border-ok/25" : "bg-warn-tint text-warn border border-warn/25"
                }`}
              >
                {metaRegisterResult.text}
              </p>
            )}
          </div>

          <button
            type="button"
            onClick={() => void handleSaveMetaConnection()}
            disabled={metaSaving || metaLoading}
            className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-accent text-ink-on-accent text-xs font-black uppercase tracking-widest hover:bg-accent-strong disabled:opacity-50 transition-all"
          >
            {metaSaving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
            {txt.saveConnection}
          </button>
        </section>

        <section className="rounded-2xl xl:rounded-3xl bg-surface border border-line shadow-sm ring-1 ring-line p-5 xl:p-6 flex flex-col gap-4">
          <div className="flex items-center gap-2 text-accent">
            <Send size={18} />
            <h3 className="text-sm font-black uppercase tracking-wider text-ink">{txt.testCard}</h3>
          </div>
          <p className="text-xs text-ink-muted font-medium">{txt.testHint}</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label className="block">
              <span className="text-[11px] font-bold text-ink-muted uppercase tracking-wider">{txt.testCountry}</span>
              <select
                value={testCountryIso}
                onChange={(e) => setTestCountryIso(e.target.value)}
                className="mt-1.5 w-full py-3 px-4 bg-surface-subtle border border-line rounded-xl text-sm font-semibold text-ink outline-none focus:bg-surface focus:border-accent focus:ring-2 focus:ring-accent/15"
              >
                {WHATSAPP_DIAL_COUNTRIES.map((c) => (
                  <option key={c.iso} value={c.iso}>
                    {language === "ar" ? c.nameAr : c.nameEn} (+{c.dial})
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-[11px] font-bold text-ink-muted uppercase tracking-wider">{txt.testNational}</span>
              <input
                type="tel"
                inputMode="numeric"
                autoComplete="tel-national"
                value={testNational}
                onChange={(e) => setTestNational(e.target.value)}
                placeholder={txt.testNationalPh}
                className="mt-1.5 w-full py-3 px-4 bg-surface-subtle border border-line rounded-xl text-sm font-semibold text-ink outline-none focus:bg-surface focus:border-accent focus:ring-2 focus:ring-accent/15"
              />
            </label>
          </div>
          <p className="text-xs font-mono text-ink-body bg-surface-subtle border border-line rounded-xl px-4 py-2">
            {txt.testPreview}: <span className="font-bold text-ink">{testE164Preview || "—"}</span>
          </p>
          <label className="block">
            <span className="text-[11px] font-bold text-ink-muted uppercase tracking-wider">{txt.testMessage}</span>
            <textarea
              value={testMessage}
              onChange={(e) => setTestMessage(e.target.value)}
              rows={2}
              placeholder="Alpha Dental — test..."
              className="mt-1.5 w-full py-3 px-4 bg-surface-subtle border border-line rounded-xl text-sm font-semibold text-ink outline-none focus:bg-surface focus:border-accent focus:ring-2 focus:ring-accent/15 resize-y"
            />
          </label>
          <div>
            <button
              type="button"
              onClick={() => void handleSendTest()}
              disabled={testSending}
              className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-accent text-ink-on-accent text-xs font-black uppercase tracking-widest hover:bg-accent-strong disabled:opacity-50 transition-all shadow-md shadow-accent/15"
            >
              {testSending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
              {txt.testSend}
            </button>
          </div>
        </section>
        </div>
      )}

      {tab === "messages" && (
      <div className="flex flex-col gap-8">
        <label className="flex items-center justify-between gap-4 cursor-pointer rounded-xl border border-line bg-surface-subtle px-4 py-3">
          <span className="text-sm font-bold text-ink-body">{txt.patientToggle}</span>
          <input
            type="checkbox"
            className="h-5 w-5 rounded border-line-strong text-accent focus:ring-accent shrink-0"
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

        {/* The three business-initiated automations. Each is a template Meta has to approve
            first, so they ship switched off and the hint says what unlocks them. */}
        {(
          [
            { key: "useReminderButtons", group: txt.groupAppointments, label: txt.reminderButtonsToggle, hint: txt.reminderButtonsHint },
            { key: "isCheckinEnabled", group: txt.groupAfterVisit, label: txt.checkinToggle, hint: txt.checkinHint },
            { key: "isReviewRequestEnabled", group: txt.groupAfterVisit, label: txt.reviewToggle, hint: txt.reviewHint },
            { key: "isNoShowRecoveryEnabled", group: txt.groupWinBack, label: txt.noshowToggle, hint: txt.noshowHint },
            { key: "isLeadFollowupEnabled", group: txt.groupWinBack, label: txt.leadFollowupToggle, hint: txt.leadFollowupHint },
            { key: "isRecallEnabled", group: txt.groupWinBack, label: txt.recallToggle, hint: txt.recallHint },
          ] as const
        ).map((row, i, rows) => (
          <div key={row.key} className="space-y-2">
            {(i === 0 || rows[i - 1].group !== row.group) && (
              <p className="pt-2 text-[11px] font-black uppercase tracking-widest text-ink-muted">{row.group}</p>
            )}
          <div className="rounded-xl border border-line bg-surface-subtle px-4 py-3">
            <label className="flex items-center justify-between gap-4 cursor-pointer">
              <span className="text-sm font-bold text-ink-body">{row.label}</span>
              <input
                type="checkbox"
                className="h-5 w-5 rounded border-line-strong text-accent focus:ring-accent shrink-0"
                checked={Boolean(state[row.key])}
                onChange={(e) => {
                  const checked = e.target.checked;
                  setState((s) => {
                    const next = { ...s, [row.key]: checked };
                    void persist(next, "silent");
                    return next;
                  });
                }}
              />
            </label>
            <p className="mt-1.5 text-xs text-ink-muted leading-relaxed">{row.hint}</p>
            {row.key === "isRecallEnabled" && state.isRecallEnabled && (
              <label className="mt-3 flex items-center gap-3 text-xs font-semibold text-ink-body">
                {txt.recallMonths}
                <select
                  className="rounded-lg border border-line bg-surface px-2 py-1.5 text-sm"
                  value={state.recallAfterMonths ?? 6}
                  onChange={(e) => {
                    const months = Number(e.target.value) || 6;
                    setState((s) => {
                      const next = { ...s, recallAfterMonths: months };
                      void persist(next, "silent");
                      return next;
                    });
                  }}
                >
                  {[3, 4, 6, 9, 12].map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </label>
            )}
          </div>
          </div>
        ))}

        {/* A refused save, said once and left on screen. A toast for this was
            missed every time, which is how a setting that never saved looked
            like a setting that would not select. */}
        {saveError && (
          <p
            role="alert"
            className="text-xs font-semibold border border-danger/25 bg-danger-tint text-danger rounded-xl px-3 py-2.5 leading-relaxed"
          >
            {saveError}
          </p>
        )}

        <p className="text-xs text-ink-body bg-warn-tint border border-warn/25 rounded-xl px-3 py-2.5 leading-relaxed">
          {txt.paymentAutomationHint}
        </p>


        {/* How messages leave. See WhatsAppDeliveryMode for why manual is a first-class choice. */}
        <div className="space-y-2">
          <p className="text-[11px] font-black uppercase tracking-widest text-ink-muted">{txt.deliveryTitle}</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {(["auto", "manual"] as const).map((mode) => {
              // When no choice is stored, show what the server will actually do
              // (resolveWhatsappDeliveryMode): auto needs the plan feature AND a connected
              // gateway; everything else falls back to a person pressing send.
              const effectiveMode =
                state.deliveryMode ??
                (canSendAutomatically && wapilotStatus && wapilotStatus.source !== "none"
                  ? "auto"
                  : "manual");
              const active = effectiveMode === mode;
              // Shown but not hidden when the plan excludes it: a feature nobody can see is a
              // feature nobody upgrades for, and silently removing the option would leave a
              // clinic wondering why their messages stopped sending themselves.
              const locked = mode === "auto" && !canSendAutomatically;
              return (
                <button
                  key={mode}
                  type="button"
                  disabled={locked}
                  onClick={() =>
                    setState((s) => {
                      const next = { ...s, deliveryMode: mode };
                      void persist(next, "silent");
                      return next;
                    })
                  }
                  className={`text-start rounded-xl border px-4 py-3 transition-all ${
                    locked
                      ? "cursor-not-allowed border-line bg-surface-subtle opacity-70"
                      : active
                        ? "border-accent bg-accent-tint ring-1 ring-accent-soft"
                        : "border-line bg-surface-subtle hover:border-line-strong"
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <span className="text-sm font-bold text-ink">
                      {mode === "auto" ? txt.deliveryAuto : txt.deliveryManual}
                    </span>
                    {locked && (
                      <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-md bg-warn-tint text-warn">
                        {txt.deliveryLocked}
                      </span>
                    )}
                  </span>
                  <span className="block text-xs text-ink-muted mt-1 leading-relaxed">
                    {mode === "auto"
                      ? locked
                        ? txt.deliveryLockedHint
                        : txt.deliveryAutoHint
                      : txt.deliveryManualHint}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="rounded-xl border border-ok/25 bg-ok-tint/70 px-4 py-3">
            <p className="text-[11px] font-black uppercase tracking-widest text-ok">
              {txt.deliveryQueueTitle}
            </p>
            <p className="text-xs text-ok mt-1.5 leading-relaxed">{txt.deliveryQueueBody}</p>
          </div>
        </div>


        {/* Leads are strangers, not patients — a separate switch on purpose. A clinic may want
            reminders for its own people and no machine greeting anybody else, or the reverse. */}
        <div className="rounded-xl border border-warn/25 bg-warn-tint/60 p-4 space-y-3">
          <label className="flex items-center justify-between gap-4 cursor-pointer">
            <span className="text-sm font-black text-warn">{txt.leadCard}</span>
            <input
              type="checkbox"
              className="h-5 w-5 rounded border-warn/40 text-warn focus:ring-warn shrink-0"
              checked={state.isLeadAutoReplyEnabled ?? false}
              onChange={(e) => {
                const checked = e.target.checked;
                setState((s) => {
                  const next = { ...s, isLeadAutoReplyEnabled: checked };
                  void persist(next, "silent");
                  return next;
                });
              }}
            />
          </label>
          <p className="text-xs font-bold text-warn/80 leading-relaxed">{txt.leadToggle}</p>
          <p className="text-xs text-ink-body leading-relaxed">{txt.leadHint}</p>
          <p className="text-xs text-warn bg-warn-tint border border-warn/25 rounded-lg px-3 py-2 leading-relaxed">
            {txt.leadWarning}
          </p>
        </div>


        {/* Opt-out. Sits above the template editor on purpose: it is the setting that decides
            whether the clinic still has a WhatsApp number in six months, and it should be read
            before the wording is fiddled with rather than found underneath it. */}
        <div className="rounded-xl border border-warn/25 bg-warn-tint/60 p-4 space-y-3">
          <p className="text-[11px] font-black uppercase tracking-widest text-warn">{txt.optOutTitle}</p>
          <label className="flex items-center justify-between gap-4 cursor-pointer">
            <span className="text-sm font-bold text-warn leading-relaxed">{txt.optOutToggle}</span>
            <input
              type="checkbox"
              className="h-5 w-5 rounded border-warn/40 text-warn focus:ring-warn shrink-0"
              checked={state.optOutFooterEnabled !== false}
              onChange={(e) => {
                const checked = e.target.checked;
                setState((s) => {
                  const next = { ...s, optOutFooterEnabled: checked };
                  void persist(next, "silent");
                  return next;
                });
              }}
            />
          </label>
          <p className="text-xs text-ink-body leading-relaxed">{txt.optOutHint}</p>
          <p className="text-xs text-warn leading-relaxed">{txt.optOutWarning}</p>
        </div>

      </div>
      )}

      {tab === "wording" && (
      <div className="flex flex-col gap-8">
        {/* Which built-in wording the templates start from. */}
        <div className="space-y-3">
          <p className="text-[11px] font-bold text-ink-muted uppercase tracking-wider">{txt.packTitle}</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {(
              [
                { pack: "bilingual" as const, label: txt.packBilingual, hint: txt.packBilingualHint },
                { pack: "arabic" as const, label: txt.packArabic, hint: txt.packArabicHint },
              ]
            ).map(({ pack, label, hint }) => {
              const selected = (state.templatePack ?? "bilingual") === pack;
              return (
                <button
                  key={pack}
                  type="button"
                  onClick={() => applyTemplatePack(pack)}
                  className={`text-start rounded-xl border p-3 transition-all ${
                    selected
                      ? "border-accent bg-accent-tint ring-2 ring-accent/15"
                      : "border-line bg-surface-subtle hover:border-line-strong"
                  }`}
                >
                  <span className="block text-sm font-black text-ink">{label}</span>
                  <span className="block text-xs text-ink-muted mt-1 leading-relaxed">{hint}</span>
                  {!selected && (
                    <span className="block text-[10px] font-black uppercase tracking-widest text-accent mt-2">
                      {txt.packApply}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>


        <div className="space-y-3">
          <label className="block">
            <span className="text-[11px] font-bold text-ink-muted uppercase tracking-wider">{txt.templateType}</span>
            <select
              value={templateType}
              onChange={(e) => setTemplateType(e.target.value as WhatsAppTemplateType)}
              className="mt-1.5 w-full py-3 px-4 bg-surface-subtle border border-line rounded-xl text-sm font-semibold text-ink outline-none focus:bg-surface focus:border-accent focus:ring-2 focus:ring-accent/15"
            >
              <option value="new">{txt.types.new}</option>
              <option value="edit">{txt.types.edit}</option>
              <option value="cancel">{txt.types.cancel}</option>
              <option value="invoice">{txt.types.invoice}</option>
              <option value="treatment">{txt.types.treatment}</option>
              <option value="reminder24h">{txt.types.reminder24h}</option>
              <option value="google_review">{txt.types.google_review}</option>
              <option value="lead_welcome">{txt.types.lead_welcome}</option>
            </select>
          </label>
          <p className="text-xs text-ink-muted font-medium">
            {templateType === "lead_welcome"
              ? txt.leadWelcomeHint
              : templateType === "google_review"
              ? txt.googleReviewHint
              : templateType === "invoice"
                ? txt.invoiceHint
                : templateType === "reminder24h"
                  ? txt.reminder24hHint
                  : txt.templateHint}
          </p>
          <label className="block">
            <span className="text-[11px] font-bold text-ink-muted uppercase tracking-wider">{txt.message}</span>
            <textarea
              value={draftMessage}
              onChange={(e) => setDraftMessage(e.target.value)}
              rows={5}
              className="mt-1.5 w-full py-3 px-4 bg-surface-subtle border border-line rounded-xl text-sm font-semibold text-ink outline-none focus:bg-surface focus:border-accent focus:ring-2 focus:ring-accent/15 resize-y min-h-[120px]"
            />
          </label>
          <label className="flex items-center gap-2 text-sm font-semibold text-ink-body">
            <input
              type="checkbox"
              checked={draftActive}
              onChange={(e) => setDraftActive(e.target.checked)}
              className="rounded border-line-strong text-accent focus:ring-accent"
            />
            {txt.active}
          </label>
          <button
            type="button"
            onClick={handleSaveTemplate}
            disabled={saving}
            className="inline-flex items-center justify-center gap-2 w-full sm:w-auto px-5 py-3 rounded-xl bg-accent text-ink-on-accent text-xs font-black uppercase tracking-widest hover:bg-accent-strong disabled:opacity-50 transition-all"
          >
            <Save size={16} />
            {txt.saveTemplate}
          </button>
        </div>
      </div>
      )}

      {(tab === "assistant" || tab === "answers" || tab === "playground" || tab === "alerts") && (
        <div className="space-y-6">
      <div hidden={tab === "alerts"} className="flex flex-col gap-8">
        {/* Answering inbound messages. Sits under the opt-out card because it shares the same
            risk: this is the one feature that talks to a patient with no staff member deciding
            to, so its off-switch and its limits belong where they can be read together. */}
        <div className="space-y-3">
          <div hidden={tab !== "assistant"} className="space-y-3">
          <p className="text-[11px] font-black uppercase tracking-widest text-ink-body">{txt.botTitle}</p>
          <label className="flex items-center justify-between gap-4 cursor-pointer">
            <span className="text-sm font-black text-ink leading-relaxed">{txt.botToggle}</span>
            <input
              type="checkbox"
              className="h-5 w-5 rounded border-line-strong text-ink-muted focus:ring-accent-soft/30 shrink-0"
              checked={state.botEnabled === true}
              onChange={(e) => {
                const checked = e.target.checked;
                setState((s) => {
                  const next = { ...s, botEnabled: checked };
                  void persist(next, "silent");
                  return next;
                });
              }}
            />
          </label>
          <p className="text-xs text-ink-body leading-relaxed">{txt.botHint}</p>
          </div>
          {state.botEnabled !== true && tab !== "assistant" && (
            <p className="text-xs font-bold text-warn bg-warn-tint border border-warn/25 rounded-lg px-3 py-2">{txt.botOffFirst}</p>
          )}

          {state.botEnabled === true && (
            <>
              <div hidden={tab !== "assistant"} className="space-y-3">
              {(state.deliveryMode ?? (canSendAutomatically ? "auto" : "manual")) !== "auto" && (
                <p className="text-xs font-bold text-warn bg-warn-tint border border-warn/25 rounded-lg px-3 py-2 leading-relaxed">
                  {txt.botNeedsGateway}
                </p>
              )}
              <label className="flex items-center justify-between gap-4 cursor-pointer pt-1">
                <span className="text-sm font-bold text-ink leading-relaxed">{txt.botStrangers}</span>
                <input
                  type="checkbox"
                  className="h-5 w-5 rounded border-line-strong text-ink-muted focus:ring-accent-soft/30 shrink-0"
                  checked={state.botAnswerStrangers === true}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setState((s) => {
                      const next = { ...s, botAnswerStrangers: checked };
                      void persist(next, "silent");
                      return next;
                    });
                  }}
                />
              </label>
              <p className="max-w-2xl text-xs leading-relaxed text-ink-muted">{txt.botStrangersHint}</p>
              <label className="flex items-center justify-between gap-4 cursor-pointer pt-1">
                <span className="text-sm font-bold text-ink leading-relaxed">{txt.botAutoConfirm}</span>
                <input
                  type="checkbox"
                  className="h-5 w-5 rounded border-line-strong text-ink-muted focus:ring-accent-soft/30 shrink-0"
                  checked={state.botAutoConfirmBookings === true}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setState((s) => {
                      const next = { ...s, botAutoConfirmBookings: checked };
                      void persist(next, "silent");
                      return next;
                    });
                  }}
                />
              </label>
              <p className="max-w-2xl text-xs leading-relaxed text-ink-muted">{txt.botAutoConfirmHint}</p>
              <label className="flex items-center justify-between gap-4 cursor-pointer pt-1">
                <span className="text-sm font-bold text-ink leading-relaxed">{txt.botAi}</span>
                <input
                  type="checkbox"
                  className="h-5 w-5 rounded border-line-strong text-ink-muted focus:ring-accent-soft/30 shrink-0"
                  checked={state.botAiEnabled === true}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setState((s) => {
                      const next = { ...s, botAiEnabled: checked };
                      void persist(next, "silent");
                      return next;
                    });
                  }}
                />
              </label>
              <p className="max-w-2xl text-xs leading-relaxed text-ink-muted">{txt.botAiHint}</p>
              <p className="max-w-2xl text-xs leading-relaxed text-ink-muted">{txt.botLimits}</p>

              {/* Symptoms: a person, or the AI as a dentist first. Needs the AI on to mean anything. */}
              <label className={`flex items-center justify-between gap-4 pt-1 ${state.botAiEnabled ? "cursor-pointer" : "opacity-50"}`}>
                <span className="text-sm font-bold text-ink leading-relaxed">{txt.botDentist}</span>
                <input
                  type="checkbox"
                  className="h-5 w-5 rounded border-line-strong text-ink-muted focus:ring-accent-soft/30 shrink-0"
                  disabled={!state.botAiEnabled}
                  checked={state.botClinicalMode === "dentist"}
                  onChange={(e) => {
                    const on = e.target.checked;
                    setState((s) => {
                      const next = { ...s, botClinicalMode: on ? ("dentist" as const) : ("handoff" as const) };
                      void persist(next, "silent");
                      return next;
                    });
                  }}
                />
              </label>
              <p className="max-w-2xl text-xs leading-relaxed text-ink-muted">{txt.botDentistHint}</p>

              {/* How long a staff reply keeps the bot out of the thread. */}
              <div className="flex flex-wrap items-center gap-3 pt-1">
                <span className="text-sm font-bold text-ink">{txt.botClaim}</span>
                <input
                  type="number"
                  min={0}
                  max={1440}
                  className="w-24 rounded-lg border border-line bg-surface px-3 py-1.5 text-sm text-ink"
                  value={state.botHumanClaimMinutes === undefined ? "" : state.botHumanClaimMinutes}
                  placeholder="15"
                  onChange={(e) => {
                    const raw = e.target.value;
                    const n = Math.max(0, Math.min(1440, Math.round(Number(raw) || 0)));
                    setState((s) => ({ ...s, botHumanClaimMinutes: raw === "" ? undefined : n }));
                  }}
                  onBlur={() => void persist(state, "silent")}
                />
                <span className="text-xs text-ink-muted">{txt.botClaimUnit}</span>
              </div>
              <p className="max-w-2xl text-xs leading-relaxed text-ink-muted">{txt.botClaimHint}</p>

              {/* Salesperson mode: the model leads, with a cap the clinic chooses and its own coaching. */}
              <div className="pt-4 mt-2 border-t border-line space-y-3">
                <label className="flex items-center justify-between gap-4 cursor-pointer">
                  <span className="text-sm font-bold text-ink leading-relaxed">{txt.botSales}</span>
                  <input
                    type="checkbox"
                    className="h-5 w-5 rounded border-line-strong text-ink-muted focus:ring-accent-soft/30 shrink-0"
                    checked={state.botMode === "ai_first"}
                    onChange={(e) => {
                      const on = e.target.checked;
                      setState((s) => {
                        const next = { ...s, botMode: on ? ("ai_first" as const) : ("assisted" as const), ...(on ? { botAiEnabled: true } : {}) };
                        void persist(next, "silent");
                        return next;
                      });
                    }}
                  />
                </label>
                <p className="max-w-2xl text-xs leading-relaxed text-ink-muted">{txt.botSalesHint}</p>

                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-xs font-bold text-ink">{txt.botAiCap}</span>
                  <input
                    type="number"
                    min={1}
                    max={200}
                    disabled={state.botAiMaxReplies === 0}
                    className="w-24 rounded-lg border border-line bg-surface px-3 py-1.5 text-sm text-ink disabled:opacity-40"
                    value={state.botAiMaxReplies === 0 || state.botAiMaxReplies === undefined ? "" : state.botAiMaxReplies}
                    placeholder={state.botMode === "ai_first" ? "∞" : "3"}
                    onChange={(e) => {
                      const n = Math.max(1, Math.min(200, Number(e.target.value) || 0));
                      setState((s) => ({ ...s, botAiMaxReplies: e.target.value === "" ? undefined : n }));
                    }}
                    onBlur={() => void persist(state, "silent")}
                  />
                  <label className="flex items-center gap-2 text-xs font-bold text-ink cursor-pointer">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-line-strong"
                      checked={state.botAiMaxReplies === 0 || (state.botAiMaxReplies === undefined && state.botMode === "ai_first")}
                      onChange={(e) => {
                        const unlimited = e.target.checked;
                        setState((s) => {
                          const next = { ...s, botAiMaxReplies: unlimited ? 0 : 12 };
                          void persist(next, "silent");
                          return next;
                        });
                      }}
                    />
                    {txt.botAiCapUnlimited}
                  </label>
                </div>
                <p className="max-w-2xl text-xs leading-relaxed text-ink-muted">{txt.botAiCapHint}</p>

                <div className="flex flex-wrap items-center gap-3 pt-1">
                  <span className="text-xs font-bold text-ink">{txt.botPersona}</span>
                  <input
                    type="text"
                    dir="auto"
                    className="w-40 rounded-lg border border-line bg-surface px-3 py-1.5 text-sm text-ink placeholder:text-ink-muted"
                    placeholder={txt.botPersonaPh}
                    value={state.botPersonaName ?? ""}
                    onChange={(e) => {
                      const value = e.target.value;
                      setState((s) => ({ ...s, botPersonaName: value }));
                    }}
                    onBlur={() => void persist(state, "silent")}
                  />
                </div>
                <label className="flex items-center justify-between gap-4 cursor-pointer">
                  <span className="text-xs font-bold text-ink leading-relaxed">{txt.botHumanTouch}</span>
                  <input
                    type="checkbox"
                    className="h-5 w-5 rounded border-line-strong text-ink-muted focus:ring-accent-soft/30 shrink-0"
                    checked={state.botHumanTouch !== false}
                    onChange={(e) => {
                      const on = e.target.checked;
                      setState((s) => {
                        const next = { ...s, botHumanTouch: on };
                        void persist(next, "silent");
                        return next;
                      });
                    }}
                  />
                </label>

                <label className="block space-y-1 pt-1">
                  <span className="text-xs font-bold text-ink">{txt.botCoaching}</span>
                  <textarea
                    rows={4}
                    dir="auto"
                    className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-muted focus:border-accent-soft focus:ring-1 focus:ring-accent-soft/30 resize-y"
                    placeholder={txt.botCoachingPh}
                    value={state.botCoaching ?? ""}
                    onChange={(e) => {
                      const value = e.target.value;
                      setState((s) => ({ ...s, botCoaching: value }));
                    }}
                    onBlur={() => void persist(state, "silent")}
                  />
                </label>
                <p className="max-w-2xl text-xs leading-relaxed text-ink-muted">{txt.botCoachingHint}</p>
              </div>
              </div>

              {/*
                The answers the system does not otherwise hold.
                Every one of these questions reached a receptionist every single time, or reached
                the model with no data and came back as general dentistry in the clinic's voice.
                Empty stays safe — the bot says a person will follow up rather than guessing.
              */}
              <div hidden={tab !== "answers"} className="space-y-3">
                <p className="text-[11px] font-black uppercase tracking-widest text-ink-body">{txt.factsTitle}</p>
                <p className="text-xs text-ink-body leading-relaxed">{txt.factsHint}</p>
                <div className="grid gap-3">
                  {(
                    [
                      { key: "whyUs" as const, label: txt.factWhyUs, ph: txt.factWhyUsPh },
                      { key: "consultation" as const, label: txt.factConsultation, ph: txt.factConsultationPh },
                      { key: "walkIn" as const, label: txt.factWalkIn, ph: txt.factWalkInPh },
                      { key: "durations" as const, label: txt.factDurations, ph: txt.factDurationsPh },
                      { key: "sessions" as const, label: txt.factSessions, ph: txt.factSessionsPh },
                      { key: "installments" as const, label: txt.factInstallments, ph: txt.factInstallmentsPh },
                      { key: "offers" as const, label: txt.factOffers, ph: txt.factOffersPh },
                      { key: "offersUntil" as const, label: txt.factOffersUntil, ph: txt.factOffersUntilPh },
                      { key: "insurance" as const, label: txt.factInsurance, ph: txt.factInsurancePh },
                      { key: "notOffered" as const, label: txt.factNotOffered, ph: txt.factNotOfferedPh },
                      { key: "aftercare" as const, label: txt.factAftercare, ph: txt.factAftercarePh },
                      { key: "parking" as const, label: txt.factParking, ph: txt.factParkingPh },
                      { key: "mapsUrl" as const, label: txt.factMaps, ph: txt.factMapsPh },
                    ]
                  ).map(({ key, label, ph }) => (
                    <label key={key} className="block space-y-1">
                      <span className="text-xs font-bold text-ink">{label}</span>
                      {key === "offersUntil" ? (
                        <input
                          type="date"
                          className="block rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink focus:border-accent-soft focus:ring-1 focus:ring-accent-soft/30"
                          value={state.botFacts?.offersUntil ?? ""}
                          onChange={(e) => {
                            const value = e.target.value;
                            setState((s) => ({ ...s, botFacts: { ...(s.botFacts ?? {}), offersUntil: value } }));
                          }}
                          onBlur={() => void persist(state, "silent")}
                        />
                      ) : (
                      <textarea
                        rows={key === "mapsUrl" ? 1 : 2}
                        dir="auto"
                        className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-muted focus:border-accent-soft focus:ring-1 focus:ring-accent-soft/30 resize-y"
                        placeholder={ph}
                        value={state.botFacts?.[key] ?? ""}
                        onChange={(e) => {
                          const value = e.target.value;
                          setState((s) => ({ ...s, botFacts: { ...(s.botFacts ?? {}), [key]: value } }));
                        }}
                        // Saved on blur rather than per keystroke: these are sentences, and a
                        // write per character is a write per character.
                        onBlur={() => void persist(state, "silent")}
                      />
                      )}
                    </label>
                  ))}
                </div>
              </div>

              <div hidden={tab !== "playground"}><BotPlayground /></div>
            </>
          )}
        </div>

      </div>
        {/* Owner alerts */}
        <section hidden={tab !== "alerts"} className="rounded-2xl xl:rounded-3xl bg-surface border border-line shadow-sm ring-1 ring-line p-5 xl:p-6 flex flex-col gap-5">
          <h3 className="text-sm font-black uppercase tracking-wider text-ink">{txt.ownerCard}</h3>

          <label className="block">
            <span className="text-[11px] font-bold text-ink-muted uppercase tracking-wider">{txt.ownerNumber}</span>
            <input
              type="tel"
              value={state.ownerNumber}
              onChange={(e) => setState((s) => ({ ...s, ownerNumber: e.target.value }))}
              placeholder="+2010..."
              className="mt-1.5 w-full py-3 px-4 bg-surface-subtle border border-line rounded-xl text-sm font-semibold text-ink outline-none focus:bg-surface focus:border-accent focus:ring-2 focus:ring-accent/15"
            />
            <p className="text-xs text-ink-muted mt-1">{txt.ownerHint}</p>
          </label>

          <div>
            <p className="text-[11px] font-bold text-ink-muted uppercase tracking-wider mb-3">{txt.alertGrid}</p>
            <div className="overflow-x-auto rounded-xl border border-line">
              <table className="w-full min-w-[320px] text-sm">
                <thead>
                  <tr className="bg-surface-subtle border-b border-line">
                    <th className="text-start px-3 py-2.5 text-[10px] font-black uppercase tracking-wider text-ink-muted">
                      {language === "ar" ? "الوحدة" : "Module"}
                    </th>
                    {ACTION_HEADERS.map((h) => (
                      <th key={h.key} className="text-center px-2 py-2.5 text-[10px] font-black uppercase tracking-wider text-ink-muted">
                        {language === "ar" ? h.labelAr : h.labelEn}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {OWNER_ALERT_MATRIX.map((row) => (
                    <tr key={row.module} className="border-b border-line last:border-0">
                      <td className="px-3 py-3 font-bold text-ink">
                        {language === "ar" ? row.labelAr : row.labelEn}
                      </td>
                      {row.keys.map((key) => (
                        <td key={key} className="text-center py-3">
                          <input
                            type="checkbox"
                            className="w-4 h-4 rounded border-line-strong text-accent focus:ring-accent cursor-pointer"
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
      )}

    </div>
  );
}
