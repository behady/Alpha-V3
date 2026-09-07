"use client";

import React, { useEffect, useMemo, useState } from "react";
import { auth } from "@/lib/firebase";
import { AlertTriangle, Loader2, RefreshCcw, Bot, MessageSquare } from "lucide-react";
import { COST_RATIO_CEILING, type ClinicMargin } from "@/lib/platformCost";

/**
 * What each clinic costs to run, and what is left after the suppliers are paid.
 *
 * PLATFORM-ONLY. This is the margin, per clinic, and nothing on this screen exists anywhere a
 * clinic can reach: they see credits and a plan price, never the Google or Meta invoice behind
 * them. The whole point of the product is that the credit is the abstraction.
 *
 * The question it answers, in one column: which clinics cost more than their plan assumed. A
 * clinic over the ceiling is not a problem to fix in code — it is a clinic on the wrong plan, and
 * this is the only place that shows up before renewal.
 */

type Totals = {
  clinics: number;
  revenueEgp: number;
  costEgp: number;
  marginEgp: number;
  costRatio: number | null;
  aiCostUsd: number;
  whatsappCostUsd: number;
};

const egp = (n: number) => `${Math.round(n).toLocaleString("en-US")} ج.م`;
const pct = (r: number | null) => (r === null ? "—" : `${(r * 100).toFixed(1)}%`);

export function CostsTab() {
  const [monthKey, setMonthKey] = useState(() => new Date().toISOString().slice(0, 7));
  const [reloadKey, setReloadKey] = useState(0);

  /*
   * One piece of state, stamped with the request it answers.
   *
   * `loading` is derived rather than stored: setting it at the top of the effect is a synchronous
   * state write inside an effect, which cascades a render and which the React compiler rejects.
   * Comparing the stamp to the current request gives the same spinner with nothing to keep in sync.
   */
  const requestKey = `${monthKey}#${reloadKey}`;
  const [answer, setAnswer] = useState<{ key: string; totals: Totals | null; rows: ClinicMargin[]; error: string } | null>(null);
  const loading = answer?.key !== requestKey;
  const rows = answer?.rows ?? [];
  const totals = answer?.totals ?? null;
  const error = answer?.error ?? "";

  useEffect(() => {
    let cancelled = false;

    async function fetchCosts() {
      const user = auth.currentUser;
      if (!user) throw new Error("Not signed in");
      const idToken = await user.getIdToken();
      const res = await fetch(`/api/admin/platform-costs?month=${encodeURIComponent(monthKey)}`, {
        headers: { Authorization: `Bearer ${idToken}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || "Failed to load");
      return data as { totals: Totals; clinics: ClinicMargin[] };
    }

    fetchCosts()
      .then((data) => {
        if (!cancelled) setAnswer({ key: requestKey, totals: data.totals, rows: data.clinics, error: "" });
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setAnswer({ key: requestKey, totals: null, rows: [], error: e instanceof Error ? e.message : "Failed to load" });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [monthKey, requestKey]);

  const months = useMemo(() => {
    const out: string[] = [];
    const d = new Date();
    for (let i = 0; i < 6; i++) {
      out.push(new Date(d.getFullYear(), d.getMonth() - i, 1).toISOString().slice(0, 7));
    }
    return out;
  }, []);

  const overCeiling = rows.filter((r) => r.costRatio !== null && r.costRatio > COST_RATIO_CEILING);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <select
          value={monthKey}
          onChange={(e) => setMonthKey(e.target.value)}
          className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm font-bold text-white"
        >
          {months.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <button
          onClick={() => setReloadKey((n) => n + 1)}
          className="flex items-center gap-2 rounded-lg bg-slate-800 px-3 py-2 text-sm font-bold text-slate-300 hover:text-white"
        >
          <RefreshCcw size={14} /> Refresh
        </button>
        <span className="text-xs font-semibold text-slate-500">
          Supplier invoices. Never shown to a clinic.
        </span>
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-sm font-bold text-slate-400">
          <Loader2 size={16} className="animate-spin" /> Reading Google and Meta…
        </div>
      )}
      {error && <div className="rounded-lg bg-rose-500/10 p-4 text-sm font-bold text-rose-300">{error}</div>}

      {totals && !loading && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[
              { label: "Subscriptions", value: egp(totals.revenueEgp), tone: "text-white" },
              { label: "Suppliers", value: egp(totals.costEgp), tone: "text-amber-300" },
              { label: "Left over", value: egp(totals.marginEgp), tone: "text-emerald-300" },
              {
                label: "Cost of revenue",
                value: pct(totals.costRatio),
                tone: totals.costRatio !== null && totals.costRatio > COST_RATIO_CEILING ? "text-rose-300" : "text-emerald-300",
              },
            ].map((k) => (
              <div key={k.label} className="rounded-xl border border-slate-800 bg-slate-900 p-4">
                <span className="block text-[11px] font-bold uppercase tracking-wide text-slate-500">{k.label}</span>
                <span className={`font-figure text-xl font-bold ${k.tone}`}>{k.value}</span>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap gap-4 text-xs font-bold text-slate-400">
            <span className="flex items-center gap-1.5">
              <Bot size={13} /> Google ${totals.aiCostUsd.toFixed(2)}
            </span>
            <span className="flex items-center gap-1.5">
              <MessageSquare size={13} /> Meta ${totals.whatsappCostUsd.toFixed(2)}
            </span>
          </div>

          {overCeiling.length > 0 && (
            <div className="flex items-start gap-2 rounded-lg bg-amber-500/10 p-3 text-sm font-bold text-amber-200">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
              <span>
                {overCeiling.length} clinic{overCeiling.length === 1 ? "" : "s"} cost more than{" "}
                {(COST_RATIO_CEILING * 100).toFixed(0)}% of what they pay:{" "}
                {overCeiling.map((r) => r.clinicName).join(", ")}. Worth a look before renewal.
              </span>
            </div>
          )}

          <div className="overflow-x-auto rounded-xl border border-slate-800">
            <table className="w-full text-sm">
              <thead className="bg-slate-900 text-[11px] uppercase tracking-wide text-slate-500">
                <tr>
                  {["Clinic", "Plan", "Pays", "Credits", "Google", "Meta", "Total cost", "Left", "Of revenue"].map((h) => (
                    <th key={h} className="px-3 py-2.5 text-start font-bold">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const hot = r.costRatio !== null && r.costRatio > COST_RATIO_CEILING;
                  const waUsd = r.whatsappBilledUsd ?? r.whatsappEstimateUsd;
                  return (
                    <tr key={r.clinicId} className="border-t border-slate-800">
                      <td className="px-3 py-2.5 font-bold text-white">
                        {r.clinicName}
                        {r.status !== "Active" && (
                          <span className="ms-2 text-[11px] font-semibold text-slate-500">{r.status}</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 font-semibold text-slate-300">{r.tier}</td>
                      <td className="px-3 py-2.5 font-figure font-semibold text-slate-300">{egp(r.monthlyRevenueEgp)}</td>
                      <td className="px-3 py-2.5 font-figure font-semibold text-slate-400">
                        {r.creditsUsed.toLocaleString("en-US")}
                        {r.creditLimit > 0 && <span className="text-slate-600"> / {r.creditLimit.toLocaleString("en-US")}</span>}
                      </td>
                      <td className="px-3 py-2.5 font-figure font-semibold text-slate-300">${r.aiCostUsd.toFixed(3)}</td>
                      <td className="px-3 py-2.5 font-figure font-semibold text-slate-300">
                        ${waUsd.toFixed(3)}
                        {r.whatsappBilledUsd === null && waUsd > 0 && (
                          <span className="ms-1 text-[10px] font-bold uppercase text-slate-600">est</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 font-figure font-bold text-amber-300">{egp(r.totalCostEgp)}</td>
                      <td className="px-3 py-2.5 font-figure font-bold text-emerald-300">{egp(r.marginEgp)}</td>
                      <td className={`px-3 py-2.5 font-figure font-bold ${hot ? "text-rose-300" : "text-slate-400"}`}>
                        {pct(r.costRatio)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <p className="text-xs font-semibold text-slate-500">
            Meta figures are its own billed numbers where reported, marked <span className="uppercase">est</span> where we
            are still estimating. Google is priced per model from the token log — super mode runs on Pro and costs several
            times Flash. Intro pricing ends 31 Dec 2026; from January the Google column roughly doubles.
          </p>
        </>
      )}
    </div>
  );
}
