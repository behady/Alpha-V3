/**
 * The WhatsApp line as a report: how much the bot carried, how fast people answered, what the
 * automated sends did, and who asked to be left alone.
 *
 * Reads conversation summary docs only — never the message threads, which would be one read per
 * conversation. Staff response time is therefore measured on HANDOFFS (the bot raised a hand at
 * `handoffAtMs`, a person first typed at `humanActiveAtMs`), which is also the number that
 * matters: a patient the bot could answer never waited.
 *
 * Pure. No React, no database.
 */

import { toYmd, type PatientDoc } from "@/lib/reports/patientStats";

export type ConversationDoc = Record<string, unknown> & { id?: string };
export type LogDoc = Record<string, unknown>;

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

export type WhatsappStats = {
  conversations: number;
  /** Conversations the bot closed on its own: not handed to a person. */
  botAlone: number;
  botAlonePct: number | null;
  aiUsed: number;
  outcomes: { outcome: string; count: number }[];
  handoffs: {
    total: number;
    open: number;
    resolved: number;
    medianMinutes: number | null;
    /** Handoffs a person answered within the hour. */
    withinHour: number;
    bySeverity: { severity: string; count: number }[];
    byReason: { reason: string; count: number }[];
  };
  bookingsByBot: number;
  reschedulesByBot: number;
  cancellationsByBot: number;
  sends: { type: string; sent: number; failed: number; queued: number; manual: number }[];
  sms: { type: string; sent: number; failed: number; queued: number }[];
  optOuts: { inPeriod: number; total: number };
  byDay: { date: string; count: number }[];
};

export function whatsappStats(
  conversations: readonly ConversationDoc[],
  appointments: readonly Record<string, unknown>[],
  logs: readonly LogDoc[],
  smsOutbox: readonly LogDoc[],
  patients: readonly PatientDoc[],
  range: { start: string; end: string },
): WhatsappStats {
  const inRange = (ms: unknown) => {
    const d = toYmd(ms);
    return d >= range.start && d <= range.end;
  };
  const real = conversations.filter((c) => !String(c.id || "").startsWith("play_"));
  const active = real.filter((c) => inRange(c.lastMessageAt || c.lastAt || c.updatedAt));

  const outcomes = new Map<string, number>();
  const severity = new Map<string, number>();
  const reasons = new Map<string, number>();
  const byDay = new Map<string, number>();
  const resolveMinutes: number[] = [];
  let botAlone = 0;
  let aiUsed = 0;
  let handoffs = 0;
  let open = 0;
  let withinHour = 0;

  for (const c of active) {
    const outcome = String(c.outcome || "").trim() || "other";
    outcomes.set(outcome, (outcomes.get(outcome) || 0) + 1);
    if (outcome !== "handoff") botAlone += 1;
    if (c.aiUsed) aiUsed += 1;
    const day = toYmd(c.lastMessageAt || c.lastAt || c.updatedAt);
    if (day) byDay.set(day, (byDay.get(day) || 0) + 1);

    const raisedAt = num(c.handoffAtMs);
    if (raisedAt > 0) {
      handoffs += 1;
      severity.set(String(c.severity || "normal"), (severity.get(String(c.severity || "normal")) || 0) + 1);
      const reason = String(c.handoffReason || "").trim() || "—";
      reasons.set(reason, (reasons.get(reason) || 0) + 1);
      const handled = num(c.humanActiveAtMs) || num(c.handledAtMs);
      const isOpen = Boolean(c.needsHuman) && num(c.handledAtMs) < raisedAt;
      if (isOpen) open += 1;
      if (handled >= raisedAt && handled > 0) {
        const mins = (handled - raisedAt) / 60000;
        resolveMinutes.push(mins);
        if (mins <= 60) withinHour += 1;
      }
    }
  }

  const bot = appointments.filter((a) => String(a.source || "") === "whatsapp_bot" && inRange(a.createdAt));
  const reschedules = appointments.filter((a) => String(a.rescheduledVia || "") === "whatsapp_bot" && inRange(a.rescheduledAt)).length;
  const cancellations = appointments.filter((a) => String(a.cancelledVia || "") === "whatsapp_bot" && inRange(a.cancelledAt)).length;

  const sends = new Map<string, { type: string; sent: number; failed: number; queued: number; manual: number }>();
  for (const l of logs) {
    const type = String(l.type || "other");
    const s = sends.get(type) || { type, sent: 0, failed: 0, queued: 0, manual: 0 };
    const status = String(l.status || "");
    if (status === "success" || status === "sent") s.sent += 1;
    else if (status === "failed") s.failed += 1;
    else if (status === "queued") s.queued += 1;
    else if (status === "manual") s.manual += 1;
    sends.set(type, s);
  }
  const sms = new Map<string, { type: string; sent: number; failed: number; queued: number }>();
  for (const l of smsOutbox) {
    const type = String(l.type || "other");
    const s = sms.get(type) || { type, sent: 0, failed: 0, queued: 0 };
    const status = String(l.status || "");
    if (status === "sent") s.sent += 1;
    else if (status === "failed") s.failed += 1;
    else s.queued += 1;
    sms.set(type, s);
  }

  const optedOut = patients.filter((p) => Boolean(p.whatsappOptOut));
  const optedOutInPeriod = optedOut.filter((p) => inRange((p as Record<string, unknown>).optOutAt)).length;

  return {
    conversations: active.length,
    botAlone,
    botAlonePct: active.length ? Number(((botAlone / active.length) * 100).toFixed(1)) : null,
    aiUsed,
    outcomes: [...outcomes.entries()].map(([outcome, count]) => ({ outcome, count })).sort((a, b) => b.count - a.count),
    handoffs: {
      total: handoffs,
      open,
      resolved: resolveMinutes.length,
      medianMinutes: median(resolveMinutes) === null ? null : Number(median(resolveMinutes)!.toFixed(0)),
      withinHour,
      bySeverity: [...severity.entries()].map(([severity, count]) => ({ severity, count })).sort((a, b) => b.count - a.count),
      byReason: [...reasons.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count).slice(0, 8),
    },
    bookingsByBot: bot.length,
    reschedulesByBot: reschedules,
    cancellationsByBot: cancellations,
    sends: [...sends.values()].sort((a, b) => b.sent + b.failed - (a.sent + a.failed)),
    sms: [...sms.values()].sort((a, b) => b.sent + b.failed - (a.sent + a.failed)),
    optOuts: { inPeriod: optedOutInPeriod, total: optedOut.length },
    byDay: [...byDay.entries()].map(([date, count]) => ({ date, count })).sort((a, b) => a.date.localeCompare(b.date)),
  };
}
