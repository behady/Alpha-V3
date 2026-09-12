/**
 * The supply store: a partner's WooCommerce shop, sold from inside Alpha for a commission.
 *
 * Everything here is pure. No network, no Firebase — so the rules that decide what a clinic pays,
 * what we earn, and what we are allowed to send to WordPress can be tested without a store to
 * point at. The HTTP half lives in src/lib/server/wooClient.ts and never leaves the server,
 * because the WooCommerce consumer secret is a write-capable credential on someone else's shop.
 *
 * Two decisions are load-bearing and are enforced in code rather than by convention:
 *
 *  1. **We never send a price.** `buildWooOrderPayload` puts `product_id` and `quantity` on the
 *     wire and nothing else. WooCommerce prices the line itself from its own catalogue. A browser
 *     that tampers with the cart can therefore change what it ORDERS but never what it PAYS, and
 *     the partner's books can never disagree with ours about the amount.
 *
 *  2. **Commission is not part of an order.** `StoreOrder` — the shape a clinic reads — has no
 *     field for it, and `commissionFor` is only ever called by superadmin code. A clinic sees the
 *     shop's price and its own order; what the platform earns behind that is the platform's
 *     business. Same rule as the WhatsApp supplier costs, and for the same reason: a clinic that
 *     can see the margin starts negotiating it.
 */

/** Marks an order in WooCommerce as ours. This is how the commission is counted at month end. */
export const ALPHA_ORDER_META = {
  /** Present on every order Alpha creates. The partner can filter his own admin on it. */
  source: "_alpha_source",
  /** Which clinic ordered. Lets the partner's delivery team and our reports agree. */
  clinicId: "_alpha_clinic_id",
  clinicName: "_alpha_clinic_name",
  /** Our own reference, echoed back so a Woo order can be matched to our record after the fact. */
  ref: "_alpha_ref",
} as const;

export const ALPHA_SOURCE_VALUE = "alpha-dental";

/** A product as the clinic sees it. Prices are whatever the partner's shop charges. */
export interface StoreProduct {
  id: number;
  name: string;
  sku: string;
  /** What the clinic pays, in the store's currency. Woo sends this as a string, sometimes empty. */
  price: number;
  regularPrice: number;
  onSale: boolean;
  inStock: boolean;
  /** null when the partner does not track stock on that product — which is not the same as zero. */
  stockQuantity: number | null;
  /** The first photo, for the catalogue card. Always `images[0]` when there is one. */
  imageUrl: string;
  /** Every photo the shop holds, in his order. The detail view pages through these. */
  images: string[];
  permalink: string;
  categoryIds: number[];
  categoryNames: string[];
  /** One line for the card. */
  shortDescription: string;
  /** The full text, for the detail view. Still plain text — his HTML is not ours to render. */
  description: string;
  /** His shop's own star rating, 0 when nobody has reviewed it. Read-only; we never write it. */
  averageRating: number;
  ratingCount: number;
  /**
   * What ALPHA clinics scored it — a different number from his, kept deliberately separate.
   * Attached by the products route from the running-average documents; see lib/supplyReviews.
   */
  alphaRating?: number;
  alphaReviewCount?: number;
}

export interface StoreCategory {
  id: number;
  name: string;
  count: number;
}

/** One line of a basket. `unitPrice` is carried for display and totals only — see the note above. */
export interface CartLine {
  productId: number;
  name: string;
  sku: string;
  unitPrice: number;
  qty: number;
  imageUrl?: string;
}

export interface OrderContact {
  clinicName: string;
  phone: string;
  address: string;
  city?: string;
  email?: string;
  notes?: string;
}

/** An order as the clinic reads it back. Deliberately has nowhere to put a commission. */
export interface StoreOrder {
  id: string;
  wooOrderId: number;
  number: string;
  status: string;
  currency: string;
  total: number;
  lines: CartLine[];
  contact: OrderContact;
  placedByUid: string;
  placedByName: string;
  createdAt: string;
  updatedAt?: string;
}

/** The superadmin-only companion record. Never written to a clinic-readable collection. */
export interface SupplyCommissionRow {
  wooOrderId: number;
  clinicId: string;
  clinicName: string;
  /** ISO date, so a month is a string compare. */
  placedAt: string;
  status: string;
  orderTotal: number;
  /** Frozen at order time: the rate can change, an order already placed cannot. */
  ratePercent: number;
  commission: number;
  currency: string;
}

function toNumber(v: unknown, fallback = 0): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : fallback;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  }
  return fallback;
}

function toText(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/** Woo sends descriptions as rendered HTML. The catalogue card wants a line of plain text. */
export function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The store's base URL, normalised, or "" if it could not be trusted.
 *
 * Refuses anything but http/https — the stored value is pasted by hand into a superadmin field,
 * and a `file:` or `javascript:` string reaching a server-side fetch is the kind of mistake that
 * only shows up once. http is allowed because a partner may be testing on a local box; the key
 * and secret travel as Basic auth, so in production this must be https and the config screen
 * says so.
 */
export function normalizeStoreUrl(raw: string): string {
  const trimmed = (raw || "").trim();
  if (!trimmed) return "";

  // Reject any scheme that is not http(s) BEFORE assuming one. Prepending https:// to
  // "file:///etc/passwd" produced "https://file///etc/passwd" — a perfectly valid URL pointing at
  // a host called "file", which is exactly the sort of thing that gets saved without anyone
  // noticing and then fails at the first product fetch.
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(trimmed);
  if (scheme && !/^https?$/i.test(scheme[1])) return "";

  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== "https:" && url.protocol !== "http:") return "";
    if (!url.hostname) return "";
    return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, "")}`;
  } catch {
    return "";
  }
}

/** Build a WooCommerce REST URL. Returns "" when the store URL is unusable. */
export function wooEndpoint(
  storeUrl: string,
  path: string,
  params: Record<string, string | number | undefined> = {}
): string {
  const base = normalizeStoreUrl(storeUrl);
  if (!base) return "";
  const clean = path.replace(/^\/+/, "");
  const url = new URL(`${base}/wp-json/wc/v3/${clean}`);
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === "") continue;
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

/**
 * One WooCommerce product, or null if it is not something a clinic can actually order.
 *
 * Variable products (a parent with sizes) are dropped rather than shown: their price is a range
 * and ordering one needs a variation id we do not collect. Showing them would put items in the
 * catalogue that fail at checkout, which is worse than not listing them at all.
 */
export function mapWooProduct(raw: unknown): StoreProduct | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Record<string, unknown>;

  const id = toNumber(p.id, 0);
  const name = toText(p.name).trim();
  if (!id || !name) return null;

  if (toText(p.status) && toText(p.status) !== "publish") return null;
  if (toText(p.catalog_visibility) === "hidden") return null;
  if (toText(p.type) === "variable" || toText(p.type) === "grouped") return null;
  if (p.purchasable === false) return null;

  const images = (Array.isArray(p.images) ? p.images : [])
    .map((img) => (img && typeof img === "object" ? toText((img as Record<string, unknown>).src) : ""))
    .filter(Boolean)
    // A shop that has uploaded the same file twice shows the same photo twice in the gallery,
    // which reads as the viewer being broken rather than as the shop being untidy.
    .filter((src, i, all) => all.indexOf(src) === i)
    .slice(0, 12);

  const categories = (Array.isArray(p.categories) ? p.categories : []).filter(
    (c): c is Record<string, unknown> => Boolean(c) && typeof c === "object"
  );

  const price = toNumber(p.price, 0);
  const regularPrice = toNumber(p.regular_price, price);

  return {
    id,
    name,
    sku: toText(p.sku),
    price,
    regularPrice,
    onSale: p.on_sale === true && regularPrice > price,
    // "instock" is the only status a clinic can order today. Backorders are the partner's call
    // and he has not asked for them; treating "onbackorder" as available would promise a delivery
    // date nobody can keep.
    inStock: toText(p.stock_status) === "instock" || toText(p.stock_status) === "",
    stockQuantity:
      p.stock_quantity === null || p.stock_quantity === undefined ? null : toNumber(p.stock_quantity, 0),
    imageUrl: images[0] || "",
    images,
    permalink: toText(p.permalink),
    categoryIds: categories.map((c) => toNumber(c.id, 0)).filter((n) => n > 0),
    categoryNames: categories.map((c) => toText(c.name)).filter(Boolean),
    shortDescription: stripHtml(toText(p.short_description) || toText(p.description)).slice(0, 160),
    // The long one. Shop descriptions run to specification tables, so this is generous — but it
    // is still stripped to text: rendering a supplier's HTML inside our page would let his shop
    // style, script or reshape a screen our clinics are signed in to.
    description: stripHtml(toText(p.description) || toText(p.short_description)).slice(0, 4000),
    averageRating: toNumber(p.average_rating, 0),
    ratingCount: toNumber(p.rating_count, 0),
  };
}

export function mapWooCategory(raw: unknown): StoreCategory | null {
  if (!raw || typeof raw !== "object") return null;
  const c = raw as Record<string, unknown>;
  const id = toNumber(c.id, 0);
  const name = toText(c.name).trim();
  if (!id || !name) return null;
  return { id, name, count: toNumber(c.count, 0) };
}

/** Basket arithmetic. Kept here so the cart badge, the checkout panel and the tests agree. */
export function cartTotals(lines: CartLine[]): { itemCount: number; subtotal: number } {
  let itemCount = 0;
  let subtotal = 0;
  for (const line of lines) {
    const qty = Math.max(0, Math.floor(toNumber(line.qty, 0)));
    itemCount += qty;
    subtotal += qty * toNumber(line.unitPrice, 0);
  }
  return { itemCount, subtotal: Math.round(subtotal * 100) / 100 };
}

/** What the platform earns on an order. Superadmin only — see the file header. */
export function commissionFor(orderTotal: number, ratePercent: number): number {
  const total = toNumber(orderTotal, 0);
  const rate = toNumber(ratePercent, 0);
  if (total <= 0 || rate <= 0) return 0;
  return Math.round(total * (rate / 100) * 100) / 100;
}

export interface OrderDraft {
  lines: CartLine[];
  contact: OrderContact;
}

/**
 * WooCommerce coupon codes are stored lower-case and compared that way, so a clinic typing
 * "ALPHA10" must become "alpha10" or the shop reports a perfectly valid code as not existing.
 * Returns "" for anything that is not a usable code.
 */
export function normalizeCouponCode(raw: string): string {
  return (raw || "").trim().toLowerCase().replace(/\s+/g, "").slice(0, 60);
}

/**
 * The codes to send with an order: the platform's own members' code, then whatever the clinic
 * typed. Deduplicated, because WooCommerce refuses an order that lists the same coupon twice.
 *
 * The members' code goes FIRST and is added by the server, never by the browser. It is the whole
 * point of the arrangement — a price a clinic can only get through Alpha — so a basket that
 * forgot to include it, or a clinic that worked out the code and used it directly on his site,
 * must not change what we send.
 */
export function couponCodesFor(memberCoupon: string, typedCoupon: string): string[] {
  const codes: string[] = [];
  const member = normalizeCouponCode(memberCoupon);
  const typed = normalizeCouponCode(typedCoupon);
  if (member) codes.push(member);
  if (typed && typed !== member) codes.push(typed);
  return codes;
}

/**
 * Is this basket something we are willing to send to the partner's shop?
 *
 * The phone is the strictest of these on purpose: cash on delivery means a driver has to find the
 * clinic and someone has to answer when he calls. An order with no reachable number is a wasted
 * journey that the partner pays for and that lands back on us.
 */
export function validateOrderDraft(draft: OrderDraft): { ok: true } | { ok: false; error: string } {
  if (!draft || !Array.isArray(draft.lines) || draft.lines.length === 0) {
    return { ok: false, error: "The basket is empty." };
  }
  if (draft.lines.length > 50) {
    return { ok: false, error: "Too many different items in one order. Split it into two." };
  }
  for (const line of draft.lines) {
    const id = toNumber(line?.productId, 0);
    const qty = toNumber(line?.qty, 0);
    if (!Number.isInteger(id) || id <= 0) {
      return { ok: false, error: "One of the items is not a real product." };
    }
    if (!Number.isInteger(qty) || qty <= 0) {
      return { ok: false, error: "Every item needs a quantity of at least 1." };
    }
    if (qty > 999) return { ok: false, error: "999 is the most of any one item in a single order." };
  }
  const contact = draft.contact || ({} as OrderContact);
  if (!toText(contact.clinicName).trim()) return { ok: false, error: "The delivery needs a clinic name." };
  const digits = toText(contact.phone).replace(/\D/g, "");
  if (digits.length < 8) return { ok: false, error: "A phone number the driver can call is required." };
  if (!toText(contact.address).trim()) return { ok: false, error: "A delivery address is required." };
  return { ok: true };
}

/**
 * The body we POST to WooCommerce.
 *
 * `status: "pending"` and `set_paid: false` are the whole cash-on-delivery arrangement: the order
 * lands in the partner's admin as a normal unpaid COD order, his team confirms it, delivers, and
 * collects. Alpha handles no money at any point, which is exactly why this was the version built
 * first. When he adds online payment later, only this function changes.
 */
export function buildWooOrderPayload(
  draft: OrderDraft,
  meta: { clinicId: string; ref: string; couponCodes?: string[] }
): Record<string, unknown> {
  const contact = draft.contact;
  const nameParts = contact.clinicName.trim().split(/\s+/);
  const billing = {
    first_name: nameParts[0] || contact.clinicName.trim(),
    last_name: nameParts.slice(1).join(" "),
    address_1: contact.address.trim(),
    city: (contact.city || "").trim(),
    phone: contact.phone.trim(),
    email: (contact.email || "").trim(),
  };

  // Codes only. WooCommerce looks each one up, checks its own rules — expiry, minimum spend,
  // which products it covers, how many times it has been used — and works out the discount
  // itself. Sending an AMOUNT here would put us in the position of calculating a discount
  // against rules we cannot see, which is the same mistake as sending a price.
  const couponLines = (meta.couponCodes || [])
    .map((code) => normalizeCouponCode(code))
    .filter(Boolean)
    .map((code) => ({ code }));

  return {
    payment_method: "cod",
    payment_method_title: "Cash on delivery",
    set_paid: false,
    status: "pending",
    ...(couponLines.length > 0 ? { coupon_lines: couponLines } : {}),
    billing,
    shipping: {
      first_name: billing.first_name,
      last_name: billing.last_name,
      address_1: billing.address_1,
      city: billing.city,
      phone: billing.phone,
    },
    // product_id and quantity ONLY. WooCommerce prices the line from its own catalogue, so a
    // tampered basket can never buy a 4,000 EGP handpiece for 1 EGP.
    line_items: draft.lines.map((line) => ({
      product_id: Math.floor(toNumber(line.productId, 0)),
      quantity: Math.floor(toNumber(line.qty, 0)),
    })),
    customer_note: (contact.notes || "").trim().slice(0, 500),
    meta_data: [
      { key: ALPHA_ORDER_META.source, value: ALPHA_SOURCE_VALUE },
      { key: ALPHA_ORDER_META.clinicId, value: meta.clinicId },
      { key: ALPHA_ORDER_META.clinicName, value: contact.clinicName.trim() },
      { key: ALPHA_ORDER_META.ref, value: meta.ref },
    ],
  };
}

/** Pull one of our meta values back off a WooCommerce order. */
export function readOrderMeta(raw: unknown, key: string): string {
  if (!raw || typeof raw !== "object") return "";
  const list = (raw as Record<string, unknown>).meta_data;
  if (!Array.isArray(list)) return "";
  for (const entry of list) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    if (toText(e.key) === key) return typeof e.value === "string" ? e.value : String(e.value ?? "");
  }
  return "";
}

/** Did Alpha create this order? Used when reconciling the partner's order list against ours. */
export function isAlphaOrder(raw: unknown): boolean {
  return readOrderMeta(raw, ALPHA_ORDER_META.source) === ALPHA_SOURCE_VALUE;
}

/** The parts of a WooCommerce order we keep. Status is the one that keeps changing. */
export function mapWooOrder(
  raw: unknown
): {
  wooOrderId: number;
  number: string;
  status: string;
  total: number;
  discountTotal: number;
  currency: string;
} | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const wooOrderId = toNumber(o.id, 0);
  if (!wooOrderId) return null;
  return {
    wooOrderId,
    number: toText(o.number) || String(wooOrderId),
    status: toText(o.status) || "pending",
    total: toNumber(o.total, 0),
    // What the coupons actually took off, as WooCommerce worked it out. Derived from his rules,
    // not from ours — subtracting our basket subtotal from his total would call a price change,
    // or a delivery charge he added, a discount.
    discountTotal: toNumber(o.discount_total, 0),
    currency: toText(o.currency) || "EGP",
  };
}

/** Month-by-month commission, newest first. Feeds the superadmin panel and nothing else. */
export function summariseCommission(rows: SupplyCommissionRow[]): {
  months: { month: string; orders: number; sales: number; commission: number }[];
  totals: { orders: number; sales: number; commission: number };
} {
  const byMonth = new Map<string, { month: string; orders: number; sales: number; commission: number }>();
  let orders = 0;
  let sales = 0;
  let commission = 0;

  for (const row of rows) {
    // A cancelled or refunded order earns nothing. Counting it would put a number in front of the
    // partner that his own books will not match, which is the fastest way to lose the arrangement.
    if (row.status === "cancelled" || row.status === "refunded" || row.status === "failed") continue;
    const month = (row.placedAt || "").slice(0, 7) || "unknown";
    const bucket = byMonth.get(month) || { month, orders: 0, sales: 0, commission: 0 };
    bucket.orders += 1;
    bucket.sales += toNumber(row.orderTotal, 0);
    bucket.commission += toNumber(row.commission, 0);
    byMonth.set(month, bucket);
    orders += 1;
    sales += toNumber(row.orderTotal, 0);
    commission += toNumber(row.commission, 0);
  }

  const months = [...byMonth.values()]
    .map((m) => ({
      ...m,
      sales: Math.round(m.sales * 100) / 100,
      commission: Math.round(m.commission * 100) / 100,
    }))
    .sort((a, b) => (a.month < b.month ? 1 : a.month > b.month ? -1 : 0));

  return {
    months,
    totals: {
      orders,
      sales: Math.round(sales * 100) / 100,
      commission: Math.round(commission * 100) / 100,
    },
  };
}

/**
 * Turn a WooCommerce failure into something a receptionist can act on.
 *
 * Woo answers a bad key with a 401 whose body says "consumer key is invalid", which is true and
 * useless to the person holding the basket: they cannot fix it, and the one who can is us. So the
 * clinic-facing text says who to call, and the real reason goes to the server log.
 */
export function friendlyStoreError(status: number, wooCode: string, language: "en" | "ar" = "en"): string {
  const ar = language === "ar";
  if (status === 401 || status === 403) {
    return ar
      ? "المتجر غير متصل حالياً. تواصل مع الدعم — لا حاجة لأي إجراء من عيادتك."
      : "The store is not connected right now. Contact support — nothing to fix on your side.";
  }
  if (wooCode === "woocommerce_rest_invalid_product_id" || wooCode === "woocommerce_rest_product_invalid_id") {
    return ar
      ? "أحد الأصناف لم يعد متاحاً في المتجر. احذفه وأعد المحاولة."
      : "One of the items is no longer in the store. Remove it and try again.";
  }
  // WooCommerce answers a bad, expired or already-used coupon with this. It is one of the few
  // failures the clinic itself can actually fix, so unlike the rest it says what is wrong.
  if (wooCode === "woocommerce_rest_invalid_coupon" || wooCode.includes("coupon")) {
    return ar
      ? "كود الخصم غير صالح أو منتهي. احذفه وأعد المحاولة، أو اطلب الطلب بدونه."
      : "That discount code is not valid or has expired. Remove it and try again, or order without it.";
  }
  if (wooCode === "woocommerce_rest_cannot_create_order") {
    return ar
      ? "المتجر رفض الطلب. راجع الكميات وحاول مرة أخرى."
      : "The store refused the order. Check the quantities and try again.";
  }
  if (status === 404) {
    return ar ? "لم يتم العثور على المتجر. تواصل مع الدعم." : "The store could not be reached. Contact support.";
  }
  if (status >= 500) {
    return ar
      ? "متجر المورّد لا يستجيب حالياً. حاول بعد قليل."
      : "The supplier's store is not responding. Try again shortly.";
  }
  return ar ? "تعذّر إتمام الطلب. حاول مرة أخرى." : "The order could not be placed. Please try again.";
}
