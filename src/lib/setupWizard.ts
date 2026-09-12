/**
 * The two-minute setup a brand-new clinic is walked through right after it is created.
 *
 * A fresh clinic starts with nothing: no opening hours, so the calendar offers Friday midnight;
 * no services, so the first invoice has nothing to pick from; no phone, so prescriptions print
 * without one. The welcome guide already lists those as missions, but a mission is something you
 * find later. This is the same three facts asked up front, on one screen each, with "Skip" always
 * on the button — and every step is optional, so the wizard can never trap anyone.
 *
 * Pure data and pure functions, no client imports, so the page, the tests and (one day) the
 * Android app read the same template. The page decides what to write; this file decides what to
 * offer.
 */

export const SETUP_ROUTE = "/setup";

export type SetupStepId = "hours" | "services" | "contact";
export const SETUP_STEPS: SetupStepId[] = ["hours", "services", "contact"];

/**
 * The hours most Egyptian dental clinics keep: an afternoon-to-late-evening day, Friday closed.
 * Stored in the exact shape the Schedule settings screen saves (`settings/clinic_info.schedule`),
 * so the wizard and that screen are two doors into one record.
 */
export const DEFAULT_SCHEDULE = {
  start: "10:00",
  end: "22:00",
  slotDuration: "30",
  offDays: ["Friday"] as string[],
};

/** Day names exactly as the Schedule screen stores them — capitalised English. */
export const WEEK_DAYS = ["Saturday", "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday"] as const;

export interface ServiceTemplate {
  /** Stable id for the checkbox and the tests, never written to Firestore. */
  key: string;
  name: { en: string; ar: string };
  /** EGP. A starting point the clinic edits, not a recommendation. */
  price: number;
  durationMinutes: number;
  requiresLab?: boolean;
  estimatedLabFee?: number;
}

/**
 * A working price list for a general practice in Egypt, priced for 2026. The point is that every
 * name in it is something a receptionist will actually pick on the first day; niche work belongs
 * on the Prices screen later. Lab fees mark the crowns and dentures so the lab board has
 * something to estimate from.
 */
export const SERVICE_TEMPLATES: ServiceTemplate[] = [
  { key: "consult", name: { en: "Consultation", ar: "كشف" }, price: 200, durationMinutes: 20 },
  { key: "scaling", name: { en: "Scaling & Polishing", ar: "تنظيف وتلميع" }, price: 600, durationMinutes: 45 },
  { key: "composite", name: { en: "Composite Filling", ar: "حشو كومبوزيت" }, price: 800, durationMinutes: 45 },
  { key: "pedo-filling", name: { en: "Pediatric Filling", ar: "حشو أطفال" }, price: 600, durationMinutes: 30 },
  { key: "fluoride", name: { en: "Fluoride Application", ar: "فلورايد" }, price: 400, durationMinutes: 20 },
  { key: "rct-anterior", name: { en: "Root Canal — Anterior", ar: "علاج عصب — أمامي" }, price: 2500, durationMinutes: 60 },
  { key: "rct-molar", name: { en: "Root Canal — Molar", ar: "علاج عصب — ضرس" }, price: 3500, durationMinutes: 90 },
  { key: "post-core", name: { en: "Post & Core", ar: "دعامة وقلب" }, price: 1500, durationMinutes: 45 },
  { key: "ext-simple", name: { en: "Extraction — Simple", ar: "خلع بسيط" }, price: 700, durationMinutes: 30 },
  { key: "ext-surgical", name: { en: "Extraction — Surgical", ar: "خلع جراحي" }, price: 2000, durationMinutes: 60 },
  { key: "whitening", name: { en: "Teeth Whitening", ar: "تبييض الأسنان" }, price: 3500, durationMinutes: 60 },
  { key: "pano", name: { en: "Panoramic X-ray", ar: "أشعة بانوراما" }, price: 400, durationMinutes: 15 },
  { key: "ortho-consult", name: { en: "Orthodontic Consultation", ar: "استشارة تقويم" }, price: 300, durationMinutes: 30 },
  { key: "zirconia", name: { en: "Zirconia Crown", ar: "طربوش زركون" }, price: 5000, durationMinutes: 60, requiresLab: true, estimatedLabFee: 1800 },
  { key: "pfm", name: { en: "PFM Crown", ar: "طربوش بورسلين على معدن" }, price: 3000, durationMinutes: 60, requiresLab: true, estimatedLabFee: 1000 },
  { key: "veneer", name: { en: "E-max Veneer", ar: "فينير إيماكس" }, price: 6000, durationMinutes: 60, requiresLab: true, estimatedLabFee: 2000 },
  { key: "implant", name: { en: "Dental Implant (fixture)", ar: "زراعة أسنان (الفيكسشر)" }, price: 15000, durationMinutes: 90 },
  { key: "denture", name: { en: "Complete Denture", ar: "طقم كامل" }, price: 8000, durationMinutes: 60, requiresLab: true, estimatedLabFee: 3000 },
];

export type ServiceChoice = { key: string; price: number; selected: boolean };

/** Every template ticked, at its template price: the wizard's opening state. */
export function initialServiceChoices(): ServiceChoice[] {
  return SERVICE_TEMPLATES.map((t) => ({ key: t.key, price: t.price, selected: true }));
}

/**
 * The service documents to create from the ticked rows.
 *
 * Returns the fields the Prices screen writes for a hand-added service, minus `category` and
 * `icon` — those come from keyword matching that lives in a client module, so the page adds them
 * from the ENGLISH name whichever language the stored name is in. Rows with a zero or nonsense
 * price are dropped rather than written as free.
 */
export function serviceDocsFrom(
  choices: ServiceChoice[],
  language: "en" | "ar"
): Array<{ englishName: string; doc: Record<string, unknown> }> {
  const out: Array<{ englishName: string; doc: Record<string, unknown> }> = [];
  for (const choice of choices) {
    if (!choice.selected) continue;
    const t = SERVICE_TEMPLATES.find((x) => x.key === choice.key);
    if (!t) continue;
    const price = Number(choice.price);
    if (!Number.isFinite(price) || price <= 0) continue;
    out.push({
      englishName: t.name.en,
      doc: {
        name: t.name[language],
        price,
        requiresLab: t.requiresLab === true,
        estimatedLabFee: t.estimatedLabFee ?? 0,
        durationMinutes: t.durationMinutes,
        pricingMode: "per_tooth",
        prices: {},
        createdAt: new Date().toISOString(),
        seededBy: "setup-wizard",
      },
    });
  }
  return out;
}

/** The nested `schedule` object the Schedule screen would save for these choices. */
export function scheduleDocFrom(input: {
  start: string;
  end: string;
  slotDuration: string;
  offDays: string[];
}): Record<string, unknown> {
  return {
    start: input.start,
    end: input.end,
    slotDuration: input.slotDuration,
    offDays: input.offDays.filter((d) => (WEEK_DAYS as readonly string[]).includes(d)),
    configuredAt: new Date().toISOString(),
  };
}

/** Egyptian mobile and landline numbers as people type them; anything else is stored as typed. */
export function normalizePhone(value: string): string {
  const digits = value.replace(/[^\d+]/g, "");
  if (/^01\d{9}$/.test(digits)) return digits;
  if (/^\+201\d{9}$/.test(digits)) return "0" + digits.slice(3);
  if (/^201\d{9}$/.test(digits)) return "0" + digits.slice(2);
  return value.trim();
}
