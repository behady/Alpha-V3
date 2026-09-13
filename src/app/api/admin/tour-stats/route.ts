import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import { requireSuperAdmin } from "@/lib/apiStaffAuth";
import { reportServerError } from "@/lib/server/reportError";
import { TOUR_STOPS } from "@/lib/grandTour";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Where the tour loses people.
 *
 * Read across every clinic, because the question is about the tour, not about one clinic: which
 * stop is the last one most people see, how many of the hands-on moments are actually taken, and
 * how often someone clicks the page themselves rather than watching.
 *
 * Superadmin only — not because the numbers are sensitive (they are staff ids and stop names)
 * but because they are a product question, and a clinic has nothing to do with the answer.
 */

interface StopRow {
  stopId: string;
  title: string;
  /** People who reached it. */
  reached: number;
  /** People whose last event was here — the drop-off. */
  lastSeen: number;
}

export async function GET(request: Request) {
  const authz = await requireSuperAdmin(request);
  if (!authz.ok) return authz.response;

  try {
    const days = Math.min(90, Math.max(1, Number(new URL(request.url).searchParams.get("days")) || 30));
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    // One collection-group read: tour_events lives under every clinic.
    const snap = await adminDb().collectionGroup("tour_events").where("createdAt", ">=", since).limit(20000).get();

    const titles = new Map(TOUR_STOPS.map((s) => [s.id, s.title.en]));
    const reached = new Map<string, Set<string>>();
    const counts: Record<string, number> = {};
    /** The last stop each person was seen on, so "lastSeen" is a real drop-off, not a visit. */
    const lastStopByUser = new Map<string, { stopId: string; at: number }>();
    const runs = new Map<string, { started: number; finished: number }>();
    const handsOn = { offered: 0, started: 0, done: 0, gaveUp: 0 };

    for (const doc of snap.docs) {
      const d = doc.data() as Record<string, unknown>;
      const event = String(d.event || "");
      const stopId = typeof d.stopId === "string" ? d.stopId : null;
      const userId = String(d.userId || "?");
      const run = String(d.run || "?");
      const at = (d.createdAt as { toDate?: () => Date })?.toDate?.()?.getTime() ?? 0;
      counts[event] = (counts[event] || 0) + 1;

      if (event === "stop" && stopId) {
        if (!reached.has(stopId)) reached.set(stopId, new Set());
        reached.get(stopId)!.add(userId);
        const prev = lastStopByUser.get(userId);
        if (!prev || at >= prev.at) lastStopByUser.set(userId, { stopId, at });
      }
      if (event === "started" || event === "finished") {
        const row = runs.get(run) || { started: 0, finished: 0 };
        if (event === "started") row.started += 1;
        else row.finished += 1;
        runs.set(run, row);
      }
      if (event === "hands_on_offered") handsOn.offered += 1;
      if (event === "hands_on_started") handsOn.started += 1;
      if (event === "hands_on_done") handsOn.done += 1;
      if (event === "hands_on_gave_up") handsOn.gaveUp += 1;
    }

    const lastCounts: Record<string, number> = {};
    for (const { stopId } of lastStopByUser.values()) lastCounts[stopId] = (lastCounts[stopId] || 0) + 1;

    // In the tour's own order, so the drop-off reads as a curve rather than a league table.
    const stops: StopRow[] = TOUR_STOPS.filter((s) => reached.has(s.id) || lastCounts[s.id]).map((s) => ({
      stopId: s.id,
      title: titles.get(s.id) || s.id,
      reached: reached.get(s.id)?.size ?? 0,
      lastSeen: lastCounts[s.id] ?? 0,
    }));

    return NextResponse.json({
      ok: true,
      days,
      events: snap.size,
      counts,
      handsOn,
      runs: Object.fromEntries(runs),
      people: lastStopByUser.size,
      stops,
    });
  } catch (error) {
    reportServerError("Tour stats failed:", error);
    return NextResponse.json({ error: "Could not read the tour's numbers." }, { status: 500 });
  }
}
