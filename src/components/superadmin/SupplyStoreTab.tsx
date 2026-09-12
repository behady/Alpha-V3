"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Check, Loader2, Plug, ShoppingBag } from "lucide-react";
import { auth } from "@/lib/firebase";

/**
 * The partner shop's connection and what it earns the platform.
 *
 * SUPERADMIN ONLY. Two things on this screen never travel any further: the WooCommerce key pair,
 * which would open the partner's whole shop to whoever held it, and the commission rate, which is
 * the platform's margin. No clinic-facing screen shows either, and no clinic-facing route returns
 * them — see api/admin/supply-store-config for where that is enforced.
 *
 * The secret is write-only. Once saved it is never sent back here; the field shows whether one is
 * stored, and typing a new one replaces it. Leaving it blank changes nothing, so saving a new
 * commission rate cannot silently disconnect the shop.
 */

interface ConfigState {
  enabled: boolean;
  storeUrl: string;
  storeName: string;
  currency: string;
  commissionPercent: number;
  deliveryNote: string;
  consumerKeyPreview: string;
  secretSet: boolean;
  usable: boolean;
  updatedAt?: string;
}

interface CommissionRow {
  wooOrderId: number;
  clinicId: string;
  clinicName: string;
  placedAt: string;
  status: string;
  orderTotal: number;
  ratePercent: number;
  commission: number;
  currency: string;
}

export default function SupplyStoreTab() {
  const [config, setConfig] = useState<ConfigState | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [form, setForm] = useState({
    storeUrl: "",
    storeName: "",
    currency: "EGP",
    commissionPercent: "0",
    deliveryNote: "",
    consumerKey: "",
    consumerSecret: "",
  });

  const [rows, setRows] = useState<CommissionRow[]>([]);
  const [months, setMonths] = useState<{ month: string; orders: number; sales: number; commission: number }[]>([]);
  const [totals, setTotals] = useState({ orders: 0, sales: 0, commission: 0 });
  const [earningsError, setEarningsError] = useState("");

  const call = useCallback(async (path: string, init?: RequestInit) => {
    const token = await auth.currentUser?.getIdToken();
    if (!token) throw new Error("Not signed in");
    const res = await fetch(path, {
      ...init,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(init?.headers || {}) },
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.ok === false) throw new Error(json.error || `HTTP ${res.status}`);
    return json as Record<string, unknown>;
  }, []);

  const applyConfig = useCallback((json: Record<string, unknown>) => {
    const next: ConfigState = {
      enabled: json.enabled === true,
      storeUrl: String(json.storeUrl || ""),
      storeName: String(json.storeName || ""),
      currency: String(json.currency || "EGP"),
      commissionPercent: Number(json.commissionPercent) || 0,
      deliveryNote: String(json.deliveryNote || ""),
      consumerKeyPreview: String(json.consumerKeyPreview || ""),
      secretSet: json.secretSet === true,
      usable: json.usable === true,
      updatedAt: json.updatedAt ? String(json.updatedAt) : undefined,
    };
    setConfig(next);
    setForm((current) => ({
      ...current,
      storeUrl: next.storeUrl,
      storeName: next.storeName,
      currency: next.currency,
      commissionPercent: String(next.commissionPercent),
      deliveryNote: next.deliveryNote,
      // Credentials are never repopulated — they are write-only by design.
      consumerKey: "",
      consumerSecret: "",
    }));
  }, []);

  const loadEarnings = useCallback(async () => {
    try {
      const json = await call("/api/admin/supply-store-orders");
      setRows((json.rows as CommissionRow[]) || []);
      setMonths((json.months as typeof months) || []);
      setTotals((json.totals as typeof totals) || { orders: 0, sales: 0, commission: 0 });
      setEarningsError("");
    } catch (e) {
      setEarningsError(e instanceof Error ? e.message : "Could not load earnings");
    }
  }, [call]);

  useEffect(() => {
    void (async () => {
      try {
        applyConfig(await call("/api/admin/supply-store-config"));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not load the connection");
      } finally {
        setLoading(false);
      }
      await loadEarnings();
    })();
  }, [call, applyConfig, loadEarnings]);

  const save = async (options: { test?: boolean; enabled?: boolean } = {}) => {
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const json = await call("/api/admin/supply-store-config", {
        method: "POST",
        body: JSON.stringify({
          storeUrl: form.storeUrl,
          storeName: form.storeName,
          currency: form.currency,
          commissionPercent: Number(form.commissionPercent),
          deliveryNote: form.deliveryNote,
          consumerKey: form.consumerKey || undefined,
          consumerSecret: form.consumerSecret || undefined,
          enabled: options.enabled,
          test: options.test,
        }),
      });
      applyConfig(json);
      const test = json.test as { ok: boolean; message: string } | undefined;
      if (test) {
        if (test.ok) setNotice(test.message);
        else setError(test.message);
      } else {
        setNotice("Saved.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save");
    } finally {
      setSaving(false);
    }
  };

  const money = (n: number, currency = "EGP") =>
    `${new Intl.NumberFormat("en-EG", { maximumFractionDigits: 2 }).format(n)} ${currency}`;

  if (loading) {
    return (
      <div className="flex h-48 items-center justify-center">
        <Loader2 className="animate-spin text-slate-400" size={26} />
      </div>
    );
  }

  const field = "w-full rounded-lg bg-slate-800 border border-slate-700 px-3 py-2 text-sm font-bold text-slate-100 outline-none focus:border-indigo-500";
  const label = "block text-xs font-black uppercase tracking-wide text-slate-400 mb-1.5";

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-slate-700 bg-slate-900 p-6">
        <div className="mb-5 flex items-center gap-3">
          <ShoppingBag size={22} className="text-indigo-400" />
          <div>
            <h2 className="text-lg font-black text-white">Supply store connection</h2>
            <p className="text-xs font-bold text-slate-400">
              A partner&apos;s WooCommerce shop, sold inside Alpha. Clinics pay the supplier cash on delivery;
              Alpha takes a commission on what goes through it.
            </p>
          </div>
          <span
            className={`ms-auto rounded-full border px-3 py-1 text-[11px] font-black ${
              config?.usable
                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                : "border-slate-600 bg-slate-800 text-slate-400"
            }`}
          >
            {config?.usable ? "Live" : config?.enabled ? "On, but not credentialed" : "Off"}
          </span>
        </div>

        {error && (
          <div className="mb-4 flex items-start gap-2 rounded-lg border border-rose-500/40 bg-rose-500/10 p-3 text-sm font-bold text-rose-300">
            <AlertTriangle size={18} className="mt-0.5 shrink-0" />
            {error}
          </div>
        )}
        {notice && (
          <div className="mb-4 flex items-start gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm font-bold text-emerald-300">
            <Check size={18} className="mt-0.5 shrink-0" />
            {notice}
          </div>
        )}

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className={label}>Shop address</label>
            <input
              value={form.storeUrl}
              onChange={(e) => setForm((f) => ({ ...f, storeUrl: e.target.value }))}
              placeholder="https://his-shop.com"
              className={field}
            />
            <p className="mt-1 text-[11px] font-bold text-slate-500">
              The WordPress site itself, no path. Must be https in production — the key travels on every call.
            </p>
          </div>

          <div>
            <label className={label}>Shop name shown to clinics</label>
            <input
              value={form.storeName}
              onChange={(e) => setForm((f) => ({ ...f, storeName: e.target.value }))}
              placeholder="Nile Dental Supplies"
              className={field}
            />
          </div>

          <div>
            <label className={label}>Consumer key {config?.consumerKeyPreview ? `(stored: ${config.consumerKeyPreview})` : ""}</label>
            <input
              value={form.consumerKey}
              onChange={(e) => setForm((f) => ({ ...f, consumerKey: e.target.value }))}
              placeholder={config?.consumerKeyPreview ? "Leave blank to keep the stored key" : "ck_..."}
              className={field}
              autoComplete="off"
            />
          </div>

          <div>
            <label className={label}>Consumer secret {config?.secretSet ? "(stored)" : ""}</label>
            <input
              type="password"
              value={form.consumerSecret}
              onChange={(e) => setForm((f) => ({ ...f, consumerSecret: e.target.value }))}
              placeholder={config?.secretSet ? "Leave blank to keep the stored secret" : "cs_..."}
              className={field}
              autoComplete="off"
            />
            <p className="mt-1 text-[11px] font-bold text-slate-500">
              WooCommerce → Settings → Advanced → REST API → Add key, with Read/Write permission.
            </p>
          </div>

          <div>
            <label className={label}>Our commission (%)</label>
            <input
              type="number"
              min={0}
              max={100}
              step="0.1"
              value={form.commissionPercent}
              onChange={(e) => setForm((f) => ({ ...f, commissionPercent: e.target.value }))}
              className={field}
            />
            <p className="mt-1 text-[11px] font-bold text-slate-500">
              Never shown to a clinic. Frozen onto each order when it is placed, so changing it does not rewrite history.
            </p>
          </div>

          <div>
            <label className={label}>Currency</label>
            <input
              value={form.currency}
              onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value }))}
              className={field}
            />
          </div>

          <div className="md:col-span-2">
            <label className={label}>Delivery note shown at checkout</label>
            <textarea
              rows={2}
              value={form.deliveryNote}
              onChange={(e) => setForm((f) => ({ ...f, deliveryNote: e.target.value }))}
              placeholder="Delivers across Greater Cairo within 48 hours. Minimum order 500 EGP."
              className={field}
            />
          </div>
        </div>

        <div className="mt-5 flex flex-wrap gap-3">
          <button
            type="button"
            disabled={saving}
            onClick={() => void save()}
            className="rounded-lg bg-indigo-500 px-5 py-2.5 text-sm font-black text-white disabled:opacity-60"
          >
            {saving ? "Saving…" : "Save"}
          </button>

          <button
            type="button"
            disabled={saving}
            onClick={() => void save({ test: true })}
            className="flex items-center gap-2 rounded-lg border border-slate-600 px-5 py-2.5 text-sm font-black text-slate-200 disabled:opacity-60"
          >
            <Plug size={16} />
            Save &amp; test connection
          </button>

          <button
            type="button"
            disabled={saving}
            onClick={() => void save({ enabled: !config?.enabled })}
            className={`ms-auto rounded-lg px-5 py-2.5 text-sm font-black disabled:opacity-60 ${
              config?.enabled ? "bg-rose-500/20 text-rose-300 border border-rose-500/40" : "bg-emerald-500 text-white"
            }`}
          >
            {config?.enabled ? "Switch the store off" : "Switch the store on"}
          </button>
        </div>
      </div>

      {/* Earnings */}
      <div className="rounded-xl border border-slate-700 bg-slate-900 p-6">
        <h2 className="mb-1 text-lg font-black text-white">What it has earned us</h2>
        <p className="mb-5 text-xs font-bold text-slate-400">
          Cancelled and refunded orders are excluded, so this is what the partner actually owes.
        </p>

        {earningsError && (
          <div className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm font-bold text-amber-300">
            {earningsError}
          </div>
        )}

        <div className="mb-6 grid gap-3 sm:grid-cols-3">
          {[
            { label: "Orders", value: String(totals.orders) },
            { label: "Sold through Alpha", value: money(totals.sales) },
            { label: "Our commission", value: money(totals.commission) },
          ].map((card) => (
            <div key={card.label} className="rounded-lg border border-slate-700 bg-slate-800 p-4">
              <div className="text-[11px] font-black uppercase tracking-wide text-slate-400">{card.label}</div>
              <div className="mt-1 text-2xl font-black text-white">{card.value}</div>
            </div>
          ))}
        </div>

        {months.length > 0 && (
          <div className="mb-6 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="text-[11px] font-black uppercase tracking-wide text-slate-500">
                  <th className="pb-2">Month</th>
                  <th className="pb-2">Orders</th>
                  <th className="pb-2">Sales</th>
                  <th className="pb-2">Commission</th>
                </tr>
              </thead>
              <tbody className="text-slate-200">
                {months.map((m) => (
                  <tr key={m.month} className="border-t border-slate-800">
                    <td className="py-2 font-bold">{m.month}</td>
                    <td className="py-2 font-bold">{m.orders}</td>
                    <td className="py-2 font-bold">{money(m.sales)}</td>
                    <td className="py-2 font-black text-emerald-300">{money(m.commission)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {rows.length === 0 ? (
          <p className="py-6 text-center text-sm font-bold text-slate-500">No orders have gone through the store yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="text-[11px] font-black uppercase tracking-wide text-slate-500">
                  <th className="pb-2">Order</th>
                  <th className="pb-2">Clinic</th>
                  <th className="pb-2">Placed</th>
                  <th className="pb-2">Status</th>
                  <th className="pb-2">Total</th>
                  <th className="pb-2">Rate</th>
                  <th className="pb-2">Ours</th>
                </tr>
              </thead>
              <tbody className="text-slate-200">
                {rows.map((row) => (
                  <tr key={row.wooOrderId} className="border-t border-slate-800">
                    <td className="py-2 font-bold">#{row.wooOrderId}</td>
                    <td className="py-2 font-bold">{row.clinicName}</td>
                    <td className="py-2 font-bold text-slate-400">{row.placedAt.slice(0, 10)}</td>
                    <td className="py-2 font-bold">{row.status}</td>
                    <td className="py-2 font-bold">{money(row.orderTotal, row.currency)}</td>
                    <td className="py-2 font-bold text-slate-400">{row.ratePercent}%</td>
                    <td className="py-2 font-black text-emerald-300">{money(row.commission, row.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
