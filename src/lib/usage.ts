/**
 * Who uses which screen, for how long, and what they press there.
 *
 * The owner's question (2026-11-28): "does anybody use these buttons?" — and nothing in the app
 * could answer it. This is the shared, pure half of the answer; the browser half is
 * components/usage/UsageTracker, the server half is /api/usage/beat and /api/admin/usage.
 *
 * WHAT IS KEPT
 *   One small document per person per clinic per day (`usage_daily`), holding, per screen:
 *   active seconds, times opened, taps, and how often each named control was pressed.
 *   The same beat also adds to one document per person per month (`usage_monthly`) — that is the
 *   summary. Day documents are deleted after RETENTION_DAYS by a nightly job; the month
 *   documents stay, and at one per person per month they cost nothing.
 *
 * WHAT IS NEVER KEPT
 *   Nothing a patient owns. A screen is recorded by its ROUTE, with every id cut out
 *   ("/patients/:id", never the id). A press is recorded only when the control has a fixed name
 *   in the code (`data-track` / `data-tour`), is a tab, or is a link to another screen — never
 *   the text of an ordinary button or row, because rows carry patient names.
 *
 * "Active" means the tab is on screen and the person touched it within the last two minutes. A
 * calendar left open all day on the reception PC is not eight hours of interest.
 */

/** Day documents older than this are deleted. Two months, the owner's figure. */
export const RETENTION_DAYS = 62;

/** How long after the last touch a screen still counts as being used. */
export const IDLE_AFTER_MS = 2 * 60 * 1000;

/** How often the browser sends what it has gathered. */
export const BEAT_EVERY_MS = 60 * 1000;

export const DAILY_COLLECTION = "usage_daily";
export const MONTHLY_COLLECTION = "usage_monthly";

/** Per-screen figures. `phoneSec` is the part of `sec` spent on a screen narrower than lg. */
export type PageUsage = { sec: number; opens: number; taps: number; phoneSec: number };

/** What the browser sends: screen key -> figures, and screen key -> control -> presses. */
export type UsageBeat = {
  pages: Record<string, PageUsage>;
  hits: Record<string, Record<string, number>>;
};

const MAX_PAGES_PER_BEAT = 30;
const MAX_TARGETS_PER_PAGE = 40;
/** A beat covers about a minute; three is the ceiling for a late one. Anything more is noise. */
const MAX_SEC_PER_BEAT = 180;
const MAX_TAPS_PER_BEAT = 2000;
const MAX_OPENS_PER_BEAT = 200;

/**
 * A path segment that is somebody's id rather than a screen name: a Firestore id, a phone number,
 * a uuid, a date. Screen names in this app are short lowercase words with dashes.
 */
function looksLikeId(segment: string): boolean {
  if (/^\d+$/.test(segment)) return true;
  if (/^\d{4}-\d{2}(-\d{2})?$/.test(segment)) return true;
  if (segment.length >= 16) return true;
  // Mixed case or letters-and-digits together: a generated id, not a word somebody typed.
  if (segment.length >= 8 && /[A-Z]/.test(segment) && /[a-z]/.test(segment)) return true;
  if (segment.length >= 8 && /\d/.test(segment) && /[A-Za-z]/.test(segment)) return true;
  return false;
}

/** Field-name safe, short, lowercase. Firestore map keys must not contain dots. */
function clean(value: string, max: number): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9؀-ۿ/:#_\- ]+/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

/**
 * The screen a path stands for, with ids cut out.
 *
 *   "/"                      + view "owner"  -> "home#owner"
 *   "/patients/AbC123xyz…"                   -> "/patients/:id"
 *   "/reports" + ?tab=clinic                 -> "/reports#clinic"
 */
export function pageKeyFor(pathname: string, opts?: { homeView?: string | null; tab?: string | null }): string {
  const path = (pathname || "/").split("?")[0].split("#")[0];
  const segments = path.split("/").filter(Boolean);
  if (segments.length === 0) {
    const view = clean(opts?.homeView || "", 12);
    return view ? `home#${view}` : "home";
  }
  const key = "/" + segments.slice(0, 5).map((s) => (looksLikeId(s) ? ":id" : clean(s, 24) || ":id")).join("/");
  const tab = opts?.tab && !looksLikeId(opts.tab) ? clean(opts.tab, 24) : "";
  return tab ? `${key}#${tab}` : key;
}

/** A link's destination as a control name: "go:/patients/:id". Null for outside links. */
export function linkTargetFor(href: string | null | undefined): string | null {
  if (!href || !href.startsWith("/") || href.startsWith("//")) return null;
  return `go:${pageKeyFor(href)}`;
}

/** A control's name as stored: bounded and key-safe. Empty when nothing usable is left. */
export function targetKey(raw: string): string {
  return clean(raw, 48);
}

function int(value: unknown, max: number): number {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(n, max);
}

/**
 * What the server keeps of a beat. The body comes from a browser, so every key is re-cleaned and
 * every number is clamped: a wrong client can at worst add three minutes to its own name.
 */
export function sanitizeBeat(raw: unknown): UsageBeat {
  const out: UsageBeat = { pages: {}, hits: {} };
  const body = (raw && typeof raw === "object" ? raw : {}) as { pages?: unknown; hits?: unknown };
  const pages = (body.pages && typeof body.pages === "object" ? body.pages : {}) as Record<string, unknown>;
  let secLeft = MAX_SEC_PER_BEAT;

  for (const [rawKey, rawValue] of Object.entries(pages).slice(0, MAX_PAGES_PER_BEAT)) {
    const key = rawKey.startsWith("home") ? clean(rawKey, 20) : pageKeyFor(rawKey.split("#")[0], { tab: rawKey.split("#")[1] });
    if (!key) continue;
    const v = (rawValue && typeof rawValue === "object" ? rawValue : {}) as Record<string, unknown>;
    const sec = Math.min(int(v.sec, MAX_SEC_PER_BEAT), secLeft);
    secLeft -= sec;
    const page: PageUsage = {
      sec,
      opens: int(v.opens, MAX_OPENS_PER_BEAT),
      taps: int(v.taps, MAX_TAPS_PER_BEAT),
      phoneSec: Math.min(int(v.phoneSec, MAX_SEC_PER_BEAT), sec),
    };
    if (page.sec + page.opens + page.taps === 0) continue;
    const prev = out.pages[key];
    out.pages[key] = prev
      ? { sec: prev.sec + page.sec, opens: prev.opens + page.opens, taps: prev.taps + page.taps, phoneSec: prev.phoneSec + page.phoneSec }
      : page;

    const rawHits = (body.hits && typeof body.hits === "object" ? (body.hits as Record<string, unknown>)[rawKey] : null) as Record<string, unknown> | null;
    if (rawHits && typeof rawHits === "object") {
      for (const [t, n] of Object.entries(rawHits).slice(0, MAX_TARGETS_PER_PAGE)) {
        const target = targetKey(t);
        const count = int(n, MAX_TAPS_PER_BEAT);
        if (!target || !count) continue;
        out.hits[key] = out.hits[key] || {};
        out.hits[key][target] = (out.hits[key][target] || 0) + count;
      }
    }
  }
  return out;
}

export function isEmptyBeat(beat: UsageBeat): boolean {
  return Object.keys(beat.pages).length === 0;
}

/** "2026-11-28" in Cairo, where every clinic is: a day there is not a UTC day. */
export function usageDay(at: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

export function dayMinus(day: string, days: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

export function dailyDocId(clinicId: string, uid: string, day: string): string {
  return `${clinicId}__${uid}__${day}`;
}

export function monthlyDocId(clinicId: string, uid: string, month: string): string {
  return `${clinicId}__${uid}__${month}`;
}

/* ------------------------------------------------------------------------------------------ */
/* The report                                                                                  */
/* ------------------------------------------------------------------------------------------ */

/** A stored document, day or month — the two share a shape. */
export type UsageDoc = {
  clinicId: string;
  uid: string;
  name?: string;
  email?: string;
  phone?: string;
  role?: string;
  day?: string;
  month?: string;
  /** Month documents only: the days of the month the person was active. */
  days?: Record<string, boolean>;
  pages?: Record<string, Partial<PageUsage>>;
  hits?: Record<string, Record<string, number>>;
};

export type PageRow = PageUsage & { key: string; people: number; hits: { target: string; count: number }[] };

export type PersonRow = {
  clinicId: string;
  uid: string;
  name: string;
  email: string;
  phone: string;
  role: string;
  sec: number;
  taps: number;
  opens: number;
  phoneSec: number;
  daysActive: number;
  lastDay: string;
  pages: PageRow[];
};

export type UsageReport = { people: PersonRow[]; pages: PageRow[] };

function topHits(hits: Record<string, number> | undefined, limit: number): { target: string; count: number }[] {
  return Object.entries(hits || {})
    .map(([target, count]) => ({ target, count: Number(count) || 0 }))
    .filter((h) => h.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

/**
 * Stored documents -> the two tables the admin reads: people (who, how long, where) and screens
 * (which get used, by how many people). Pure, so it is tested without a database.
 */
export function buildUsageReport(docs: UsageDoc[]): UsageReport {
  type Acc = {
    row: Omit<PersonRow, "pages" | "daysActive">;
    days: Set<string>;
    pages: Map<string, PageUsage>;
    hits: Map<string, Record<string, number>>;
  };
  const people = new Map<string, Acc>();
  const allPages = new Map<string, PageUsage & { people: Set<string>; hits: Record<string, number> }>();

  for (const doc of docs) {
    if (!doc?.clinicId || !doc?.uid) continue;
    const id = `${doc.clinicId}__${doc.uid}`;
    let acc = people.get(id);
    if (!acc) {
      acc = {
        row: { clinicId: doc.clinicId, uid: doc.uid, name: "", email: "", phone: "", role: "", sec: 0, taps: 0, opens: 0, phoneSec: 0, lastDay: "" },
        days: new Set(),
        pages: new Map(),
        hits: new Map(),
      };
      people.set(id, acc);
    }
    // The newest document's name wins: people get renamed and re-roled.
    const stamp = doc.day || (doc.month ? `${doc.month}-99` : "");
    if (stamp >= acc.row.lastDay || !acc.row.name) {
      acc.row.name = doc.name || acc.row.name;
      acc.row.email = doc.email || acc.row.email;
      acc.row.phone = doc.phone || acc.row.phone;
      acc.row.role = doc.role || acc.row.role;
    }
    if (doc.day) {
      acc.days.add(doc.day);
      if (doc.day > acc.row.lastDay) acc.row.lastDay = doc.day;
    }
    if (doc.month && doc.days) {
      for (const d of Object.keys(doc.days)) {
        const day = `${doc.month}-${d.padStart(2, "0")}`;
        acc.days.add(day);
        if (day > acc.row.lastDay) acc.row.lastDay = day;
      }
    }

    for (const [key, raw] of Object.entries(doc.pages || {})) {
      const p: PageUsage = { sec: Number(raw?.sec) || 0, opens: Number(raw?.opens) || 0, taps: Number(raw?.taps) || 0, phoneSec: Number(raw?.phoneSec) || 0 };
      acc.row.sec += p.sec;
      acc.row.taps += p.taps;
      acc.row.opens += p.opens;
      acc.row.phoneSec += p.phoneSec;
      const mine = acc.pages.get(key) || { sec: 0, opens: 0, taps: 0, phoneSec: 0 };
      acc.pages.set(key, { sec: mine.sec + p.sec, opens: mine.opens + p.opens, taps: mine.taps + p.taps, phoneSec: mine.phoneSec + p.phoneSec });
      const all = allPages.get(key) || { sec: 0, opens: 0, taps: 0, phoneSec: 0, people: new Set<string>(), hits: {} };
      all.sec += p.sec;
      all.opens += p.opens;
      all.taps += p.taps;
      all.phoneSec += p.phoneSec;
      all.people.add(id);
      allPages.set(key, all);
    }
    for (const [key, targets] of Object.entries(doc.hits || {})) {
      const mine = acc.hits.get(key) || {};
      const all = allPages.get(key);
      for (const [t, n] of Object.entries(targets || {})) {
        mine[t] = (mine[t] || 0) + (Number(n) || 0);
        if (all) all.hits[t] = (all.hits[t] || 0) + (Number(n) || 0);
      }
      acc.hits.set(key, mine);
    }
  }

  const peopleRows: PersonRow[] = [...people.values()]
    .map((acc) => ({
      ...acc.row,
      daysActive: acc.days.size,
      pages: [...acc.pages.entries()]
        .map(([key, p]) => ({ key, ...p, people: 1, hits: topHits(acc.hits.get(key), 8) }))
        .sort((a, b) => b.sec - a.sec || b.opens - a.opens),
    }))
    .sort((a, b) => b.sec - a.sec);

  const pageRows: PageRow[] = [...allPages.entries()]
    .map(([key, p]) => ({ key, sec: p.sec, opens: p.opens, taps: p.taps, phoneSec: p.phoneSec, people: p.people.size, hits: topHits(p.hits, 8) }))
    .sort((a, b) => b.sec - a.sec || b.opens - a.opens);

  return { people: peopleRows, pages: pageRows };
}

/** "3h 12m", "14m", "40s" — or "3س 12د" in Arabic. Digits stay 0-9 either way. */
export function formatDuration(sec: number, arabic = false): string {
  const [h, m, sUnit] = arabic ? ["س", "د", "ث"] : ["h", "m", "s"];
  // Arabic units are letters that join to whatever follows, so they stand apart from the digits.
  const gap = arabic ? " " : "";
  const s = Math.max(0, Math.round(sec));
  if (s < 60) return `${s}${gap}${sUnit}`;
  const mins = Math.round(s / 60);
  if (mins < 60) return `${mins}${gap}${m}`;
  return `${Math.floor(mins / 60)}${gap}${h} ${String(mins % 60).padStart(2, "0")}${gap}${m}`;
}

/**
 * The screens the app's menus lead to, with the names people know them by. The report lists the
 * ones nobody opened — that list is the answer to "what can we remove".
 */
export const KNOWN_PAGES: { key: string; label: string; ar: string }[] = [
  { key: "home#owner", label: "Home · Owner view", ar: "الرئيسية · شاشة المالك" },
  { key: "home#desk", label: "Home · Appointments view", ar: "الرئيسية · شاشة المواعيد" },
  { key: "home#chair", label: "Home · Dentist view", ar: "الرئيسية · شاشة الدكتور" },
  { key: "/appointments", label: "Appointments page", ar: "صفحة المواعيد" },
  { key: "/patients", label: "Patients list", ar: "سجل المرضى" },
  { key: "/patients/:id", label: "Patient file", ar: "ملف المريض" },
  { key: "/finance", label: "Finance", ar: "الحسابات" },
  { key: "/finance/recovery", label: "Collect dues", ar: "تحصيل المديونيات" },
  { key: "/insurance", label: "Insurance", ar: "التأمين" },
  { key: "/reports", label: "Reports", ar: "التقارير" },
  { key: "/lab", label: "Lab", ar: "المعمل" },
  { key: "/chats", label: "WhatsApp", ar: "واتساب" },
  { key: "/leads", label: "Leads", ar: "العملاء المحتملون" },
  { key: "/inventory", label: "Stock", ar: "المخزن" },
  { key: "/store", label: "Supply store", ar: "متجر المستلزمات" },
  { key: "/ortho", label: "Ortho", ar: "التقويم" },
  { key: "/attendance", label: "Time clock", ar: "الحضور والانصراف" },
  { key: "/team", label: "Team", ar: "الفريق" },
  { key: "/ai", label: "AI (Intelligence)", ar: "ذكاء ألفا" },
  { key: "/marketing", label: "Marketing", ar: "التسويق" },
  { key: "/notes", label: "Notes", ar: "الملاحظات" },
  { key: "/calls", label: "Calls", ar: "المكالمات" },
  { key: "/settings", label: "Settings", ar: "الإعدادات" },
  { key: "/setup", label: "Quick setup", ar: "الإعداد السريع" },
  { key: "/welcome", label: "Getting started", ar: "البداية" },
  { key: "/help", label: "Help Center", ar: "مركز المساعدة" },
];

const LABELS = new Map(KNOWN_PAGES.map((p) => [p.key, p]));

/** A screen key as a person reads it. Unknown ones are shown as their path. */
export function pageLabel(key: string, arabic = false): string {
  const name = (p: { label: string; ar: string }) => (arabic ? p.ar : p.label);
  const exact = LABELS.get(key);
  if (exact) return name(exact);
  const [base, tab] = key.split("#");
  const baseEntry = LABELS.get(base);
  if (baseEntry && tab) return `${name(baseEntry)} · ${tab}`;
  return key;
}
