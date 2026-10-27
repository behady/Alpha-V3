"use client";

import React, { useMemo, useState } from "react";
import { ExternalLink, Loader2, RefreshCcw, Search, X } from "lucide-react";
import type { SubscriptionTier } from "@/types/saas";
import { TIERS, isTrial, monthlyValue, balanceOwed, toDate, type ConsoleClinic } from "./clinicMath";
import { useSuperAdminText, type SAKey } from "./i18n";

export type BulkAction = { kind: "extend"; days: number } | { kind: "plan"; tier: SubscriptionTier } | { kind: "status"; status: "Active" | "Suspended" };

type Filter = "all" | "active" | "trial" | "ending" | "expired" | "suspended";
type Sort = "expiring" | "newest" | "revenue" | "name";

const TIER_KEY: Record<SubscriptionTier, SAKey> = { "Free Trial": "tierFree", Basic: "tierBasic", Pro: "tierPro", Premium: "tierPremium" };
const STATUS_KEY: Record<string, SAKey> = { Active: "stActive", Suspended: "stSuspended", Expired: "stExpired" };

const TIER_PILL: Record<SubscriptionTier, string> = {
  "Free Trial": "bg-surface-muted text-ink-body",
  Basic: "bg-info-tint text-info",
  Pro: "bg-ink-slab text-white",
  Premium: "bg-accent text-ink-on-accent",
};

function matches(c: ConsoleClinic, f: Filter): boolean {
  const d = c.daysRemaining;
  switch (f) {
    case "active": return c.status === "Active";
    case "trial": return isTrial(c);
    case "ending": return d !== undefined && d >= 0 && d <= 14;
    case "expired": return c.status === "Expired" || (d !== undefined && d < 0);
    case "suspended": return c.status === "Suspended";
    default: return true;
  }
}

interface Props {
  clinics: ConsoleClinic[];
  loading: boolean;
  onOpen: (id: string) => void;
  onBulk: (ids: string[], action: BulkAction) => Promise<void>;
}

export function ClinicsTable({ clinics, loading, onOpen, onBulk }: Props) {
  const { t, num, days, money, date, locale } = useSuperAdminText();
  const [filter, setFilter] = useState<Filter>("all");
  const [tier, setTier] = useState<"" | SubscriptionTier>("");
  const [sort, setSort] = useState<Sort>("expiring");
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = clinics.filter(
      (c) =>
        matches(c, filter) &&
        (!tier || c.subscriptionTier === tier) &&
        (!needle || c.name?.toLowerCase().includes(needle) || c.id.toLowerCase().includes(needle) || c.ownerEmail?.toLowerCase().includes(needle))
    );
    const by: Record<Sort, (a: ConsoleClinic, b: ConsoleClinic) => number> = {
      expiring: (a, b) => (a.daysRemaining ?? Infinity) - (b.daysRemaining ?? Infinity),
      newest: (a, b) => (toDate(b.createdAt)?.getTime() ?? 0) - (toDate(a.createdAt)?.getTime() ?? 0),
      revenue: (a, b) => monthlyValue(b) - monthlyValue(a),
      name: (a, b) => (a.name || "").localeCompare(b.name || "", locale),
    };
    return list.sort(by[sort]);
  }, [clinics, filter, tier, sort, q, locale]);

  const counts = useMemo(() => {
    const out = {} as Record<Filter, number>;
    (["all", "active", "trial", "ending", "expired", "suspended"] as Filter[]).forEach((f) => (out[f] = clinics.filter((c) => matches(c, f)).length));
    return out;
  }, [clinics]);

  // Only rows on screen can be acted on: a filter change must not leave hidden clinics selected.
  const selected = rows.filter((r) => sel.has(r.id)).map((r) => r.id);
  const allShownSelected = rows.length > 0 && selected.length === rows.length;
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toggleAll = () => setSel(allShownSelected ? new Set() : new Set(rows.map((r) => r.id)));

  const runBulk = async (action: BulkAction) => {
    setBusy(true);
    try {
      await onBulk(selected, action);
      setSel(new Set());
    } finally {
      setBusy(false);
    }
  };

  const chips: { key: Filter; label: SAKey }[] = [
    { key: "all", label: "fAll" }, { key: "active", label: "fActive" }, { key: "trial", label: "fTrial" },
    { key: "ending", label: "fEnding" }, { key: "expired", label: "fExpired" }, { key: "suspended", label: "fSuspended" },
  ];

  const expiry = (c: ConsoleClinic) => {
    const d = c.daysRemaining;
    const end = toDate(c.expiresAt);
    if (d === undefined || !end) return { main: t("noEndDate"), sub: isTrial(c) ? "" : t("attnNoDateBody"), cls: "text-warn" };
    if (d < 0) return { main: t("endedAgo", { days: days(-d) }), sub: t("endsOn", { d: date(end) }), cls: "text-danger" };
    if (d === 0) return { main: t("endsToday"), sub: date(end), cls: "text-danger" };
    return {
      main: t("daysLeft", { days: days(d) }),
      sub: t("endsOn", { d: date(end) }),
      cls: d <= 7 ? "text-danger" : d <= 14 ? "text-warn" : "text-ink",
    };
  };

  const fieldCls = "min-h-[40px] rounded-xl border border-line-strong bg-surface px-3 text-sm text-ink outline-none focus:border-ink";

  return (
    <section aria-labelledby="list-h" className="bg-surface border border-line rounded-3xl flex flex-col min-w-0">
      <div className="px-4 md:px-5 py-4 flex flex-wrap items-center gap-3 border-b border-line">
        <h2 id="list-h" className="font-display text-base font-bold text-ink me-1">{t("allClinics")}</h2>
        <div role="group" aria-label={t("status")} className="flex flex-wrap gap-1.5">
          {chips.map((c) => {
            const on = filter === c.key;
            return (
              <button
                key={c.key}
                type="button"
                aria-pressed={on}
                onClick={() => setFilter(c.key)}
                className={`min-h-[36px] px-3 rounded-full text-[13px] font-semibold border transition-colors ${
                  on ? "bg-ink-slab text-white border-ink-slab" : "bg-surface text-ink-body border-line-strong hover:bg-surface-subtle"
                }`}
              >
                {t(c.label)} <span className="font-figure opacity-70 ms-0.5">{num(counts[c.key])}</span>
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center gap-2 ms-auto w-full xl:w-auto">
          <label className={`${fieldCls} flex items-center gap-2 flex-1 xl:flex-none xl:w-64 focus-within:border-ink`}>
            <Search size={16} className="text-ink-muted shrink-0" aria-hidden />
            <span className="sr-only">{t("searchLabel")}</span>
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t("searchPh")}
              className="flex-1 min-w-0 bg-transparent outline-none text-sm"
            />
          </label>
          <label className="flex items-center gap-1.5 text-[13px] text-ink-muted">
            {t("plan")}
            <select value={tier} onChange={(e) => setTier(e.target.value as "" | SubscriptionTier)} className={fieldCls}>
              <option value="">{t("allPlans")}</option>
              {TIERS.map((x) => <option key={x} value={x}>{t(TIER_KEY[x])}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-1.5 text-[13px] text-ink-muted">
            {t("sort")}
            <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} className={fieldCls}>
              <option value="expiring">{t("sortExpiring")}</option>
              <option value="newest">{t("sortNewest")}</option>
              <option value="revenue">{t("sortRevenue")}</option>
              <option value="name">{t("sortName")}</option>
            </select>
          </label>
          <button
            type="button"
            onClick={() => window.location.reload()}
            aria-label={t("refresh")}
            title={t("refresh")}
            className="min-h-[40px] w-10 rounded-xl border border-line-strong bg-surface text-ink-body flex items-center justify-center hover:bg-surface-subtle"
          >
            <RefreshCcw size={16} aria-hidden />
          </button>
        </div>
      </div>

      {selected.length > 0 && (
        <div className="mx-3 md:mx-4 mt-3 px-3 py-2.5 rounded-2xl bg-ink-slab text-white flex flex-wrap items-center gap-2">
          <span className="font-semibold text-sm me-2">{t("selected", { n: num(selected.length) })}</span>
          <button type="button" disabled={busy} onClick={() => runBulk({ kind: "extend", days: 14 })} className="min-h-[36px] px-3 rounded-lg border border-white/20 text-[13px] font-semibold hover:bg-white/10 disabled:opacity-50">
            {t("bulkExtend")}
          </button>
          <label className="sr-only" htmlFor="bulk-plan">{t("bulkPlan")}</label>
          <select
            id="bulk-plan"
            disabled={busy}
            value=""
            onChange={(e) => { const v = e.target.value as SubscriptionTier; if (v) void runBulk({ kind: "plan", tier: v }); }}
            className="min-h-[36px] px-2 rounded-lg border border-white/20 bg-ink-slab text-[13px] font-semibold text-white disabled:opacity-50"
          >
            <option value="">{t("bulkPlan")}</option>
            {TIERS.map((x) => <option key={x} value={x}>{t(TIER_KEY[x])}</option>)}
          </select>
          <button type="button" disabled={busy} onClick={() => runBulk({ kind: "status", status: "Active" })} className="min-h-[36px] px-3 rounded-lg border border-white/20 text-[13px] font-semibold hover:bg-white/10 disabled:opacity-50">
            {t("bulkActivate")}
          </button>
          <button type="button" disabled={busy} onClick={() => runBulk({ kind: "status", status: "Suspended" })} className="min-h-[36px] px-3 rounded-lg border border-red-300/40 text-red-200 text-[13px] font-semibold hover:bg-white/10 disabled:opacity-50">
            {t("bulkSuspend")}
          </button>
          {busy && <Loader2 size={16} className="animate-spin" aria-hidden />}
          <button type="button" onClick={() => setSel(new Set())} className="ms-auto min-h-[36px] px-3 rounded-lg text-[13px] text-white/70 hover:text-white inline-flex items-center gap-1">
            <X size={14} aria-hidden /> {t("clear")}
          </button>
        </div>
      )}

      {loading ? (
        <div className="p-12 flex justify-center"><Loader2 className="animate-spin text-ink-muted" size={28} /></div>
      ) : rows.length === 0 ? (
        <div className="p-14 text-center">
          <p className="font-semibold text-ink">{t("noMatch")}</p>
          <p className="text-sm text-ink-muted mt-1">{t("noMatchSub")}</p>
        </div>
      ) : (
        <div className="overflow-x-auto px-2 pb-2 pt-1">
          <table className="w-full min-w-[1040px] border-collapse text-sm">
            <thead>
              <tr className="text-start text-xs text-ink-muted">
                <th scope="col" className="p-3 w-10 text-start">
                  <input type="checkbox" checked={allShownSelected} onChange={toggleAll} aria-label={t("selectAll")} className="w-[18px] h-[18px] accent-[var(--ink-slab)] cursor-pointer" />
                </th>
                <th scope="col" className="p-3 font-semibold text-start">{t("colClinic")}</th>
                <th scope="col" className="p-3 font-semibold text-start">{t("colPlan")}</th>
                <th scope="col" className="p-3 font-semibold text-start">{t("colExpiry")}</th>
                <th scope="col" className="p-3 font-semibold text-start">{t("colStaff")}</th>
                <th scope="col" className="p-3 font-semibold text-start">{t("colAi")}</th>
                <th scope="col" className="p-3 font-semibold text-start">{t("colPaid")}</th>
                <th scope="col" className="p-3 font-semibold text-end">{t("colActions")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => {
                const on = sel.has(c.id);
                const ex = expiry(c);
                const pct = c.aiLimit > 0 ? Math.min(100, (c.aiUsed / c.aiLimit) * 100) : 0;
                const price = Number(c.customPrice) || 0;
                const owed = balanceOwed(c);
                const joined = toDate(c.createdAt);
                return (
                  <tr key={c.id} className={`border-t border-line transition-colors ${on ? "bg-accent-tint" : "hover:bg-surface-subtle"}`}>
                    <td className="p-3">
                      <input type="checkbox" checked={on} onChange={() => toggle(c.id)} aria-label={`${t("select")} ${c.name}`} className="w-[18px] h-[18px] accent-[var(--ink-slab)] cursor-pointer" />
                    </td>
                    <td className="p-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="w-9 h-9 rounded-xl bg-surface-muted text-ink font-bold flex items-center justify-center shrink-0" dir="auto">
                          {c.name?.charAt(0).toUpperCase()}
                        </span>
                        <div className="flex flex-col min-w-0">
                          <button type="button" onClick={() => onOpen(c.id)} dir="auto" className="self-start max-w-full font-semibold text-ink text-start truncate hover:underline underline-offset-4">
                            {c.name}
                          </button>
                          <span className={`text-xs truncate ${c.ownerEmail ? "text-ink-muted" : "text-warn"}`}>
                            {c.ownerEmail ? <span dir="ltr">{c.ownerEmail}</span> : t("noOwner")}
                            {joined && <span className="text-ink-faint"> · {t("joined", { d: date(joined) })}</span>}
                          </span>
                        </div>
                      </div>
                    </td>
                    <td className="p-3">
                      <div className="flex flex-col items-start gap-1">
                        <span className={`text-xs font-bold px-2.5 py-0.5 rounded-full ${TIER_PILL[c.subscriptionTier] || TIER_PILL["Free Trial"]}`}>
                          {t(TIER_KEY[c.subscriptionTier] || "tierFree")}
                        </span>
                        <span className="flex items-center gap-1.5 text-xs text-ink-muted">
                          <span className={`w-2 h-2 rounded-full ${c.status === "Active" ? "bg-ok" : c.status === "Suspended" ? "bg-ink-faint" : "bg-danger"}`} aria-hidden />
                          {t(STATUS_KEY[c.status] || "stActive")}
                        </span>
                      </div>
                    </td>
                    <td className="p-3 min-w-[150px]">
                      <div className="flex flex-col gap-0.5">
                        <span className={`font-semibold ${ex.cls}`}>{ex.main}</span>
                        {ex.sub && <span className="text-xs text-ink-muted">{ex.sub}</span>}
                      </div>
                    </td>
                    <td className="p-3 font-figure">{num(c.staffCount)}</td>
                    <td className="p-3 min-w-[140px]">
                      <div className="flex flex-col gap-1.5">
                        <span className="text-xs text-ink-muted font-figure">{num(c.aiUsed)} / {num(c.aiLimit)}</span>
                        <div className="h-1.5 rounded-full bg-surface-muted overflow-hidden">
                          <div className={`h-full ${pct >= 90 ? "bg-danger" : "bg-ink-slab"}`} style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    </td>
                    <td className={`p-3 font-figure ${owed > 0 ? "text-danger" : "text-ink"}`}>
                      {price > 0 ? `${money(Number(c.amountPaid) || 0)} / ${money(price)}` : "—"}
                    </td>
                    <td className="p-3">
                      <div className="flex justify-end gap-1.5">
                        <a
                          href={`/?clinic=${c.id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="min-h-[36px] px-3 rounded-lg border border-line-strong bg-surface text-ink text-[13px] font-semibold inline-flex items-center gap-1.5 hover:bg-surface-subtle whitespace-nowrap"
                        >
                          <ExternalLink size={14} aria-hidden /> {t("enterClinic")}
                        </a>
                        <button
                          type="button"
                          onClick={() => onOpen(c.id)}
                          className="min-h-[36px] px-3 rounded-lg bg-ink-slab text-white text-[13px] font-semibold hover:bg-ink whitespace-nowrap"
                        >
                          {t("manage")}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="px-5 py-3 border-t border-line text-[13px] text-ink-muted">
        {t("showing", { n: num(rows.length), total: num(clinics.length) })}
      </div>
    </section>
  );
}
