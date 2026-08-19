/**
 * The Marketing studio's shared vocabulary.
 *
 * The generator is a prompt FUNNEL, not a chat box: users pick from these catalogs, and the
 * server assembles a tested prompt from their choices. That is what keeps output quality
 * consistent across clinics and makes every generation cost a predictable number of credits —
 * so the ids here are a contract between the page, the API route, and the prompts. Renaming an
 * id orphans saved content that references it; add new entries instead.
 */

export type MarketingKind = "post" | "reel" | "ad";
export type MarketingStatus = "draft" | "scheduled" | "posted";
export type MarketingChannel = "facebook" | "instagram" | "google_business";
export type MarketingLanguage = "ar" | "en";

/** One saved item in clinics/{clinicId}/marketing_content. */
export type MarketingItem = {
  id: string;
  kind: MarketingKind;
  language: MarketingLanguage;
  goal?: string;
  service?: string;
  occasion?: string;
  tone?: string;
  /** Short internal label shown in lists and on the calendar — not part of the published text. */
  title: string;
  /** Post caption / reel caption / ad primary text. The thing that gets copied out. */
  body: string;
  hashtags?: string[];
  /** Reels: filming directions, one scene per entry ("SHOT: … — SAY: …"). */
  scenes?: string[];
  /** Ads: the Meta creative fields that accompany the primary text. */
  adHeadline?: string;
  adDescription?: string;
  adHooks?: string[];
  status: MarketingStatus;
  /** YYYY-MM-DD. Only meaningful while status is "scheduled" (kept on posted items as history). */
  scheduledDate?: string;
  channels: MarketingChannel[];
  /** Which playbook generated this item, when it came from one. */
  playbook?: string;
  /** The ⭐ "this one worked" mark — starred items teach the AI this clinic's winning voice. */
  starred?: boolean;
  createdAt?: unknown;
  updatedAt?: unknown;
  postedAt?: unknown;
  createdBy?: string;
  createdByName?: string;
};

/** One AI-generated variant, before the user saves it as an item. */
export type MarketingVariant = {
  title: string;
  body: string;
  hashtags?: string[];
  scenes?: string[];
  adHeadline?: string;
  adDescription?: string;
  adHooks?: string[];
};

/** A planned entry inside a generated month plan. */
export type MarketingPlanEntry = MarketingVariant & {
  /** Days after the plan's start date this entry should be posted. */
  dayOffset: number;
  kind: MarketingKind;
};

type CatalogEntry = { id: string; en: string; ar: string };

export const MARKETING_GOALS: CatalogEntry[] = [
  { id: "offer", en: "Announce an offer", ar: "الإعلان عن عرض" },
  { id: "education", en: "Educate patients", ar: "توعية المرضى" },
  { id: "awareness", en: "Present a service", ar: "التعريف بخدمة" },
  { id: "trust", en: "Build trust in the clinic", ar: "بناء الثقة في العيادة" },
  { id: "engagement", en: "Question / engagement", ar: "سؤال وتفاعل" },
  { id: "occasion", en: "Occasion greeting", ar: "تهنئة بمناسبة" },
];

export const MARKETING_OCCASIONS: CatalogEntry[] = [
  { id: "", en: "No occasion", ar: "بدون مناسبة" },
  { id: "ramadan", en: "Ramadan", ar: "شهر رمضان" },
  { id: "eid_fitr", en: "Eid al-Fitr", ar: "عيد الفطر" },
  { id: "eid_adha", en: "Eid al-Adha", ar: "عيد الأضحى" },
  { id: "mothers_day", en: "Mother's Day", ar: "عيد الأم" },
  { id: "back_to_school", en: "Back to school", ar: "العودة للمدارس" },
  { id: "new_year", en: "New year", ar: "رأس السنة" },
  { id: "wedding_season", en: "Wedding season", ar: "موسم الأفراح" },
];

/**
 * Reel formats — the shapes that actually run on clinic pages right now, straight from the
 * user's market survey (2026-08): talking dentist, clinic tour, patient interview,
 * transformation. "auto" keeps the old behavior: the model picks what fits the goal.
 */
export const REEL_FORMATS: CatalogEntry[] = [
  { id: "auto", en: "Let the AI choose", ar: "خلّي الذكاء يختار" },
  { id: "dentist_talk", en: "Dentist to camera", ar: "الطبيب يتكلم للكاميرا" },
  { id: "clinic_tour", en: "Clinic tour", ar: "جولة في العيادة" },
  { id: "patient_interview", en: "Patient review interview", ar: "مقابلة تقييم مريض" },
  { id: "transformation", en: "Before/after transformation", ar: "تحوّل قبل / بعد" },
];

export const MARKETING_TONES: CatalogEntry[] = [
  { id: "friendly", en: "Friendly & warm", ar: "ودّي وقريب" },
  { id: "professional", en: "Professional & calm", ar: "احترافي وهادئ" },
  { id: "luxury", en: "Premium & elegant", ar: "راقي وفاخر" },
  { id: "playful", en: "Light & playful", ar: "خفيف ومرح" },
];

export type MarketingPlaybook = CatalogEntry & {
  descEn: string;
  descAr: string;
  /** Playbooks focused on one service ask the user to pick it before generating. */
  needsService?: boolean;
};

export const MARKETING_PLAYBOOKS: MarketingPlaybook[] = [
  {
    id: "balanced_month",
    en: "Balanced month",
    ar: "شهر متوازن",
    descEn: "A healthy mix for any month: education, trust, light engagement, and one soft offer.",
    descAr: "مزيج صحي لأي شهر: توعية، بناء ثقة، تفاعل خفيف، وعرض واحد هادئ.",
  },
  {
    id: "new_clinic",
    en: "New clinic opening",
    ar: "افتتاح عيادة جديدة",
    descEn: "Introduce the clinic, the doctors, and the services — built to turn strangers into first visits.",
    descAr: "قدّم العيادة والأطباء والخدمات — مصمم لتحويل الغرباء إلى أول زيارة.",
  },
  {
    id: "ramadan",
    en: "Ramadan plan",
    ar: "خطة رمضان",
    descEn: "Ramadan-timed content: greetings, fasting-friendly dental tips, and an offer for after Iftar hours.",
    descAr: "محتوى بتوقيت رمضان: تهنئة، نصائح أسنان تناسب الصيام، وعرض لمواعيد ما بعد الإفطار.",
  },
  {
    id: "slow_season",
    en: "Slow season recovery",
    ar: "إنعاش الموسم الهادئ",
    descEn: "For quiet weeks: reminders of why checkups matter now, plus a time-limited offer to fill chairs.",
    descAr: "للأسابيع الهادئة: تذكير بأهمية الكشف الآن، مع عرض لفترة محدودة لملء المواعيد.",
  },
  {
    id: "service_push",
    en: "Push one service",
    ar: "التركيز على خدمة",
    descEn: "A focused month around one service you pick — education, proof, objections, then the offer.",
    descAr: "شهر كامل حول خدمة واحدة تختارها — توعية، إثبات، ردود على التردد، ثم العرض.",
    needsService: true,
  },
];

export const MARKETING_CHANNELS: { id: MarketingChannel; en: string; ar: string }[] = [
  { id: "facebook", en: "Facebook", ar: "فيسبوك" },
  { id: "instagram", en: "Instagram", ar: "إنستجرام" },
  { id: "google_business", en: "Google Business", ar: "جوجل بيزنس" },
];

/** Credit cost of each generation mode. Shown in the UI and charged by the API — keep in sync. */
export const MARKETING_CREDIT_COST = { single: 1, month: 5 } as const;

/* ------------------------------------ campaigns ------------------------------------ */

export type CampaignSegment = "dormant" | "unfinished_treatment" | "birthdays";

/** One row in clinics/{clinicId}/marketing_campaigns — written server-side at launch. */
export type MarketingCampaign = {
  id: string;
  name: string;
  /** "reviews" is written only by the nightly review-request automation. */
  segment: CampaignSegment | "reviews";
  /** The template as launched, with {patient_name} / {clinic_name} placeholders intact. */
  body: string;
  recipientCount: number;
  createdAt?: unknown;
  createdBy?: string;
  createdByName?: string;
};

/** A patient the segment scan matched, before the campaign is launched. */
export type CampaignRecipient = {
  patientId: string;
  name: string;
  phone: string;
  /** Human-readable why-they're-on-this-list ("last visit 8 months ago", "plan: 12,000 EGP"). */
  detail?: string;
};

export const CAMPAIGN_SEGMENTS: {
  id: CampaignSegment;
  en: string;
  ar: string;
  descEn: string;
  descAr: string;
}[] = [
  {
    id: "dormant",
    en: "Dormant patients",
    ar: "مرضى منقطعين",
    descEn: "Haven't visited in a long time (your reactivation threshold) and have no upcoming booking.",
    descAr: "لم يزوروا العيادة من فترة طويلة وليس لديهم حجز قادم.",
  },
  {
    id: "unfinished_treatment",
    en: "Unfinished treatment plans",
    ar: "خطط علاج غير مكتملة",
    descEn: "Got a treatment plan (presented or accepted) but have no upcoming appointment — they already said yes once.",
    descAr: "لديهم خطة علاج معروضة أو مقبولة لكن بدون موعد قادم — وافقوا مرة بالفعل.",
  },
  {
    id: "birthdays",
    en: "Birthdays this week",
    ar: "أعياد ميلاد الأسبوع",
    descEn: "Patients whose birthday falls in the next 7 days — a warm wish with a soft offer.",
    descAr: "مرضى عيد ميلادهم خلال ٧ أيام — تهنئة دافئة مع عرض هادئ.",
  },
];

/**
 * Upcoming occasion dates the radar watches (Egypt-centric). Islamic dates are lunar and
 * approximate by a day — fine for content planning, wrong for religious rulings. Extend this
 * table yearly; the radar simply ignores dates in the past.
 */
export const OCCASION_DATES: { id: string; date: string }[] = [
  { id: "back_to_school", date: "2026-09-20" },
  { id: "new_year", date: "2027-01-01" },
  { id: "ramadan", date: "2027-02-08" },
  { id: "eid_fitr", date: "2027-03-10" },
  { id: "mothers_day", date: "2027-03-21" },
  { id: "eid_adha", date: "2027-05-17" },
  { id: "back_to_school", date: "2027-09-20" },
  { id: "new_year", date: "2028-01-01" },
  { id: "ramadan", date: "2028-01-28" },
  { id: "eid_fitr", date: "2028-02-27" },
  { id: "mothers_day", date: "2028-03-21" },
  { id: "eid_adha", date: "2028-05-05" },
];

/* ------------------------------------ brand kit ------------------------------------ */

export type MarketingTheme = "modern" | "luxury" | "basic";

/**
 * The Design tier's visual identity — clinics/{id}/marketing_settings/brand.
 * Deliberately tiny: a theme picked by pointing at examples plus an optional exact brand
 * color. The theme carries the real design decisions (palette, type, shapes) inside the
 * Design Studio's templates, so every export looks professionally made, never "configured".
 */
export type BrandKit = {
  theme: MarketingTheme;
  /** Exact brand color, when the clinic has one. Empty = the theme's own accent. */
  accent?: string;
  showPhone?: boolean;
  showLogo?: boolean;
  updatedAt?: unknown;
  updatedBy?: string;
};

export const MARKETING_THEMES: {
  id: MarketingTheme;
  en: string;
  ar: string;
  descEn: string;
  descAr: string;
  /** Swatches for the picker card — accent / ground / ink. */
  accent: string;
  ground: string;
  ink: string;
}[] = [
  {
    id: "modern",
    en: "Modern",
    ar: "عصري",
    descEn: "Fresh, friendly, energetic — bright color and bold type.",
    descAr: "منعش وودود وحيوي — ألوان مبهجة وخط جريء.",
    accent: "#10b981",
    ground: "#f0fdf9",
    ink: "#0f172a",
  },
  {
    id: "luxury",
    en: "Luxury",
    ar: "فاخر",
    descEn: "Dark, calm, premium — gold details on deep charcoal.",
    descAr: "هادئ وراقي — تفاصيل ذهبية على خلفية داكنة.",
    accent: "#c9a227",
    ground: "#0e1116",
    ink: "#f4efe3",
  },
  {
    id: "basic",
    en: "Basic",
    ar: "بسيط",
    descEn: "Clean and clear — white space, one color, no noise.",
    descAr: "نظيف وواضح — مساحات بيضاء ولون واحد بلا ضوضاء.",
    accent: "#2563eb",
    ground: "#ffffff",
    ink: "#1e293b",
  },
];

/* ------------------------------- clinic voice profile ------------------------------- */

/**
 * How THIS clinic wants to sound — filled once in the setup wizard, injected into every prompt.
 * Lives in clinics/{clinicId}/marketing_settings/voice (its own subcollection, member-writable,
 * so the marketing team can maintain it without needing the Admin-only settings grant).
 *
 * This is Layer 1 of the personalization strategy ("Told"). Layer 2 ("Shown") rides on
 * MarketingItem.starred: starred and posted items are fed back into prompts as style examples.
 */
export type MarketingVoiceProfile = {
  formality: "casual" | "balanced" | "formal";
  emojiLevel: "high" | "medium" | "low";
  pricePolicy: "open" | "offers_only" | "never";
  /** Phrases the clinic loves to close or open with — woven in when they fit. */
  signaturePhrases?: string;
  /** Standing facts worth mentioning when relevant ("open till 11pm", "ladies' section"). */
  alwaysMention?: string;
  /** Words and phrases the clinic never wants to see. */
  bannedWords?: string;
  /** The services the clinic most wants to market — biases playbooks and suggestions. */
  focusServices?: string[];
  defaultLanguage?: MarketingLanguage;
  defaultTone?: string;
  /** True when the wizard was dismissed without finishing — stops it from nagging every open. */
  skipped?: boolean;
  completedAt?: unknown;
  updatedAt?: unknown;
  updatedBy?: string;
};

export const VOICE_FORMALITY: CatalogEntry[] = [
  { id: "casual", en: "Casual & close — like talking to a friend", ar: "قريب وبسيط — كأنك بتكلم صاحبك" },
  { id: "balanced", en: "Balanced — friendly but professional", ar: "متوازن — ودود لكن محترف" },
  { id: "formal", en: "Formal — respectful and reserved", ar: "رسمي — محترم ومتحفظ" },
];

export const VOICE_EMOJI: CatalogEntry[] = [
  { id: "high", en: "We love emojis 😍 use them freely", ar: "بنحب الإيموجي 😍 استخدمها براحتك" },
  { id: "medium", en: "A few well-placed ones", ar: "شوية في مكانهم" },
  { id: "low", en: "Almost none — keep it clean", ar: "تقريباً بدون — نظيف وهادئ" },
];

export const VOICE_PRICE: CatalogEntry[] = [
  { id: "open", en: "Mention prices openly when given", ar: "نذكر الأسعار بوضوح لو متوفرة" },
  { id: "offers_only", en: "Numbers only inside clear offers", ar: "الأرقام في العروض الواضحة فقط" },
  { id: "never", en: "Never mention numbers — invite to ask", ar: "بدون أرقام نهائياً — ادعُ للسؤال" },
];
