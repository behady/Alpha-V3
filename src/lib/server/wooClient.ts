/**
 * The only place the partner's WooCommerce credentials are ever held or used.
 *
 * SERVER ONLY. The consumer key/secret pair is a read AND write credential on somebody else's
 * shop: with it you can create orders, edit products and read every customer he has. It is stored
 * in `platform_secrets/supply_store`, a root document no Firestore rule grants to anybody, and it
 * is never returned by any route — the superadmin screen only ever learns that a secret is stored.
 *
 * Everything a browser needs (products, categories, its own orders) is proxied through the API
 * routes in src/app/api/store/*, which means the shop's URL is not even discoverable from the
 * client. That is not paranoia about the shop; it is that the same credential would let a clinic
 * read the partner's entire customer list, and we introduced them.
 */

import { adminDb } from "@/lib/firebaseAdmin";
import { normalizeStoreUrl, wooEndpoint } from "@/lib/supplyStore";

export const SUPPLY_STORE_SECRET_DOC = "platform_secrets/supply_store";

export interface SupplyStoreConfig {
  /** Off by default. Nothing about the store renders for any clinic until this is true. */
  enabled: boolean;
  storeUrl: string;
  consumerKey: string;
  consumerSecret: string;
  /** What the partner shows clinics as the shop's name. */
  storeName: string;
  currency: string;
  /** The platform's cut, in percent. Superadmin-only, frozen onto each order when it is placed. */
  commissionPercent: number;
  /** Shown at checkout: delivery areas, lead time, minimum order — the partner's own words. */
  deliveryNote: string;
  updatedAt?: string;
}

/**
 * One config read per warm lambda for a minute, rather than one per product page.
 *
 * Deliberately short: turning the store off in the superadmin panel has to take effect while the
 * person who turned it off is still looking at the screen, or they will conclude the switch does
 * nothing and start hunting for another one.
 */
let cached: { at: number; config: SupplyStoreConfig } | null = null;
const CACHE_MS = 60_000;

export function clearSupplyStoreCache(): void {
  cached = null;
}

function toText(v: unknown): string {
  return typeof v === "string" ? v : "";
}

export async function loadSupplyStoreConfig(): Promise<SupplyStoreConfig> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.config;

  const [collection, docId] = SUPPLY_STORE_SECRET_DOC.split("/");
  const snap = await adminDb().collection(collection).doc(docId).get();
  const data = (snap.exists ? snap.data() : null) ?? {};

  const config: SupplyStoreConfig = {
    enabled: data.enabled === true,
    storeUrl: normalizeStoreUrl(toText(data.storeUrl)),
    consumerKey: toText(data.consumerKey),
    consumerSecret: toText(data.consumerSecret),
    storeName: toText(data.storeName),
    currency: toText(data.currency) || "EGP",
    commissionPercent: Number(data.commissionPercent) || 0,
    deliveryNote: toText(data.deliveryNote),
    updatedAt: toText(data.updatedAt) || undefined,
  };

  cached = { at: Date.now(), config };
  return config;
}

export async function saveSupplyStoreConfig(patch: Partial<SupplyStoreConfig>): Promise<void> {
  const [collection, docId] = SUPPLY_STORE_SECRET_DOC.split("/");
  const clean: Record<string, unknown> = { updatedAt: new Date().toISOString() };

  // Firestore rejects a write where any field is `undefined`, and it fails the whole document
  // rather than the field — so a patch that simply omits the secret must not carry the key at all.
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    clean[key] = value;
  }

  await adminDb().collection(collection).doc(docId).set(clean, { merge: true });
  clearSupplyStoreCache();
}

/** Is the store ready to serve a clinic? Both switched on and actually credentialed. */
export function isStoreUsable(config: SupplyStoreConfig): boolean {
  return Boolean(config.enabled && config.storeUrl && config.consumerKey && config.consumerSecret);
}

export interface WooResult<T> {
  ok: boolean;
  status: number;
  /** WooCommerce's own error code, e.g. `woocommerce_rest_invalid_product_id`. "" on success. */
  code: string;
  data: T | null;
  /** Total pages, from Woo's X-WP-TotalPages header. 0 when the response carried none. */
  totalPages: number;
  /** The real reason, for the server log only. Never sent to a browser. */
  detail: string;
}

/**
 * One call to the partner's shop.
 *
 * Credentials go in the Authorization header rather than the query string that most WooCommerce
 * tutorials use: query parameters land in access logs, proxy caches and error reports, and this
 * pair is not ours to leak.
 */
export async function wooRequest<T>(
  config: SupplyStoreConfig,
  path: string,
  options: {
    method?: "GET" | "POST";
    params?: Record<string, string | number | undefined>;
    body?: unknown;
    timeoutMs?: number;
  } = {}
): Promise<WooResult<T>> {
  if (!isStoreUsable(config)) {
    return { ok: false, status: 503, code: "alpha_store_not_configured", data: null, totalPages: 0, detail: "Supply store is not configured" };
  }

  const url = wooEndpoint(config.storeUrl, path, options.params);
  if (!url) {
    return { ok: false, status: 500, code: "alpha_store_bad_url", data: null, totalPages: 0, detail: "Store URL is unusable" };
  }

  const auth = Buffer.from(`${config.consumerKey}:${config.consumerSecret}`).toString("base64");
  const controller = new AbortController();
  // A WordPress shop on shared hosting can take a while to wake up, but a receptionist holding a
  // basket cannot wait forever and Vercel will cut us off regardless.
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 20_000);

  try {
    const res = await fetch(url, {
      method: options.method ?? "GET",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal,
      cache: "no-store",
    });

    const totalPages = Number(res.headers.get("x-wp-totalpages")) || 0;
    const text = await res.text();
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      // A WordPress fatal error or a hosting interstitial answers with HTML. Treat it as a
      // failure with no code rather than letting a JSON parse error surface as a 500 from us.
      return {
        ok: false,
        status: res.status || 502,
        code: "alpha_store_bad_response",
        data: null,
        totalPages,
        detail: `Non-JSON response from store: ${text.slice(0, 200)}`,
      };
    }

    if (!res.ok) {
      const err = (parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {}) as Record<string, unknown>;
      return {
        ok: false,
        status: res.status,
        code: toText(err.code),
        data: null,
        totalPages,
        detail: toText(err.message) || `HTTP ${res.status}`,
      };
    }

    return { ok: true, status: res.status, code: "", data: parsed as T, totalPages, detail: "" };
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    return {
      ok: false,
      status: aborted ? 504 : 502,
      code: aborted ? "alpha_store_timeout" : "alpha_store_unreachable",
      data: null,
      totalPages: 0,
      detail: error instanceof Error ? error.message : "Store request failed",
    };
  } finally {
    clearTimeout(timer);
  }
}
