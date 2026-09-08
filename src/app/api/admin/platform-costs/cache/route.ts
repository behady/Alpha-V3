import { NextResponse } from "next/server";
import { requireStaffUser } from "@/lib/apiStaffAuth";
import { adminDb } from "@/lib/firebaseAdmin";
import { costOfTokens } from "@/lib/platformCost";
import { rulebookCacheFirstUsedAt } from "@/lib/bot/rulebookCache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Did the rulebook cache actually save money?
 *
 * The Costs tab answers "what does each clinic cost us this month". This answers a narrower
 * question that no monthly total can: the same work, priced before and after one change. Every
 * reply is costed from its own token counts at the rate of its own day, and the replies are split
 * at the exact MOMENT the first cache was created — not the day, because a cutover at ten in the
 * morning otherwise hides the saving inside the very day someone is looking at.
 *
 * `cachedShare` is the check on the check: a day after the cutover with a low share means the
 * cache stopped hitting, which reads identically to a quiet week if you only look at the total.
 *
 * Superadmin only. Clinics see credits; the invoice behind a credit is the platform's business.
 */

const DAY_MS = 86_400_000;

interface DayRow {
  day: string;
  replies: number;
  inputTokens: number;
  cachedTokens: number;
  outputTokens: number;
  usd: number;
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

  const cutoverMs = await rulebookCacheFirstUsedAt();
  const side = {
    before: { replies: 0, usd: 0, input: 0, cached: 0 },
    after: { replies: 0, usd: 0, input: 0, cached: 0 },
  };

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
      if (feature !== "all" && !String(x.feature || "").startsWith(feature)) continue;
      // Rows written before the token meter shipped carry a credit and nothing to price.
      if (typeof x.inputTokens !== "number") continue;
      const at = (x.createdAt as { toDate?: () => Date })?.toDate?.() ?? new Date();
      const tokens = {
        input: Number(x.inputTokens) || 0,
        cached: Number(x.cachedTokens) || 0,
        output: Number(x.outputTokens) || 0,
        thoughts: Number(x.thoughtTokens) || 0,
      };
      const usd = costOfTokens(String(x.model || "gemini-flash-latest"), tokens, at);

      const row = bump(cairoDay(at.getTime()));
      row.replies += 1;
      row.inputTokens += tokens.input;
      row.cachedTokens += tokens.cached;
      row.outputTokens += tokens.output + tokens.thoughts;
      row.usd += usd;

      const bucket = cutoverMs && at.getTime() >= cutoverMs ? side.after : side.before;
      bucket.replies += 1;
      bucket.usd += usd;
      bucket.input += tokens.input;
      bucket.cached += tokens.cached;
    }
  }

  const rowList = [...perDay.values()].sort((a, b) => a.day.localeCompare(b.day));
  for (const r of rowList) {
    r.cachedShare = r.inputTokens ? r.cachedTokens / r.inputTokens : 0;
    r.usdPerReply = r.replies ? r.usd / r.replies : 0;
  }

  const summarize = (b: { replies: number; usd: number; input: number; cached: number }) => ({
    replies: b.replies,
    usd: b.usd,
    usdPerReply: b.replies ? b.usd / b.replies : 0,
    cachedShare: b.input ? b.cached / b.input : 0,
  });
  const before = summarize(side.before);
  const after = summarize(side.after);

  return NextResponse.json({
    ok: true,
    days,
    feature,
    cutoverAt: cutoverMs ? new Date(cutoverMs).toISOString() : null,
    cutoverDay: cutoverMs ? cairoDay(cutoverMs) : null,
    before,
    after,
    saving: before.usdPerReply && after.replies ? 1 - after.usdPerReply / before.usdPerReply : null,
    rows: rowList,
  });
}
