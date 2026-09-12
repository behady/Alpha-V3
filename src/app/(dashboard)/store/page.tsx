"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Minus,
  Package,
  Plus,
  Search,
  ShoppingBag,
  ShoppingCart,
  Star,
  Tag,
  Trash2,
  Truck,
  X,
} from "lucide-react";
import { auth } from "@/lib/firebase";
import { useClinic } from "@/context/ClinicContext";
import { useLanguage } from "@/context/LanguageContext";
import PermissionGuard from "@/components/PermissionGuard";
import Protect from "@/components/Protect";
import { useSupplyStoreStatus } from "@/lib/useSupplyStore";
import { cartTotals, type CartLine, type StoreCategory, type StoreProduct } from "@/lib/supplyStore";

/**
 * The partner supplier's shop, inside Alpha.
 *
 * Cash on delivery: the basket becomes a real unpaid order in the partner's WooCommerce, his team
 * confirms and delivers, and his driver collects at the door. Alpha never touches the money, which
 * is why this screen has no payment step and no card field anywhere in it.
 *
 * Nothing here knows what the platform earns. The commission lives on a superadmin-only record
 * written by the order route; if a number for it ever appears in this file, something has gone
 * wrong upstream.
 */

interface StoreOrderRow {
  id: string;
  wooOrderId: number;
  number: string;
  ref?: string;
  status: string;
  currency: string;
  total: number;
  subtotal?: number;
  /** What the coupons took off, as his shop worked it out. 0 when none applied. */
  discount?: number;
  lines: CartLine[];
  contact: { clinicName: string; phone: string; address: string; city?: string; email?: string; notes?: string };
  placedByName: string;
  createdAt: string;
}

/** WooCommerce's own status vocabulary, said the way a receptionist would say it. */
const STATUS_TEXT: Record<string, { en: string; ar: string; tone: string }> = {
  pending: { en: "Waiting for the supplier", ar: "بانتظار المورّد", tone: "bg-amber-50 text-amber-700 border-amber-200" },
  processing: { en: "Being prepared", ar: "جارٍ التجهيز", tone: "bg-sky-50 text-sky-700 border-sky-200" },
  "on-hold": { en: "On hold", ar: "معلّق", tone: "bg-slate-100 text-slate-600 border-slate-200" },
  completed: { en: "Delivered", ar: "تم التسليم", tone: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  cancelled: { en: "Cancelled", ar: "أُلغي", tone: "bg-rose-50 text-rose-700 border-rose-200" },
  refunded: { en: "Refunded", ar: "مُسترد", tone: "bg-rose-50 text-rose-700 border-rose-200" },
  failed: { en: "Failed", ar: "فشل", tone: "bg-rose-50 text-rose-700 border-rose-200" },
};

const CART_KEY_PREFIX = "alpha:supplyCart:";

/**
 * His shop's own star rating, read-only.
 *
 * These are the reviews his customers left on his site; nothing in Alpha writes them. Shown
 * because a clinic deciding between two scalers wants the same signal any other buyer gets, and
 * hidden entirely when nobody has reviewed the product — an empty five-star row reads as a bad
 * score rather than as no score.
 */
function Stars({ rating, count, ar }: { rating: number; count: number; ar: boolean }) {
  if (!count || rating <= 0) return null;
  const full = Math.round(rating);
  return (
    <div className="mt-1.5 flex items-center gap-1" title={`${rating} / 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          size={12}
          className={n <= full ? "fill-[#FACC15] text-[#FACC15]" : "text-line"}
        />
      ))}
      <span className="ms-1 text-[11px] font-bold text-ink-muted">
        {count} {ar ? "تقييم" : count === 1 ? "review" : "reviews"}
      </span>
    </div>
  );
}

export default function SupplyStorePage() {
  const { language } = useLanguage();
  const { clinicId, clinic } = useClinic();
  const store = useSupplyStoreStatus();
  const isRTL = language === "ar";
  const ar = isRTL;

  const [tab, setTab] = useState<"catalogue" | "orders">("catalogue");

  const [products, setProducts] = useState<StoreProduct[]>([]);
  const [categories, setCategories] = useState<StoreCategory[]>([]);
  const [category, setCategory] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [productError, setProductError] = useState("");

  const [cart, setCart] = useState<CartLine[]>([]);
  const [cartOpen, setCartOpen] = useState(false);

  /** The product whose full description and photos are open, and which photo is showing. */
  const [detail, setDetail] = useState<StoreProduct | null>(null);
  const [detailImage, setDetailImage] = useState(0);

  /** A discount code the clinic typed. The members' code is added by the server, not here. */
  const [coupon, setCoupon] = useState("");

  const [orders, setOrders] = useState<StoreOrderRow[]>([]);
  const [loadingOrders, setLoadingOrders] = useState(false);
  const [orderError, setOrderError] = useState("");

  const [contact, setContact] = useState({ clinicName: "", phone: "", address: "", city: "", notes: "" });
  const [placing, setPlacing] = useState(false);
  const [placeError, setPlaceError] = useState("");
  const [placedNumber, setPlacedNumber] = useState("");

  const currency = store.currency || "EGP";
  const money = useCallback(
    (n: number) => `${new Intl.NumberFormat(ar ? "ar-EG" : "en-EG", { maximumFractionDigits: 2 }).format(n)} ${currency}`,
    [ar, currency]
  );

  const authedFetch = useCallback(
    async (path: string, init?: RequestInit) => {
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error(ar ? "انتهت الجلسة. سجّل الدخول مرة أخرى." : "Session expired. Sign in again.");
      const res = await fetch(path, {
        ...init,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(init?.headers || {}) },
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json.ok === false) {
        throw new Error(json.error || `HTTP ${res.status}`);
      }
      return json as Record<string, unknown>;
    },
    [ar]
  );

  // --- the basket ------------------------------------------------------------------------------

  /**
   * Kept in localStorage, keyed by clinic.
   *
   * A basket is half an hour of someone walking the storeroom with a phone in their hand. Losing
   * it to an accidental refresh, or worse leaking it into the next clinic a superadmin switches
   * to, are both worth the few lines this costs.
   */
  const cartKey = clinicId ? `${CART_KEY_PREFIX}${clinicId}` : "";
  const cartLoaded = useRef(false);

  useEffect(() => {
    if (!cartKey) return;
    cartLoaded.current = false;
    try {
      const raw = window.localStorage.getItem(cartKey);
      const parsed = raw ? JSON.parse(raw) : [];
      setCart(Array.isArray(parsed) ? parsed : []);
    } catch {
      setCart([]);
    }
    cartLoaded.current = true;
  }, [cartKey]);

  useEffect(() => {
    if (!cartKey || !cartLoaded.current) return;
    try {
      window.localStorage.setItem(cartKey, JSON.stringify(cart));
    } catch {
      // A full or blocked storage quota must not stop someone ordering; the basket simply lives
      // in memory for this visit.
    }
  }, [cart, cartKey]);

  const totals = useMemo(() => cartTotals(cart), [cart]);

  const addToCart = (product: StoreProduct) => {
    setCart((current) => {
      const existing = current.find((line) => line.productId === product.id);
      if (existing) {
        return current.map((line) =>
          line.productId === product.id ? { ...line, qty: Math.min(999, line.qty + 1) } : line
        );
      }
      return [
        ...current,
        {
          productId: product.id,
          name: product.name,
          sku: product.sku,
          unitPrice: product.price,
          qty: 1,
          imageUrl: product.imageUrl,
        },
      ];
    });
    setCartOpen(true);
  };

  const setQty = (productId: number, qty: number) => {
    setCart((current) =>
      qty <= 0
        ? current.filter((line) => line.productId !== productId)
        : current.map((line) => (line.productId === productId ? { ...line, qty: Math.min(999, qty) } : line))
    );
  };

  // --- catalogue -------------------------------------------------------------------------------

  // Typing straight into the API would fire one WooCommerce search per keystroke on somebody
  // else's shared hosting. A third of a second of quiet is the whole throttle.
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 350);
    return () => clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    if (!clinicId || !store.connected) return;
    let cancelled = false;
    setLoadingProducts(true);
    setProductError("");

    void (async () => {
      try {
        const params = new URLSearchParams({ clinicId, page: String(page), lang: language });
        if (search) params.set("search", search);
        if (category) params.set("category", category);
        const json = await authedFetch(`/api/store/products?${params.toString()}`);
        if (cancelled) return;
        setProducts((json.products as StoreProduct[]) || []);
        if (Array.isArray(json.categories)) setCategories(json.categories as StoreCategory[]);
        setTotalPages(Math.max(1, Number(json.totalPages) || 1));
      } catch (error) {
        if (!cancelled) setProductError(error instanceof Error ? error.message : "Could not load the store");
      } finally {
        if (!cancelled) setLoadingProducts(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [clinicId, store.connected, page, search, category, language, authedFetch]);

  // --- orders ----------------------------------------------------------------------------------

  const loadOrders = useCallback(async () => {
    if (!clinicId) return;
    setLoadingOrders(true);
    setOrderError("");
    try {
      const json = await authedFetch(`/api/store/orders?clinicId=${encodeURIComponent(clinicId)}`);
      const list = (json.orders as StoreOrderRow[]) || [];
      setOrders(list);

      // Prefill the delivery details from the last order rather than asking again. The address of
      // a clinic does not change between orders, and retyping it is where mistakes come from.
      const last = list[0];
      setContact((current) => {
        if (current.phone || current.address) return current;
        if (last?.contact) {
          return {
            clinicName: last.contact.clinicName || clinic?.name || "",
            phone: last.contact.phone || "",
            address: last.contact.address || "",
            city: last.contact.city || "",
            notes: "",
          };
        }
        return { ...current, clinicName: current.clinicName || clinic?.name || "" };
      });
    } catch (error) {
      setOrderError(error instanceof Error ? error.message : "Could not load your orders");
    } finally {
      setLoadingOrders(false);
    }
  }, [clinicId, authedFetch, clinic?.name]);

  useEffect(() => {
    if (clinicId && store.connected) void loadOrders();
  }, [clinicId, store.connected, loadOrders]);

  const placeOrder = async () => {
    setPlacing(true);
    setPlaceError("");
    setPlacedNumber("");
    try {
      const json = await authedFetch("/api/store/orders", {
        method: "POST",
        body: JSON.stringify({ clinicId, lines: cart, contact, coupon, lang: language }),
      });
      const order = json.order as StoreOrderRow;
      setPlacedNumber(order?.number || "");
      setCart([]);
      setCoupon("");
      setCartOpen(false);
      setTab("orders");
      await loadOrders();
    } catch (error) {
      setPlaceError(error instanceof Error ? error.message : "The order could not be placed");
    } finally {
      setPlacing(false);
    }
  };

  const statusChip = (status: string) => {
    const entry = STATUS_TEXT[status] || {
      en: status,
      ar: status,
      tone: "bg-slate-100 text-slate-600 border-slate-200",
    };
    return (
      <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-black ${entry.tone}`}>
        {ar ? entry.ar : entry.en}
      </span>
    );
  };

  // --- render ----------------------------------------------------------------------------------

  if (store.loading) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <Loader2 className="animate-spin text-ink-muted" size={28} />
      </div>
    );
  }

  if (!store.connected) {
    // Reachable by typing the URL: the rail hides this page when no shop is connected.
    return (
      <div className="flex h-[60vh] flex-col items-center justify-center px-6 text-center">
        <div className="mb-5 flex h-20 w-20 items-center justify-center rounded-[1.75rem] bg-surface-subtle text-ink-muted">
          <ShoppingBag size={34} />
        </div>
        <h1 className="mb-2 text-2xl font-black tracking-tight text-ink">
          {ar ? "لا يوجد متجر متصل" : "No store connected"}
        </h1>
        <p className="max-w-md font-bold text-ink-muted">
          {ar
            ? "لم يتم ربط متجر مورّد بحسابكم بعد. تواصل مع الدعم لتفعيله."
            : "No supplier's shop has been connected to your account yet. Contact support to switch it on."}
        </p>
      </div>
    );
  }

  return (
    <PermissionGuard permission="access.store">
      <div
        className={`flex min-h-screen flex-col bg-gradient-to-br from-slate-100/80 via-white to-slate-50 pb-24 font-sans text-slate-800 lg:pb-8 ${isRTL ? "text-right" : "text-left"}`}
        dir={isRTL ? "rtl" : "ltr"}
      >
        <div className="mx-auto flex w-full max-w-[1920px] flex-1 flex-col gap-6 px-4 pb-8 pt-6 md:px-6 xl:gap-8 xl:px-10 xl:pt-10 2xl:px-12">
          {/* Page header */}
          <div className="flex shrink-0 flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h1 className="flex items-center gap-3 text-3xl font-black tracking-tight text-ink xl:text-4xl">
                <ShoppingBag size={30} className="text-[#FACC15]" />
                {ar ? "متجر المستلزمات" : "Supply Store"}
              </h1>
              <p className="mt-1 font-bold text-ink-muted">
                {store.storeName
                  ? ar
                    ? `مستلزمات العيادة من ${store.storeName} — الدفع عند الاستلام.`
                    : `Clinic supplies from ${store.storeName} — paid cash on delivery.`
                  : ar
                    ? "مستلزمات العيادة، الدفع عند الاستلام."
                    : "Clinic supplies, paid cash on delivery."}
              </p>
            </div>

            <button
              type="button"
              onClick={() => setCartOpen(true)}
              className="relative inline-flex items-center gap-2 self-start rounded-2xl bg-ink px-5 py-3 text-sm font-black text-white shadow-lg transition-transform hover:scale-[1.02]"
            >
              <ShoppingCart size={18} />
              {ar ? "السلة" : "Basket"}
              {totals.itemCount > 0 && (
                <span className="ms-1 rounded-full bg-[#FACC15] px-2 py-0.5 text-xs font-black text-ink">
                  {totals.itemCount}
                </span>
              )}
            </button>
          </div>

          {placedNumber && (
            <div className="flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-800">
              <Check size={20} className="mt-0.5 shrink-0" />
              <div className="font-bold">
                {ar
                  ? `تم إرسال الطلب رقم ${placedNumber} إلى المورّد. سيتواصل معكم لتأكيد التسليم، والدفع عند الاستلام.`
                  : `Order ${placedNumber} has gone to the supplier. They will call to confirm delivery, and you pay the driver in cash.`}
              </div>
            </div>
          )}

          {/* Tabs */}
          <div className="flex shrink-0 gap-2">
            {(["catalogue", "orders"] as const).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                className={`rounded-xl px-4 py-2 text-sm font-black transition-colors ${
                  tab === key ? "bg-[#FACC15] text-ink shadow-md" : "bg-surface text-ink-muted hover:text-ink"
                }`}
              >
                {key === "catalogue" ? (ar ? "الكتالوج" : "Catalogue") : ar ? "طلباتنا" : "Our orders"}
              </button>
            ))}
          </div>

          {tab === "catalogue" && (
            <>
              {/* Search + categories */}
              <div className="flex shrink-0 flex-col gap-3 lg:flex-row lg:items-center">
                <div className="relative flex-1">
                  <Search
                    size={18}
                    className={`pointer-events-none absolute top-1/2 -translate-y-1/2 text-ink-muted ${isRTL ? "right-4" : "left-4"}`}
                  />
                  <input
                    value={searchInput}
                    onChange={(e) => setSearchInput(e.target.value)}
                    placeholder={ar ? "ابحث عن صنف أو كود..." : "Search for an item or code..."}
                    className={`w-full rounded-2xl border border-line bg-surface py-3 text-sm font-bold text-ink shadow-sm outline-none transition-colors focus:border-[#FACC15] ${isRTL ? "pe-12 ps-4" : "ps-12 pe-4"}`}
                  />
                </div>

                {categories.length > 0 && (
                  <select
                    value={category}
                    onChange={(e) => {
                      setCategory(e.target.value);
                      setPage(1);
                    }}
                    className="rounded-2xl border border-line bg-surface px-4 py-3 text-sm font-bold text-ink shadow-sm outline-none focus:border-[#FACC15]"
                  >
                    <option value="">{ar ? "كل الأقسام" : "All categories"}</option>
                    {categories.map((c) => (
                      <option key={c.id} value={String(c.id)}>
                        {c.name} ({c.count})
                      </option>
                    ))}
                  </select>
                )}
              </div>

              {productError && (
                <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-800">
                  <AlertTriangle size={20} className="mt-0.5 shrink-0" />
                  <div className="font-bold">{productError}</div>
                </div>
              )}

              {loadingProducts ? (
                <div className="flex h-64 items-center justify-center">
                  <Loader2 className="animate-spin text-ink-muted" size={28} />
                </div>
              ) : products.length === 0 ? (
                <div className="flex h-64 flex-col items-center justify-center text-center">
                  <Package size={34} className="mb-3 text-ink-muted" />
                  <p className="font-bold text-ink-muted">
                    {ar ? "لا توجد أصناف مطابقة." : "No items match that."}
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
                  {products.map((product) => {
                    const inCart = cart.find((line) => line.productId === product.id);
                    return (
                      <div
                        key={product.id}
                        className="flex flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-sm transition-shadow hover:shadow-md"
                      >
                        {/*
                          A FIXED height, not an aspect ratio.
                          `aspect-square` did not constrain this: a tall portrait photo — and a
                          supplier's catalogue is full of them, every handpiece is shot upright —
                          stretched its own card, and because grid rows are as tall as their
                          tallest cell, one such photo left every other card on the row with a
                          crater of white space under the price. A fixed box with object-contain
                          letterboxes instead, so a row of cards is a row of cards.
                        */}
                        <button
                          type="button"
                          onClick={() => {
                            setDetail(product);
                            setDetailImage(0);
                          }}
                          className="relative h-44 w-full shrink-0 cursor-zoom-in bg-surface-subtle"
                          aria-label={product.name}
                        >
                          {product.imageUrl ? (
                            /* The partner's shop is an arbitrary domain, so next/image's optimiser
                               would need it whitelisted in next.config. A plain img keeps a new
                               partner from being a deploy. */
                            /* eslint-disable-next-line @next/next/no-img-element */
                            <img
                              src={product.imageUrl}
                              alt=""
                              loading="lazy"
                              className="h-full w-full object-contain p-3"
                            />
                          ) : (
                            <div className="flex h-full items-center justify-center text-ink-muted">
                              <Package size={32} />
                            </div>
                          )}
                          {product.onSale && (
                            <span className="absolute start-3 top-3 rounded-full bg-rose-500 px-2 py-1 text-[10px] font-black text-white">
                              {ar ? "عرض" : "SALE"}
                            </span>
                          )}
                          {product.images.length > 1 && (
                            <span className="absolute end-3 bottom-3 rounded-full bg-ink/80 px-2 py-0.5 text-[10px] font-black text-white">
                              {product.images.length} {ar ? "صور" : "photos"}
                            </span>
                          )}
                        </button>

                        <div className="flex flex-1 flex-col p-4">
                          <button
                            type="button"
                            onClick={() => {
                              setDetail(product);
                              setDetailImage(0);
                            }}
                            className="text-start"
                          >
                            <h3 className="line-clamp-2 text-sm font-black leading-snug text-ink hover:underline">
                              {product.name}
                            </h3>
                          </button>
                          {product.sku && (
                            <p className="mt-1 text-[11px] font-bold text-ink-muted">{product.sku}</p>
                          )}

                          <Stars rating={product.averageRating} count={product.ratingCount} ar={ar} />

                          <div className="mt-3 flex items-baseline gap-2">
                            <span className="text-lg font-black text-ink">{money(product.price)}</span>
                            {product.onSale && (
                              <span className="text-xs font-bold text-ink-muted line-through">
                                {money(product.regularPrice)}
                              </span>
                            )}
                          </div>

                          {product.shortDescription && (
                            <p className="mt-2 line-clamp-2 text-xs font-bold leading-relaxed text-ink-muted">
                              {product.shortDescription}
                            </p>
                          )}

                          {product.stockQuantity !== null && product.stockQuantity <= 5 && (
                            <p className="mt-1 text-[11px] font-black text-amber-600">
                              {ar ? `باقي ${product.stockQuantity} فقط` : `Only ${product.stockQuantity} left`}
                            </p>
                          )}

                          <div className="mt-auto pt-4">
                            {inCart ? (
                              <div className="flex items-center justify-between rounded-xl border border-line bg-surface-subtle p-1">
                                <button
                                  type="button"
                                  onClick={() => setQty(product.id, inCart.qty - 1)}
                                  className="flex h-8 w-8 items-center justify-center rounded-lg bg-surface text-ink-muted shadow-sm transition-colors hover:text-red-600"
                                >
                                  <Minus size={14} />
                                </button>
                                <span className="text-sm font-black text-ink">{inCart.qty}</span>
                                <button
                                  type="button"
                                  onClick={() => setQty(product.id, inCart.qty + 1)}
                                  className="flex h-8 w-8 items-center justify-center rounded-lg bg-surface text-ink-muted shadow-sm transition-colors hover:text-emerald-600"
                                >
                                  <Plus size={14} />
                                </button>
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={() => addToCart(product)}
                                className="w-full rounded-xl bg-ink py-2.5 text-xs font-black text-white transition-transform hover:scale-[1.02]"
                              >
                                {ar ? "أضف للسلة" : "Add to basket"}
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {totalPages > 1 && (
                <div className="flex shrink-0 items-center justify-center gap-3 pt-2">
                  <button
                    type="button"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    className="flex h-10 w-10 items-center justify-center rounded-xl border border-line bg-surface text-ink-muted shadow-sm disabled:opacity-40"
                  >
                    {isRTL ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
                  </button>
                  <span className="text-sm font-black text-ink-muted">
                    {page} / {totalPages}
                  </span>
                  <button
                    type="button"
                    disabled={page >= totalPages}
                    onClick={() => setPage((p) => p + 1)}
                    className="flex h-10 w-10 items-center justify-center rounded-xl border border-line bg-surface text-ink-muted shadow-sm disabled:opacity-40"
                  >
                    {isRTL ? <ChevronLeft size={18} /> : <ChevronRight size={18} />}
                  </button>
                </div>
              )}
            </>
          )}

          {tab === "orders" && (
            <div className="space-y-4">
              {orderError && (
                <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 font-bold text-amber-800">
                  <AlertTriangle size={20} className="mt-0.5 shrink-0" />
                  {orderError}
                </div>
              )}

              {loadingOrders ? (
                <div className="flex h-48 items-center justify-center">
                  <Loader2 className="animate-spin text-ink-muted" size={28} />
                </div>
              ) : orders.length === 0 ? (
                <div className="flex h-48 flex-col items-center justify-center text-center">
                  <Truck size={34} className="mb-3 text-ink-muted" />
                  <p className="font-bold text-ink-muted">
                    {ar ? "لم ترسلوا أي طلب بعد." : "You have not ordered anything yet."}
                  </p>
                </div>
              ) : (
                orders.map((order) => (
                  <div key={order.id} className="rounded-2xl border border-line bg-surface p-5 shadow-sm">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-3">
                          <h3 className="text-lg font-black text-ink">
                            {ar ? `طلب رقم ${order.number}` : `Order ${order.number}`}
                          </h3>
                          {statusChip(order.status)}
                        </div>
                        <p className="mt-1 text-xs font-bold text-ink-muted">
                          {new Date(order.createdAt).toLocaleString(ar ? "ar-EG" : "en-GB")} · {order.placedByName}
                        </p>
                      </div>
                      <div className="text-end">
                        <div className="text-xl font-black text-ink">{money(order.total)}</div>
                        {order.discount ? (
                          <div className="text-[11px] font-black text-emerald-600">
                            {ar ? `وفّرت ${money(order.discount)}` : `Saved ${money(order.discount)}`}
                          </div>
                        ) : null}
                        <div className="text-[11px] font-black uppercase tracking-wide text-ink-muted">
                          {ar ? "الدفع عند الاستلام" : "Cash on delivery"}
                        </div>
                      </div>
                    </div>

                    <div className="mt-4 space-y-2 border-t border-line pt-4">
                      {order.lines.map((line) => (
                        <div key={line.productId} className="flex items-center justify-between gap-3 text-sm">
                          <span className="font-bold text-ink-body">
                            {line.name} <span className="text-ink-muted">× {line.qty}</span>
                          </span>
                          <span className="font-black text-ink">{money(line.unitPrice * line.qty)}</span>
                        </div>
                      ))}
                    </div>

                    <p className="mt-4 text-xs font-bold text-ink-muted">
                      {order.contact.address}
                      {order.contact.city ? `، ${order.contact.city}` : ""} · {order.contact.phone}
                    </p>
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        {/*
          One product, in full: every photo the shop holds, the whole description, and his own
          star rating. The catalogue card deliberately shows almost none of this — a grid where
          every tile carries a paragraph is a grid nobody scans — so this is where someone lands
          when they want to know whether the thing is actually what they need.
        */}
        {detail && (
          <div
            className="fixed inset-0 z-[200] flex items-center justify-center p-4"
            dir={isRTL ? "rtl" : "ltr"}
          >
            <button
              type="button"
              aria-label="close"
              onClick={() => setDetail(null)}
              className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            />
            <div className="relative flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-3xl bg-surface shadow-2xl">
              <button
                type="button"
                onClick={() => setDetail(null)}
                className="absolute end-4 top-4 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-surface-subtle text-ink-muted shadow-sm hover:text-ink"
              >
                <X size={18} />
              </button>

              <div className="grid flex-1 gap-6 overflow-y-auto p-6 md:grid-cols-2">
                {/* Photos */}
                <div>
                  <div className="flex h-72 items-center justify-center rounded-2xl bg-surface-subtle">
                    {detail.images[detailImage] ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img
                        src={detail.images[detailImage]}
                        alt=""
                        className="max-h-full max-w-full object-contain p-4"
                      />
                    ) : (
                      <Package size={40} className="text-ink-muted" />
                    )}
                  </div>

                  {detail.images.length > 1 && (
                    <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
                      {detail.images.map((src, i) => (
                        <button
                          key={src}
                          type="button"
                          onClick={() => setDetailImage(i)}
                          className={`h-16 w-16 shrink-0 overflow-hidden rounded-xl border-2 bg-surface-subtle transition-colors ${
                            i === detailImage ? "border-[#FACC15]" : "border-line"
                          }`}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={src} alt="" loading="lazy" className="h-full w-full object-contain p-1" />
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Everything else */}
                <div className="flex flex-col">
                  <h2 className="pe-10 text-xl font-black leading-snug text-ink">{detail.name}</h2>
                  {detail.sku && <p className="mt-1 text-xs font-bold text-ink-muted">{detail.sku}</p>}
                  <Stars rating={detail.averageRating} count={detail.ratingCount} ar={ar} />

                  <div className="mt-4 flex items-baseline gap-3">
                    <span className="text-3xl font-black text-ink">{money(detail.price)}</span>
                    {detail.onSale && (
                      <span className="text-sm font-bold text-ink-muted line-through">
                        {money(detail.regularPrice)}
                      </span>
                    )}
                  </div>

                  {detail.categoryNames.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {detail.categoryNames.map((name) => (
                        <span
                          key={name}
                          className="rounded-full bg-surface-subtle px-2.5 py-1 text-[11px] font-black text-ink-muted"
                        >
                          {name}
                        </span>
                      ))}
                    </div>
                  )}

                  {detail.stockQuantity !== null && (
                    <p className="mt-3 text-xs font-black text-ink-muted">
                      {detail.stockQuantity <= 5
                        ? ar
                          ? `باقي ${detail.stockQuantity} فقط`
                          : `Only ${detail.stockQuantity} left`
                        : ar
                          ? "متوفر"
                          : "In stock"}
                    </p>
                  )}

                  {detail.description ? (
                    <p className="mt-4 whitespace-pre-line text-sm font-bold leading-relaxed text-ink-body">
                      {detail.description}
                    </p>
                  ) : (
                    <p className="mt-4 text-sm font-bold text-ink-muted">
                      {ar ? "المورّد لم يكتب وصفاً لهذا الصنف." : "The supplier has not written a description for this one."}
                    </p>
                  )}

                  <div className="mt-6">
                    {(() => {
                      const inCart = cart.find((line) => line.productId === detail.id);
                      if (!inCart) {
                        return (
                          <button
                            type="button"
                            onClick={() => addToCart(detail)}
                            className="w-full rounded-2xl bg-ink py-3.5 text-sm font-black text-white transition-transform hover:scale-[1.01]"
                          >
                            {ar ? "أضف للسلة" : "Add to basket"}
                          </button>
                        );
                      }
                      return (
                        <div className="flex items-center justify-between rounded-2xl border border-line bg-surface-subtle p-2">
                          <button
                            type="button"
                            onClick={() => setQty(detail.id, inCart.qty - 1)}
                            className="flex h-10 w-10 items-center justify-center rounded-xl bg-surface text-ink-muted shadow-sm hover:text-red-600"
                          >
                            <Minus size={16} />
                          </button>
                          <span className="text-base font-black text-ink">
                            {inCart.qty} {ar ? "في السلة" : "in basket"}
                          </span>
                          <button
                            type="button"
                            onClick={() => setQty(detail.id, inCart.qty + 1)}
                            className="flex h-10 w-10 items-center justify-center rounded-xl bg-surface text-ink-muted shadow-sm hover:text-emerald-600"
                          >
                            <Plus size={16} />
                          </button>
                        </div>
                      );
                    })()}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Basket + checkout */}
        {cartOpen && (
          <div className="fixed inset-0 z-[200] flex" dir={isRTL ? "rtl" : "ltr"}>
            <button
              type="button"
              aria-label="close"
              onClick={() => setCartOpen(false)}
              className="flex-1 bg-black/40 backdrop-blur-sm"
            />
            <div className="flex h-full w-full max-w-md flex-col bg-surface shadow-2xl">
              <div className="flex shrink-0 items-center justify-between border-b border-line px-5 py-4">
                <h2 className="text-lg font-black text-ink">{ar ? "السلة" : "Your basket"}</h2>
                <button
                  type="button"
                  onClick={() => setCartOpen(false)}
                  className="rounded-lg px-3 py-1 text-sm font-black text-ink-muted hover:text-ink"
                >
                  {ar ? "إغلاق" : "Close"}
                </button>
              </div>

              <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
                {cart.length === 0 ? (
                  <p className="py-10 text-center font-bold text-ink-muted">
                    {ar ? "السلة فارغة." : "The basket is empty."}
                  </p>
                ) : (
                  cart.map((line) => (
                    <div key={line.productId} className="flex gap-3 rounded-xl border border-line p-3">
                      <div className="h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-surface-subtle">
                        {line.imageUrl ? (
                          /* eslint-disable-next-line @next/next/no-img-element */
                          <img src={line.imageUrl} alt="" className="h-full w-full object-contain p-1" />
                        ) : (
                          <div className="flex h-full items-center justify-center text-ink-muted">
                            <Package size={18} />
                          </div>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="line-clamp-2 text-sm font-black text-ink">{line.name}</p>
                        <p className="mt-0.5 text-xs font-bold text-ink-muted">{money(line.unitPrice)}</p>
                        <div className="mt-2 flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setQty(line.productId, line.qty - 1)}
                            className="flex h-7 w-7 items-center justify-center rounded-lg border border-line text-ink-muted"
                          >
                            <Minus size={12} />
                          </button>
                          <span className="w-6 text-center text-sm font-black text-ink">{line.qty}</span>
                          <button
                            type="button"
                            onClick={() => setQty(line.productId, line.qty + 1)}
                            className="flex h-7 w-7 items-center justify-center rounded-lg border border-line text-ink-muted"
                          >
                            <Plus size={12} />
                          </button>
                          <button
                            type="button"
                            onClick={() => setQty(line.productId, 0)}
                            className="ms-auto p-1 text-ink-muted hover:text-red-600"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))
                )}

                {cart.length > 0 && (
                  <div className="space-y-3 border-t border-line pt-4">
                    <h3 className="text-sm font-black text-ink">{ar ? "بيانات التسليم" : "Delivery details"}</h3>

                    {(
                      [
                        { key: "clinicName", en: "Clinic name", ar: "اسم العيادة" },
                        { key: "phone", en: "Phone for the driver", ar: "رقم للتواصل مع المندوب" },
                        { key: "address", en: "Address", ar: "العنوان" },
                        { key: "city", en: "City / area", ar: "المدينة / المنطقة" },
                      ] as const
                    ).map((field) => (
                      <input
                        key={field.key}
                        value={contact[field.key]}
                        onChange={(e) => setContact((c) => ({ ...c, [field.key]: e.target.value }))}
                        placeholder={ar ? field.ar : field.en}
                        className="w-full rounded-xl border border-line bg-surface px-3 py-2.5 text-sm font-bold text-ink outline-none focus:border-[#FACC15]"
                      />
                    ))}

                    <textarea
                      value={contact.notes}
                      onChange={(e) => setContact((c) => ({ ...c, notes: e.target.value }))}
                      rows={2}
                      placeholder={ar ? "ملاحظات للمورّد (اختياري)" : "Note for the supplier (optional)"}
                      className="w-full rounded-xl border border-line bg-surface px-3 py-2.5 text-sm font-bold text-ink outline-none focus:border-[#FACC15]"
                    />

                    <div className="border-t border-line pt-3">
                      <h3 className="mb-2 text-sm font-black text-ink">{ar ? "كود خصم" : "Discount code"}</h3>
                      <div className="relative">
                        <Tag
                          size={16}
                          className={`pointer-events-none absolute top-1/2 -translate-y-1/2 text-ink-muted ${isRTL ? "right-3" : "left-3"}`}
                        />
                        <input
                          value={coupon}
                          onChange={(e) => setCoupon(e.target.value)}
                          placeholder={ar ? "لو معاك كود من المورّد" : "If the supplier gave you a code"}
                          className={`w-full rounded-xl border border-line bg-surface py-2.5 text-sm font-bold uppercase text-ink outline-none focus:border-[#FACC15] ${isRTL ? "pe-10 ps-3" : "ps-10 pe-3"}`}
                        />
                      </div>

                      {/*
                        The clinic is told a members' price applies, never what the code is. The
                        code is the reason to order through Alpha rather than direct; a clinic that
                        learned it would simply type it on his site and the arrangement would be
                        worth nothing. The server attaches it — see couponCodesFor.
                      */}
                      {store.membersDiscount && (
                        <p className="mt-2 flex items-start gap-2 rounded-xl bg-emerald-50 p-3 text-xs font-bold text-emerald-700">
                          <Tag size={14} className="mt-0.5 shrink-0" />
                          {ar
                            ? "خصم عملاء ألفا بيتطبّق على الطلب ده تلقائياً — هتشوفه في تأكيد المورّد."
                            : "The Alpha members' discount is applied to this order automatically — you'll see it on the supplier's confirmation."}
                        </p>
                      )}
                    </div>

                    {store.deliveryNote && (
                      <p className="rounded-xl bg-surface-subtle p-3 text-xs font-bold text-ink-muted">
                        {store.deliveryNote}
                      </p>
                    )}
                  </div>
                )}
              </div>

              {cart.length > 0 && (
                <div className="shrink-0 space-y-3 border-t border-line px-5 py-4">
                  {placeError && (
                    <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-bold text-rose-700">
                      {placeError}
                    </div>
                  )}

                  <div className="flex items-center justify-between">
                    <span className="text-sm font-black text-ink-muted">{ar ? "الإجمالي" : "Subtotal"}</span>
                    <span className="text-xl font-black text-ink">{money(totals.subtotal)}</span>
                  </div>
                  <p className="text-[11px] font-bold text-ink-muted">
                    {ar
                      ? "قد يضيف المورّد الشحن عند التأكيد. الدفع نقداً عند الاستلام."
                      : "The supplier may add delivery when he confirms. Payment is cash to the driver."}
                  </p>

                  {/* Someone with access.store but not store.order can price a basket and not
                      send it. Without the fallback the button is simply absent, which reads as
                      the page being broken rather than as a permission they were not given. */}
                  <Protect
                    permission="store.order"
                    fallback={
                      <p className="rounded-xl bg-surface-subtle p-3 text-center text-xs font-bold text-ink-muted">
                        {ar
                          ? "معندكش صلاحية إرسال الطلبات. اعرض السلة على المدير."
                          : "You are not allowed to send orders. Show this basket to an admin."}
                      </p>
                    }
                  >
                    <button
                      type="button"
                      disabled={placing}
                      onClick={() => void placeOrder()}
                      className="flex w-full items-center justify-center gap-2 rounded-2xl bg-[#FACC15] py-3.5 text-sm font-black text-ink shadow-lg transition-transform hover:scale-[1.01] disabled:opacity-60"
                    >
                      {placing ? <Loader2 size={18} className="animate-spin" /> : <Truck size={18} />}
                      {ar ? "إرسال الطلب للمورّد" : "Send the order to the supplier"}
                    </button>
                  </Protect>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </PermissionGuard>
  );
}
