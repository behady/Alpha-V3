import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import { requireSuperAdmin } from "@/lib/apiStaffAuth";
import { reportServerError } from "@/lib/server/reportError";
import { SARA_QUESTION_LOG } from "@/lib/sara/questionLog.server";
import { estimateUsd } from "@/lib/sara/costEstimate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * What people asked the assistant, across every clinic, newest first.
 *
 *   ?days=7|30|90
 *
 * Superadmin only: the questions carry patient names and the cost column is the platform's own
 * supplier cost, which a clinic never sees. The point of the list is the `read` and `none` rows:
 * questions answered the slow way, or not at all, are the next ready-made answers to build.
 */
export async function GET(request: Request) {
  try {
    const authz = await requireSuperAdmin(request);
    if (!authz.ok) return authz.response;

    const url = new URL(request.url);
    const days = Math.min(Math.max(Number(url.searchParams.get("days")) || 30, 1), 90);
    const from = new Date(Date.now() - (days - 1) * 86_400_000).toISOString().slice(0, 10);

    const db = adminDb();
    const snap = await db.collection(SARA_QUESTION_LOG).where("day", ">=", from).orderBy("day", "desc").limit(2000).get();

    const rows = snap.docs
      .map((d) => {
        const r = d.data() as Record<string, unknown>;
        const at = (r.createdAt as { toMillis?: () => number } | undefined)?.toMillis?.() ?? 0;
        const tokens = { inputTokens: Number(r.inputTokens) || 0, cachedTokens: Number(r.cachedTokens) || 0, outputTokens: Number(r.outputTokens) || 0 };
        return {
          id: d.id,
          at,
          day: String(r.day || ""),
          clinicId: String(r.clinicId || ""),
          userName: String(r.userName || ""),
          role: String(r.role || ""),
          client: String(r.client || ""),
          question: String(r.question || ""),
          outcome: String(r.outcome || ""),
          tools: Array.isArray(r.tools) ? (r.tools as unknown[]).map(String) : [],
          ceilingHit: r.ceilingHit === true,
          deepOffered: r.deepOffered === true,
          credits: Number(r.credits) || 0,
          apiCalls: Number(r.apiCalls) || 0,
          inputTokens: tokens.inputTokens,
          usd: estimateUsd(tokens, String(r.day || "")),
        };
      })
      .sort((a, b) => b.at - a.at);

    const clinicIds = [...new Set(rows.map((r) => r.clinicId).filter(Boolean))];
    const clinics: Record<string, string> = {};
    await Promise.all(
      clinicIds.map(async (id) => {
        const c = await db.collection("clinics").doc(id).get();
        clinics[id] = String(c.data()?.name || id);
      })
    );

    const byOutcome: Record<string, { count: number; usd: number }> = {};
    for (const r of rows) {
      const o = (byOutcome[r.outcome] ||= { count: 0, usd: 0 });
      o.count += 1;
      o.usd = Number((o.usd + r.usd).toFixed(4));
    }

    return NextResponse.json({ ok: true, period: { from, days }, clinics, byOutcome, rows });
  } catch (error) {
    reportServerError("api/admin/sara-questions", error);
    return NextResponse.json({ ok: false, error: "Could not load the questions." }, { status: 500 });
  }
}
