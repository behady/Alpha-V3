"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Check, Eye, EyeOff, Loader2, Plug, ShoppingBag, Star } from "lucide-react";
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
  memberCoupon: string;
  consumerKeyPreview: string;
  secretSet: boolean;
  usable: boolean;
  updatedAt?: string;
}

interface ModeratedReview {
  id: string;
  productId: number;
  productName: string;
  rating: number;
  text: string;
  clinicName: string;
  authorName: string;
  createdAt: string;
  hidden?: boolean;
  hiddenReason?: string;
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
    memberCoupon: "",
    consumerKey: "",
    consumerSecret: "",
  });

  const [rows, setRows] = useState<CommissionRow[]>([]);
  const [months, setMonths] = useState<{ month: string; orders: number; sales: number; commission: number }[]>([]);
  const [totals, setTotals] = useState({ orders: 0, sales: 0, commission: 0 });
  const [earningsError, setEarningsError] = useState("");

  const [reviews, setReviews] = useState<ModeratedReview[]>([]);
  const [reviewsError, setReviewsError] = useState("");
  const [busyReview, setBusyReview] = useState("");

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
      memberCoupon: String(json.memberCoupon || ""),
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
      memberCoupon: next.memberCoupon,
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

  const loadReviews = useCallback(async () => {
    try {
      const json = await call("/api/admin/supply-reviews");
      setReviews((json.reviews as ModeratedReview[]) || []);
      setReviewsError("");
    } catch (e) {
      setReviewsError(e instanceof Error ? e.message : "Could not load reviews");
    }
  }, [call]);

  /**
   * Hide or restore one review.
   *
   * Hiding, not deleting: the document stays with the reason attached, the clinic that wrote it
   * still sees its own, and the decision can be reversed. Hiding also pulls the rating out of the
   * product average — a review nobody may read must not go on scoring the supplier.
   */
  const moderate = async (review: ModeratedReview) => {
    setBusyReview(review.id);
    try {
      const reason = review.hidden
        ? ""
        : window.prompt("Why is this being hidden? (kept on the record, not shown to the clinic)") ?? "";
      await call("/api/admin/supply-reviews", {
        method: "POST",
        body: JSON.stringify({ reviewId: review.id, hidden: !review.hidden, reason }),
      });
      await loadReviews();
    } catch (e) {
      setReviewsError(e instanceof Error ? e.message : "Could not update that review");
    } finally {
      setBusyReview("");
    }
  };

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
      await loadReviews();
    })();
  }, [call, applyConfig, loadEarnings, loadReviews]);

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
          memberCoupon: form.memberCoupon,
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

          <div>
            <label className={label}>Alpha members&apos; coupon code</label>
            <input
              value={form.memberCoupon}
              onChange={(e) => setForm((f) => ({ ...f, memberCoupon: e.target.value }))}
              placeholder="alpha10"
              className={field}
              autoComplete="off"
            />
            <p className="mt-1 text-[11px] font-bold text-slate-500">
              A coupon HE creates in WooCommerce. Applied to every order Alpha places, automatically. Clinics are
              told a members&apos; discount applies but never see the code &mdash; if they did, they could use it on his
              site directly and ordering through Alpha would stop being worth anything. Leave blank for none.
            </p>
            <p className="mt-1 text-[11px] font-bold text-amber-400">
              Note: it lowers the order total, and our commission is a percentage of that total &mdash; so a discount he
              funds also trims our cut a little.
            </p>
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

      {/*
        Clinic-to-clinic reviews, and the only lever over them.

        These are published to every clinic on the platform under the author clinic's name, so
        there has to be a way to take one down — a mistaken claim about a medical supply is not
        something to leave up while emails are exchanged. Nothing here reaches the partner's shop.
      */}
      <div className="rounded-xl border border-slate-700 bg-slate-900 p-6">
        <h2 className="mb-1 text-lg font-black text-white">Clinic reviews</h2>
        <p className="mb-5 text-xs font-bold text-slate-400">
          Written by clinics, for clinics. Never sent to the supplier. Hiding one removes it from the product&apos;s
          average and from every other clinic&apos;s view; the clinic that wrote it still sees its own, marked hidden.
        </p>

        {reviewsError && (
          <div className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm font-bold text-amber-300">
            {reviewsError}
          </div>
        )}

        {reviews.length === 0 ? (
          <p className="py-6 text-center text-sm font-bold text-slate-500">No clinic has reviewed anything yet.</p>
        ) : (
          <div className="space-y-3">
            {reviews.map((review) => (
              <div
                key={review.id}
                className={`rounded-lg border p-4 ${
                  review.hidden ? "border-rose-500/40 bg-rose-500/5" : "border-slate-700 bg-slate-800"
                }`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-black text-white">{review.clinicName}</span>
                  <span className="flex items-center gap-0.5">
                    {[1, 2, 3, 4, 5].map((n) => (
                      <Star
                        key={n}
                        size={12}
                        className={n <= review.rating ? "fill-amber-400 text-amber-400" : "text-slate-600"}
                      />
                    ))}
                  </span>
                  <span className="text-[11px] font-bold text-slate-400">
                    {review.productName || `#${review.productId}`} &middot; {review.createdAt.slice(0, 10)} &middot;{" "}
                    {review.authorName}
                  </span>

                  <button
                    type="button"
                    disabled={busyReview === review.id}
                    onClick={() => void moderate(review)}
                    className={`ms-auto flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-black disabled:opacity-50 ${
                      review.hidden
                        ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
                        : "bg-rose-500/20 text-rose-300 border border-rose-500/40"
                    }`}
                  >
                    {review.hidden ? <Eye size={14} /> : <EyeOff size={14} />}
                    {review.hidden ? "Restore" : "Hide"}
                  </button>
                </div>

                {review.text && <p className="mt-2 whitespace-pre-line text-sm font-bold text-slate-200">{review.text}</p>}

                {review.hidden && review.hiddenReason && (
                  <p className="mt-2 text-[11px] font-black text-rose-300">Hidden: {review.hiddenReason}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
