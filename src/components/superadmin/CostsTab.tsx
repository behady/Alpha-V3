"use client";

import React, { useEffect, useMemo, useState } from "react";
import { auth } from "@/lib/firebase";
import { AlertTriangle, Loader2, RefreshCcw, Bot, MessageSquare } from "lucide-react";
import { COST_RATIO_CEILING, type ClinicMargin } from "@/lib/platformCost";
import { CacheSavingPanel } from "./CacheSavingPanel";

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
  aiCostByFeatureUsd: Record<string, number>;
  /** The clinics' own Meta bills, summed. Shown for context; never part of our cost. */
  clinicsWhatsappUsd: number;
};

const egp = (n: number) => `${Math.round(n).toLocaleString("en-US")} ج.م`;
const pct = (r: number | null) => (r === null ? "—" : `${(r * 100).toFixed(1)}%`);

/**
 * What each feature key means to a person reading the bill. Keys come from the `feature` every
 * charge is logged under (see lib/aiCreditLog and the routes); an unknown key shows as itself.
 */
const FEATURE_LABELS: Record<string, string> = {
  whatsapp_bot: "WhatsApp replies",
  whatsapp_sales: "WhatsApp sales replies",
  whatsapp_voice: "WhatsApp voice notes",
  whatsapp_photo: "WhatsApp photos",
  reception: "Reception panel",
  chat: "Assistant chat",
  treatment_plan: "Treatment plans",
  plan_translation: "Plan translation",
  diagnosis_chat: "Diagnosis chat",
  ortho_analyze: "Ortho auto-diagnosis",
  marketing_single: "Marketing posts",
  marketing_month: "Marketing month plans",
  bot_coach: "Nightly bot coach",
  bot_memory: "Nightly patient memory",
  bot_playbook: "Weekly sales playbook",
};
const featureLabel = (k: string) => FEATURE_LABELS[k] || k;

/** The feature that cost the most on one clinic, and its share of that clinic's Google bill. */
function topFeature(byFeature: Record<string, number> | undefined, total: number): { label: string; share: number } | null {
  const entries = Object.entries(byFeature || {}).filter(([, v]) => v > 0);
  if (entries.length === 0 || total <= 0) return null;
  const [key, usd] = entries.sort((a, b) => b[1] - a[1])[0];
  return { label: featureLabel(key), share: usd / total };
}

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
  const [answer, setAnswer] = useState<{ key: string; totals: Totals | null; rows: ClinicMargin[]; usdToEgp: number; error: string } | null>(null);
  const loading = answer?.key !== requestKey;
  const rows = answer?.rows ?? [];
  const totals = answer?.totals ?? null;
  const usdToEgp = answer?.usdToEgp ?? 48;
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
      return data as { totals: Totals; clinics: ClinicMargin[]; usdToEgp: number };
    }

    fetchCosts()
      .then((data) => {
        if (!cancelled) setAnswer({ key: requestKey, totals: data.totals, rows: data.clinics, usdToEgp: Number(data.usdToEgp) || 48, error: "" });
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setAnswer({ key: requestKey, totals: null, rows: [], usdToEgp: 48, error: e instanceof Error ? e.message : "Failed to load" });
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
            <span className="flex items-center gap-1.5" title="Billed by Meta to each clinic's own account. Not our cost.">
              <MessageSquare size={13} /> Clinics&apos; Meta bills ${totals.clinicsWhatsappUsd.toFixed(2)}
            </span>
          </div>

          {/* Where the Google money goes. The answer to "what does the treatment planner cost us". */}
          {Object.keys(totals.aiCostByFeatureUsd || {}).length > 0 && (
            <div className="overflow-x-auto rounded-xl border border-slate-800">
              <table className="w-full text-sm">
                <thead className="bg-slate-900 text-[11px] uppercase tracking-wide text-slate-500">
                  <tr>
                    {["Google, by feature", "USD", "EGP", "Share"].map((h) => (
                      <th key={h} className="px-3 py-2.5 text-start font-bold">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(totals.aiCostByFeatureUsd)
                    .sort((a, b) => b[1] - a[1])
                    .map(([key, usd]) => {
                      const share = totals.aiCostUsd > 0 ? usd / totals.aiCostUsd : 0;
                      return (
                        <tr key={key} className="border-t border-slate-800">
                          <td className="px-3 py-2 font-bold text-white">
                            {featureLabel(key)}
                            {key !== featureLabel(key) && <span className="ms-2 font-mono text-[10px] text-slate-600">{key}</span>}
                          </td>
                          <td className="px-3 py-2 font-figure font-semibold text-slate-300">${usd.toFixed(3)}</td>
                          <td className="px-3 py-2 font-figure font-semibold text-slate-300">{egp(usd * usdToEgp)}</td>
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-2">
                              <div className="h-1.5 w-24 overflow-hidden rounded-full bg-slate-800">
                                <div className="h-full rounded-full bg-amber-400" style={{ width: `${Math.round(share * 100)}%` }} />
                              </div>
                              <span className="font-figure text-xs font-bold text-slate-400">{(share * 100).toFixed(0)}%</span>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          )}

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
                  {["Clinic", "Plan", "Pays", "Credits", "Google", "Mostly on", "Their Meta bill", "Our cost", "Left", "Of revenue"].map((h) => (
                    <th key={h} className="px-3 py-2.5 text-start font-bold">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const hot = r.costRatio !== null && r.costRatio > COST_RATIO_CEILING;
                  const waUsd = r.clinicWhatsappUsd;
                  const top = topFeature(r.aiCostByFeatureUsd, r.aiCostUsd);
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
                      <td className="px-3 py-2.5 font-figure font-semibold text-slate-300">
                        ${r.aiCostUsd.toFixed(3)}
                        {r.creditsUsed > 0 && r.aiMeasuredCalls < r.creditsUsed / 2 && (
                          <span
                            className="ms-1 text-[10px] font-bold uppercase text-amber-400"
                            title={`Only ${r.aiMeasuredCalls} of ${r.creditsUsed} charges recorded tokens — this is a floor, not the full bill.`}
                          >
                            part
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-xs font-semibold text-slate-400">
                        {top ? (
                          <span title={`${(top.share * 100).toFixed(0)}% of this clinic's Google bill`}>
                            {top.label} <span className="text-slate-600">{(top.share * 100).toFixed(0)}%</span>
                          </span>
                        ) : (
                          <span className="text-slate-700">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 font-figure font-semibold text-slate-500" title="Billed by Meta to the clinic's own account">
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

          <CacheSavingPanel />

          <p className="text-xs font-semibold text-slate-500">
            Meta bills each clinic&apos;s own account — the Meta column is their spend, shown for context, and is never part of
            our cost; it is Meta&apos;s own figure where reported, marked <span className="uppercase">est</span> where we
            are still estimating. Google is priced per model from the token log — super mode runs on Pro and costs several
            times Flash. The by-feature split covers charges since 9 Sep 2026, when per-feature token logging shipped. Intro pricing ends 31 Dec 2026; from January the Google column roughly doubles. A Google figure marked
            <span className="uppercase"> part</span> covers only the charges that recorded tokens — token logging began
            in late Aug 2026 and the WhatsApp assistant only joined it on 6 Sep, so earlier months read low.
          </p>
        </>
      )}
    </div>
  );
}
