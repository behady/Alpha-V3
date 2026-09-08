"use client";

import { useEffect, useState } from "react";
import { auth } from "@/lib/firebase";
import { Loader2 } from "lucide-react";

/**
 * The same work, priced before and after one change.
 *
 * The rest of this tab reports what a month costs. That cannot answer whether a change helped —
 * a cheaper month might just be a quieter one. So this prices every WhatsApp reply from its own
 * token counts and splits them at the moment the rulebook cache was first created, which turns
 * the question into one number: the average cost of a reply on each side of that line.
 *
 * `cached` is the honesty column. A day after the cutover with a low cached share means the cache
 * stopped hitting — a fault that looks exactly like a quiet week if you only read the totals.
 */

interface Side {
  replies: number;
  usd: number;
  usdPerReply: number;
  cachedShare: number;
}

interface DayRow {
  day: string;
  replies: number;
  cachedShare: number;
  usd: number;
  usdPerReply: number;
}

interface Report {
  ok: boolean;
  cutoverDay: string | null;
  before: Side;
  after: Side;
  saving: number | null;
  rows: DayRow[];
  error?: string;
}

const usd = (n: number, d = 4) => `$${n.toFixed(d)}`;
const pct = (n: number) => `${Math.round(n * 100)}%`;

export function CacheSavingPanel({ egpPerUsd = 50 }: { egpPerUsd?: number }) {
  const [days, setDays] = useState(30);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState("");

  useEffect(() => {
    const key = String(days);
    let live = true;
    setPending(key);
    (async () => {
      try {
        const token = await auth.currentUser?.getIdToken();
        const res = await fetch(`/api/admin/platform-costs/cache?days=${days}&feature=whatsapp`, { headers: { Authorization: `Bearer ${token}` } });
        const json = (await res.json()) as Report;
        if (!live) return;
        if (!json.ok) throw new Error(json.error || "failed");
        setReport(json);
        setError("");
      } catch (e) {
        if (live) setError(e instanceof Error ? e.message : "failed");
      } finally {
        if (live) setPending("");
      }
    })();
    return () => {
      live = false;
    };
  }, [days]);

  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="text-sm font-black uppercase tracking-widest text-slate-300">Rulebook cache — before and after</h3>
        <div className="flex items-center gap-1 rounded-lg bg-slate-800 p-1 text-xs font-bold">
          {[7, 30, 90].map((d) => (
            <button key={d} onClick={() => setDays(d)} className={`px-2.5 py-1 rounded-md ${days === d ? "bg-indigo-500 text-white" : "text-slate-400 hover:text-white"}`}>
              {d}d
            </button>
          ))}
        </div>
        {pending ? <Loader2 size={14} className="animate-spin text-slate-500" /> : null}
      </div>

      {error ? <p className="text-sm text-red-400">{error}</p> : null}

      {report ? (
        report.before.replies + report.after.replies === 0 ? (
          <p className="text-xs text-slate-500">
            No priced replies yet in this window. Only replies sent after the token meter shipped (7 Sept 2026) carry the counts this needs.
          </p>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <Tile
                label={report.cutoverDay ? `Before ${report.cutoverDay}` : "All replies (cache not on yet)"}
                big={report.before.replies ? usd(report.before.usdPerReply) : "—"}
                sub={report.before.replies ? `${report.before.replies} replies · ${(report.before.usdPerReply * egpPerUsd).toFixed(2)} EGP each` : "none"}
              />
              <Tile
                label="After the cache"
                big={report.after.replies ? usd(report.after.usdPerReply) : "—"}
                sub={report.after.replies ? `${report.after.replies} replies · ${(report.after.usdPerReply * egpPerUsd).toFixed(2)} EGP each · ${pct(report.after.cachedShare)} cached` : "nothing yet"}
                accent
              />
              <Tile
                label="Saved per reply"
                big={report.saving == null ? "—" : pct(report.saving)}
                sub={report.saving == null ? "needs replies on both sides of the line" : "priced at Google's rate for each reply's own day"}
              />
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="text-slate-500">
                  <tr>
                    <th className="py-1 font-medium">Day</th>
                    <th className="py-1 text-right font-medium">Replies</th>
                    <th className="py-1 text-right font-medium">Cached</th>
                    <th className="py-1 text-right font-medium">Cost</th>
                    <th className="py-1 text-right font-medium">Per reply</th>
                  </tr>
                </thead>
                <tbody className="tabular-nums">
                  {report.rows.map((r) => (
                    <tr key={r.day} className={`border-t border-slate-800 ${report.cutoverDay && r.day >= report.cutoverDay ? "bg-indigo-500/5" : ""}`}>
                      <td className="py-1 font-mono text-slate-300">
                        {r.day}
                        {report.cutoverDay === r.day ? <span className="ml-2 rounded bg-indigo-500 px-1.5 py-px text-[10px] font-black text-white">cache on</span> : null}
                      </td>
                      <td className="py-1 text-right text-slate-400">{r.replies}</td>
                      <td className={`py-1 text-right ${r.cachedShare > 0.5 ? "text-emerald-400" : "text-slate-500"}`}>{pct(r.cachedShare)}</td>
                      <td className="py-1 text-right text-slate-400">${r.usd.toFixed(3)}</td>
                      <td className="py-1 text-right font-bold text-slate-200">{usd(r.usdPerReply)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )
      ) : null}
    </section>
  );
}

function Tile({ label, big, sub, accent }: { label: string; big: string; sub: string; accent?: boolean }) {
  return (
    <div className={`rounded-lg border p-3 ${accent ? "border-indigo-500/60 bg-indigo-500/10" : "border-slate-800 bg-slate-900"}`}>
      <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">{label}</p>
      <p className="mt-1 font-mono text-xl font-bold text-white tabular-nums">{big}</p>
      <p className="mt-0.5 text-[11px] text-slate-400">{sub}</p>
    </div>
  );
}
