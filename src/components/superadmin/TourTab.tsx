"use client";

import React, { useCallback, useEffect, useState } from "react";
import { auth } from "@/lib/firebase";
import { Loader2, RefreshCcw, Hand, Users, Flag } from "lucide-react";

/**
 * Where the tour loses people, and whether anyone does the hands-on parts.
 *
 * Until this existed the only evidence a tour had happened was `localStorage` on somebody else's
 * laptop. The one column that matters is "last seen": the stop where a person's events stop is
 * the stop that lost them, and a spike anywhere but the finale is a script to rewrite.
 */

interface StopRow {
  stopId: string;
  title: string;
  reached: number;
  lastSeen: number;
}

interface Stats {
  days: number;
  events: number;
  people: number;
  counts: Record<string, number>;
  handsOn: { offered: number; started: number; done: number; gaveUp: number };
  runs: Record<string, { started: number; finished: number }>;
  stops: StopRow[];
}

export function TourTab() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState(30);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch(`/api/admin/tour-stats?days=${days}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Could not load the tour's numbers.");
      setStats(data as Stats);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load.");
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => {
    void load();
  }, [load]);

  const maxReached = Math.max(1, ...(stats?.stops.map((s) => s.reached) ?? [1]));
  const runRows = Object.entries(stats?.runs ?? {});

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-black text-white">Sara&apos;s tour</h2>
        <select
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
          className="rounded-lg bg-slate-800 px-3 py-1.5 text-sm font-bold text-slate-200 outline-none"
        >
          <option value={7}>Last 7 days</option>
          <option value={30}>Last 30 days</option>
          <option value={90}>Last 90 days</option>
        </select>
        <button
          onClick={() => void load()}
          className="inline-flex items-center gap-2 rounded-lg bg-slate-800 px-3 py-1.5 text-sm font-bold text-slate-200 hover:bg-slate-700"
        >
          <RefreshCcw size={14} />
          Refresh
        </button>
        {loading && <Loader2 size={16} className="animate-spin text-slate-400" />}
      </div>

      {error && <p className="rounded-xl bg-red-500/10 px-4 py-3 text-sm font-bold text-red-300">{error}</p>}

      {stats && (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            {[
              { icon: Users, label: "People who started", value: stats.people },
              {
                icon: Flag,
                label: "Runs finished",
                value: `${runRows.reduce((a, [, r]) => a + r.finished, 0)} / ${runRows.reduce((a, [, r]) => a + r.started, 0)}`,
              },
              {
                icon: Hand,
                label: "Hands-on taken",
                value: `${stats.handsOn.done} done · ${stats.handsOn.gaveUp} left · ${stats.handsOn.offered} offered`,
              },
            ].map(({ icon: Icon, label, value }) => (
              <div key={label} className="rounded-2xl bg-slate-900 p-4 ring-1 ring-white/5">
                <div className="flex items-center gap-2 text-[11px] font-black uppercase tracking-wider text-slate-400">
                  <Icon size={13} />
                  {label}
                </div>
                <p className="mt-1.5 text-xl font-black text-white">{value}</p>
              </div>
            ))}
          </div>

          {stats.stops.length === 0 ? (
            <p className="rounded-2xl bg-slate-900 p-6 text-center text-sm font-bold text-slate-400">
              Nobody has taken the tour in this window.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-2xl bg-slate-900 ring-1 ring-white/5">
              <table className="w-full text-sm">
                <thead className="text-[11px] font-black uppercase tracking-wider text-slate-400">
                  <tr>
                    <th className="px-4 py-3 text-left">Stop</th>
                    <th className="px-4 py-3 text-right">Reached</th>
                    <th className="px-4 py-3 text-right">Last seen here</th>
                    <th className="px-4 py-3 text-left">&nbsp;</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {stats.stops.map((row) => (
                    <tr key={row.stopId} className={row.lastSeen > 0 ? "bg-amber-500/5" : ""}>
                      <td className="px-4 py-2.5 font-bold text-slate-200">
                        {row.title}
                        <span className="ms-2 text-[10px] font-medium text-slate-500">{row.stopId}</span>
                      </td>
                      <td className="px-4 py-2.5 text-right font-black tabular-nums text-slate-200">{row.reached}</td>
                      <td className="px-4 py-2.5 text-right font-black tabular-nums text-amber-300">{row.lastSeen || ""}</td>
                      <td className="w-40 px-4 py-2.5">
                        <div className="h-1.5 w-full rounded-full bg-white/5">
                          <div
                            className="h-full rounded-full bg-[#FACC15]"
                            style={{ width: `${Math.round((row.reached / maxReached) * 100)}%` }}
                          />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <p className="text-[11px] font-medium text-slate-500">
            {stats.events.toLocaleString()} events. &ldquo;Last seen here&rdquo; is where a person&apos;s events stop —
            on any stop but the finale, that is a drop-off.
          </p>
        </>
      )}
    </div>
  );
}

export default TourTab;
