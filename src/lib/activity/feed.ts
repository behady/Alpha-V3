/**
 * Activity log v2, the page's pure half: no Firebase, no React, so every rule here is unit-tested
 * (tests/activityFeed.test.mts).
 *
 * - Date presets become a [start, end) pair of instants on the clinic's clock, so "today" in Cairo
 *   is Cairo's midnight to midnight whatever the browser's own timezone, summer time included.
 * - The filters, the folding of a visit discount's lines and the per-person summary all run over
 *   the whole loaded range. The old page filtered "the latest 200", which made an absent entry
 *   look like something that never happened.
 */

import { countedNoun } from "../arabicCount";
import { addDaysYmd, instantAtYmd, ymdInTimeZone } from "../clinicDate";
import { categoriesOfLog, money } from "./catalogue";
import type { ActivityLogDoc, Category } from "./types";

type Lang = "ar" | "en";

// ---------------------------------------------------------------- dates

export type Tab = "all" | Exclude<Category, "system">;
export type Preset = "today" | "yesterday" | "week" | "month" | { from: string; to: string };

/** The preset's instants: `start` inclusive, `end` exclusive, both on the clinic's clock. */
export function rangeFor(preset: Preset, now: Date, tz: string): { start: Date; end: Date } {
  const today = ymdInTimeZone(tz, now);
  const tomorrow = addDaysYmd(today, 1);
  let from: string;
  let toExclusive: string;
  if (preset === "today") {
    from = today;
    toExclusive = tomorrow;
  } else if (preset === "yesterday") {
    from = addDaysYmd(today, -1);
    toExclusive = today;
  } else if (preset === "week") {
    from = addDaysYmd(today, -6);
    toExclusive = tomorrow;
  } else if (preset === "month") {
    from = `${today.slice(0, 8)}01`;
    toExclusive = tomorrow;
  } else {
    // A pair picked the wrong way round is still the same days.
    const [a, b] = preset.from <= preset.to ? [preset.from, preset.to] : [preset.to, preset.from];
    from = a;
    toExclusive = addDaysYmd(b, 1);
  }
  return { start: instantAtYmd(tz, from), end: instantAtYmd(tz, toExclusive) };
}

/** When the entry was written; a pre-timestamp legacy row falls back to its `date` string. */
export function logTime(log: ActivityLogDoc): Date | null {
  const ts = log.timestamp;
  if (ts instanceof Date) return Number.isNaN(ts.getTime()) ? null : ts;
  if (ts && typeof ts.toDate === "function") {
    const d = ts.toDate();
    if (d instanceof Date && !Number.isNaN(d.getTime())) return d;
  }
  if (typeof log.date === "string" && log.date) {
    const d = new Date(log.date);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return null;
}

/** The clinic-clock day an entry is filed under; "" when it carries no time at all. */
export function dayKey(log: ActivityLogDoc, tz: string): string {
  const at = logTime(log);
  return at ? ymdInTimeZone(tz, at) : "";
}

// ---------------------------------------------------------------- people

/**
 * Who an entry belongs to, as a filter key: the uid, or for an old row written without one, its
 * name. Never shown; the page shows `userName`.
 */
export function personKey(log: ActivityLogDoc): string {
  const uid = typeof log.userId === "string" ? log.userId.trim() : "";
  if (uid) return uid;
  const name = String(log.userName ?? log.user ?? "").trim();
  return name ? `name:${name}` : "";
}

export function personName(log: ActivityLogDoc): string {
  const name = String(log.userName ?? log.user ?? "").trim();
  return name === "Unknown User" ? "" : name;
}

// ---------------------------------------------------------------- filters

export type Filters = { tab: Tab; userId?: string; patient?: string; branchId?: string; flaggedOnly?: boolean };

export function filterEntries(logs: ActivityLogDoc[], f: Filters): ActivityLogDoc[] {
  const term = (f.patient ?? "").trim().toLowerCase();
  return logs.filter((log) => {
    if (f.tab !== "all" && !categoriesOfLog(log).includes(f.tab)) return false;
    if (f.userId && personKey(log) !== f.userId) return false;
    if (f.branchId && log.branchId !== f.branchId) return false;
    if (f.flaggedOnly && log.flag !== true) return false;
    if (term) {
      // A v2 row names its patient; an old row only has free text, so its details are searched.
      const haystack = log.v === 2 ? log.patientName : log.patientName ?? log.details;
      if (!String(haystack ?? "").toLowerCase().includes(term)) return false;
    }
    return true;
  });
}

// ---------------------------------------------------------------- folding a visit discount

export type FoldedEntry = { log: ActivityLogDoc; members: ActivityLogDoc[] };

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/**
 * One visit discount is written as one `discount.*` line per charge, tied by `groupId`. On the
 * page that is one action: the lines fold into the first (newest) one, with the amounts summed.
 * Lines of different events (a discount given and one removed) never fold together.
 */
export function foldGroups(logs: ActivityLogDoc[]): FoldedEntry[] {
  const out: FoldedEntry[] = [];
  const byKey = new Map<string, FoldedEntry>();
  for (const log of logs) {
    const group = typeof log.groupId === "string" ? log.groupId : "";
    const foldable = !!group && typeof log.event === "string" && log.event.startsWith("discount.");
    if (!foldable) {
      out.push({ log, members: [log] });
      continue;
    }
    const key = `${group}|${log.event}`;
    const hit = byKey.get(key);
    if (hit) hit.members.push(log);
    else {
      const entry = { log, members: [log] };
      byKey.set(key, entry);
      out.push(entry);
    }
  }
  return out.map((entry) => (entry.members.length > 1 ? { log: foldedLog(entry.members), members: entry.members } : entry));
}

function foldedLog(members: ActivityLogDoc[]): ActivityLogDoc {
  const first = members[0];
  const amounts = members.map((m) => m.amount).filter(isNum);
  const procedures = new Set(members.map((m) => m.refs?.procedure ?? ""));
  const refs = { ...(first.refs ?? {}) };
  // Name the procedure only when every line was the same one; one line's price arrow never speaks for the group.
  if (procedures.size > 1) delete refs.procedure;
  const reasons = new Set(members.map((m) => (m.reason ?? "").trim()));
  return {
    ...first,
    amount: amounts.length ? amounts.reduce((a, b) => a + b, 0) : first.amount,
    refs,
    changes: undefined,
    // One reason typed for the whole visit discount is the group's; differing ones stay on their lines.
    reason: reasons.size === 1 ? first.reason : undefined,
    flag: members.some((m) => m.flag === true) || first.flag,
  };
}

/** "(3 خدمات)" / "(3 treatments)" after a folded line. */
export function servicesCount(n: number, lang: Lang): string {
  return lang === "ar"
    ? countedNoun(n, true, { one: "خدمة واحدة", two: "خدمتين", few: "خدمات", many: "خدمة" })
    : countedNoun(n, false, { one: "treatment", two: "treatments", few: "treatments", many: "treatments" });
}

// ---------------------------------------------------------------- summary strip

export type SummaryKey = "received" | "edited" | "deleted" | "discounts" | "insCreated" | "insStatus" | "insCancelled" | "insCollected";
export type SummaryItem = { key: SummaryKey; count: number; amount: number };
export type PersonSummary = { userId: string; userName: string; items: SummaryItem[] };

const ITEM_ORDER: Record<"money" | "discount" | "insurance", SummaryKey[]> = {
  money: ["received", "edited", "deleted"],
  discount: ["discounts"],
  insurance: ["insCreated", "insStatus", "insCancelled", "insCollected"],
};

const MONEY_EDITS = new Set(["payment.edited", "expense.edited", "income.edited", "procedure.edited"]);

function statusTo(log: ActivityLogDoc): string {
  const to = log.changes?.find((c) => c.field === "status")?.to;
  return typeof to === "string" ? to.trim().toLowerCase() : "";
}

/**
 * Which summary item an entry counts towards on a tab, and the money it adds. Edits and insurance
 * status changes are counted, not summed: their amount is a value after the edit, not money moved.
 */
function classify(log: ActivityLogDoc, tab: "money" | "discount" | "insurance"): { key: SummaryKey; amount: number; countIt: boolean } | null {
  const ev = log.event;
  if (log.v !== 2 || !ev) return null;
  const amt = isNum(log.amount) ? log.amount : 0;
  if (tab === "money") {
    if (ev === "payment.received") return { key: "received", amount: amt, countIt: true };
    if (MONEY_EDITS.has(ev)) return { key: "edited", amount: 0, countIt: true };
    if (ev.endsWith(".deleted") && categoriesOfLog(log).includes("money")) return { key: "deleted", amount: amt, countIt: true };
    return null;
  }
  if (tab === "discount") {
    if (ev === "discount.given" || ev === "discount.changed") return { key: "discounts", amount: amt, countIt: true };
    // A removed discount takes its money back off the person's total, and is not a discount given.
    if (ev === "discount.removed") return { key: "discounts", amount: -amt, countIt: false };
    return null;
  }
  if (ev === "insurance.created") return { key: "insCreated", amount: 0, countIt: true };
  if (ev === "insurance.status") return { key: statusTo(log) === "cancelled" ? "insCancelled" : "insStatus", amount: 0, countIt: true };
  if (ev === "insurer.collected") return { key: "insCollected", amount: amt, countIt: true };
  return null;
}

/**
 * One line per person for the Money, Discounts or Insurance tab, most money first. A visit discount
 * written as several lines (one `groupId`) counts as one discount, as it shows as one line.
 */
export function summarize(logs: ActivityLogDoc[], tab: "money" | "discount" | "insurance"): PersonSummary[] {
  const people = new Map<string, { name: string; items: Map<SummaryKey, SummaryItem>; groups: Set<string> }>();
  for (const log of logs) {
    const hit = classify(log, tab);
    if (!hit) continue;
    const id = personKey(log);
    if (!id) continue;
    let person = people.get(id);
    if (!person) {
      person = { name: personName(log), items: new Map(), groups: new Set() };
      people.set(id, person);
    }
    if (!person.name) person.name = personName(log);
    let item = person.items.get(hit.key);
    if (!item) {
      item = { key: hit.key, count: 0, amount: 0 };
      person.items.set(hit.key, item);
    }
    item.amount += hit.amount;
    if (hit.countIt) {
      const group = typeof log.groupId === "string" && log.groupId ? `${hit.key}|${log.event}|${log.groupId}` : "";
      if (!group || !person.groups.has(group)) item.count += 1;
      if (group) person.groups.add(group);
    }
  }
  const rows = Array.from(people.entries()).map(([userId, p]) => ({
    userId,
    userName: p.name,
    items: ITEM_ORDER[tab].map((k) => p.items.get(k)).filter((i): i is SummaryItem => !!i && (i.count > 0 || i.amount !== 0)),
  }));
  const total = (r: PersonSummary) => r.items.reduce((s, i) => s + i.amount, 0);
  const count = (r: PersonSummary) => r.items.reduce((s, i) => s + i.count, 0);
  return rows
    .filter((r) => r.items.length > 0)
    .sort((a, b) => total(b) - total(a) || count(b) - count(a) || a.userName.localeCompare(b.userName));
}

type Forms = { one: string; two: string; few: string; many: string };
const ITEM_WORDS: Record<SummaryKey, { ar: Forms; en: [string, string]; money: boolean }> = {
  received: { ar: { one: "دفعة واحدة مستلمة", two: "دفعتين مستلمتين", few: "دفعات مستلمة", many: "دفعة مستلمة" }, en: ["payment received", "payments received"], money: true },
  edited: { ar: { one: "تعديل واحد", two: "تعديلين", few: "تعديلات", many: "تعديل" }, en: ["edit", "edits"], money: false },
  deleted: { ar: { one: "حذف واحد", two: "عمليتين حذف", few: "عمليات حذف", many: "عملية حذف" }, en: ["deletion", "deletions"], money: true },
  discounts: { ar: { one: "خصم واحد", two: "خصمين", few: "خصومات", many: "خصم" }, en: ["discount", "discounts"], money: true },
  insCreated: { ar: { one: "موافقة جديدة", two: "موافقتين جداد", few: "موافقات جديدة", many: "موافقة جديدة" }, en: ["approval created", "approvals created"], money: false },
  insStatus: { ar: { one: "تغيير حالة واحد", two: "تغييرين حالة", few: "تغييرات حالة", many: "تغيير حالة" }, en: ["status change", "status changes"], money: false },
  insCancelled: { ar: { one: "موافقة ملغاة", two: "موافقتين ملغيين", few: "موافقات ملغاة", many: "موافقة ملغاة" }, en: ["approval cancelled", "approvals cancelled"], money: false },
  insCollected: { ar: { one: "تحصيل واحد", two: "تحصيلين", few: "تحصيلات", many: "تحصيل" }, en: ["collection", "collections"], money: true },
};

/** The two halves of a summary item, so the page can set the money as a figure: "6 خصومات", "1,200 ج". */
export function summaryItemParts(item: SummaryItem, lang: Lang): { counted: string; amount: string } {
  const w = ITEM_WORDS[item.key];
  const counted = item.count <= 0 ? ""
    : lang === "ar" ? countedNoun(item.count, true, w.ar)
    : `${item.count} ${item.count === 1 ? w.en[0] : w.en[1]}`;
  const amount = w.money && item.amount !== 0 ? money(item.amount, lang) : "";
  return { counted, amount };
}

/** "6 خصومات · 1,200 ج", "3 تعديلات", "1 payment received · 500 EGP". */
export function summaryItemText(item: SummaryItem, lang: Lang): string {
  const { counted, amount } = summaryItemParts(item, lang);
  return [counted, amount].filter(Boolean).join(" · ");
}

// ---------------------------------------------------------------- the patient's name as a link

/** [before, name, after] around the first mention of `name`, or null when it is not in the sentence. */
export function splitOnName(sentence: string, name: string | null | undefined): [string, string, string] | null {
  const n = String(name ?? "").trim();
  if (!n) return null;
  const at = sentence.indexOf(n);
  if (at < 0) return null;
  return [sentence.slice(0, at), n, sentence.slice(at + n.length)];
}
