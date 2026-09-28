/**
 * Click-to-WhatsApp ads as a report: for each ad, how many chats it opened, how many of those
 * people actually typed, how many booked and came, and what they paid.
 *
 * A clinic paying Meta per conversation has exactly one question — which ad is paying for
 * itself — and until the ad was recorded on the conversation there was nothing to answer it
 * with. This reads the conversation summary docs (the `ad` block `recordAdReferral` wrote), the
 * appointments and the ledger rows in the window, and joins them on the patient the bot
 * registered. Spend is not known here; the component says "your spend ÷ booked" and leaves the
 * arithmetic to the owner, who has the Ads Manager open anyway.
 *
 * Pure. No React, no database.
 */

import { ledgerCashValue } from "@/lib/reportHelpers";
import { toYmd } from "@/lib/reports/patientStats";

export type AdConversationDoc = Record<string, unknown> & { id?: string };

export type AdRow = {
  /** The grouping key: the ad's id when Meta gave one, else its headline. */
  key: string;
  label: string;
  sourceType: string;
  /** Conversations this ad opened in the period. */
  chats: number;
  /** Of those, people who wrote at least one message (an ad tap alone opens a chat too). */
  typed: number;
  /** Chats that reached a person (the bot raised a hand). */
  handoffs: number;
  /** People with an appointment made after the click. */
  booked: number;
  /** Of the booked, people whose appointment was completed. */
  attended: number;
  /** What those patients paid in the period. */
  revenue: number;
  /** booked ÷ chats, as a percentage. */
  conversionPct: number | null;
};

export type AdStats = {
  rows: AdRow[];
  totals: Omit<AdRow, "key" | "label" | "sourceType">;
  /** Chats in the period that came from no ad, for the "how much of WhatsApp is ads" figure. */
  organicChats: number;
};

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const ATTENDED = /complet|arriv|seen|attend|done|check/i;

export function adStats(
  conversations: readonly AdConversationDoc[],
  appointments: readonly Record<string, unknown>[],
  ledger: readonly Record<string, unknown>[],
  range: { start: string; end: string },
): AdStats {
  const inRange = (v: unknown) => {
    const d = toYmd(v);
    return d >= range.start && d <= range.end;
  };
  const real = conversations.filter((c) => !String(c.id || "").startsWith("play_"));

  // Appointments and money, by patient, once.
  const apptsByPatient = new Map<string, Record<string, unknown>[]>();
  for (const a of appointments) {
    const pid = String(a.patientId || "");
    if (!pid) continue;
    const list = apptsByPatient.get(pid) || [];
    list.push(a);
    apptsByPatient.set(pid, list);
  }
  const paidByPatient = new Map<string, number>();
  for (const row of ledger) {
    const type = String(row.type || "");
    if (type === "expense") continue;
    const pid = String(row.patientId || "");
    if (!pid) continue;
    paidByPatient.set(pid, (paidByPatient.get(pid) || 0) + ledgerCashValue(row));
  }

  const groups = new Map<string, AdRow>();
  let organic = 0;
  for (const c of real) {
    const ad = c.ad && typeof c.ad === "object" ? (c.ad as Record<string, unknown>) : null;
    const when = num(c.adAt) || num(c.lastMessageAt) || num(c.lastAt);
    if (!inRange(when)) continue;
    if (!ad) {
      organic += 1;
      continue;
    }
    const headline = String(ad.headline || "").trim();
    const body = String(ad.body || "").trim();
    const sourceId = String(ad.sourceId || "").trim();
    const sourceType = String(ad.sourceType || "ad").trim();
    const key = sourceId || headline || body.slice(0, 60) || "unknown";
    const label = headline || (body ? (body.length > 48 ? `${body.slice(0, 45).trim()}…` : body) : sourceId ? `#${sourceId.slice(-6)}` : "—");
    const row = groups.get(key) || { key, label, sourceType, chats: 0, typed: 0, handoffs: 0, booked: 0, attended: 0, revenue: 0, conversionPct: null };
    row.chats += 1;
    if (num(c.adTypedAt) > 0 || (String(c.lastText || "").trim() && c.lastDirection === "in")) row.typed += 1;
    if (num(c.handoffAtMs) > 0 || c.needsHuman === true) row.handoffs += 1;

    const pid = String(c.patientId || "");
    const appts = pid ? apptsByPatient.get(pid) || [] : [];
    const afterClick = appts.filter((a) => {
      const created = num(a.createdAtMs) || (a.createdAt && typeof a.createdAt === "object" && "toMillis" in (a.createdAt as object) ? (a.createdAt as { toMillis: () => number }).toMillis() : 0);
      return !created || created >= when - 60_000;
    });
    const booked = c.outcome === "booked" || afterClick.length > 0;
    if (booked) row.booked += 1;
    if (afterClick.some((a) => ATTENDED.test(String(a.status || "")))) row.attended += 1;
    if (pid) row.revenue += paidByPatient.get(pid) || 0;
    groups.set(key, row);
  }

  const rows = [...groups.values()]
    .map((r) => ({ ...r, conversionPct: r.chats ? Number(((r.booked / r.chats) * 100).toFixed(1)) : null }))
    .sort((a, b) => b.booked - a.booked || b.chats - a.chats);

  const totals = rows.reduce(
    (t, r) => ({ chats: t.chats + r.chats, typed: t.typed + r.typed, handoffs: t.handoffs + r.handoffs, booked: t.booked + r.booked, attended: t.attended + r.attended, revenue: t.revenue + r.revenue, conversionPct: null as number | null }),
    { chats: 0, typed: 0, handoffs: 0, booked: 0, attended: 0, revenue: 0, conversionPct: null as number | null },
  );
  totals.conversionPct = totals.chats ? Number(((totals.booked / totals.chats) * 100).toFixed(1)) : null;

  return { rows, totals, organicChats: organic };
}
