"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  Megaphone, Wand2, CalendarDays, FolderOpen, BookOpen, Loader2, Copy, Check,
  ChevronLeft, ChevronRight, Trash2, Clock, X, FileText, Clapperboard, Target,
  Sparkles, CheckCircle2, AlertTriangle, CalendarPlus, Film, Star, SlidersHorizontal,
  Send, UserX, ClipboardList, Cake, Armchair, PartyPopper, ThumbsDown,
  TrendingUp, QrCode, Printer, Link2, Search, Palette, Camera,
} from "lucide-react";
import QRCode from "qrcode";
import LeadFunnelReport from "@/components/reports/LeadFunnelReport";
import { DEFAULT_LEAD_SOURCES } from "@/lib/leads";
import DesignStudio, { type DesignInput } from "@/components/marketing/DesignStudio";
import CasesTab from "@/components/marketing/CasesTab";
import {
  onSnapshot, orderBy, query, addDoc, updateDoc, deleteDoc, serverTimestamp,
  getDocs, setDoc, where,
} from "firebase/firestore";
import { auth } from "@/lib/firebase";
import { getClinicCollection, getClinicDoc } from "@/lib/db-utils";
import { useLanguage } from "@/context/LanguageContext";
import { useAuth } from "@/context/AuthContext";
import { useUI } from "@/context/UIContext";
import { useClinic } from "@/context/ClinicContext";
import PermissionGuard from "@/components/PermissionGuard";
import { UpgradeRequired } from "@/components/UpgradeRequired";
import { hasFeature, getMarketingCreditLimit } from "@/lib/subscriptions";
import { logActivity } from "@/lib/logger";
import {
  MARKETING_GOALS, MARKETING_OCCASIONS, MARKETING_TONES, MARKETING_PLAYBOOKS,
  MARKETING_CHANNELS, MARKETING_CREDIT_COST, VOICE_FORMALITY, VOICE_EMOJI, VOICE_PRICE,
  CAMPAIGN_SEGMENTS, OCCASION_DATES, MARKETING_THEMES, REEL_FORMATS,
  type MarketingItem, type MarketingKind, type MarketingLanguage, type MarketingVariant,
  type MarketingPlanEntry, type MarketingChannel, type MarketingVoiceProfile,
  type CampaignSegment, type CampaignRecipient, type MarketingCampaign, type BrandKit,
} from "@/types/marketing";
import { handleWhatsAppApiResult } from "@/lib/whatsappManual";

/* ---------------------------------- date helpers ---------------------------------- */

const pad = (n: number) => String(n).padStart(2, "0");
const toYmd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayYmd = () => toYmd(new Date());
const addDaysYmd = (base: string, days: number) => {
  const [y, m, d] = base.split("-").map(Number);
  return toYmd(new Date(y, (m || 1) - 1, (d || 1) + days));
};

/* ---------------------------------- small ui bits ---------------------------------- */

const KIND_META: Record<MarketingKind, { icon: any; en: string; ar: string; chip: string }> = {
  post: { icon: FileText, en: "Post", ar: "منشور", chip: "bg-sky-50 text-sky-700 border-sky-200" },
  reel: { icon: Clapperboard, en: "Reel", ar: "ريلز", chip: "bg-violet-50 text-violet-700 border-violet-200" },
  ad: { icon: Target, en: "Ad", ar: "إعلان", chip: "bg-amber-50 text-amber-800 border-amber-200" },
};

const STATUS_META: Record<string, { en: string; ar: string; chip: string }> = {
  draft: { en: "Draft", ar: "مسودة", chip: "bg-slate-100 text-slate-600 border-slate-200" },
  scheduled: { en: "Scheduled", ar: "مجدول", chip: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  posted: { en: "Posted", ar: "تم النشر", chip: "bg-slate-900 text-white border-slate-900" },
};

function KindChip({ kind, isAr }: { kind: MarketingKind; isAr: boolean }) {
  const meta = KIND_META[kind] || KIND_META.post;
  const Icon = meta.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg border text-[11px] font-black ${meta.chip}`}>
      <Icon size={12} /> {isAr ? meta.ar : meta.en}
    </span>
  );
}

function StatusChip({ status, isAr }: { status: string; isAr: boolean }) {
  const meta = STATUS_META[status] || STATUS_META.draft;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-lg border text-[11px] font-black ${meta.chip}`}>
      {isAr ? meta.ar : meta.en}
    </span>
  );
}

/* ------------------------------------ the page ------------------------------------ */

type Tab = "create" | "campaigns" | "cases" | "reviews" | "results" | "calendar" | "library" | "playbooks";

/** One row of clinics/{id}/review_requests — written by the nightly robot and the public page. */
type ReviewRequest = {
  id: string;
  patientId: string;
  patientName: string;
  phone: string;
  appointmentDate?: string;
  status: "queued" | "rated";
  rating?: number;
  feedback?: string;
  handled?: boolean;
  createdAt?: unknown;
  ratedAt?: unknown;
};

type CampaignDraft = {
  id: string;
  patientId: string;
  patientName: string;
  phone: string;
  body: string;
  status: string;
  context?: { campaignId?: string; campaignName?: string } | null;
};

export default function MarketingPage() {
  const { language } = useLanguage();
  const isAr = language === "ar";
  const { user } = useAuth();
  const { clinic, clinicId, isAdmin } = useClinic();
  const { showToast, confirm } = useUI();

  const unlocked = hasFeature(clinic, "marketingText");
  const designUnlocked = unlocked && hasFeature(clinic, "marketingDesign");
  const creditLimit = getMarketingCreditLimit(clinic);

  /* ------- brand kit + design studio (the Design tier) ------- */

  const [brand, setBrand] = useState<BrandKit>({ theme: "modern" });
  const [brandOpen, setBrandOpen] = useState(false);
  const [brandSaving, setBrandSaving] = useState(false);
  const [logoAiBusy, setLogoAiBusy] = useState(false);
  const [designItem, setDesignItem] = useState<DesignInput | null>(null);
  const [profileLite, setProfileLite] = useState<{ clinicName: string; phone: string; logoUrl: string }>({
    clinicName: "",
    phone: "",
    logoUrl: "",
  });

  useEffect(() => {
    if (!user || !designUnlocked) return;
    const unsub = onSnapshot(getClinicDoc("marketing_settings", "brand"), (snap) => {
      if (snap.exists()) {
        const d = snap.data() as BrandKit;
        setBrand({ ...d, theme: d.theme || "modern" });
      }
    });
    return () => unsub();
  }, [user, designUnlocked]);

  useEffect(() => {
    if (!user || !designUnlocked) return;
    getDocs(query(getClinicCollection("settings")))
      .then((snap) => {
        const doc_ = snap.docs.find((d) => d.id === "clinicProfile");
        const d = (doc_?.data() || {}) as Record<string, unknown>;
        setProfileLite({
          clinicName: String(d.clinicName || clinic?.name || ""),
          phone: String(d.phone || ""),
          logoUrl: String(d.logoUrl || ""),
        });
      })
      .catch(() => setProfileLite({ clinicName: clinic?.name || "", phone: "", logoUrl: "" }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, designUnlocked]);

  const saveBrand = async (patch: Partial<BrandKit>) => {
    setBrandSaving(true);
    try {
      const next = { ...brand, ...patch };
      setBrand(next);
      await setDoc(
        getClinicDoc("marketing_settings", "brand"),
        { ...next, updatedAt: serverTimestamp(), updatedBy: user?.uid || "" },
        { merge: true }
      );
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setBrandSaving(false);
    }
  };

  const [tab, setTab] = useState<Tab>("create");
  const [items, setItems] = useState<MarketingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [services, setServices] = useState<string[]>([]);
  const [creditsUsed, setCreditsUsed] = useState(0);
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  const [copiedKey, setCopiedKey] = useState("");

  useEffect(() => setPortalTarget(document.body), []);

  /* ------- voice profile (the setup wizard's output) ------- */

  const [voice, setVoice] = useState<MarketingVoiceProfile | null>(null);
  const [voiceLoaded, setVoiceLoaded] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardStep, setWizardStep] = useState(0);
  const [wizardSaving, setWizardSaving] = useState(false);
  const [wForm, setWForm] = useState<MarketingVoiceProfile>({
    formality: "balanced",
    emojiLevel: "medium",
    pricePolicy: "offers_only",
    signaturePhrases: "",
    alwaysMention: "",
    bannedWords: "",
    focusServices: [],
    defaultLanguage: isAr ? "ar" : "en",
    defaultTone: "friendly",
  });
  const [defaultsApplied, setDefaultsApplied] = useState(false);

  useEffect(() => {
    if (!user || !unlocked) return;
    const unsub = onSnapshot(getClinicDoc("marketing_settings", "voice"), (snap) => {
      setVoice(snap.exists() ? (snap.data() as MarketingVoiceProfile) : null);
      setVoiceLoaded(true);
    });
    return () => unsub();
  }, [user, unlocked]);

  const saveVoice = async (skippedOnly: boolean) => {
    setWizardSaving(true);
    try {
      const payload: Record<string, unknown> = skippedOnly
        ? { skipped: true, updatedAt: serverTimestamp(), updatedBy: user?.uid || "" }
        : {
            ...wForm,
            skipped: false,
            completedAt: voice?.completedAt || serverTimestamp(),
            updatedAt: serverTimestamp(),
            updatedBy: user?.uid || "",
          };
      await setDoc(getClinicDoc("marketing_settings", "voice"), payload, { merge: true });
      if (!skippedOnly) {
        void logActivity({ uid: user?.uid, name: user?.name, role: user?.role }, "Marketing voice profile updated");
        showToast(isAr ? "تم حفظ صوت العيادة — كل التوليدات القادمة ستلتزم به" : "Clinic voice saved — every future generation will follow it", "success");
      }
      setWizardOpen(false);
      setWizardStep(0);
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setWizardSaving(false);
    }
  };

  const openWizard = () => {
    if (voice) {
      setWForm({
        formality: voice.formality || "balanced",
        emojiLevel: voice.emojiLevel || "medium",
        pricePolicy: voice.pricePolicy || "offers_only",
        signaturePhrases: voice.signaturePhrases || "",
        alwaysMention: voice.alwaysMention || "",
        bannedWords: voice.bannedWords || "",
        focusServices: voice.focusServices || [],
        defaultLanguage: voice.defaultLanguage || (isAr ? "ar" : "en"),
        defaultTone: voice.defaultTone || "friendly",
      });
    }
    setWizardStep(0);
    setWizardOpen(true);
  };

  /** First visit: the wizard IS the page until it is finished or explicitly skipped. */
  const wizardForced = voiceLoaded && !voice?.completedAt && !voice?.skipped;

  /* ------- live data ------- */

  useEffect(() => {
    if (!user || !unlocked) return;
    const q = query(getClinicCollection("marketing_content"), orderBy("createdAt", "desc"));
    const unsub = onSnapshot(q, (snap) => {
      setItems(snap.docs.map((d) => ({ id: d.id, ...d.data() } as MarketingItem)));
      setLoading(false);
    });
    return () => unsub();
  }, [user, unlocked]);

  useEffect(() => {
    if (!user || !unlocked) return;
    const monthKey = new Date().toISOString().slice(0, 7);
    const unsub = onSnapshot(getClinicDoc("ai_usage", monthKey), (snap) => {
      setCreditsUsed(snap.exists() ? Number(snap.data()?.marketingCreditsUsed) || 0 : 0);
    });
    return () => unsub();
  }, [user, unlocked]);

  useEffect(() => {
    if (!user || !unlocked) return;
    getDocs(getClinicCollection("services"))
      .then((snap) => {
        const names = snap.docs
          .map((d) => String((d.data() as any)?.name || "").trim())
          .filter(Boolean)
          .sort((a, b) => a.localeCompare(b));
        setServices(Array.from(new Set(names)));
      })
      .catch(() => setServices([]));
  }, [user, unlocked]);

  /* ------- api helper ------- */

  const callGenerator = async (payload: Record<string, unknown>) => {
    const token = await auth.currentUser?.getIdToken();
    if (!token) throw new Error(isAr ? "انتهت الجلسة. سجّل الدخول مرة أخرى." : "Session expired. Please sign in again.");
    const res = await fetch("/api/ai/marketing-content", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ clinicId, ...payload }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) throw new Error(data.error || (isAr ? "فشل التوليد." : "Generation failed."));
    return data;
  };

  /* ------- saving ------- */

  const saveVariant = async (
    variant: MarketingVariant,
    meta: { kind: MarketingKind; language: MarketingLanguage; goal?: string; service?: string; occasion?: string; tone?: string; playbook?: string },
    schedule?: { date: string; channels: MarketingChannel[] }
  ) => {
    await addDoc(getClinicCollection("marketing_content"), {
      kind: meta.kind,
      language: meta.language,
      goal: meta.goal || "",
      service: meta.service || "",
      occasion: meta.occasion || "",
      tone: meta.tone || "",
      playbook: meta.playbook || "",
      title: variant.title,
      body: variant.body,
      hashtags: variant.hashtags || [],
      scenes: variant.scenes || [],
      adHeadline: variant.adHeadline || "",
      adDescription: variant.adDescription || "",
      adHooks: variant.adHooks || [],
      status: schedule ? "scheduled" : "draft",
      scheduledDate: schedule?.date || "",
      channels: schedule?.channels || [],
      createdAt: serverTimestamp(),
      createdBy: user?.uid || "",
      createdByName: user?.name || "",
    });
    void logActivity(
      { uid: user?.uid, name: user?.name, role: user?.role },
      "Marketing content created",
      `${meta.kind}: ${variant.title}`
    );
  };

  const copyText = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(""), 1500);
      showToast(isAr ? "تم النسخ — الصقه في المنصة" : "Copied — paste it on the platform", "success");
    } catch {
      showToast(isAr ? "تعذر النسخ" : "Could not copy", "error");
    }
  };

  const fullText = (v: { body: string; hashtags?: string[] }) =>
    v.hashtags?.length ? `${v.body}\n\n${v.hashtags.join(" ")}` : v.body;

  const markPosted = async (item: MarketingItem) => {
    await updateDoc(getClinicDoc("marketing_content", item.id), {
      status: "posted",
      postedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    void logActivity({ uid: user?.uid, name: user?.name, role: user?.role }, "Marketing post published", item.title);
    showToast(isAr ? "تم تسجيله كمنشور 🎉" : "Marked as posted 🎉", "success");
  };

  const unschedule = async (item: MarketingItem) => {
    await updateDoc(getClinicDoc("marketing_content", item.id), {
      status: "draft",
      scheduledDate: "",
      updatedAt: serverTimestamp(),
    });
  };

  const removeItem = async (item: MarketingItem) => {
    const okGo = await confirm(isAr ? "حذف هذا المحتوى نهائياً؟" : "Delete this content permanently?", {
      confirmLabel: isAr ? "حذف" : "Delete",
      tone: "danger",
    });
    if (!okGo) return;
    await deleteDoc(getClinicDoc("marketing_content", item.id));
    showToast(isAr ? "تم الحذف" : "Deleted", "success");
  };

  /* ------- health score (starter) ------- */

  const health = useMemo(() => {
    const today = todayYmd();
    const in7 = addDaysYmd(today, 6);
    const twoDaysAgo = addDaysYmd(today, -2);
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const monthPrefix = today.slice(0, 7);

    const createdThisMonth = items.some((i) => {
      const t = (i.createdAt as any)?.toDate?.();
      return t ? toYmd(t).startsWith(monthPrefix) : false;
    });
    const scheduledNext7 = items.filter(
      (i) => i.status === "scheduled" && i.scheduledDate && i.scheduledDate >= today && i.scheduledDate <= in7
    ).length;
    const overdue = items.filter(
      (i) => i.status === "scheduled" && i.scheduledDate && i.scheduledDate < twoDaysAgo
    ).length;
    const postedLast7 = items.some((i) => {
      const t = (i.postedAt as any)?.toDate?.();
      return t ? t >= sevenDaysAgo : false;
    });

    const checks = [
      {
        ok: !!voice?.completedAt,
        en: "Complete the clinic voice setup so content sounds like you",
        ar: "أكمل إعداد صوت العيادة حتى يشبهك المحتوى",
      },
      {
        ok: createdThisMonth,
        en: "Create your first content this month",
        ar: "أنشئ أول محتوى هذا الشهر",
      },
      {
        ok: scheduledNext7 >= 3,
        en: `Schedule at least 3 posts for the next 7 days (now: ${scheduledNext7})`,
        ar: `جدول ٣ منشورات على الأقل للأسبوع القادم (الآن: ${scheduledNext7})`,
      },
      {
        ok: overdue === 0,
        en: `Clear ${overdue} overdue scheduled post${overdue === 1 ? "" : "s"}`,
        ar: `عندك ${overdue} منشور مجدول فات موعده — انشره أو أعد جدولته`,
      },
      {
        ok: postedLast7,
        en: "Mark something as posted this week",
        ar: "انشر شيئاً هذا الأسبوع وسجّله كمنشور",
      },
    ];
    const score = Math.round((checks.filter((c) => c.ok).length / checks.length) * 100);
    const next = checks.find((c) => !c.ok);
    return { score, next };
  }, [items, voice]);

  /* ------- generator state ------- */

  const [genKind, setGenKind] = useState<MarketingKind>("post");
  const [genLanguage, setGenLanguage] = useState<MarketingLanguage>(isAr ? "ar" : "en");
  const [genGoal, setGenGoal] = useState("offer");
  const [genReelFormat, setGenReelFormat] = useState("auto");
  const [genService, setGenService] = useState("");
  const [genOccasion, setGenOccasion] = useState("");
  const [genTone, setGenTone] = useState("friendly");
  const [genOffer, setGenOffer] = useState("");
  const [genNotes, setGenNotes] = useState("");
  const [generating, setGenerating] = useState(false);
  const [variants, setVariants] = useState<MarketingVariant[]>([]);
  const [variantEdits, setVariantEdits] = useState<Record<number, string>>({});
  const [savedVariants, setSavedVariants] = useState<Record<number, boolean>>({});

  // The wizard's saved defaults become the forms' starting point — once per visit, so a
  // mid-session choice the user just made is never yanked back by a snapshot refresh.
  useEffect(() => {
    if (!voice?.completedAt || defaultsApplied) return;
    if (voice.defaultLanguage) {
      setGenLanguage(voice.defaultLanguage);
      setPbLanguage(voice.defaultLanguage);
    }
    if (voice.defaultTone) {
      setGenTone(voice.defaultTone);
      setPbTone(voice.defaultTone);
    }
    setDefaultsApplied(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voice, defaultsApplied]);

  const runGenerate = async () => {
    setGenerating(true);
    setVariants([]);
    setVariantEdits({});
    setSavedVariants({});
    try {
      const data = await callGenerator({
        mode: "single",
        kind: genKind,
        language: genLanguage,
        goal: genGoal,
        serviceName: genService,
        occasion: genOccasion,
        tone: genTone,
        offer: genOffer,
        notes: genNotes,
        reelFormat: genKind === "reel" ? genReelFormat : undefined,
      });
      setVariants(data.variants || []);
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setGenerating(false);
    }
  };

  /* ------- schedule modal (shared) ------- */

  const [scheduleTarget, setScheduleTarget] = useState<
    | { type: "variant"; index: number }
    | { type: "item"; item: MarketingItem }
    | null
  >(null);
  const [scheduleDate, setScheduleDate] = useState("");
  const [scheduleChannels, setScheduleChannels] = useState<MarketingChannel[]>(["facebook", "instagram"]);
  const [scheduling, setScheduling] = useState(false);

  const openSchedule = (target: { type: "variant"; index: number } | { type: "item"; item: MarketingItem }) => {
    setScheduleDate(addDaysYmd(todayYmd(), 1));
    setScheduleChannels(["facebook", "instagram"]);
    setScheduleTarget(target);
  };

  const confirmSchedule = async () => {
    if (!scheduleTarget || !scheduleDate) return;
    setScheduling(true);
    try {
      if (scheduleTarget.type === "variant") {
        const i = scheduleTarget.index;
        const v = { ...variants[i], body: variantEdits[i] ?? variants[i].body };
        await saveVariant(
          v,
          { kind: genKind, language: genLanguage, goal: genGoal, service: genService, occasion: genOccasion, tone: genTone },
          { date: scheduleDate, channels: scheduleChannels }
        );
        setSavedVariants((p) => ({ ...p, [i]: true }));
      } else {
        await updateDoc(getClinicDoc("marketing_content", scheduleTarget.item.id), {
          status: "scheduled",
          scheduledDate: scheduleDate,
          channels: scheduleChannels,
          updatedAt: serverTimestamp(),
        });
      }
      showToast(isAr ? "تمت الجدولة ✅" : "Scheduled ✅", "success");
      setScheduleTarget(null);
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setScheduling(false);
    }
  };

  /* ------- calendar state ------- */

  const [calMonth, setCalMonth] = useState(() => {
    const d = new Date();
    return { y: d.getFullYear(), m: d.getMonth() };
  });
  const [dayPanel, setDayPanel] = useState<string | null>(null);

  const scheduledByDate = useMemo(() => {
    const map = new Map<string, MarketingItem[]>();
    for (const it of items) {
      if (!it.scheduledDate) continue;
      if (it.status !== "scheduled" && it.status !== "posted") continue;
      const list = map.get(it.scheduledDate) || [];
      list.push(it);
      map.set(it.scheduledDate, list);
    }
    return map;
  }, [items]);

  /* ------- playbook state ------- */

  const [pbOpen, setPbOpen] = useState<string | null>(null);
  const [pbStart, setPbStart] = useState("");
  const [pbPerWeek, setPbPerWeek] = useState(3);
  const [pbLanguage, setPbLanguage] = useState<MarketingLanguage>(isAr ? "ar" : "en");
  const [pbTone, setPbTone] = useState("friendly");
  const [pbService, setPbService] = useState("");
  const [pbOffer, setPbOffer] = useState("");
  const [pbGenerating, setPbGenerating] = useState(false);
  const [pbEntries, setPbEntries] = useState<MarketingPlanEntry[] | null>(null);
  const [pbSelected, setPbSelected] = useState<Record<number, boolean>>({});
  const [pbSaving, setPbSaving] = useState(false);

  const openPlaybook = (id: string) => {
    setPbStart(addDaysYmd(todayYmd(), 1));
    setPbPerWeek(3);
    setPbLanguage(isAr ? "ar" : "en");
    setPbTone("friendly");
    setPbService("");
    setPbOffer("");
    setPbEntries(null);
    setPbSelected({});
    setPbOpen(id);
  };

  const runPlaybook = async () => {
    if (!pbOpen) return;
    setPbGenerating(true);
    try {
      const data = await callGenerator({
        mode: "month",
        playbook: pbOpen,
        postsPerWeek: pbPerWeek,
        language: pbLanguage,
        tone: pbTone,
        serviceName: pbService,
        offer: pbOffer,
      });
      const entries: MarketingPlanEntry[] = data.items || [];
      setPbEntries(entries);
      setPbSelected(Object.fromEntries(entries.map((_, i) => [i, true])));
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setPbGenerating(false);
    }
  };

  const savePlaybookEntries = async () => {
    if (!pbEntries || !pbOpen) return;
    setPbSaving(true);
    try {
      const chosen = pbEntries.filter((_, i) => pbSelected[i]);
      await Promise.all(
        chosen.map((entry) =>
          saveVariant(
            entry,
            { kind: entry.kind, language: pbLanguage, tone: pbTone, service: pbService, playbook: pbOpen },
            { date: addDaysYmd(pbStart, entry.dayOffset), channels: ["facebook", "instagram"] }
          )
        )
      );
      showToast(
        isAr ? `تمت إضافة ${chosen.length} محتوى للتقويم 🎉` : `${chosen.length} items added to the calendar 🎉`,
        "success"
      );
      setPbOpen(null);
      setTab("calendar");
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setPbSaving(false);
    }
  };

  /* ------- library state ------- */

  const [libFilter, setLibFilter] = useState<"all" | "draft" | "scheduled" | "posted">("all");
  const [editingItem, setEditingItem] = useState<string | null>(null);
  const [editingBody, setEditingBody] = useState("");

  const libItems = useMemo(
    () => (libFilter === "all" ? items : items.filter((i) => i.status === libFilter)),
    [items, libFilter]
  );

  /* ------- campaigns state ------- */

  const [campaigns, setCampaigns] = useState<MarketingCampaign[]>([]);
  const [campaignDrafts, setCampaignDrafts] = useState<CampaignDraft[]>([]);
  const [campSegment, setCampSegment] = useState<CampaignSegment | null>(null);
  const [campScanning, setCampScanning] = useState(false);
  const [campRecipients, setCampRecipients] = useState<CampaignRecipient[] | null>(null);
  const [campSelected, setCampSelected] = useState<Record<string, boolean>>({});
  const [campName, setCampName] = useState("");
  const [campBody, setCampBody] = useState("");
  const [campOffer, setCampOffer] = useState("");
  const [campAiBusy, setCampAiBusy] = useState(false);
  const [campAiOptions, setCampAiOptions] = useState<string[]>([]);
  const [campLaunching, setCampLaunching] = useState(false);
  const [busyDraft, setBusyDraft] = useState<string | null>(null);
  const [campDraftEdits, setCampDraftEdits] = useState<Record<string, string>>({});
  const [emptyChair, setEmptyChair] = useState<{ date: string; count: number; avg: number } | null>(null);
  const [radarDismissed, setRadarDismissed] = useState(false);

  useEffect(() => {
    if (!user || !unlocked) return;
    const q1 = query(getClinicCollection("marketing_campaigns"), orderBy("createdAt", "desc"));
    const unsub1 = onSnapshot(q1, (snap) =>
      setCampaigns(snap.docs.map((d) => ({ id: d.id, ...d.data() } as MarketingCampaign)))
    );
    // The clinic's campaign drafts, live: powers both the review queue and per-campaign progress.
    const q2 = query(getClinicCollection("message_drafts"), where("reason", "==", "marketing_campaign"));
    const unsub2 = onSnapshot(q2, (snap) =>
      setCampaignDrafts(snap.docs.map((d) => ({ id: d.id, ...d.data() } as CampaignDraft)))
    );
    return () => {
      unsub1();
      unsub2();
    };
  }, [user, unlocked]);

  /** Occupancy check: is one of the next 7 days clearly emptier than that weekday usually is? */
  useEffect(() => {
    if (!user || !unlocked) return;
    const today = todayYmd();
    (async () => {
      try {
        const [upSnap, pastSnap] = await Promise.all([
          getDocs(query(getClinicCollection("appointments"), where("date", ">=", today), where("date", "<=", addDaysYmd(today, 6)))),
          getDocs(query(getClinicCollection("appointments"), where("date", ">=", addDaysYmd(today, -28)), where("date", "<", today))),
        ]);
        const countReal = (snap: typeof upSnap) => {
          const perDate = new Map<string, number>();
          snap.forEach((doc) => {
            const d = doc.data() as { date?: string; status?: string };
            if (!d.date || d.status === "Cancelled" || d.status === "No Show") return;
            perDate.set(d.date, (perDate.get(d.date) || 0) + 1);
          });
          return perDate;
        };
        const upcoming = countReal(upSnap);
        const past = countReal(pastSnap);

        const weekdayAvg = new Map<number, number>();
        for (let w = 0; w < 7; w++) {
          let sum = 0;
          for (let i = 1; i <= 28; i++) {
            const d = addDaysYmd(today, -i);
            if (new Date(d + "T00:00:00").getDay() === w) sum += past.get(d) || 0;
          }
          weekdayAvg.set(w, sum / 4);
        }

        for (let i = 1; i <= 6; i++) {
          const d = addDaysYmd(today, i);
          const w = new Date(d + "T00:00:00").getDay();
          const avg = weekdayAvg.get(w) || 0;
          if (avg < 2) continue; // closed or barely-used day — nothing to fill
          const count = upcoming.get(d) || 0;
          if (count <= avg * 0.5) {
            setEmptyChair({ date: d, count, avg: Math.round(avg * 10) / 10 });
            return;
          }
        }
        setEmptyChair(null);
      } catch {
        setEmptyChair(null);
      }
    })();
  }, [user, unlocked]);

  /** The next occasion within 14 days, if any — the radar's one job. */
  const upcomingOccasion = useMemo(() => {
    const today = todayYmd();
    const horizon = addDaysYmd(today, 14);
    const hit = OCCASION_DATES.filter((o) => o.date >= today && o.date <= horizon).sort((a, b) =>
      a.date.localeCompare(b.date)
    )[0];
    if (!hit) return null;
    const cat = MARKETING_OCCASIONS.find((o) => o.id === hit.id);
    if (!cat) return null;
    const days = Math.round((new Date(hit.date + "T00:00:00").getTime() - new Date(today + "T00:00:00").getTime()) / 86400000);
    return { id: hit.id, date: hit.date, days, en: cat.en, ar: cat.ar };
  }, []);

  const scanSegment = async (segment: CampaignSegment) => {
    setCampSegment(segment);
    setCampRecipients(null);
    setCampAiOptions([]);
    setCampScanning(true);
    try {
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch("/api/marketing/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ clinicId, action: "scan", segment }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || (isAr ? "فشل الفحص." : "Scan failed."));
      const recipients: CampaignRecipient[] = data.recipients || [];
      setCampRecipients(recipients);
      setCampSelected(Object.fromEntries(recipients.map((r) => [r.patientId, true])));
      const seg = CAMPAIGN_SEGMENTS.find((s) => s.id === segment);
      setCampName(`${seg ? (isAr ? seg.ar : seg.en) : segment} — ${todayYmd()}`);
      setCampBody("");
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), "error");
      setCampSegment(null);
    } finally {
      setCampScanning(false);
    }
  };

  const campaignAiNotes: Record<CampaignSegment, string> = {
    dormant:
      "This goes to patients who have not visited in many months — a warm we-miss-you check-in inviting them back for a checkup.",
    unfinished_treatment:
      "This goes to patients who received a treatment plan but never continued — gently encourage finishing what they started, no guilt.",
    birthdays: "This is a birthday wish to a patient — celebrate first, tiny soft offer second.",
  };

  const writeCampaignMessage = async () => {
    if (!campSegment) return;
    setCampAiBusy(true);
    try {
      const data = await callGenerator({
        mode: "single",
        kind: "whatsapp",
        language: voice?.defaultLanguage || (isAr ? "ar" : "en"),
        goal: campOffer.trim() ? "offer" : "trust",
        tone: voice?.defaultTone || "friendly",
        offer: campOffer,
        notes: campaignAiNotes[campSegment],
      });
      const options = (data.variants || []).map((v: { body: string }) => v.body).filter(Boolean);
      setCampAiOptions(options);
      if (options[0] && !campBody.trim()) setCampBody(options[0]);
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setCampAiBusy(false);
    }
  };

  const launchCampaign = async () => {
    if (!campSegment || !campRecipients) return;
    const chosen = campRecipients.filter((r) => campSelected[r.patientId]);
    if (!campName.trim() || !campBody.trim() || chosen.length === 0) return;
    setCampLaunching(true);
    try {
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch("/api/marketing/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          clinicId,
          action: "launch",
          segment: campSegment,
          name: campName.trim(),
          body: campBody,
          recipients: chosen,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || (isAr ? "فشل الإطلاق." : "Launch failed."));
      void logActivity(
        { uid: user?.uid, name: user?.name, role: user?.role },
        "Marketing campaign launched",
        `${campName.trim()} → ${data.created} drafts`
      );
      showToast(
        isAr
          ? `تم تجهيز ${data.created} رسالة للمراجعة${data.skipped ? ` (${data.skipped} مكررة تم تخطيها)` : ""}`
          : `${data.created} messages queued for review${data.skipped ? ` (${data.skipped} duplicates skipped)` : ""}`,
        "success"
      );
      setCampSegment(null);
      setCampRecipients(null);
      setCampBody("");
      setCampOffer("");
      setCampAiOptions([]);
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setCampLaunching(false);
    }
  };

  /** Same approve/reject flow as Reactivation — one draft, one human decision. */
  const resolveCampaignDraft = async (draft: CampaignDraft, decision: "approve" | "reject", editedBody?: string) => {
    if (busyDraft) return;
    setBusyDraft(draft.id);
    try {
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch("/api/message-drafts", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ clinicId, draftId: draft.id, decision, editedBody, userName: user?.name }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || "Could not update that draft");
      if (data.status === "manual") {
        handleWhatsAppApiResult({ manual: true, phone: data.phone, text: data.body }, draft.patientName);
        showToast(isAr ? "افتح واتساب من الرسالة عشان تبعت" : "Open WhatsApp from the prompt to send it", "info");
        return;
      }
      showToast(
        decision === "approve" ? (isAr ? "تم الإرسال" : "Sent") : isAr ? "تم الاستبعاد" : "Dismissed",
        "success"
      );
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setBusyDraft(null);
    }
  };

  /* ------- automations (the scheduled robots; toggles live in marketing_settings/automations) ------- */

  type Automations = {
    reviewEnabled?: boolean;
    birthdayEnabled?: boolean;
    birthdayTemplate?: string;
    leadAlerts?: boolean;
  };
  const [automations, setAutomations] = useState<Automations>({});

  useEffect(() => {
    if (!user || !unlocked) return;
    const unsub = onSnapshot(getClinicDoc("marketing_settings", "automations"), (snap) => {
      setAutomations(snap.exists() ? (snap.data() as Automations) : {});
    });
    return () => unsub();
  }, [user, unlocked]);

  const saveAutomation = async (patch: Automations) => {
    try {
      await setDoc(
        getClinicDoc("marketing_settings", "automations"),
        { ...patch, updatedAt: serverTimestamp(), updatedBy: user?.uid || "" },
        { merge: true }
      );
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), "error");
    }
  };

  /* ------- reviews history ------- */

  const [reviews, setReviews] = useState<ReviewRequest[]>([]);
  /** The on-camera interview modal for 5-star patients — static questions, zero AI cost. */
  const [interviewFor, setInterviewFor] = useState<ReviewRequest | null>(null);

  const INTERVIEW_QUESTIONS = isAr
    ? [
        "إيه اللي خلاك تختار عيادتنا في الأول؟",
        "إيه اللي كنت خايف منه قبل ما تيجي؟ وحصل إيه فعلاً؟",
        "احكيلنا إحساسك لما شفت النتيجة.",
        "لو حد متردد يعالج أسنانه، تقوله إيه؟",
      ]
    : [
        "What made you choose our clinic in the first place?",
        "What were you worried about before coming — and what actually happened?",
        "Tell us how it felt when you saw the result.",
        "What would you say to someone hesitating about treatment?",
      ];

  useEffect(() => {
    if (!user || !unlocked) return;
    const q = query(getClinicCollection("review_requests"), orderBy("createdAt", "desc"));
    const unsub = onSnapshot(q, (snap) =>
      setReviews(snap.docs.map((d) => ({ id: d.id, ...d.data() } as ReviewRequest)))
    );
    return () => unsub();
  }, [user, unlocked]);

  const reviewStats = useMemo(() => {
    const rated = reviews.filter((r) => r.status === "rated" && typeof r.rating === "number");
    const happy = rated.filter((r) => (r.rating || 0) >= 4);
    const unhappy = rated.filter((r) => (r.rating || 0) <= 3);
    const unhandled = unhappy.filter((r) => !r.handled);
    const avg = rated.length ? rated.reduce((s, r) => s + (r.rating || 0), 0) / rated.length : 0;
    return {
      asked: reviews.length,
      rated: rated.length,
      happy: happy.length,
      unhappy: unhappy.length,
      unhandled: unhandled.length,
      avg: Math.round(avg * 10) / 10,
    };
  }, [reviews]);

  /* ------- results (spend, ROI, funnel, referrals) ------- */

  const normalizeDate = (val: unknown): string => {
    if (!val) return "1970-01-01";
    if (typeof val === "object" && val !== null && "toDate" in val) {
      try {
        return (val as { toDate: () => Date }).toDate().toISOString().split("T")[0];
      } catch {
        return "1970-01-01";
      }
    }
    const raw = String(val).trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
    const d = new Date(raw);
    return isNaN(d.getTime()) ? "1970-01-01" : d.toISOString().split("T")[0];
  };

  const [resRaw, setResRaw] = useState<{
    ledger: Record<string, unknown>[];
    leads: Record<string, unknown>[];
    patients: { id: string; name: string; phone: string }[];
  } | null>(null);
  const [resLoading, setResLoading] = useState(false);
  const [resMonth, setResMonth] = useState(() => {
    const d = new Date();
    return { y: d.getFullYear(), m: d.getMonth() };
  });

  useEffect(() => {
    if (tab !== "results" || resRaw || resLoading || !user || !unlocked) return;
    setResLoading(true);
    Promise.all([
      getDocs(getClinicCollection("ledger")),
      getDocs(getClinicCollection("leads")),
      getDocs(getClinicCollection("patients")),
    ])
      .then(([ledgerSnap, leadsSnap, patientsSnap]) => {
        setResRaw({
          ledger: ledgerSnap.docs
            .map((d) => ({ id: d.id, ...d.data() } as Record<string, unknown>))
            .filter((r) => !["deleted", "cancelled"].includes(String(r.status || "").toLowerCase())),
          leads: leadsSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Record<string, unknown>)),
          patients: patientsSnap.docs.map((d) => ({
            id: d.id,
            name: String((d.data() as any)?.name || ""),
            phone: String((d.data() as any)?.phone || (d.data() as any)?.phoneNumber || ""),
          })),
        });
      })
      .catch(() => showToast(isAr ? "تعذر تحميل البيانات" : "Could not load the data", "error"))
      .finally(() => setResLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, resRaw, resLoading, user, unlocked]);

  const resRange = useMemo(() => {
    const start = `${resMonth.y}-${pad(resMonth.m + 1)}-01`;
    const end = toYmd(new Date(resMonth.y, resMonth.m + 1, 0));
    return { start, end };
  }, [resMonth]);

  type DatedRow = Record<string, unknown> & { normDate: string };

  const monthLeads = useMemo<DatedRow[]>(() => {
    if (!resRaw) return [];
    return resRaw.leads
      .map((l): DatedRow => ({ ...l, normDate: normalizeDate(l.createdAt) }))
      .filter((l) => l.normDate >= resRange.start && l.normDate <= resRange.end);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resRaw, resRange]);

  const monthPayments = useMemo<DatedRow[]>(() => {
    if (!resRaw) return [];
    return resRaw.ledger
      .filter((r) => r.type === "payment" || r.type === "expense" || r.type === "income")
      .map((r): DatedRow => ({ ...r, normDate: normalizeDate(r.date || r.createdAt) }))
      .filter((r) => r.normDate >= resRange.start && r.normDate <= resRange.end);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resRaw, resRange]);

  // Ad spend for the month — typed in by the clinic, the one number no system can know for them.
  const spendDocId = `spend-${resMonth.y}-${pad(resMonth.m + 1)}`;
  const [spendMap, setSpendMap] = useState<Record<string, number>>({});
  useEffect(() => {
    if (!user || !unlocked || tab !== "results") return;
    const unsub = onSnapshot(getClinicDoc("marketing_settings", spendDocId), (snap) => {
      const by = snap.exists() ? (snap.data()?.byChannel as Record<string, number>) : null;
      setSpendMap(by && typeof by === "object" ? by : {});
    });
    return () => unsub();
  }, [user, unlocked, tab, spendDocId]);

  const saveSpend = async (channel: string, value: number) => {
    try {
      await setDoc(
        getClinicDoc("marketing_settings", spendDocId),
        { byChannel: { ...spendMap, [channel]: value }, updatedAt: serverTimestamp(), updatedBy: user?.uid || "" },
        { merge: true }
      );
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), "error");
    }
  };

  /** Channel economics: spend beside what the channel's won leads actually paid this month. */
  const roiRows = useMemo(() => {
    const paidByPatient: Record<string, number> = {};
    monthPayments.forEach((p) => {
      if (p.type === "expense") return;
      const pid = String(p.patientId || "");
      if (!pid) return;
      paidByPatient[pid] = (paidByPatient[pid] || 0) + (Number(p.paid) || Number(p.amount) || 0);
    });

    const channels = new Set<string>([
      ...DEFAULT_LEAD_SOURCES,
      ...Object.keys(spendMap),
      ...monthLeads.map((l) => String(l.source || "").trim()).filter(Boolean),
    ]);

    const rows = Array.from(channels).map((channel) => {
      const rows_ = monthLeads.filter((l) => String(l.source || "").trim() === channel);
      const won = rows_.filter((l) => l.stage === "won");
      const newPatientIds = new Set(
        won.filter((l) => !l.isReturningPatient && l.patientId).map((l) => String(l.patientId))
      );
      let revenue = 0;
      newPatientIds.forEach((pid) => (revenue += paidByPatient[pid] || 0));
      const spend = Number(spendMap[channel]) || 0;
      return {
        channel,
        spend,
        leads: rows_.length,
        won: won.length,
        revenue,
        costPerPatient: won.length > 0 && spend > 0 ? Math.round(spend / won.length) : null,
        roi: spend > 0 ? Math.round((revenue / spend) * 10) / 10 : null,
      };
    });
    return rows
      .filter((r) => r.spend > 0 || r.leads > 0)
      .sort((a, b) => b.revenue - a.revenue || b.leads - a.leads);
  }, [monthLeads, monthPayments, spendMap]);

  /* ------- referral cards ------- */

  const [refSearch, setRefSearch] = useState("");
  const [refSelected, setRefSelected] = useState<{ id: string; name: string } | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState("");

  const referralLink = refSelected
    ? `${typeof window !== "undefined" ? window.location.origin : ""}/refer/${clinicId}/${refSelected.id}`
    : "";

  useEffect(() => {
    if (!referralLink) {
      setQrDataUrl("");
      return;
    }
    QRCode.toDataURL(referralLink, { width: 480, margin: 1, color: { dark: "#0f172a" } })
      .then(setQrDataUrl)
      .catch(() => setQrDataUrl(""));
  }, [referralLink]);

  const refMatches = useMemo(() => {
    const q = refSearch.trim().toLowerCase();
    if (!resRaw || q.length < 2) return [];
    return resRaw.patients
      .filter((p) => p.name.toLowerCase().includes(q) || p.phone.includes(q))
      .slice(0, 6);
  }, [refSearch, resRaw]);

  const topReferrers = useMemo(() => {
    if (!resRaw) return [];
    const byRef = new Map<string, { name: string; total: number; won: number }>();
    resRaw.leads.forEach((l) => {
      const rid = String(l.referredByPatientId || "");
      if (!rid) return;
      const row = byRef.get(rid) || { name: String(l.referredByName || "Unknown"), total: 0, won: 0 };
      row.total++;
      if (l.stage === "won") row.won++;
      byRef.set(rid, row);
    });
    return Array.from(byRef.values()).sort((a, b) => b.won - a.won || b.total - a.total).slice(0, 8);
  }, [resRaw]);

  const printReferralCard = () => {
    if (!refSelected || !qrDataUrl) return;
    const clinicName = clinic?.name || "";
    const w = window.open("", "_blank", "width=480,height=640");
    if (!w) return;
    w.document.write(`<!doctype html><html dir="rtl"><head><title>Referral card</title><style>
      body{font-family:'Segoe UI',Tahoma,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#fff}
      .card{width:340px;border:2px solid #0f172a;border-radius:20px;padding:28px;text-align:center}
      .clinic{font-size:15px;font-weight:800;color:#059669;letter-spacing:.5px;margin-bottom:6px}
      h1{font-size:19px;color:#0f172a;margin:0 0 4px}
      .sub{font-size:12px;color:#64748b;font-weight:700;margin-bottom:16px}
      img{width:220px;height:220px}
      .from{font-size:12px;color:#334155;font-weight:800;margin-top:12px}
      .link{font-size:9px;color:#94a3b8;margin-top:8px;word-break:break-all;direction:ltr}
    </style></head><body><div class="card">
      <div class="clinic">${clinicName}</div>
      <h1>امسح الكود واحجز كشفك 🦷</h1>
      <div class="sub">Scan to book your visit</div>
      <img src="${qrDataUrl}" alt="QR"/>
      <div class="from">ترشيح من: ${refSelected.name}</div>
      <div class="link">${referralLink}</div>
    </div><script>window.onload=function(){window.print()}</script></body></html>`);
    w.document.close();
  };

  const pendingCampaignDrafts = useMemo(
    () => campaignDrafts.filter((d) => d.status === "pending_review"),
    [campaignDrafts]
  );

  const campaignProgress = useMemo(() => {
    const map = new Map<string, { sent: number; pending: number; rejected: number }>();
    for (const d of campaignDrafts) {
      const cid = d.context?.campaignId;
      if (!cid) continue;
      const row = map.get(cid) || { sent: 0, pending: 0, rejected: 0 };
      if (d.status === "sent") row.sent++;
      else if (d.status === "pending_review" || d.status === "approved") row.pending++;
      else if (d.status === "rejected" || d.status === "failed") row.rejected++;
      map.set(cid, row);
    }
    return map;
  }, [campaignDrafts]);

  /* ---------------------------------- rendering ---------------------------------- */

  if (clinic && !unlocked) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-10">
        <UpgradeRequired
          featureName={isAr ? "استوديو التسويق" : "Marketing Studio"}
          minTier={isAr ? "إضافة التسويق" : "Marketing add-on"}
        />
      </div>
    );
  }

  const tabs: { id: Tab; icon: any; en: string; ar: string }[] = [
    { id: "create", icon: Wand2, en: "Create", ar: "إنشاء" },
    { id: "campaigns", icon: Send, en: "Campaigns", ar: "الحملات" },
    { id: "cases", icon: Camera, en: "Cases", ar: "الحالات" },
    { id: "reviews", icon: Star, en: "Reviews", ar: "التقييمات" },
    { id: "results", icon: TrendingUp, en: "Results", ar: "النتائج" },
    { id: "calendar", icon: CalendarDays, en: "Calendar", ar: "التقويم" },
    { id: "library", icon: FolderOpen, en: "Library", ar: "المكتبة" },
    { id: "playbooks", icon: BookOpen, en: "Playbooks", ar: "خطط جاهزة" },
  ];

  const SEGMENT_ICONS: Record<CampaignSegment, any> = {
    dormant: UserX,
    unfinished_treatment: ClipboardList,
    birthdays: Cake,
  };

  const monthName = new Date(calMonth.y, calMonth.m, 1).toLocaleDateString(isAr ? "ar-EG" : "en-US", {
    month: "long",
    year: "numeric",
  });

  /** Saturday-first weeks — matches how Egyptian clinics read a month. */
  const calendarCells = (() => {
    const first = new Date(calMonth.y, calMonth.m, 1);
    const daysInMonth = new Date(calMonth.y, calMonth.m + 1, 0).getDate();
    const lead = (first.getDay() + 1) % 7; // getDay(): Sat=6 → lead 0
    const cells: (string | null)[] = Array(lead).fill(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(toYmd(new Date(calMonth.y, calMonth.m, d)));
    while (cells.length % 7 !== 0) cells.push(null);
    return cells;
  })();

  const weekdays = isAr
    ? ["السبت", "الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة"]
    : ["Sat", "Sun", "Mon", "Tue", "Wed", "Thu", "Fri"];

  const selectCls =
    "w-full bg-white border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-bold text-slate-700 outline-none focus:border-emerald-400";
  const labelCls = "block text-xs font-black text-slate-500 mb-1.5";

  const variantCard = (v: MarketingVariant, i: number) => {
    const bodyValue = variantEdits[i] ?? v.body;
    const saved = savedVariants[i];
    return (
      <div key={i} className="bg-white rounded-2xl border border-slate-200 p-4 flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <KindChip kind={genKind} isAr={isAr} />
            <span className="text-sm font-black text-slate-800">{v.title}</span>
          </div>
          {saved && (
            <span className="inline-flex items-center gap-1 text-emerald-600 text-xs font-black">
              <CheckCircle2 size={14} /> {isAr ? "محفوظ" : "Saved"}
            </span>
          )}
        </div>

        <textarea
          value={bodyValue}
          onChange={(e) => setVariantEdits((p) => ({ ...p, [i]: e.target.value }))}
          rows={Math.min(10, Math.max(4, bodyValue.split("\n").length + 1))}
          dir="auto"
          className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-sm text-slate-800 leading-relaxed outline-none focus:border-emerald-400 resize-y"
        />

        {v.scenes && v.scenes.length > 0 && (
          <div className="bg-violet-50/60 border border-violet-100 rounded-xl p-3">
            <div className="flex items-center gap-1.5 text-violet-700 text-xs font-black mb-2">
              <Film size={13} /> {isAr ? "سيناريو التصوير (٣٠ ثانية)" : "Filming script (30s)"}
            </div>
            <ol className="space-y-1.5">
              {v.scenes.map((s, si) => (
                <li key={si} dir="auto" className="text-xs text-slate-700 leading-relaxed">
                  <span className="font-black text-violet-600">{si + 1}.</span> {s}
                </li>
              ))}
            </ol>
          </div>
        )}

        {(v.adHeadline || v.adHooks?.length) && (
          <div className="bg-amber-50/60 border border-amber-100 rounded-xl p-3 space-y-1.5">
            {v.adHeadline && (
              <p dir="auto" className="text-xs text-slate-700">
                <span className="font-black text-amber-700">{isAr ? "العنوان: " : "Headline: "}</span>
                {v.adHeadline}
              </p>
            )}
            {v.adDescription && (
              <p dir="auto" className="text-xs text-slate-700">
                <span className="font-black text-amber-700">{isAr ? "الوصف: " : "Description: "}</span>
                {v.adDescription}
              </p>
            )}
            {v.adHooks && v.adHooks.length > 0 && (
              <div className="text-xs text-slate-700">
                <span className="font-black text-amber-700">{isAr ? "بدايات بديلة للاختبار:" : "Alternative hooks to test:"}</span>
                <ul className="mt-1 space-y-1">
                  {v.adHooks.map((h, hi) => (
                    <li key={hi} dir="auto">• {h}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {v.hashtags && v.hashtags.length > 0 && (
          <p dir="auto" className="text-xs font-bold text-sky-600 leading-relaxed">{v.hashtags.join(" ")}</p>
        )}

        <div className="flex items-center gap-2 flex-wrap pt-1">
          <button
            onClick={() => copyText(`v${i}`, fullText({ body: bodyValue, hashtags: v.hashtags }))}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-black transition-colors"
          >
            {copiedKey === `v${i}` ? <Check size={14} className="text-emerald-600" /> : <Copy size={14} />}
            {isAr ? "نسخ" : "Copy"}
          </button>
          <button
            disabled={saved}
            onClick={async () => {
              try {
                await saveVariant(
                  { ...v, body: bodyValue },
                  { kind: genKind, language: genLanguage, goal: genGoal, service: genService, occasion: genOccasion, tone: genTone }
                );
                setSavedVariants((p) => ({ ...p, [i]: true }));
                showToast(isAr ? "حُفظ في المكتبة" : "Saved to library", "success");
              } catch (e) {
                showToast(e instanceof Error ? e.message : String(e), "error");
              }
            }}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white border border-slate-200 hover:border-slate-300 text-slate-700 text-xs font-black transition-colors disabled:opacity-40"
          >
            <FolderOpen size={14} /> {isAr ? "حفظ كمسودة" : "Save draft"}
          </button>
          <button
            disabled={saved}
            onClick={() => openSchedule({ type: "variant", index: i })}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-black transition-colors disabled:opacity-40"
          >
            <CalendarPlus size={14} /> {isAr ? "جدولة" : "Schedule"}
          </button>
          {designUnlocked && (
            <button
              onClick={() => setDesignItem({ language: genLanguage, title: v.title, body: bodyValue })}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-violet-500 hover:bg-violet-600 text-white text-xs font-black transition-colors"
            >
              <Palette size={14} /> {isAr ? "صمّمه" : "Design it"}
            </button>
          )}
        </div>
      </div>
    );
  };

  const itemActions = (item: MarketingItem) => (
    <div className="flex items-center gap-1.5 flex-wrap">
      {item.status === "posted" && (
        <button
          onClick={async () => {
            await updateDoc(getClinicDoc("marketing_content", item.id), {
              starred: !item.starred,
              updatedAt: serverTimestamp(),
            });
            if (!item.starred) {
              showToast(
                isAr ? "ممتاز ⭐ — الذكاء الاصطناعي سيتعلم من أسلوب هذا المنشور" : "Nice ⭐ — the AI will learn from this post's style",
                "success"
              );
            }
          }}
          title={isAr ? "علّم المنشورات الناجحة — الذكاء الاصطناعي يقلد أسلوبها" : "Star posts that worked — the AI imitates their style"}
          className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-black border transition-colors ${
            item.starred
              ? "bg-amber-100 border-amber-300 text-amber-700"
              : "bg-white border-slate-200 text-slate-400 hover:text-amber-600 hover:border-amber-200"
          }`}
        >
          <Star size={12} fill={item.starred ? "currentColor" : "none"} />
          {item.starred ? (isAr ? "ناجح" : "Worked") : (isAr ? "نجح؟" : "Worked?")}
        </button>
      )}
      <button
        onClick={() => copyText(item.id, fullText(item))}
        className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-[11px] font-black transition-colors"
      >
        {copiedKey === item.id ? <Check size={12} className="text-emerald-600" /> : <Copy size={12} />}
        {isAr ? "نسخ" : "Copy"}
      </button>
      {designUnlocked && (
        <button
          onClick={() => setDesignItem({ language: item.language, title: item.title, body: item.body })}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-violet-50 hover:bg-violet-100 text-violet-700 text-[11px] font-black transition-colors"
        >
          <Palette size={12} /> {isAr ? "صمّمه" : "Design"}
        </button>
      )}
      {item.status !== "posted" && (
        <button
          onClick={() => markPosted(item)}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-700 text-white text-[11px] font-black transition-colors"
        >
          <Check size={12} /> {isAr ? "تم نشره" : "Posted"}
        </button>
      )}
      {item.status === "draft" && (
        <button
          onClick={() => openSchedule({ type: "item", item })}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white text-[11px] font-black transition-colors"
        >
          <CalendarPlus size={12} /> {isAr ? "جدولة" : "Schedule"}
        </button>
      )}
      {item.status === "scheduled" && (
        <button
          onClick={() => unschedule(item)}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white border border-slate-200 hover:border-slate-300 text-slate-600 text-[11px] font-black transition-colors"
        >
          <Clock size={12} /> {isAr ? "إلغاء الجدولة" : "Unschedule"}
        </button>
      )}
      <button
        onClick={() => removeItem(item)}
        className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white border border-rose-100 hover:bg-rose-50 text-rose-500 text-[11px] font-black transition-colors"
      >
        <Trash2 size={12} />
      </button>
    </div>
  );

  return (
    <PermissionGuard permission="access.marketing">
      <div className="max-w-7xl mx-auto px-3 sm:px-6 xl:px-10 py-5 sm:py-8">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 mb-5 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 bg-slate-900 text-white rounded-2xl flex items-center justify-center shadow-sm">
              <Megaphone size={20} />
            </div>
            <div>
              <h1 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">
                {isAr ? "استوديو التسويق" : "Marketing Studio"}
              </h1>
              <p className="text-xs font-bold text-slate-400">
                {isAr ? "محتوى جاهز، تقويم نشر، وخطط شهرية" : "Ready content, a posting calendar, and monthly plans"}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* Health score */}
            <div
              className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-xs font-black ${
                health.score >= 75
                  ? "bg-emerald-50 border-emerald-200 text-emerald-700"
                  : health.score >= 50
                    ? "bg-amber-50 border-amber-200 text-amber-700"
                    : "bg-rose-50 border-rose-200 text-rose-600"
              }`}
              title={health.next ? (isAr ? health.next.ar : health.next.en) : ""}
            >
              <Sparkles size={14} />
              {isAr ? `صحة التسويق ${health.score}٪` : `Marketing health ${health.score}%`}
            </div>
            {/* Credits */}
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white border border-slate-200 text-xs font-black text-slate-600">
              <Wand2 size={14} className="text-emerald-500" />
              {isAr ? `التوليدات: ${creditsUsed} / ${creditLimit}` : `Generations: ${creditsUsed} / ${creditLimit}`}
            </div>
            {/* Brand kit (Design tier) */}
            {designUnlocked && (
              <button
                onClick={() => setBrandOpen(true)}
                title={isAr ? "هوية العيادة — الثيم والألوان للتصاميم" : "Brand kit — theme and colors for designs"}
                className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white border border-slate-200 hover:border-emerald-300 text-xs font-black text-slate-600 transition-colors"
              >
                <Palette size={14} className="text-slate-400" />
                {isAr ? "هوية العيادة" : "Brand kit"}
              </button>
            )}
            {/* Voice settings */}
            <button
              onClick={openWizard}
              title={isAr ? "صوت العيادة — كيف يكتب الذكاء الاصطناعي باسمكم" : "Clinic voice — how the AI writes as you"}
              className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white border border-slate-200 hover:border-emerald-300 text-xs font-black text-slate-600 transition-colors"
            >
              <SlidersHorizontal size={14} className="text-slate-400" />
              {isAr ? "صوت العيادة" : "Clinic voice"}
            </button>
          </div>
        </div>

        {/* Occasion radar */}
        {upcomingOccasion && !radarDismissed && (
          <div className="flex items-center gap-3 bg-gradient-to-l from-emerald-50 to-white border border-emerald-200 rounded-2xl px-4 py-3 mb-5">
            <PartyPopper size={18} className="text-emerald-600 shrink-0" />
            <p className="text-sm font-bold text-slate-700 flex-1">
              {isAr
                ? `${upcomingOccasion.ar} بعد ${upcomingOccasion.days} يوم — جهزنا المحتوى من دلوقتي؟`
                : `${upcomingOccasion.en} is ${upcomingOccasion.days} day${upcomingOccasion.days === 1 ? "" : "s"} away — get the content ready now?`}
            </p>
            <button
              onClick={() => {
                setGenOccasion(upcomingOccasion.id);
                setGenGoal("occasion");
                setTab("create");
              }}
              className="px-3.5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-black transition-colors shrink-0"
            >
              {isAr ? "جهّز المحتوى" : "Prepare content"}
            </button>
            <button onClick={() => setRadarDismissed(true)} className="p-1.5 rounded-full text-slate-400 hover:bg-slate-100 shrink-0">
              <X size={14} />
            </button>
          </div>
        )}

        {/* Next best action */}
        {health.next && (
          <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-2xl px-4 py-3 mb-5 text-sm font-bold text-slate-600">
            <AlertTriangle size={16} className="text-amber-500 shrink-0" />
            <span>
              {isAr ? "الخطوة التالية: " : "Next step: "}
              {isAr ? health.next.ar : health.next.en}
            </span>
          </div>
        )}

        {/* Tabs */}
        <div className="flex items-center gap-1.5 mb-6 bg-white border border-slate-200 rounded-2xl p-1.5 w-fit max-w-full overflow-x-auto">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-black whitespace-nowrap transition-colors ${
                tab === t.id ? "bg-slate-900 text-white" : "text-slate-500 hover:bg-slate-50"
              }`}
            >
              <t.icon size={14} /> {isAr ? t.ar : t.en}
            </button>
          ))}
        </div>

        {/* ============================== CREATE ============================== */}
        {tab === "create" && (
          <div className="grid lg:grid-cols-[360px_1fr] gap-5 items-start">
            {/* Guided form */}
            <div className="bg-white rounded-3xl border border-slate-200 p-5 space-y-4">
              <div>
                <label className={labelCls}>{isAr ? "نوع المحتوى" : "Content type"}</label>
                <div className="grid grid-cols-3 gap-1.5">
                  {(Object.keys(KIND_META) as MarketingKind[]).map((k) => {
                    const meta = KIND_META[k];
                    const Icon = meta.icon;
                    return (
                      <button
                        key={k}
                        onClick={() => setGenKind(k)}
                        className={`flex flex-col items-center gap-1 py-3 rounded-xl border text-xs font-black transition-colors ${
                          genKind === k
                            ? "bg-slate-900 text-white border-slate-900"
                            : "bg-white text-slate-500 border-slate-200 hover:border-slate-300"
                        }`}
                      >
                        <Icon size={16} /> {isAr ? meta.ar : meta.en}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>{isAr ? "لغة المحتوى" : "Content language"}</label>
                  <select value={genLanguage} onChange={(e) => setGenLanguage(e.target.value as MarketingLanguage)} className={selectCls}>
                    <option value="ar">{isAr ? "عربي (مصري)" : "Arabic (Egyptian)"}</option>
                    <option value="en">{isAr ? "إنجليزي" : "English"}</option>
                  </select>
                </div>
                <div>
                  <label className={labelCls}>{isAr ? "الأسلوب" : "Tone"}</label>
                  <select value={genTone} onChange={(e) => setGenTone(e.target.value)} className={selectCls}>
                    {MARKETING_TONES.map((t) => (
                      <option key={t.id} value={t.id}>{isAr ? t.ar : t.en}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className={labelCls}>{isAr ? "الهدف" : "Goal"}</label>
                <select value={genGoal} onChange={(e) => setGenGoal(e.target.value)} className={selectCls}>
                  {MARKETING_GOALS.map((g) => (
                    <option key={g.id} value={g.id}>{isAr ? g.ar : g.en}</option>
                  ))}
                </select>
              </div>

              {genKind === "reel" && (
                <div>
                  <label className={labelCls}>{isAr ? "شكل الريل" : "Reel format"}</label>
                  <select value={genReelFormat} onChange={(e) => setGenReelFormat(e.target.value)} className={selectCls}>
                    {REEL_FORMATS.map((f) => (
                      <option key={f.id} value={f.id}>{isAr ? f.ar : f.en}</option>
                    ))}
                  </select>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>{isAr ? "الخدمة (اختياري)" : "Service (optional)"}</label>
                  <select value={genService} onChange={(e) => setGenService(e.target.value)} className={selectCls}>
                    <option value="">{isAr ? "— بدون تحديد —" : "— none —"}</option>
                    {services.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>{isAr ? "مناسبة (اختياري)" : "Occasion (optional)"}</label>
                  <select value={genOccasion} onChange={(e) => setGenOccasion(e.target.value)} className={selectCls}>
                    {MARKETING_OCCASIONS.map((o) => (
                      <option key={o.id} value={o.id}>{isAr ? o.ar : o.en}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className={labelCls}>
                  {isAr ? "تفاصيل العرض (اختياري — بالأرقام لو فيه)" : "Offer details (optional — with numbers if any)"}
                </label>
                <input
                  value={genOffer}
                  onChange={(e) => setGenOffer(e.target.value)}
                  dir="auto"
                  placeholder={isAr ? "مثال: خصم ٢٠٪ على التنظيف حتى نهاية الشهر" : "e.g. 20% off cleaning until end of month"}
                  className={selectCls}
                  maxLength={400}
                />
              </div>

              <div>
                <label className={labelCls}>{isAr ? "ملاحظات إضافية (اختياري)" : "Extra notes (optional)"}</label>
                <input
                  value={genNotes}
                  onChange={(e) => setGenNotes(e.target.value)}
                  dir="auto"
                  placeholder={isAr ? "أي شيء تريد التركيز عليه" : "Anything to emphasize"}
                  className={selectCls}
                  maxLength={300}
                />
              </div>

              <button
                onClick={runGenerate}
                disabled={generating}
                className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl bg-slate-900 hover:bg-emerald-600 text-white font-black text-sm transition-colors disabled:opacity-60"
              >
                {generating ? <Loader2 size={16} className="animate-spin" /> : <Wand2 size={16} />}
                {generating
                  ? isAr ? "جارٍ الكتابة…" : "Writing…"
                  : isAr ? `توليد ٣ اختيارات (${MARKETING_CREDIT_COST.single} رصيد)` : `Generate 3 options (${MARKETING_CREDIT_COST.single} credit)`}
              </button>
            </div>

            {/* Variants */}
            <div className="space-y-4">
              {variants.length === 0 && !generating && (
                <div className="bg-white/60 border border-dashed border-slate-300 rounded-3xl p-10 text-center">
                  <Wand2 size={28} className="mx-auto text-slate-300 mb-3" />
                  <p className="text-sm font-black text-slate-500">
                    {isAr ? "اختر من القوائم واضغط توليد — ستحصل على ٣ صياغات مختلفة تختار منها" : "Pick from the lists and hit Generate — you'll get 3 different takes to choose from"}
                  </p>
                  <p className="text-xs font-bold text-slate-400 mt-1">
                    {isAr ? "كل توليدة تكلف رصيداً واحداً من رصيدك الشهري" : "Each generation costs 1 credit from your monthly quota"}
                  </p>
                </div>
              )}
              {generating && (
                <div className="bg-white rounded-3xl border border-slate-200 p-10 text-center">
                  <Loader2 size={28} className="mx-auto text-emerald-500 animate-spin mb-3" />
                  <p className="text-sm font-black text-slate-600">
                    {isAr ? "الذكاء الاصطناعي يكتب ٣ اختيارات…" : "The AI is writing 3 options…"}
                  </p>
                </div>
              )}
              {variants.map((v, i) => variantCard(v, i))}
            </div>
          </div>
        )}

        {/* ============================== CAMPAIGNS ============================== */}
        {tab === "campaigns" && (
          <div className="space-y-5">
            {/* Empty-chair alert */}
            {emptyChair && !campSegment && (
              <div className="flex items-center gap-3 bg-white border border-amber-200 rounded-2xl px-4 py-3.5">
                <div className="w-10 h-10 bg-amber-50 text-amber-600 rounded-2xl flex items-center justify-center shrink-0">
                  <Armchair size={18} />
                </div>
                <p className="text-sm font-bold text-slate-700 flex-1">
                  {isAr
                    ? `يوم ${new Date(emptyChair.date + "T00:00:00").toLocaleDateString("ar-EG", { weekday: "long", day: "numeric", month: "long" })} شكله هادي — ${emptyChair.count} حجز مقابل ${emptyChair.avg} في المعتاد. نبعت عرض يملأ الكراسي؟`
                    : `${new Date(emptyChair.date + "T00:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })} looks slow — ${emptyChair.count} booked vs the usual ${emptyChair.avg}. Send an offer to fill the chairs?`}
                </p>
                <button
                  onClick={() => void scanSegment("dormant")}
                  className="px-3.5 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-xs font-black transition-colors shrink-0"
                >
                  {isAr ? "ابدأ حملة" : "Start a campaign"}
                </button>
              </div>
            )}

            {/* Segment picker */}
            {!campSegment && (
              <div className="grid sm:grid-cols-3 gap-4">
                {CAMPAIGN_SEGMENTS.map((seg) => {
                  const Icon = SEGMENT_ICONS[seg.id];
                  return (
                    <button
                      key={seg.id}
                      onClick={() => void scanSegment(seg.id)}
                      className="bg-white rounded-3xl border border-slate-200 hover:border-emerald-300 p-5 text-start transition-colors group"
                    >
                      <div className="w-10 h-10 bg-slate-100 text-slate-600 rounded-2xl flex items-center justify-center mb-3 group-hover:bg-emerald-500 group-hover:text-white transition-colors">
                        <Icon size={18} />
                      </div>
                      <h3 className="text-sm font-black text-slate-900 mb-1">{isAr ? seg.ar : seg.en}</h3>
                      <p className="text-xs font-bold text-slate-400 leading-relaxed">{isAr ? seg.descAr : seg.descEn}</p>
                      <p className="text-[11px] font-black text-emerald-600 mt-3">
                        {isAr ? "افحص من ينطبق عليهم ←" : "Scan who qualifies →"}
                      </p>
                    </button>
                  );
                })}
              </div>
            )}

            {campScanning && (
              <div className="bg-white rounded-3xl border border-slate-200 p-10 text-center">
                <Loader2 size={28} className="mx-auto text-emerald-500 animate-spin mb-3" />
                <p className="text-sm font-black text-slate-600">
                  {isAr ? "جارٍ فحص سجلات المرضى…" : "Scanning patient records…"}
                </p>
              </div>
            )}

            {/* Compose + recipients */}
            {campSegment && campRecipients && (
              <div className="grid lg:grid-cols-[1fr_340px] gap-5 items-start">
                <div className="bg-white rounded-3xl border border-slate-200 p-5 space-y-4">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-sm font-black text-slate-900">
                      {isAr ? "رسالة الحملة" : "Campaign message"}
                    </h3>
                    <button
                      onClick={() => { setCampSegment(null); setCampRecipients(null); }}
                      className="text-xs font-black text-slate-400 hover:text-slate-600"
                    >
                      {isAr ? "← رجوع للقوائم" : "← back to audiences"}
                    </button>
                  </div>

                  <div>
                    <label className={labelCls}>{isAr ? "اسم الحملة (داخلي)" : "Campaign name (internal)"}</label>
                    <input value={campName} onChange={(e) => setCampName(e.target.value)} dir="auto" className={selectCls} maxLength={120} />
                  </div>

                  <div>
                    <label className={labelCls}>{isAr ? "العرض إن وجد (بالأرقام الحقيقية)" : "The offer, if any (real numbers only)"}</label>
                    <input
                      value={campOffer}
                      onChange={(e) => setCampOffer(e.target.value)}
                      dir="auto"
                      maxLength={400}
                      placeholder={isAr ? "مثال: خصم ١٥٪ على استكمال الخطة هذا الشهر" : "e.g. 15% off completing the plan this month"}
                      className={selectCls}
                    />
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={writeCampaignMessage}
                      disabled={campAiBusy}
                      className="flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-slate-900 hover:bg-emerald-600 text-white text-xs font-black transition-colors disabled:opacity-60"
                    >
                      {campAiBusy ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />}
                      {isAr ? `اكتبها بالذكاء الاصطناعي (${MARKETING_CREDIT_COST.single} رصيد)` : `AI write it (${MARKETING_CREDIT_COST.single} credit)`}
                    </button>
                    {campAiOptions.length > 1 &&
                      campAiOptions.map((opt, i) => (
                        <button
                          key={i}
                          onClick={() => setCampBody(opt)}
                          className={`px-3 py-2 rounded-xl text-xs font-black border transition-colors ${
                            campBody === opt ? "bg-emerald-500 text-white border-emerald-500" : "bg-white text-slate-500 border-slate-200 hover:border-emerald-300"
                          }`}
                        >
                          {isAr ? `اختيار ${i + 1}` : `Option ${i + 1}`}
                        </button>
                      ))}
                  </div>

                  <div>
                    <label className={labelCls}>
                      {isAr ? "نص الرسالة — {{patient_name}} يتبدل باسم كل مريض تلقائياً" : "Message text — {{patient_name}} becomes each patient's real name"}
                    </label>
                    <textarea
                      value={campBody}
                      onChange={(e) => setCampBody(e.target.value)}
                      rows={6}
                      dir="auto"
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-sm text-slate-800 leading-relaxed outline-none focus:border-emerald-400 resize-y"
                    />
                  </div>

                  <button
                    onClick={launchCampaign}
                    disabled={campLaunching || !campBody.trim() || !campName.trim() || campRecipients.filter((r) => campSelected[r.patientId]).length === 0}
                    className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl bg-emerald-500 hover:bg-emerald-600 text-white font-black text-sm transition-colors disabled:opacity-50"
                  >
                    {campLaunching ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                    {isAr
                      ? `تجهيز ${campRecipients.filter((r) => campSelected[r.patientId]).length} رسالة للمراجعة`
                      : `Queue ${campRecipients.filter((r) => campSelected[r.patientId]).length} messages for review`}
                  </button>
                  <p className="text-[11px] font-bold text-slate-400 leading-relaxed">
                    {isAr
                      ? "لا يُرسل شيء تلقائياً: كل رسالة تظهر في قائمة المراجعة بالأسفل، وتُبعت واحدة واحدة. الإرسال بإيقاع بشري يحمي رقم الواتساب من الحظر."
                      : "Nothing sends automatically: every message lands in the review queue below and goes out one by one. A human pace protects the clinic's WhatsApp number from being flagged."}
                  </p>
                </div>

                {/* Recipients */}
                <div className="bg-white rounded-3xl border border-slate-200 p-5">
                  <h3 className="text-sm font-black text-slate-900 mb-3">
                    {isAr ? `المستلمون (${campRecipients.length})` : `Recipients (${campRecipients.length})`}
                  </h3>
                  {campRecipients.length === 0 ? (
                    <p className="text-xs font-bold text-slate-400">
                      {isAr ? "لا يوجد أحد ينطبق عليه هذا التصنيف حالياً 🎉" : "Nobody currently matches this audience 🎉"}
                    </p>
                  ) : (
                    <div className="space-y-1.5 max-h-[420px] overflow-y-auto">
                      {campRecipients.map((r) => (
                        <label key={r.patientId} className="flex items-center gap-2.5 px-2.5 py-2 rounded-xl hover:bg-slate-50 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={!!campSelected[r.patientId]}
                            onChange={(e) => setCampSelected((p) => ({ ...p, [r.patientId]: e.target.checked }))}
                            className="w-4 h-4 accent-emerald-500 shrink-0"
                          />
                          <div className="min-w-0">
                            <p dir="auto" className="text-xs font-black text-slate-800 truncate">{r.name}</p>
                            <p className="text-[10px] font-bold text-slate-400 truncate" dir="ltr">
                              {r.phone}{r.detail ? ` · ${r.detail}` : ""}
                            </p>
                          </div>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Review queue */}
            {pendingCampaignDrafts.length > 0 && (
              <div className="bg-white rounded-3xl border border-slate-200 p-5">
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-8 h-8 bg-emerald-50 text-emerald-600 rounded-xl flex items-center justify-center">
                    <Send size={15} />
                  </div>
                  <h3 className="text-sm font-black text-slate-900">
                    {isAr ? `رسائل تنتظر الإرسال (${pendingCampaignDrafts.length})` : `Messages waiting to send (${pendingCampaignDrafts.length})`}
                  </h3>
                </div>
                <div className="space-y-3">
                  {pendingCampaignDrafts.map((d) => (
                    <div key={d.id} className="border border-slate-200 rounded-2xl p-3.5">
                      <div className="flex items-center gap-2 flex-wrap mb-2">
                        <span dir="auto" className="text-xs font-black text-slate-800">{d.patientName}</span>
                        <span className="text-[10px] font-bold text-slate-400" dir="ltr">{d.phone}</span>
                        {d.context?.campaignName && (
                          <span className="text-[10px] font-black text-slate-400 bg-slate-50 border border-slate-100 rounded px-1.5 py-0.5">
                            {d.context.campaignName}
                          </span>
                        )}
                      </div>
                      <textarea
                        value={campDraftEdits[d.id] ?? d.body}
                        onChange={(e) => setCampDraftEdits((p) => ({ ...p, [d.id]: e.target.value }))}
                        rows={3}
                        dir="auto"
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs text-slate-800 leading-relaxed outline-none focus:border-emerald-400 resize-y mb-2"
                      />
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => void resolveCampaignDraft(d, "approve", campDraftEdits[d.id])}
                          disabled={busyDraft === d.id}
                          className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-black transition-colors disabled:opacity-50"
                        >
                          {busyDraft === d.id ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                          {isAr ? "إرسال" : "Send"}
                        </button>
                        <button
                          onClick={() => void resolveCampaignDraft(d, "reject")}
                          disabled={busyDraft === d.id}
                          className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white border border-slate-200 hover:border-rose-200 hover:text-rose-500 text-slate-500 text-xs font-black transition-colors disabled:opacity-50"
                        >
                          <ThumbsDown size={13} /> {isAr ? "استبعاد" : "Dismiss"}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Past campaigns */}
            {campaigns.length > 0 && (
              <div className="bg-white rounded-3xl border border-slate-200 p-5">
                <h3 className="text-sm font-black text-slate-900 mb-3">{isAr ? "الحملات" : "Campaigns"}</h3>
                <div className="space-y-2">
                  {campaigns.map((c) => {
                    const prog = campaignProgress.get(c.id) || { sent: 0, pending: 0, rejected: 0 };
                    const seg = CAMPAIGN_SEGMENTS.find((s) => s.id === c.segment);
                    return (
                      <div key={c.id} className="flex items-center justify-between gap-3 border border-slate-100 rounded-2xl px-4 py-3 flex-wrap">
                        <div className="min-w-0">
                          <p dir="auto" className="text-sm font-black text-slate-800 truncate">{c.name}</p>
                          <p className="text-[11px] font-bold text-slate-400">
                            {seg
                              ? isAr ? seg.ar : seg.en
                              : c.segment === "reviews"
                                ? isAr ? "طلبات تقييم" : "Review requests"
                                : c.segment}{" "}
                            · {c.recipientCount} {isAr ? "مستلم" : "recipients"}
                          </p>
                        </div>
                        <div className="flex items-center gap-1.5 text-[11px] font-black">
                          <span className="px-2 py-1 rounded-lg bg-emerald-50 text-emerald-700">{prog.sent} {isAr ? "أُرسلت" : "sent"}</span>
                          <span className="px-2 py-1 rounded-lg bg-amber-50 text-amber-700">{prog.pending} {isAr ? "بالانتظار" : "waiting"}</span>
                          {prog.rejected > 0 && (
                            <span className="px-2 py-1 rounded-lg bg-slate-100 text-slate-500">{prog.rejected} {isAr ? "مستبعدة" : "dismissed"}</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Automations — the robots that fill the queue by themselves */}
            {isAdmin && !campSegment && (
              <div className="bg-white rounded-3xl border border-slate-200 p-5">
                <div className="flex items-center gap-2 mb-1">
                  <div className="w-8 h-8 bg-slate-100 text-slate-600 rounded-xl flex items-center justify-center">
                    <Sparkles size={15} />
                  </div>
                  <h3 className="text-sm font-black text-slate-900">{isAr ? "التشغيل التلقائي" : "Automations"}</h3>
                </div>
                <p className="text-[11px] font-bold text-slate-400 mb-4">
                  {isAr
                    ? "النظام يجهز الرسائل بنفسه كل يوم ويحطها في قائمة المراجعة — والإرسال يظل بيد فريقك."
                    : "The system prepares messages by itself each day and puts them in the review queue — sending stays in your team's hands."}
                </p>

                <div className="space-y-3">
                  {/* Review requests */}
                  <div className="flex items-start justify-between gap-3 p-3.5 border border-slate-100 rounded-2xl">
                    <div className="min-w-0">
                      <p className="text-xs font-black text-slate-800">
                        {isAr ? "طلبات التقييم بعد الزيارة ⭐" : "Post-visit review requests ⭐"}
                      </p>
                      <p className="text-[11px] font-bold text-slate-400 leading-relaxed mt-0.5">
                        {isAr
                          ? "كل مساء: مرضى اليوم المكتملين يصلهم رابط تقييم — الراضي (٤-٥ نجوم) يتحول لتقييم جوجل، وغير الراضي تصل شكواه للإدارة فقط بدون نشر. يتطلب رابط جوجل في إعدادات العيادة."
                          : "Each evening: today's completed patients get a rating link — happy (4–5★) continues to Google, unhappy goes privately to management only. Needs the Google review link in clinic settings."}
                      </p>
                    </div>
                    <button
                      onClick={() => void saveAutomation({ reviewEnabled: automations.reviewEnabled !== true })}
                      className={`w-11 h-6 rounded-full transition-colors relative shrink-0 mt-0.5 ${
                        automations.reviewEnabled === true ? "bg-emerald-500" : "bg-slate-200"
                      }`}
                    >
                      <div
                        className={`w-5 h-5 bg-white rounded-full absolute top-0.5 shadow transition-transform ${
                          automations.reviewEnabled === true ? "translate-x-5 rtl:-translate-x-5" : "translate-x-0.5 rtl:-translate-x-0.5"
                        }`}
                      />
                    </button>
                  </div>

                  {/* Birthdays */}
                  <div className="p-3.5 border border-slate-100 rounded-2xl">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-xs font-black text-slate-800">{isAr ? "تهنئة أعياد الميلاد 🎂" : "Birthday wishes 🎂"}</p>
                        <p className="text-[11px] font-bold text-slate-400 leading-relaxed mt-0.5">
                          {isAr
                            ? "كل صباح: رسالة تهنئة جاهزة لكل مريض عيد ميلاده اليوم."
                            : "Each morning: a ready wish for every patient whose birthday is today."}
                        </p>
                      </div>
                      <button
                        onClick={() => void saveAutomation({ birthdayEnabled: automations.birthdayEnabled !== true })}
                        className={`w-11 h-6 rounded-full transition-colors relative shrink-0 mt-0.5 ${
                          automations.birthdayEnabled === true ? "bg-emerald-500" : "bg-slate-200"
                        }`}
                      >
                        <div
                          className={`w-5 h-5 bg-white rounded-full absolute top-0.5 shadow transition-transform ${
                            automations.birthdayEnabled === true ? "translate-x-5 rtl:-translate-x-5" : "translate-x-0.5 rtl:-translate-x-0.5"
                          }`}
                        />
                      </button>
                    </div>
                    {automations.birthdayEnabled === true && (
                      <textarea
                        value={automations.birthdayTemplate ?? ""}
                        onChange={(e) => setAutomations((p) => ({ ...p, birthdayTemplate: e.target.value }))}
                        onBlur={() => void saveAutomation({ birthdayTemplate: automations.birthdayTemplate || "" })}
                        rows={3}
                        dir="auto"
                        placeholder={
                          isAr
                            ? "اتركه فارغاً للرسالة الافتراضية — {{patient_name}} و {{clinic_name}} يتبدلان تلقائياً"
                            : "Leave empty for the default message — {{patient_name}} and {{clinic_name}} are filled automatically"
                        }
                        className="w-full mt-3 bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs text-slate-800 leading-relaxed outline-none focus:border-emerald-400 resize-y"
                      />
                    )}
                  </div>

                  {/* Lead alerts */}
                  <div className="flex items-start justify-between gap-3 p-3.5 border border-slate-100 rounded-2xl">
                    <div className="min-w-0">
                      <p className="text-xs font-black text-slate-800">{isAr ? "تنبيه العملاء المنتظرين ⏱" : "Waiting-lead alerts ⏱"}</p>
                      <p className="text-[11px] font-bold text-slate-400 leading-relaxed mt-0.5">
                        {isAr
                          ? "إشعار للإدارة والاستقبال عندما ينتظر عميل محتمل أكثر من ١٥ دقيقة بدون رد (من ٩ صباحاً لـ ١١ مساءً)."
                          : "A push to admins and reception when a lead waits 15+ minutes unanswered (9am–11pm)."}
                      </p>
                    </div>
                    <button
                      onClick={() => void saveAutomation({ leadAlerts: automations.leadAlerts === false })}
                      className={`w-11 h-6 rounded-full transition-colors relative shrink-0 mt-0.5 ${
                        automations.leadAlerts !== false ? "bg-emerald-500" : "bg-slate-200"
                      }`}
                    >
                      <div
                        className={`w-5 h-5 bg-white rounded-full absolute top-0.5 shadow transition-transform ${
                          automations.leadAlerts !== false ? "translate-x-5 rtl:-translate-x-5" : "translate-x-0.5 rtl:-translate-x-0.5"
                        }`}
                      />
                    </button>
                  </div>
                </div>
              </div>
            )}

            {!campSegment && !campScanning && campaigns.length === 0 && pendingCampaignDrafts.length === 0 && (
              <p className="text-[11px] font-bold text-slate-400 text-center">
                {isAr
                  ? "اختر جمهوراً بالأعلى — النظام يفحص سجلاتك الحقيقية ويجهز رسالة لكل شخص، وأنت تراجع وترسل."
                  : "Pick an audience above — the system scans your real records and prepares one message per person; you review and send."}
              </p>
            )}
          </div>
        )}

        {/* ============================== CASES ============================== */}
        {tab === "cases" && (
          <CasesTab
            clinicId={clinicId || ""}
            isAr={isAr}
            isAdmin={isAdmin}
            services={services}
            userName={user?.name}
            clinicName={profileLite.clinicName || clinic?.name || ""}
            logoUrl={brand.logoDataUrl || profileLite.logoUrl}
            designUnlocked={designUnlocked}
            showToast={showToast}
          />
        )}

        {/* ============================== REVIEWS ============================== */}
        {tab === "reviews" && (
          <div className="space-y-5">
            {/* Stats strip */}
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              {[
                { label: isAr ? "طلبات مُرسلة" : "Requests", value: reviewStats.asked, cls: "text-slate-800" },
                { label: isAr ? "ردود" : "Answered", value: reviewStats.rated, cls: "text-slate-800" },
                { label: isAr ? "متوسط النجوم" : "Avg stars", value: reviewStats.rated ? `${reviewStats.avg} ⭐` : "—", cls: "text-amber-600" },
                { label: isAr ? "راضون → جوجل" : "Happy → Google", value: reviewStats.happy, cls: "text-emerald-600" },
                { label: isAr ? "غير راضين" : "Unhappy", value: reviewStats.unhappy, cls: reviewStats.unhandled > 0 ? "text-rose-600" : "text-slate-800" },
              ].map((s) => (
                <div key={s.label} className="bg-white rounded-2xl border border-slate-200 px-4 py-3.5">
                  <p className={`text-xl font-black tabular-nums ${s.cls}`}>{s.value}</p>
                  <p className="text-[11px] font-black text-slate-400">{s.label}</p>
                </div>
              ))}
            </div>

            {reviewStats.unhandled > 0 && (
              <div className="flex items-center gap-2 bg-rose-50 border border-rose-200 rounded-2xl px-4 py-3 text-sm font-bold text-rose-700">
                <AlertTriangle size={16} className="shrink-0" />
                {isAr
                  ? `${reviewStats.unhandled} شكوى تحتاج مكالمة — اتصل بالمريض ثم علّمها "تمت المعالجة"`
                  : `${reviewStats.unhandled} complaint${reviewStats.unhandled === 1 ? "" : "s"} need${reviewStats.unhandled === 1 ? "s" : ""} a call — phone the patient, then mark it handled`}
              </div>
            )}

            {/* History list */}
            {reviews.length === 0 ? (
              <div className="bg-white/60 border border-dashed border-slate-300 rounded-3xl p-10 text-center">
                <Star size={28} className="mx-auto text-slate-300 mb-3" />
                <p className="text-sm font-black text-slate-500">
                  {isAr
                    ? "لا توجد طلبات تقييم بعد — فعّل «طلبات التقييم بعد الزيارة» في تبويب الحملات، وستظهر هنا تلقائياً"
                    : "No review requests yet — switch on post-visit review requests in the Campaigns tab and they'll appear here automatically"}
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {reviews.map((r) => {
                  const isUnhappy = r.status === "rated" && (r.rating || 0) <= 3;
                  return (
                    <div
                      key={r.id}
                      className={`bg-white rounded-2xl border p-4 ${
                        isUnhappy && !r.handled ? "border-rose-200 ring-1 ring-rose-100" : "border-slate-200"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3 flex-wrap">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p dir="auto" className="text-sm font-black text-slate-800">{r.patientName}</p>
                            {r.status === "rated" ? (
                              <span className="flex items-center gap-0.5" dir="ltr">
                                {[1, 2, 3, 4, 5].map((s) => (
                                  <Star
                                    key={s}
                                    size={13}
                                    className={s <= (r.rating || 0) ? "text-amber-400 fill-amber-400" : "text-slate-200"}
                                  />
                                ))}
                              </span>
                            ) : (
                              <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">
                                {isAr ? "في انتظار الرد" : "awaiting answer"}
                              </span>
                            )}
                            {r.status === "rated" && (r.rating || 0) >= 4 && (
                              <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700">
                                {isAr ? "تحوّل لتقييم جوجل" : "sent to Google"}
                              </span>
                            )}
                            {r.status === "rated" && r.rating === 5 && (
                              <button
                                onClick={() => setInterviewFor(r)}
                                className="text-[10px] font-black px-2 py-0.5 rounded-full bg-violet-50 text-violet-700 hover:bg-violet-100 transition-colors"
                                title={isAr ? "مرشح مثالي لريل تقييم بالفيديو" : "Perfect candidate for a video review reel"}
                              >
                                🎥 {isAr ? "اطلب فيديو تقييم" : "ask for video review"}
                              </button>
                            )}
                            {isUnhappy && r.handled && (
                              <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 flex items-center gap-1">
                                <Check size={10} /> {isAr ? "تمت المعالجة" : "handled"}
                              </span>
                            )}
                          </div>
                          <p className="text-[11px] font-bold text-slate-400 mt-0.5">
                            {isAr ? "زيارة" : "Visit"} {r.appointmentDate || "—"}
                            <span dir="ltr" className="ms-2">{r.phone}</span>
                          </p>
                          {r.feedback && (
                            <p dir="auto" className={`mt-2 text-xs leading-relaxed rounded-xl px-3 py-2.5 ${
                              isUnhappy ? "bg-rose-50 text-rose-800 font-bold" : "bg-slate-50 text-slate-600"
                            }`}>
                              &ldquo;{r.feedback}&rdquo;
                            </p>
                          )}
                        </div>

                        {isUnhappy && (
                          <div className="flex items-center gap-1.5 shrink-0">
                            <a
                              href={`tel:${r.phone}`}
                              className="px-3 py-2 rounded-xl bg-slate-900 hover:bg-slate-700 text-white text-[11px] font-black transition-colors"
                            >
                              {isAr ? "اتصال" : "Call"}
                            </a>
                            {!r.handled && (
                              <button
                                onClick={async () => {
                                  await updateDoc(getClinicDoc("review_requests", r.id), {
                                    handled: true,
                                    handledBy: user?.uid || "",
                                    handledAt: serverTimestamp(),
                                  });
                                  showToast(isAr ? "تم — أحسنت 👏" : "Marked handled 👏", "success");
                                }}
                                className="px-3 py-2 rounded-xl bg-white border border-slate-200 hover:border-emerald-300 text-slate-600 text-[11px] font-black transition-colors"
                              >
                                {isAr ? "تمت المعالجة" : "Mark handled"}
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ============================== RESULTS ============================== */}
        {tab === "results" && (
          <div className="space-y-5">
            {/* Month picker */}
            <div className="flex items-center justify-between bg-white rounded-2xl border border-slate-200 px-4 py-3">
              <button
                onClick={() => setResMonth((p) => (p.m === 0 ? { y: p.y - 1, m: 11 } : { y: p.y, m: p.m - 1 }))}
                className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 transition-colors"
              >
                {isAr ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
              </button>
              <h2 className="text-sm font-black text-slate-900">
                {new Date(resMonth.y, resMonth.m, 1).toLocaleDateString(isAr ? "ar-EG" : "en-US", { month: "long", year: "numeric" })}
              </h2>
              <button
                onClick={() => setResMonth((p) => (p.m === 11 ? { y: p.y + 1, m: 0 } : { y: p.y, m: p.m + 1 }))}
                className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 transition-colors"
              >
                {isAr ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}
              </button>
            </div>

            {resLoading && (
              <div className="bg-white rounded-3xl border border-slate-200 p-10 text-center">
                <Loader2 size={24} className="mx-auto text-emerald-500 animate-spin" />
              </div>
            )}

            {resRaw && (
              <>
                {/* Spend & ROI */}
                <div className="bg-white rounded-3xl border border-slate-200 p-5">
                  <div className="flex items-center gap-2 mb-1">
                    <div className="w-8 h-8 bg-emerald-50 text-emerald-600 rounded-xl flex items-center justify-center">
                      <TrendingUp size={15} />
                    </div>
                    <h3 className="text-sm font-black text-slate-900">
                      {isAr ? "الإنفاق والعائد لكل قناة" : "Spend & return per channel"}
                    </h3>
                  </div>
                  <p className="text-[11px] font-bold text-slate-400 mb-4">
                    {isAr
                      ? "اكتب ما أنفقته على كل قناة هذا الشهر — النظام يعرف الباقي من بياناتك الحقيقية: العملاء، من وصل للكرسي، وما دفعوه."
                      : "Type what you spent on each channel this month — the system already knows the rest from your real data: leads, who reached the chair, and what they paid."}
                  </p>

                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[620px] text-sm">
                      <thead>
                        <tr className="text-[11px] font-black text-slate-400 border-b border-slate-100">
                          <th className="text-start py-2 pe-2">{isAr ? "القناة" : "Channel"}</th>
                          <th className="text-center py-2 px-2">{isAr ? "الإنفاق" : "Spend"}</th>
                          <th className="text-center py-2 px-2">{isAr ? "عملاء" : "Leads"}</th>
                          <th className="text-center py-2 px-2">{isAr ? "وصلوا للكرسي" : "In the chair"}</th>
                          <th className="text-center py-2 px-2">{isAr ? "الدخل" : "Revenue"}</th>
                          <th className="text-center py-2 px-2">{isAr ? "تكلفة المريض" : "Cost / patient"}</th>
                          <th className="text-center py-2 ps-2">{isAr ? "العائد" : "Return"}</th>
                        </tr>
                      </thead>
                      <tbody className="tabular-nums">
                        {roiRows.map((r) => (
                          <tr key={r.channel} className="border-b border-slate-50">
                            <td className="py-2.5 pe-2 font-black text-slate-800">{r.channel}</td>
                            <td className="py-2.5 px-2 text-center">
                              <input
                                type="number"
                                min={0}
                                defaultValue={r.spend || ""}
                                key={`${spendDocId}-${r.channel}-${r.spend}`}
                                onBlur={(e) => {
                                  const v = Math.max(0, Number(e.target.value) || 0);
                                  if (v !== r.spend) void saveSpend(r.channel, v);
                                }}
                                placeholder="0"
                                disabled={!isAdmin}
                                className="w-24 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 text-center text-xs font-bold text-slate-700 outline-none focus:border-emerald-400 disabled:opacity-50"
                              />
                            </td>
                            <td className="py-2.5 px-2 text-center font-bold text-slate-600">{r.leads}</td>
                            <td className="py-2.5 px-2 text-center font-bold text-emerald-600">{r.won}</td>
                            <td className="py-2.5 px-2 text-center font-black text-slate-800">{r.revenue.toLocaleString()}</td>
                            <td className="py-2.5 px-2 text-center font-bold text-slate-500">
                              {r.costPerPatient !== null ? r.costPerPatient.toLocaleString() : "—"}
                            </td>
                            <td className="py-2.5 ps-2 text-center">
                              {r.roi !== null ? (
                                <span className={`px-2 py-1 rounded-lg text-xs font-black ${
                                  r.roi >= 1 ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-600"
                                }`}>
                                  ×{r.roi}
                                </span>
                              ) : (
                                <span className="text-slate-300 font-bold">—</span>
                              )}
                            </td>
                          </tr>
                        ))}
                        {roiRows.length === 0 && (
                          <tr>
                            <td colSpan={7} className="py-6 text-center text-xs font-bold text-slate-400">
                              {isAr ? "لا عملاء محتملين ولا إنفاق مسجل في هذا الشهر" : "No leads and no spend recorded for this month"}
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                  <p className="text-[11px] font-bold text-slate-400 mt-3">
                    {isAr
                      ? "الدخل = ما دفعه هذا الشهر المرضى الجدد الذين جاءوا من عملاء هذه القناة. مرضى قدامى عادوا عبر إعلان لا يُحسبون — القناة تأخذ فضل من جلبته فقط."
                      : "Revenue = what NEW patients converted from this channel's leads paid this month. Returning patients aren't counted — a channel gets credit only for people it actually brought."}
                  </p>
                </div>

                {/* Referral cards */}
                <div className="grid lg:grid-cols-2 gap-5 items-start">
                  <div className="bg-white rounded-3xl border border-slate-200 p-5">
                    <div className="flex items-center gap-2 mb-1">
                      <div className="w-8 h-8 bg-violet-50 text-violet-600 rounded-xl flex items-center justify-center">
                        <QrCode size={15} />
                      </div>
                      <h3 className="text-sm font-black text-slate-900">{isAr ? "كروت الترشيح" : "Referral cards"}</h3>
                    </div>
                    <p className="text-[11px] font-bold text-slate-400 mb-3">
                      {isAr
                        ? "اختر مريضاً سعيداً — يحصل على كارت QR ورابط شخصي. صديقه يمسح، يسيب رقمه، ويظهر في صندوق العملاء باسم من رشّحه."
                        : "Pick a happy patient — they get a personal QR card and link. Their friend scans, leaves a number, and lands in your Leads inbox tagged with who referred them."}
                    </p>

                    <div className="relative mb-3">
                      <Search size={14} className="absolute start-3 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input
                        value={refSearch}
                        onChange={(e) => { setRefSearch(e.target.value); setRefSelected(null); }}
                        dir="auto"
                        placeholder={isAr ? "ابحث باسم المريض أو رقمه…" : "Search patient name or phone…"}
                        className="w-full ps-9 pe-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-700 outline-none focus:border-emerald-400"
                      />
                    </div>
                    {!refSelected && refMatches.length > 0 && (
                      <div className="border border-slate-100 rounded-xl overflow-hidden mb-3">
                        {refMatches.map((p) => (
                          <button
                            key={p.id}
                            onClick={() => { setRefSelected({ id: p.id, name: p.name }); setRefSearch(p.name); }}
                            className="w-full text-start px-3.5 py-2.5 text-xs font-bold text-slate-700 hover:bg-emerald-50 border-b border-slate-50 last:border-0"
                          >
                            {p.name} <span className="text-slate-400" dir="ltr">{p.phone}</span>
                          </button>
                        ))}
                      </div>
                    )}

                    {refSelected && qrDataUrl && (
                      <div className="text-center border border-slate-100 rounded-2xl p-4">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={qrDataUrl} alt="QR" className="w-40 h-40 mx-auto mb-2" />
                        <p className="text-xs font-black text-slate-800 mb-3">
                          {isAr ? `كارت ترشيح — ${refSelected.name}` : `Referral card — ${refSelected.name}`}
                        </p>
                        <div className="flex items-center justify-center gap-2 flex-wrap">
                          <button
                            onClick={() => copyText("reflink", referralLink)}
                            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-black transition-colors"
                          >
                            {copiedKey === "reflink" ? <Check size={13} className="text-emerald-600" /> : <Link2 size={13} />}
                            {isAr ? "نسخ الرابط (للواتساب)" : "Copy link (for WhatsApp)"}
                          </button>
                          <button
                            onClick={printReferralCard}
                            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-900 hover:bg-slate-700 text-white text-xs font-black transition-colors"
                          >
                            <Printer size={13} /> {isAr ? "طباعة الكارت" : "Print card"}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Top referrers */}
                  <div className="bg-white rounded-3xl border border-slate-200 p-5">
                    <h3 className="text-sm font-black text-slate-900 mb-3">
                      {isAr ? "أبطال الترشيح 🏆" : "Referral champions 🏆"}
                    </h3>
                    {topReferrers.length === 0 ? (
                      <p className="text-xs font-bold text-slate-400">
                        {isAr
                          ? "لا ترشيحات مسجلة بعد — أول كارت QR يبدأ العد."
                          : "No tracked referrals yet — the first QR card starts the count."}
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {topReferrers.map((r, i) => (
                          <div key={r.name + i} className="flex items-center justify-between gap-3 border border-slate-100 rounded-xl px-3.5 py-2.5">
                            <p dir="auto" className="text-xs font-black text-slate-800 truncate">
                              {i === 0 ? "🥇 " : i === 1 ? "🥈 " : i === 2 ? "🥉 " : ""}{r.name}
                            </p>
                            <p className="text-[11px] font-bold text-slate-500 shrink-0">
                              {isAr
                                ? `${r.total} ترشيح · ${r.won} وصلوا`
                                : `${r.total} referred · ${r.won} in the chair`}
                            </p>
                          </div>
                        ))}
                      </div>
                    )}
                    <p className="text-[11px] font-bold text-slate-400 mt-3">
                      {isAr
                        ? "هؤلاء سفراء عيادتك — كافئهم (خصم على جلسة، تنظيف مجاني) وسيجلبون المزيد."
                        : "These are your clinic's ambassadors — reward them (a session discount, a free cleaning) and they'll bring more."}
                    </p>
                  </div>
                </div>

                {/* Full funnel with per-campaign drill-down */}
                <LeadFunnelReport
                  leads={monthLeads}
                  payments={monthPayments}
                  rangeLabel={`${resRange.start} → ${resRange.end}`}
                  isAr={isAr}
                />
              </>
            )}
          </div>
        )}

        {/* ============================== CALENDAR ============================== */}
        {tab === "calendar" && (
          <div className="bg-white rounded-3xl border border-slate-200 p-4 sm:p-6">
            <div className="flex items-center justify-between mb-4">
              <button
                onClick={() => setCalMonth((p) => (p.m === 0 ? { y: p.y - 1, m: 11 } : { y: p.y, m: p.m - 1 }))}
                className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 transition-colors"
              >
                {isAr ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
              </button>
              <h2 className="text-base sm:text-lg font-black text-slate-900">{monthName}</h2>
              <button
                onClick={() => setCalMonth((p) => (p.m === 11 ? { y: p.y + 1, m: 0 } : { y: p.y, m: p.m + 1 }))}
                className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 transition-colors"
              >
                {isAr ? <ChevronLeft size={18} /> : <ChevronRight size={18} />}
              </button>
            </div>

            <div className="grid grid-cols-7 gap-1 sm:gap-1.5 mb-1">
              {weekdays.map((w) => (
                <div key={w} className="text-center text-[10px] sm:text-xs font-black text-slate-400 py-1">{w}</div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1 sm:gap-1.5">
              {calendarCells.map((date, ci) => {
                if (!date) return <div key={`e${ci}`} className="min-h-[64px] sm:min-h-[88px]" />;
                const dayItems = scheduledByDate.get(date) || [];
                const isToday = date === todayYmd();
                const isPast = date < todayYmd();
                return (
                  <button
                    key={date}
                    onClick={() => setDayPanel(date)}
                    className={`min-h-[64px] sm:min-h-[88px] rounded-xl border p-1.5 sm:p-2 text-start transition-colors flex flex-col gap-1 ${
                      isToday
                        ? "border-emerald-400 bg-emerald-50/50"
                        : dayItems.length
                          ? "border-slate-200 bg-white hover:border-emerald-300"
                          : "border-slate-100 bg-slate-50/50 hover:bg-white hover:border-slate-200"
                    }`}
                  >
                    <span className={`text-[11px] sm:text-xs font-black ${isToday ? "text-emerald-600" : "text-slate-500"}`}>
                      {Number(date.slice(8))}
                    </span>
                    <div className="flex flex-col gap-0.5 overflow-hidden">
                      {dayItems.slice(0, 2).map((it) => (
                        <span
                          key={it.id}
                          dir="auto"
                          className={`truncate text-[9px] sm:text-[10px] font-bold rounded px-1 py-0.5 ${
                            it.status === "posted"
                              ? "bg-slate-900 text-white"
                              : isPast
                                ? "bg-rose-50 text-rose-600"
                                : "bg-emerald-50 text-emerald-700"
                          }`}
                        >
                          {it.title}
                        </span>
                      ))}
                      {dayItems.length > 2 && (
                        <span className="text-[9px] font-black text-slate-400">+{dayItems.length - 2}</span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
            <p className="text-[11px] font-bold text-slate-400 mt-3">
              {isAr
                ? "اضغط على أي يوم لعرض محتواه — انسخ النص، انشره على المنصة، ثم علّمه \"تم نشره\"."
                : "Tap a day to see its content — copy the text, post it on the platform, then mark it \"Posted\"."}
            </p>
          </div>
        )}

        {/* ============================== LIBRARY ============================== */}
        {tab === "library" && (
          <div className="space-y-3">
            <div className="flex items-center gap-1.5 flex-wrap">
              {(["all", "draft", "scheduled", "posted"] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setLibFilter(f)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-black transition-colors ${
                    libFilter === f ? "bg-slate-900 text-white" : "bg-white border border-slate-200 text-slate-500 hover:border-slate-300"
                  }`}
                >
                  {f === "all"
                    ? isAr ? "الكل" : "All"
                    : isAr ? STATUS_META[f].ar : STATUS_META[f].en}
                  {f !== "all" && ` (${items.filter((i) => i.status === f).length})`}
                </button>
              ))}
            </div>

            {loading && (
              <div className="bg-white rounded-3xl border border-slate-200 p-10 text-center">
                <Loader2 size={24} className="mx-auto text-slate-300 animate-spin" />
              </div>
            )}

            {!loading && libItems.length === 0 && (
              <div className="bg-white/60 border border-dashed border-slate-300 rounded-3xl p-10 text-center">
                <FolderOpen size={28} className="mx-auto text-slate-300 mb-3" />
                <p className="text-sm font-black text-slate-500">
                  {isAr ? "لا يوجد محتوى هنا بعد — ابدأ من تبويب الإنشاء" : "Nothing here yet — start from the Create tab"}
                </p>
              </div>
            )}

            {libItems.map((item) => (
              <div key={item.id} className="bg-white rounded-2xl border border-slate-200 p-4">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap mb-1.5">
                      <KindChip kind={item.kind} isAr={isAr} />
                      <StatusChip status={item.status} isAr={isAr} />
                      {item.scheduledDate && (
                        <span className="text-[11px] font-black text-slate-400">{item.scheduledDate}</span>
                      )}
                      {item.channels?.map((c) => {
                        const ch = MARKETING_CHANNELS.find((x) => x.id === c);
                        return ch ? (
                          <span key={c} className="text-[10px] font-bold text-slate-400 bg-slate-50 border border-slate-100 rounded px-1.5 py-0.5">
                            {isAr ? ch.ar : ch.en}
                          </span>
                        ) : null;
                      })}
                    </div>
                    <p dir="auto" className="text-sm font-black text-slate-800 truncate">{item.title}</p>

                    {editingItem === item.id ? (
                      <div className="mt-2 space-y-2">
                        <textarea
                          value={editingBody}
                          onChange={(e) => setEditingBody(e.target.value)}
                          rows={6}
                          dir="auto"
                          className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-sm text-slate-800 leading-relaxed outline-none focus:border-emerald-400 resize-y"
                        />
                        <div className="flex gap-2">
                          <button
                            onClick={async () => {
                              await updateDoc(getClinicDoc("marketing_content", item.id), {
                                body: editingBody,
                                updatedAt: serverTimestamp(),
                              });
                              setEditingItem(null);
                              showToast(isAr ? "تم الحفظ" : "Saved", "success");
                            }}
                            className="px-3 py-1.5 rounded-lg bg-emerald-500 text-white text-xs font-black"
                          >
                            {isAr ? "حفظ" : "Save"}
                          </button>
                          <button
                            onClick={() => setEditingItem(null)}
                            className="px-3 py-1.5 rounded-lg bg-slate-100 text-slate-600 text-xs font-black"
                          >
                            {isAr ? "إلغاء" : "Cancel"}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <p
                        dir="auto"
                        onClick={() => {
                          setEditingItem(item.id);
                          setEditingBody(item.body);
                        }}
                        className="mt-1 text-xs text-slate-500 leading-relaxed line-clamp-3 whitespace-pre-line cursor-text hover:text-slate-700"
                        title={isAr ? "اضغط للتعديل" : "Click to edit"}
                      >
                        {item.body}
                      </p>
                    )}
                  </div>
                  {itemActions(item)}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ============================== PLAYBOOKS ============================== */}
        {tab === "playbooks" && (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {MARKETING_PLAYBOOKS.map((pb) => (
              <button
                key={pb.id}
                onClick={() => openPlaybook(pb.id)}
                className="bg-white rounded-3xl border border-slate-200 hover:border-emerald-300 p-5 text-start transition-colors group"
              >
                <div className="w-10 h-10 bg-emerald-50 text-emerald-600 rounded-2xl flex items-center justify-center mb-3 group-hover:bg-emerald-500 group-hover:text-white transition-colors">
                  <BookOpen size={18} />
                </div>
                <h3 className="text-sm font-black text-slate-900 mb-1">{isAr ? pb.ar : pb.en}</h3>
                <p className="text-xs font-bold text-slate-400 leading-relaxed">{isAr ? pb.descAr : pb.descEn}</p>
                <p className="text-[11px] font-black text-emerald-600 mt-3">
                  {isAr
                    ? `شهر كامل بضغطة واحدة (${MARKETING_CREDIT_COST.month} أرصدة)`
                    : `A full month in one click (${MARKETING_CREDIT_COST.month} credits)`}
                </p>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ============================== MODALS ============================== */}

      {/* Voice setup wizard — forced on first visit, reopenable from the header */}
      {(wizardForced || wizardOpen) && portalTarget &&
        createPortal(
          <div className="fixed inset-0 z-[310] bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4" dir={isAr ? "rtl" : "ltr"}>
            <div className="bg-white rounded-3xl shadow-2xl w-full max-w-xl max-h-[90vh] flex flex-col">
              <div className="p-5 sm:p-6 border-b border-slate-100">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-emerald-500 text-white rounded-2xl flex items-center justify-center">
                      <Sparkles size={18} />
                    </div>
                    <div>
                      <h3 className="text-base font-black text-slate-900">
                        {isAr ? "علّم الذكاء الاصطناعي صوت عيادتك" : "Teach the AI your clinic's voice"}
                      </h3>
                      <p className="text-xs font-bold text-slate-400">
                        {isAr ? "٣ خطوات — دقيقتان — وكل محتوى بعدها يشبهكم" : "3 steps — 2 minutes — then everything sounds like you"}
                      </p>
                    </div>
                  </div>
                  {!wizardForced && (
                    <button onClick={() => setWizardOpen(false)} className="p-1.5 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500">
                      <X size={16} />
                    </button>
                  )}
                </div>
                <div className="flex gap-1.5 mt-4">
                  {[0, 1, 2].map((s) => (
                    <div key={s} className={`h-1.5 flex-1 rounded-full ${s <= wizardStep ? "bg-emerald-500" : "bg-slate-100"}`} />
                  ))}
                </div>
              </div>

              <div className="p-5 sm:p-6 overflow-y-auto space-y-5">
                {wizardStep === 0 && (
                  <>
                    <div>
                      <label className={labelCls}>{isAr ? "كيف تحبون الكلام مع جمهوركم؟" : "How do you talk to your audience?"}</label>
                      <div className="space-y-1.5">
                        {VOICE_FORMALITY.map((o) => (
                          <button
                            key={o.id}
                            onClick={() => setWForm((p) => ({ ...p, formality: o.id as MarketingVoiceProfile["formality"] }))}
                            className={`w-full text-start px-4 py-3 rounded-xl border text-sm font-bold transition-colors ${
                              wForm.formality === o.id ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-600 border-slate-200 hover:border-slate-300"
                            }`}
                          >
                            {isAr ? o.ar : o.en}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <label className={labelCls}>{isAr ? "الإيموجي؟" : "Emojis?"}</label>
                      <div className="space-y-1.5">
                        {VOICE_EMOJI.map((o) => (
                          <button
                            key={o.id}
                            onClick={() => setWForm((p) => ({ ...p, emojiLevel: o.id as MarketingVoiceProfile["emojiLevel"] }))}
                            className={`w-full text-start px-4 py-3 rounded-xl border text-sm font-bold transition-colors ${
                              wForm.emojiLevel === o.id ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-600 border-slate-200 hover:border-slate-300"
                            }`}
                          >
                            {isAr ? o.ar : o.en}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <label className={labelCls}>{isAr ? "الأسعار في المنشورات؟" : "Prices in your posts?"}</label>
                      <div className="space-y-1.5">
                        {VOICE_PRICE.map((o) => (
                          <button
                            key={o.id}
                            onClick={() => setWForm((p) => ({ ...p, pricePolicy: o.id as MarketingVoiceProfile["pricePolicy"] }))}
                            className={`w-full text-start px-4 py-3 rounded-xl border text-sm font-bold transition-colors ${
                              wForm.pricePolicy === o.id ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-600 border-slate-200 hover:border-slate-300"
                            }`}
                          >
                            {isAr ? o.ar : o.en}
                          </button>
                        ))}
                      </div>
                    </div>
                  </>
                )}

                {wizardStep === 1 && (
                  <>
                    <div>
                      <label className={labelCls}>
                        {isAr ? "جمل مميزة تحبون تكرارها (اختياري)" : "Signature phrases you love to repeat (optional)"}
                      </label>
                      <input
                        value={wForm.signaturePhrases}
                        onChange={(e) => setWForm((p) => ({ ...p, signaturePhrases: e.target.value }))}
                        dir="auto"
                        maxLength={300}
                        placeholder={isAr ? "مثال: ابتسامتك تستاهل ✨" : "e.g. Your smile deserves it ✨"}
                        className={selectCls}
                      />
                    </div>
                    <div>
                      <label className={labelCls}>
                        {isAr ? "حاجات دايماً تستاهل الذكر (اختياري)" : "Things always worth mentioning (optional)"}
                      </label>
                      <input
                        value={wForm.alwaysMention}
                        onChange={(e) => setWForm((p) => ({ ...p, alwaysMention: e.target.value }))}
                        dir="auto"
                        maxLength={300}
                        placeholder={isAr ? "مثال: مفتوحين لـ ١١ مساءً — يوجد قسم سيدات" : "e.g. Open till 11pm — ladies' section available"}
                        className={selectCls}
                      />
                    </div>
                    <div>
                      <label className={labelCls}>
                        {isAr ? "كلمات ممنوعة نهائياً (اختياري)" : "Words we never use (optional)"}
                      </label>
                      <input
                        value={wForm.bannedWords}
                        onChange={(e) => setWForm((p) => ({ ...p, bannedWords: e.target.value }))}
                        dir="auto"
                        maxLength={300}
                        placeholder={isAr ? "مثال: رخيص، مضمون ١٠٠٪" : "e.g. cheap, 100% guaranteed"}
                        className={selectCls}
                      />
                    </div>
                  </>
                )}

                {wizardStep === 2 && (
                  <>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className={labelCls}>{isAr ? "اللغة الافتراضية للمحتوى" : "Default content language"}</label>
                        <select
                          value={wForm.defaultLanguage}
                          onChange={(e) => setWForm((p) => ({ ...p, defaultLanguage: e.target.value as MarketingLanguage }))}
                          className={selectCls}
                        >
                          <option value="ar">{isAr ? "عربي (مصري)" : "Arabic (Egyptian)"}</option>
                          <option value="en">{isAr ? "إنجليزي" : "English"}</option>
                        </select>
                      </div>
                      <div>
                        <label className={labelCls}>{isAr ? "الأسلوب الافتراضي" : "Default tone"}</label>
                        <select
                          value={wForm.defaultTone}
                          onChange={(e) => setWForm((p) => ({ ...p, defaultTone: e.target.value }))}
                          className={selectCls}
                        >
                          {MARKETING_TONES.map((t) => (
                            <option key={t.id} value={t.id}>{isAr ? t.ar : t.en}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <div>
                      <label className={labelCls}>
                        {isAr ? "أهم الخدمات اللي عايزين تسوقوا لها (اختياري)" : "The services you most want to market (optional)"}
                      </label>
                      {services.length === 0 ? (
                        <p className="text-xs font-bold text-slate-400">
                          {isAr ? "لا توجد خدمات مسجلة بعد — أضفها من الإعدادات ← الخدمات والأسعار" : "No services registered yet — add them in Settings → Services & Prices"}
                        </p>
                      ) : (
                        <div className="flex gap-1.5 flex-wrap max-h-40 overflow-y-auto">
                          {services.map((s) => {
                            const active = wForm.focusServices?.includes(s);
                            return (
                              <button
                                key={s}
                                onClick={() =>
                                  setWForm((p) => ({
                                    ...p,
                                    focusServices: active
                                      ? (p.focusServices || []).filter((x) => x !== s)
                                      : [...(p.focusServices || []), s].slice(0, 6),
                                  }))
                                }
                                className={`px-3 py-1.5 rounded-xl text-xs font-black border transition-colors ${
                                  active ? "bg-emerald-500 text-white border-emerald-500" : "bg-white text-slate-500 border-slate-200 hover:border-emerald-300"
                                }`}
                              >
                                {s}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                    <div className="bg-emerald-50/60 border border-emerald-100 rounded-xl p-3.5">
                      <p className="text-xs font-bold text-emerald-800 leading-relaxed">
                        {isAr
                          ? "💡 وسيستمر التعلم تلقائياً: كل ما تختار صياغة وتعدلها وتعلّم منشوراً ناجحاً بالنجمة ⭐، يفهم الذكاء الاصطناعي أسلوبكم أكثر."
                          : "💡 Learning continues automatically: every option you pick, edit you make, and post you star ⭐ teaches the AI more of your style."}
                      </p>
                    </div>
                  </>
                )}
              </div>

              <div className="p-5 sm:p-6 border-t border-slate-100 flex items-center gap-2">
                {wizardStep > 0 ? (
                  <button
                    onClick={() => setWizardStep((s) => s - 1)}
                    className="px-4 py-3 rounded-2xl bg-slate-100 hover:bg-slate-200 text-slate-600 font-black text-sm transition-colors"
                  >
                    {isAr ? "رجوع" : "Back"}
                  </button>
                ) : wizardForced ? (
                  <button
                    onClick={() => saveVoice(true)}
                    disabled={wizardSaving}
                    className="px-4 py-3 rounded-2xl text-slate-400 hover:text-slate-600 font-black text-sm transition-colors"
                  >
                    {isAr ? "لاحقاً" : "Later"}
                  </button>
                ) : null}
                <div className="flex-1" />
                {wizardStep < 2 ? (
                  <button
                    onClick={() => setWizardStep((s) => s + 1)}
                    className="px-6 py-3 rounded-2xl bg-slate-900 hover:bg-emerald-600 text-white font-black text-sm transition-colors"
                  >
                    {isAr ? "التالي" : "Next"}
                  </button>
                ) : (
                  <button
                    onClick={() => saveVoice(false)}
                    disabled={wizardSaving}
                    className="flex items-center gap-2 px-6 py-3 rounded-2xl bg-emerald-500 hover:bg-emerald-600 text-white font-black text-sm transition-colors disabled:opacity-60"
                  >
                    {wizardSaving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                    {isAr ? "حفظ صوت العيادة" : "Save clinic voice"}
                  </button>
                )}
              </div>
            </div>
          </div>,
          portalTarget
        )}

      {/* Video-review interview questions */}
      {interviewFor && portalTarget &&
        createPortal(
          <div className="fixed inset-0 z-[320] bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4" dir={isAr ? "rtl" : "ltr"}>
            <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md p-5">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-base font-black text-slate-900">
                  {isAr ? `🎥 فيديو تقييم — ${interviewFor.patientName}` : `🎥 Video review — ${interviewFor.patientName}`}
                </h3>
                <button onClick={() => setInterviewFor(null)} className="p-1.5 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500">
                  <X size={16} />
                </button>
              </div>
              <p className="text-xs font-bold text-slate-500 leading-relaxed mb-3">
                {isAr
                  ? "المريض أعطى ٥ نجوم — أفضل لحظة تطلب فيها فيديو قصير. صوّر بالموبايل عمودياً، واسأل الأسئلة دي واحداً واحداً، وسيب المريض يرد بكلامه هو (ممنوع تلقينه):"
                  : "They gave 5 stars — the perfect moment to ask for a short video. Film vertical on a phone, ask these one by one, and let the patient answer in their own words (never script them):"}
              </p>
              <ol className="space-y-2 mb-4">
                {INTERVIEW_QUESTIONS.map((q, i) => (
                  <li key={i} className="flex gap-2 text-sm font-bold text-slate-700 bg-slate-50 border border-slate-100 rounded-xl px-3.5 py-2.5">
                    <span className="font-black text-violet-500">{i + 1}.</span> {q}
                  </li>
                ))}
              </ol>
              <button
                onClick={() => copyText("interview", INTERVIEW_QUESTIONS.map((q, i) => `${i + 1}. ${q}`).join("\n"))}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl bg-slate-900 hover:bg-violet-600 text-white font-black text-sm transition-colors"
              >
                {copiedKey === "interview" ? <Check size={15} /> : <Copy size={15} />}
                {isAr ? "نسخ الأسئلة (ابعتها لمن سيصوّر)" : "Copy questions (send to whoever films)"}
              </button>
            </div>
          </div>,
          portalTarget
        )}

      {/* Brand kit modal */}
      {brandOpen && portalTarget &&
        createPortal(
          <div className="fixed inset-0 z-[310] bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4" dir={isAr ? "rtl" : "ltr"}>
            <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col">
              <div className="flex items-center justify-between p-5 border-b border-slate-100">
                <div>
                  <h3 className="text-base font-black text-slate-900">{isAr ? "هوية العيادة" : "Brand kit"}</h3>
                  <p className="text-[11px] font-bold text-slate-400">
                    {isAr ? "كل تصميم يخرج بهذه الهوية تلقائياً" : "Every design comes out in this identity automatically"}
                  </p>
                </div>
                <button onClick={() => setBrandOpen(false)} className="p-1.5 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500">
                  <X size={16} />
                </button>
              </div>

              <div className="p-5 overflow-y-auto space-y-5">
                <div>
                  <label className={labelCls}>{isAr ? "أي شكل يشبه عيادتك؟" : "Which look feels like your clinic?"}</label>
                  <div className="space-y-2">
                    {MARKETING_THEMES.map((t) => (
                      <button
                        key={t.id}
                        onClick={() => void saveBrand({ theme: t.id })}
                        className={`w-full flex items-center gap-3.5 p-3.5 rounded-2xl border text-start transition-colors ${
                          brand.theme === t.id ? "border-emerald-400 ring-1 ring-emerald-200 bg-emerald-50/40" : "border-slate-200 hover:border-slate-300"
                        }`}
                      >
                        {/* Mini style preview — pointing beats describing. */}
                        <div
                          className="w-16 h-16 rounded-xl shrink-0 flex flex-col justify-between p-2"
                          style={{ background: t.ground, border: "1px solid #e2e8f0" }}
                        >
                          <div className="h-1.5 rounded-full" style={{ background: t.accent, width: "60%" }} />
                          <div className="space-y-1">
                            <div className="h-1 rounded-full" style={{ background: t.ink, opacity: 0.85, width: "90%" }} />
                            <div className="h-1 rounded-full" style={{ background: t.ink, opacity: 0.4, width: "70%" }} />
                          </div>
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-black text-slate-900">{isAr ? t.ar : t.en}</p>
                          <p className="text-[11px] font-bold text-slate-400 leading-relaxed">{isAr ? t.descAr : t.descEn}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex items-center justify-between gap-3">
                  <div>
                    <label className={labelCls}>{isAr ? "لون العلامة (اختياري)" : "Brand color (optional)"}</label>
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        value={brand.accent || MARKETING_THEMES.find((t) => t.id === brand.theme)?.accent || "#10b981"}
                        onChange={(e) => void saveBrand({ accent: e.target.value })}
                        className="w-10 h-10 rounded-xl border border-slate-200 cursor-pointer"
                      />
                      {brand.accent && (
                        <button
                          onClick={() => void saveBrand({ accent: "" })}
                          className="text-[11px] font-black text-slate-400 hover:text-slate-600"
                        >
                          {isAr ? "استخدم لون الثيم" : "Use theme color"}
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="text-end">
                    <label className={labelCls}>{isAr ? "رقم الهاتف على التصاميم" : "Phone on designs"}</label>
                    <button
                      onClick={() => void saveBrand({ showPhone: brand.showPhone === false })}
                      className={`w-11 h-6 rounded-full transition-colors relative ${
                        brand.showPhone !== false ? "bg-emerald-500" : "bg-slate-200"
                      }`}
                    >
                      <div
                        className={`w-5 h-5 bg-white rounded-full absolute top-0.5 shadow transition-transform ${
                          brand.showPhone !== false ? "translate-x-5 rtl:-translate-x-5" : "translate-x-0.5 rtl:-translate-x-0.5"
                        }`}
                      />
                    </button>
                  </div>
                </div>

                {/* Marketing logo — ideally the white/transparent version that sits on photos. */}
                <div>
                  <label className={labelCls}>{isAr ? "لوجو التسويق (يفضَّل نسخة بيضاء بخلفية شفافة)" : "Marketing logo (ideally white on transparent)"}</label>
                  <div className="flex items-center gap-3">
                    {brand.logoDataUrl ? (
                      <div className="w-16 h-16 rounded-xl bg-slate-800 flex items-center justify-center p-1.5 shrink-0">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={brand.logoDataUrl} alt="logo" className="max-w-full max-h-full object-contain" />
                      </div>
                    ) : null}
                    <label className="px-3.5 py-2.5 rounded-xl bg-slate-900 hover:bg-emerald-600 text-white text-xs font-black cursor-pointer transition-colors">
                      {brand.logoDataUrl ? (isAr ? "تغيير اللوجو" : "Change logo") : isAr ? "رفع اللوجو" : "Upload logo"}
                      <input
                        type="file"
                        accept="image/png,image/webp,image/jpeg,image/svg+xml"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          const url = URL.createObjectURL(file);
                          const img = new Image();
                          img.onload = () => {
                            URL.revokeObjectURL(url);

                            /**
                             * Auto background removal: logos usually arrive on a solid box
                             * (the user's arrived on a dark square). If all four corners agree
                             * on one opaque color, that color becomes transparent, with a soft
                             * edge. Photos and already-transparent PNGs are left untouched.
                             */
                            const stripBackground = (canvas: HTMLCanvasElement) => {
                              const ctx = canvas.getContext("2d");
                              if (!ctx) return;
                              const { width, height } = canvas;
                              const image = ctx.getImageData(0, 0, width, height);
                              const px = image.data;
                              const corner = (x: number, y: number) => {
                                const i = (y * width + x) * 4;
                                return [px[i], px[i + 1], px[i + 2], px[i + 3]];
                              };
                              const corners = [corner(0, 0), corner(width - 1, 0), corner(0, height - 1), corner(width - 1, height - 1)];
                              if (corners.some((c) => c[3] < 250)) return; // already transparent
                              const avg = [0, 1, 2].map((c) => corners.reduce((s, k) => s + k[c], 0) / 4);
                              const spread =
                                corners.reduce((s, k) => s + Math.hypot(k[0] - avg[0], k[1] - avg[1], k[2] - avg[2]), 0) / 4;
                              if (spread > 30) return; // corners disagree — not a solid background
                              const tol = 72;
                              const soft = 32;
                              for (let i = 0; i < px.length; i += 4) {
                                const d = Math.hypot(px[i] - avg[0], px[i + 1] - avg[1], px[i + 2] - avg[2]);
                                if (d < tol - soft) px[i + 3] = 0;
                                else if (d < tol) px[i + 3] = Math.round(px[i + 3] * ((d - (tol - soft)) / soft));
                              }
                              ctx.putImageData(image, 0, 0);
                            };

                            // PNG output keeps transparency; shrink until it fits a Firestore doc comfortably.
                            let dim = 512;
                            let out = "";
                            do {
                              const scale = Math.min(1, dim / Math.max(img.width, img.height));
                              const canvas = document.createElement("canvas");
                              canvas.width = Math.max(1, Math.round(img.width * scale));
                              canvas.height = Math.max(1, Math.round(img.height * scale));
                              canvas.getContext("2d")?.drawImage(img, 0, 0, canvas.width, canvas.height);
                              stripBackground(canvas);
                              out = canvas.toDataURL("image/png");
                              dim = Math.round(dim / 2);
                            } while (out.length > 280 * 1024 && dim >= 64);
                            void saveBrand({ logoDataUrl: out });
                          };
                          img.onerror = () => showToast(isAr ? "تعذر قراءة الملف" : "Could not read that file", "error");
                          img.src = url;
                          e.target.value = "";
                        }}
                      />
                    </label>
                    {brand.logoDataUrl && (
                      <button
                        onClick={() => void saveBrand({ logoDataUrl: "" })}
                        className="text-[11px] font-black text-slate-400 hover:text-rose-500"
                      >
                        {isAr ? "إزالة" : "Remove"}
                      </button>
                    )}
                  </div>
                  {brand.logoDataUrl && (
                    <button
                      disabled={logoAiBusy}
                      onClick={async () => {
                        setLogoAiBusy(true);
                        try {
                          // Real segmentation for textured backgrounds the color trick can't
                          // touch. Runs entirely in the browser; the first use downloads the
                          // model (~30-60s), after that it's seconds.
                          const { removeBackground } = await import("@imgly/background-removal");
                          const blob = await removeBackground(brand.logoDataUrl!);
                          const dataUrl = await new Promise<string>((resolve, reject) => {
                            const r = new FileReader();
                            r.onload = () => resolve(String(r.result));
                            r.onerror = reject;
                            r.readAsDataURL(blob);
                          });
                          // Shrink if the cut-out came back too heavy for the settings doc.
                          const img = new Image();
                          img.onload = () => {
                            let dim = 512;
                            let out = dataUrl;
                            while (out.length > 280 * 1024 && dim >= 64) {
                              const scale = Math.min(1, dim / Math.max(img.width, img.height));
                              const canvas = document.createElement("canvas");
                              canvas.width = Math.max(1, Math.round(img.width * scale));
                              canvas.height = Math.max(1, Math.round(img.height * scale));
                              canvas.getContext("2d")?.drawImage(img, 0, 0, canvas.width, canvas.height);
                              out = canvas.toDataURL("image/png");
                              dim = Math.round(dim / 2);
                            }
                            void saveBrand({ logoDataUrl: out });
                            showToast(isAr ? "تمت إزالة الخلفية ✅" : "Background removed ✅", "success");
                            setLogoAiBusy(false);
                          };
                          img.onerror = () => setLogoAiBusy(false);
                          img.src = dataUrl;
                        } catch (e) {
                          console.error("bg removal failed", e);
                          showToast(isAr ? "تعذرت إزالة الخلفية — جرّب ملف PNG شفاف من المصمم" : "Background removal failed — try the designer's transparent PNG", "error");
                          setLogoAiBusy(false);
                        }
                      }}
                      className="mt-2 flex items-center gap-1.5 px-3 py-2 rounded-xl bg-violet-50 hover:bg-violet-100 text-violet-700 text-xs font-black transition-colors disabled:opacity-60"
                    >
                      {logoAiBusy ? <Loader2 size={13} className="animate-spin" /> : <Wand2 size={13} />}
                      {logoAiBusy
                        ? isAr ? "جارٍ الإزالة… أول مرة تأخذ حتى دقيقة" : "Removing… first time takes up to a minute"
                        : isAr ? "إزالة الخلفية بالذكاء الاصطناعي" : "Remove background (AI)"}
                    </button>
                  )}
                  {!brand.logoDataUrl && !profileLite.logoUrl && (
                    <p className="text-[11px] font-bold text-amber-700 bg-amber-50 border border-amber-100 rounded-xl px-3.5 py-2.5 mt-2">
                      {isAr
                        ? "بدون لوجو سيظهر اسم العيادة نصاً على التصاميم."
                        : "Without a logo, the clinic name appears as text on designs."}
                    </p>
                  )}
                </div>

                <button
                  onClick={() => setBrandOpen(false)}
                  disabled={brandSaving}
                  className="w-full py-3 rounded-2xl bg-slate-900 hover:bg-emerald-600 text-white font-black text-sm transition-colors"
                >
                  {isAr ? "تم" : "Done"}
                </button>
              </div>
            </div>
          </div>,
          portalTarget
        )}

      {/* Design studio */}
      {designItem && (
        <DesignStudio
          item={designItem}
          brand={brand}
          clinicName={profileLite.clinicName || clinic?.name || ""}
          phone={profileLite.phone}
          logoUrl={brand.logoDataUrl || profileLite.logoUrl}
          isAr={isAr}
          onClose={() => setDesignItem(null)}
        />
      )}

      {/* Schedule modal */}
      {scheduleTarget && portalTarget &&
        createPortal(
          <div className="fixed inset-0 z-[300] bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4" dir={isAr ? "rtl" : "ltr"}>
            <div className="bg-white rounded-3xl shadow-2xl w-full max-w-sm p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-base font-black text-slate-900">{isAr ? "جدولة النشر" : "Schedule post"}</h3>
                <button onClick={() => setScheduleTarget(null)} className="p-1.5 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500">
                  <X size={16} />
                </button>
              </div>
              <label className={labelCls}>{isAr ? "تاريخ النشر" : "Posting date"}</label>
              <input
                type="date"
                value={scheduleDate}
                min={todayYmd()}
                onChange={(e) => setScheduleDate(e.target.value)}
                className={`${selectCls} mb-4`}
              />
              <label className={labelCls}>{isAr ? "المنصات" : "Channels"}</label>
              <div className="flex gap-1.5 flex-wrap mb-5">
                {MARKETING_CHANNELS.map((ch) => {
                  const active = scheduleChannels.includes(ch.id);
                  return (
                    <button
                      key={ch.id}
                      onClick={() =>
                        setScheduleChannels((p) => (active ? p.filter((x) => x !== ch.id) : [...p, ch.id]))
                      }
                      className={`px-3 py-2 rounded-xl text-xs font-black border transition-colors ${
                        active ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-500 border-slate-200"
                      }`}
                    >
                      {isAr ? ch.ar : ch.en}
                    </button>
                  );
                })}
              </div>
              <button
                onClick={confirmSchedule}
                disabled={scheduling || !scheduleDate || scheduleChannels.length === 0}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl bg-emerald-500 hover:bg-emerald-600 text-white font-black text-sm transition-colors disabled:opacity-50"
              >
                {scheduling ? <Loader2 size={16} className="animate-spin" /> : <CalendarPlus size={16} />}
                {isAr ? "تأكيد الجدولة" : "Confirm schedule"}
              </button>
            </div>
          </div>,
          portalTarget
        )}

      {/* Day panel */}
      {dayPanel && portalTarget &&
        createPortal(
          <div className="fixed inset-0 z-[300] bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4" dir={isAr ? "rtl" : "ltr"}>
            <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col">
              <div className="flex items-center justify-between p-5 border-b border-slate-100">
                <h3 className="text-base font-black text-slate-900">
                  {new Date(dayPanel + "T00:00:00").toLocaleDateString(isAr ? "ar-EG" : "en-US", {
                    weekday: "long", day: "numeric", month: "long",
                  })}
                </h3>
                <button onClick={() => setDayPanel(null)} className="p-1.5 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500">
                  <X size={16} />
                </button>
              </div>
              <div className="p-5 overflow-y-auto space-y-3">
                {(scheduledByDate.get(dayPanel) || []).length === 0 && (
                  <p className="text-sm font-bold text-slate-400 text-center py-6">
                    {isAr ? "لا يوجد محتوى مجدول لهذا اليوم" : "Nothing scheduled for this day"}
                  </p>
                )}
                {(scheduledByDate.get(dayPanel) || []).map((item) => (
                  <div key={item.id} className="border border-slate-200 rounded-2xl p-4">
                    <div className="flex items-center gap-2 flex-wrap mb-2">
                      <KindChip kind={item.kind} isAr={isAr} />
                      <StatusChip status={item.status} isAr={isAr} />
                      <span dir="auto" className="text-sm font-black text-slate-800">{item.title}</span>
                    </div>
                    <p dir="auto" className="text-xs text-slate-600 leading-relaxed whitespace-pre-line mb-2">{item.body}</p>
                    {item.hashtags && item.hashtags.length > 0 && (
                      <p dir="auto" className="text-xs font-bold text-sky-600 mb-2">{item.hashtags.join(" ")}</p>
                    )}
                    {item.scenes && item.scenes.length > 0 && (
                      <div className="bg-violet-50/60 border border-violet-100 rounded-xl p-3 mb-2">
                        <div className="flex items-center gap-1.5 text-violet-700 text-xs font-black mb-1.5">
                          <Film size={12} /> {isAr ? "سيناريو التصوير" : "Filming script"}
                        </div>
                        <ol className="space-y-1">
                          {item.scenes.map((s, si) => (
                            <li key={si} dir="auto" className="text-[11px] text-slate-700">{si + 1}. {s}</li>
                          ))}
                        </ol>
                      </div>
                    )}
                    {itemActions(item)}
                  </div>
                ))}
              </div>
            </div>
          </div>,
          portalTarget
        )}

      {/* Playbook modal */}
      {pbOpen && portalTarget &&
        createPortal(
          <div className="fixed inset-0 z-[300] bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4" dir={isAr ? "rtl" : "ltr"}>
            <div className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl max-h-[88vh] flex flex-col">
              <div className="flex items-center justify-between p-5 border-b border-slate-100">
                <h3 className="text-base font-black text-slate-900">
                  {(() => {
                    const pb = MARKETING_PLAYBOOKS.find((p) => p.id === pbOpen);
                    return pb ? (isAr ? pb.ar : pb.en) : "";
                  })()}
                </h3>
                <button onClick={() => setPbOpen(null)} className="p-1.5 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500">
                  <X size={16} />
                </button>
              </div>

              <div className="p-5 overflow-y-auto">
                {!pbEntries && (
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className={labelCls}>{isAr ? "تاريخ البداية" : "Start date"}</label>
                        <input type="date" value={pbStart} min={todayYmd()} onChange={(e) => setPbStart(e.target.value)} className={selectCls} />
                      </div>
                      <div>
                        <label className={labelCls}>{isAr ? "منشورات في الأسبوع" : "Posts per week"}</label>
                        <select value={pbPerWeek} onChange={(e) => setPbPerWeek(Number(e.target.value))} className={selectCls}>
                          <option value={2}>2</option>
                          <option value={3}>3</option>
                          <option value={4}>4</option>
                        </select>
                      </div>
                      <div>
                        <label className={labelCls}>{isAr ? "لغة المحتوى" : "Content language"}</label>
                        <select value={pbLanguage} onChange={(e) => setPbLanguage(e.target.value as MarketingLanguage)} className={selectCls}>
                          <option value="ar">{isAr ? "عربي (مصري)" : "Arabic (Egyptian)"}</option>
                          <option value="en">{isAr ? "إنجليزي" : "English"}</option>
                        </select>
                      </div>
                      <div>
                        <label className={labelCls}>{isAr ? "الأسلوب" : "Tone"}</label>
                        <select value={pbTone} onChange={(e) => setPbTone(e.target.value)} className={selectCls}>
                          {MARKETING_TONES.map((t) => (
                            <option key={t.id} value={t.id}>{isAr ? t.ar : t.en}</option>
                          ))}
                        </select>
                      </div>
                    </div>

                    {MARKETING_PLAYBOOKS.find((p) => p.id === pbOpen)?.needsService && (
                      <div>
                        <label className={labelCls}>{isAr ? "الخدمة محور الخطة" : "The service to focus on"}</label>
                        <select value={pbService} onChange={(e) => setPbService(e.target.value)} className={selectCls}>
                          <option value="">{isAr ? "— اختر خدمة —" : "— pick a service —"}</option>
                          {services.map((s) => (
                            <option key={s} value={s}>{s}</option>
                          ))}
                        </select>
                      </div>
                    )}

                    <div>
                      <label className={labelCls}>
                        {isAr ? "عرض الشهر (اختياري — بالأرقام لو فيه)" : "The month's offer (optional — with numbers if any)"}
                      </label>
                      <input
                        value={pbOffer}
                        onChange={(e) => setPbOffer(e.target.value)}
                        dir="auto"
                        placeholder={isAr ? "مثال: كشف مجاني مع أي تنظيف خلال الشهر" : "e.g. free checkup with any cleaning this month"}
                        className={selectCls}
                        maxLength={400}
                      />
                    </div>

                    <button
                      onClick={runPlaybook}
                      disabled={pbGenerating || (MARKETING_PLAYBOOKS.find((p) => p.id === pbOpen)?.needsService && !pbService)}
                      className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl bg-slate-900 hover:bg-emerald-600 text-white font-black text-sm transition-colors disabled:opacity-50"
                    >
                      {pbGenerating ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
                      {pbGenerating
                        ? isAr ? "جارٍ كتابة خطة الشهر… قد يستغرق دقيقة" : "Writing the month's plan… may take a minute"
                        : isAr ? `توليد خطة الشهر (${MARKETING_CREDIT_COST.month} أرصدة)` : `Generate the month plan (${MARKETING_CREDIT_COST.month} credits)`}
                    </button>
                  </div>
                )}

                {pbEntries && (
                  <div className="space-y-3">
                    <p className="text-xs font-bold text-slate-500">
                      {isAr
                        ? "راجع الخطة — ألغِ تحديد ما لا يعجبك، ثم أضِف الباقي للتقويم."
                        : "Review the plan — untick what you don't like, then add the rest to the calendar."}
                    </p>
                    {pbEntries.map((entry, i) => (
                      <label key={i} className="flex items-start gap-3 border border-slate-200 rounded-2xl p-3.5 cursor-pointer hover:border-emerald-300 transition-colors">
                        <input
                          type="checkbox"
                          checked={!!pbSelected[i]}
                          onChange={(e) => setPbSelected((p) => ({ ...p, [i]: e.target.checked }))}
                          className="mt-1 w-4 h-4 accent-emerald-500"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap mb-1">
                            <span className="text-[11px] font-black text-slate-400 bg-slate-50 border border-slate-100 rounded px-1.5 py-0.5">
                              {pbStart ? addDaysYmd(pbStart, entry.dayOffset) : `+${entry.dayOffset}`}
                            </span>
                            <KindChip kind={entry.kind} isAr={isAr} />
                            <span dir="auto" className="text-xs font-black text-slate-800">{entry.title}</span>
                          </div>
                          <p dir="auto" className="text-[11px] text-slate-500 leading-relaxed line-clamp-3 whitespace-pre-line">{entry.body}</p>
                        </div>
                      </label>
                    ))}
                    <div className="flex gap-2 pt-2">
                      <button
                        onClick={savePlaybookEntries}
                        disabled={pbSaving || Object.values(pbSelected).every((v) => !v)}
                        className="flex-1 flex items-center justify-center gap-2 py-3 rounded-2xl bg-emerald-500 hover:bg-emerald-600 text-white font-black text-sm transition-colors disabled:opacity-50"
                      >
                        {pbSaving ? <Loader2 size={16} className="animate-spin" /> : <CalendarPlus size={16} />}
                        {isAr
                          ? `إضافة ${Object.values(pbSelected).filter(Boolean).length} للتقويم`
                          : `Add ${Object.values(pbSelected).filter(Boolean).length} to calendar`}
                      </button>
                      <button
                        onClick={() => setPbEntries(null)}
                        className="px-4 py-3 rounded-2xl bg-slate-100 hover:bg-slate-200 text-slate-600 font-black text-sm transition-colors"
                      >
                        {isAr ? "رجوع" : "Back"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>,
          portalTarget
        )}
    </PermissionGuard>
  );
}
