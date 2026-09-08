"use client";

import { useEffect, useState } from "react";
import { auth } from "@/lib/firebase";

/**
 * What the AI costs the platform, and whether the rulebook cache is saving money.
 *
 * One question, answered with one number: the average cost of a WhatsApp reply before the cache
 * went live and after. Everything else on the screen exists to make that number checkable — the
 * day-by-day table is what you would reconcile against Google's invoice, and the cached share is
 * how you would tell a cache that stopped hitting from a quiet week.
 *
 * Money is the platform's alone. Clinics see credits in their own settings and never this.
 */

interface Summary {
  replies: number;
  usd: number;
  usdPerReply: number;
  egpPerReply: number;
  cachedShare: number;
}

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

interface Report {
  ok: boolean;
  days: number;
  feature: string;
  cutoverDay: string | null;
  egpPerUsd: number;
  before: Summary;
  after: Summary;
  saving: number | null;
  rows: DayRow[];
  error?: string;
}

const usd = (n: number, digits = 2) => `$${n.toFixed(digits)}`;
const pct = (n: number) => `${Math.round(n * 100)}%`;
const num = (n: number) => n.toLocaleString("en-US");

export function AiCostsTab() {
  const [days, setDays] = useState(30);
  const [feature, setFeature] = useState<"whatsapp" | "all">("whatsapp");
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const token = await auth.currentUser?.getIdToken();
        const res = await fetch(`/api/admin/ai-costs?days=${days}&feature=${feature}`, { headers: { Authorization: `Bearer ${token}` } });
        const json = (await res.json()) as Report;
        if (!json.ok) throw new Error(json.error || "failed");
        if (!cancelled) setReport(json);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "failed");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [days, feature]);

  const before = report?.before;
  const after = report?.after;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-black text-white">AI cost to the platform</h2>
        <div className="flex items-center gap-1 rounded-lg bg-slate-800 p-1 text-xs font-bold">
          {[7, 30, 90].map((d) => (
            <button key={d} onClick={() => setDays(d)} className={`px-3 py-1 rounded-md ${days === d ? "bg-indigo-500 text-white" : "text-slate-400 hover:text-white"}`}>
              {d} days
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1 rounded-lg bg-slate-800 p-1 text-xs font-bold">
          {(["whatsapp", "all"] as const).map((f) => (
            <button key={f} onClick={() => setFeature(f)} className={`px-3 py-1 rounded-md ${feature === f ? "bg-indigo-500 text-white" : "text-slate-400 hover:text-white"}`}>
              {f === "whatsapp" ? "WhatsApp assistant" : "All AI"}
            </button>
          ))}
        </div>
        {loading ? <span className="text-xs text-slate-400">loading…</span> : null}
      </div>

      {error ? <p className="text-sm text-red-400">{error}</p> : null}

      {report && before && after ? (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Tile
              label={report.cutoverDay ? `Before the cache (to ${report.cutoverDay})` : "All replies (no cache yet)"}
              big={before.replies ? usd(before.usdPerReply, 4) : "—"}
              sub={before.replies ? `${num(before.replies)} replies · ${before.egpPerReply.toFixed(2)} EGP each · ${pct(before.cachedShare)} cached` : "no priced replies in range"}
            />
            <Tile
              label={report.cutoverDay ? `After the cache (from ${report.cutoverDay})` : "After the cache"}
              big={after.replies ? usd(after.usdPerReply, 4) : "—"}
              sub={after.replies ? `${num(after.replies)} replies · ${after.egpPerReply.toFixed(2)} EGP each · ${pct(after.cachedShare)} cached` : "nothing yet"}
              accent
            />
            <Tile
              label="Saving per reply"
              big={report.saving == null ? "—" : pct(report.saving)}
              sub={report.saving == null ? "needs replies on both sides of the line" : `Google's rate for the day of each reply; cached tokens at a tenth`}
            />
          </div>

          <p className="text-xs text-slate-400 max-w-3xl leading-relaxed">
            Priced from the raw token counts on every reply, at Google&apos;s published rate for that day (1 USD = {report.egpPerUsd} EGP shown for
            reference). &ldquo;Cached&rdquo; is the share of input tokens Google served from the shared rulebook cache. A day with a low cached share after the
            cutover means the cache was not hitting, not that the clinic was quiet.
          </p>

          <div className="overflow-x-auto rounded-xl border border-slate-800">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-800/60 text-xs uppercase tracking-wider text-slate-400">
                <tr>
                  <th className="px-3 py-2">Day</th>
                  <th className="px-3 py-2 text-right">Replies</th>
                  <th className="px-3 py-2 text-right">Input tokens</th>
                  <th className="px-3 py-2 text-right">Cached</th>
                  <th className="px-3 py-2 text-right">Output</th>
                  <th className="px-3 py-2 text-right">Cost</th>
                  <th className="px-3 py-2 text-right">Per reply</th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {report.rows.map((r) => {
                  const afterLine = report.cutoverDay ? r.day >= report.cutoverDay : false;
                  return (
                    <tr key={r.day} className={`border-t border-slate-800 ${afterLine ? "bg-indigo-500/5" : ""}`}>
                      <td className="px-3 py-2 font-mono text-xs text-slate-300">
                        {r.day}
                        {report.cutoverDay === r.day ? <span className="ml-2 rounded bg-indigo-500 px-1.5 py-0.5 text-[10px] font-black text-white">cache on</span> : null}
                      </td>
                      <td className="px-3 py-2 text-right">{num(r.replies)}</td>
                      <td className="px-3 py-2 text-right text-slate-400">{num(r.inputTokens)}</td>
                      <td className="px-3 py-2 text-right">
                        <span className={r.cachedShare > 0.5 ? "text-emerald-400" : "text-slate-400"}>{pct(r.cachedShare)}</span>
                      </td>
                      <td className="px-3 py-2 text-right text-slate-400">{num(r.outputTokens)}</td>
                      <td className="px-3 py-2 text-right">{usd(r.usd)}</td>
                      <td className="px-3 py-2 text-right font-bold">{usd(r.usdPerReply, 4)}</td>
                    </tr>
                  );
                })}
                {report.rows.length === 0 ? (
                  <tr>
                    <td className="px-3 py-6 text-center text-slate-500" colSpan={7}>
                      No priced replies in this range. Rows only carry token counts since the meter shipped (7 Sept 2026).
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </div>
  );
}

function Tile({ label, big, sub, accent }: { label: string; big: string; sub: string; accent?: boolean }) {
  return (
    <div className={`rounded-xl border p-4 ${accent ? "border-indigo-500/60 bg-indigo-500/10" : "border-slate-800 bg-slate-900/60"}`}>
      <p className="text-[11px] font-black uppercase tracking-widest text-slate-400">{label}</p>
      <p className="mt-1 font-mono text-2xl font-bold text-white tabular-nums">{big}</p>
      <p className="mt-1 text-xs text-slate-400">{sub}</p>
    </div>
  );
}
