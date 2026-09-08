import { NextResponse } from "next/server";
import { requireStaffUser } from "@/lib/apiStaffAuth";
import { adminDb } from "@/lib/firebaseAdmin";
import { costOf, EGP_PER_USD } from "@/lib/gemini/pricing";
import { rulebookCacheFirstUsedAt } from "@/lib/bot/rulebookCache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * What the AI actually cost us, day by day, across every clinic — the platform's own number,
 * never a clinic's.
 *
 * Built for one question: did the rulebook cache save money? So every day is priced from its
 * raw token rows at the rate of that day, split into what was cached and what was not, and the
 * days are divided at the moment the first cache was created. The two averages either side of
 * that line are the answer, in a figure a person can check against Google's invoice.
 *
 * Superadmin only. Clinics see credits in their own settings; the money behind a credit is the
 * platform's margin and stays here.
 */

const DAY_MS = 86_400_000;

interface DayRow {
  day: string;
  replies: number;
  inputTokens: number;
  cachedTokens: number;
  outputTokens: number;
  usd: number;
  /** Share of input tokens that were served from the cache. */
  cachedShare: number;
  usdPerReply: number;
}

function cairoDay(ms: number): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo" }).format(new Date(ms));
}

export async function GET(request: Request) {
  const authz = await requireStaffUser(request);
  if (!authz.ok) return authz.response;
  const user = (await adminDb().collection("users").doc(authz.uid).get()).data() || {};
  if (user.isSuperAdmin !== true && user.isSuperAdmin !== "true") {
    return NextResponse.json({ ok: false, error: "Superadmin only" }, { status: 403 });
  }

  const url = new URL(request.url);
  const days = Math.min(90, Math.max(1, Number(url.searchParams.get("days")) || 30));
  const feature = (url.searchParams.get("feature") || "whatsapp").trim();
  const since = new Date(Date.now() - days * DAY_MS);

  // The before/after line is the MOMENT the first cache was created, not the day: a cutover at
  // 10am splits that day's replies in two, and lumping them together hides the saving on the very
  // day anyone is looking for it.
  const cutoverMs = await rulebookCacheFirstUsedAt();
  const side = { before: { replies: 0, usd: 0, input: 0, cached: 0 }, after: { replies: 0, usd: 0, input: 0, cached: 0 } };

  const perDay = new Map<string, DayRow>();
  const bump = (day: string) => {
    if (!perDay.has(day)) perDay.set(day, { day, replies: 0, inputTokens: 0, cachedTokens: 0, outputTokens: 0, usd: 0, cachedShare: 0, usdPerReply: 0 });
    return perDay.get(day)!;
  };

  // One query per clinic rather than a collection-group query: the latter needs an index this
  // project has never declared, and a report that throws on a missing index reports nothing.
  const clinics = await adminDb().collection("clinics").select().get();
  for (const c of clinics.docs) {
    const rows = await c.ref.collection("ai_usage_log").where("createdAt", ">=", since).limit(5000).get();
    for (const d of rows.docs) {
      const x = d.data() as Record<string, unknown>;
      const f = String(x.feature || "");
      if (feature !== "all" && !f.startsWith(feature)) continue;
      if (typeof x.inputTokens !== "number") continue; // rows from before the meter carry no tokens
      const at = (x.createdAt as { toDate?: () => Date })?.toDate?.() ?? new Date();
      const row = bump(cairoDay(at.getTime()));
      const usage = {
        inputTokens: Number(x.inputTokens) || 0,
        cachedTokens: Number(x.cachedTokens) || 0,
        outputTokens: Number(x.outputTokens) || 0,
        thoughtTokens: Number(x.thoughtTokens) || 0,
      };
      row.replies += 1;
      row.inputTokens += usage.inputTokens;
      row.cachedTokens += usage.cachedTokens;
      row.outputTokens += usage.outputTokens + usage.thoughtTokens;
      const usd = costOf(String(x.model || "gemini-flash-latest"), usage, at).usd;
      row.usd += usd;
      const bucket = cutoverMs && at.getTime() >= cutoverMs ? side.after : side.before;
      bucket.replies += 1;
      bucket.usd += usd;
      bucket.input += usage.inputTokens;
      bucket.cached += usage.cachedTokens;
    }
  }

  const list = [...perDay.values()].sort((a, b) => a.day.localeCompare(b.day));
  for (const r of list) {
    r.cachedShare = r.inputTokens ? r.cachedTokens / r.inputTokens : 0;
    r.usdPerReply = r.replies ? r.usd / r.replies : 0;
  }

  const cutoverDay = cutoverMs ? cairoDay(cutoverMs) : null;
  const summarize = (b: { replies: number; usd: number; input: number; cached: number }) => ({
    replies: b.replies,
    usd: b.usd,
    usdPerReply: b.replies ? b.usd / b.replies : 0,
    egpPerReply: b.replies ? (b.usd / b.replies) * EGP_PER_USD : 0,
    cachedShare: b.input ? b.cached / b.input : 0,
  });
  const before = summarize(side.before);
  const after = summarize(side.after);

  return NextResponse.json({
    ok: true,
    days,
    feature,
    cutoverDay,
    cutoverAt: cutoverMs ? new Date(cutoverMs).toISOString() : null,
    egpPerUsd: EGP_PER_USD,
    before,
    after,
    saving: before.usdPerReply && after.replies ? 1 - after.usdPerReply / before.usdPerReply : null,
    rows: list,
  });
}
