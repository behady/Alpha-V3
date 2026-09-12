// The supply store's arithmetic and its outbound payload. Run with tsx; no network, no emulator.
//
// Four things are worth freezing here, and each of them is a way the arrangement with the partner
// could quietly break:
//
//   1. We must never put a PRICE on the wire. WooCommerce prices every line from its own
//      catalogue, which is the only reason a tampered basket cannot buy a handpiece for 1 EGP.
//      A well-meaning "send the total so the shop can check it" would undo that silently.
//
//   2. Commission must round the way money rounds, and a cancelled order must earn nothing —
//      otherwise the figure we invoice the partner for will not match his own books, which is the
//      fastest way to lose the deal.
//
//   3. The store URL is typed by hand into a superadmin field and then handed to a server-side
//      fetch. Anything that is not http(s) has to die at the door.
//
//   4. Variable and out-of-stock products must not reach the catalogue. Both of them look fine on
//      a card and fail at checkout, which reads to the clinic as the whole feature being broken.

import assert from "node:assert/strict";
import {
  ALPHA_ORDER_META,
  ALPHA_SOURCE_VALUE,
  buildWooOrderPayload,
  cartTotals,
  commissionFor,
  isAlphaOrder,
  mapWooOrder,
  mapWooProduct,
  normalizeStoreUrl,
  readOrderMeta,
  stripHtml,
  summariseCommission,
  validateOrderDraft,
  wooEndpoint,
  type CartLine,
  type SupplyCommissionRow,
} from "../src/lib/supplyStore";

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed += 1;
  console.log(`  ok  ${name}`);
}

// --- 1. The outbound payload carries no prices --------------------------------------------------

const draft = {
  lines: [
    { productId: 41, name: "Composite kit", sku: "CMP-1", unitPrice: 1250, qty: 2 },
    { productId: 77, name: "Gloves, box", sku: "GLV-M", unitPrice: 90, qty: 3 },
  ] as CartLine[],
  contact: {
    clinicName: "Alpha Dental",
    phone: "01001234567",
    address: "12 Nile St",
    city: "Giza",
    notes: "Ring the bell twice",
  },
};

check("the order payload sends product_id and quantity only", () => {
  const payload = buildWooOrderPayload(draft, { clinicId: "clinic1", ref: "ALP-TEST" });
  const lines = payload.line_items as Record<string, unknown>[];
  assert.equal(lines.length, 2);
  for (const line of lines) {
    assert.deepEqual(Object.keys(line).sort(), ["product_id", "quantity"]);
  }
  // The serialised body is what actually travels; check the whole thing, not just the keys above.
  const wire = JSON.stringify(payload);
  assert.ok(!wire.includes("1250"), "a unit price reached the WooCommerce payload");
  assert.ok(!wire.includes("unitPrice"), "a unit price reached the WooCommerce payload");
});

check("the order is unpaid, cash on delivery", () => {
  const payload = buildWooOrderPayload(draft, { clinicId: "clinic1", ref: "ALP-TEST" });
  assert.equal(payload.payment_method, "cod");
  assert.equal(payload.set_paid, false);
  assert.equal(payload.status, "pending");
});

check("every order is stamped so the commission can be counted", () => {
  const payload = buildWooOrderPayload(draft, { clinicId: "clinic1", ref: "ALP-9" });
  assert.equal(readOrderMeta(payload, ALPHA_ORDER_META.source), ALPHA_SOURCE_VALUE);
  assert.equal(readOrderMeta(payload, ALPHA_ORDER_META.clinicId), "clinic1");
  assert.equal(readOrderMeta(payload, ALPHA_ORDER_META.ref), "ALP-9");
  assert.equal(isAlphaOrder(payload), true);
  assert.equal(isAlphaOrder({ meta_data: [{ key: "_other", value: "x" }] }), false);
});

check("the delivery address travels with the order", () => {
  const payload = buildWooOrderPayload(draft, { clinicId: "c", ref: "r" });
  const billing = payload.billing as Record<string, string>;
  assert.equal(billing.phone, "01001234567");
  assert.equal(billing.address_1, "12 Nile St");
  assert.equal(billing.city, "Giza");
  assert.equal(payload.customer_note, "Ring the bell twice");
});

// --- 2. Validation --------------------------------------------------------------------------

check("an empty basket is refused", () => {
  const result = validateOrderDraft({ lines: [], contact: draft.contact });
  assert.equal(result.ok, false);
});

check("a missing or too-short phone is refused", () => {
  for (const phone of ["", "123", "abc"]) {
    const result = validateOrderDraft({ ...draft, contact: { ...draft.contact, phone } });
    assert.equal(result.ok, false, `phone "${phone}" should be refused`);
  }
});

check("a fractional or zero quantity is refused", () => {
  for (const qty of [0, -1, 1.5, 1000]) {
    const result = validateOrderDraft({
      ...draft,
      lines: [{ ...draft.lines[0], qty }],
    });
    assert.equal(result.ok, false, `qty ${qty} should be refused`);
  }
});

check("a valid basket passes", () => {
  assert.equal(validateOrderDraft(draft).ok, true);
});

// --- 3. Money -------------------------------------------------------------------------------

check("the basket subtotal adds up", () => {
  const { itemCount, subtotal } = cartTotals(draft.lines);
  assert.equal(itemCount, 5);
  assert.equal(subtotal, 2 * 1250 + 3 * 90);
});

check("commission rounds to piastres, never to a fraction of one", () => {
  assert.equal(commissionFor(1000, 7.5), 75);
  assert.equal(commissionFor(333.33, 7), 23.33);
  assert.equal(commissionFor(0, 10), 0);
  assert.equal(commissionFor(500, 0), 0);
});

check("cancelled and refunded orders earn nothing", () => {
  const rows: SupplyCommissionRow[] = [
    { wooOrderId: 1, clinicId: "a", clinicName: "A", placedAt: "2026-09-01T00:00:00Z", status: "completed", orderTotal: 1000, ratePercent: 10, commission: 100, currency: "EGP" },
    { wooOrderId: 2, clinicId: "a", clinicName: "A", placedAt: "2026-09-04T00:00:00Z", status: "cancelled", orderTotal: 5000, ratePercent: 10, commission: 500, currency: "EGP" },
    { wooOrderId: 3, clinicId: "b", clinicName: "B", placedAt: "2026-08-20T00:00:00Z", status: "processing", orderTotal: 200, ratePercent: 10, commission: 20, currency: "EGP" },
  ];
  const { months, totals } = summariseCommission(rows);
  assert.equal(totals.orders, 2);
  assert.equal(totals.sales, 1200);
  assert.equal(totals.commission, 120);
  // Newest month first, so the panel opens on the one being invoiced.
  assert.deepEqual(months.map((m) => m.month), ["2026-09", "2026-08"]);
});

// --- 4. The store URL -------------------------------------------------------------------------

check("only http and https survive normalisation", () => {
  assert.equal(normalizeStoreUrl("javascript:alert(1)"), "");
  assert.equal(normalizeStoreUrl("file:///etc/passwd"), "");
  assert.equal(normalizeStoreUrl(""), "");
  assert.equal(normalizeStoreUrl("   "), "");
});

check("a bare domain is assumed to be https, and trailing slashes go", () => {
  assert.equal(normalizeStoreUrl("shop.example.com"), "https://shop.example.com");
  assert.equal(normalizeStoreUrl("https://shop.example.com/"), "https://shop.example.com");
  assert.equal(normalizeStoreUrl("https://shop.example.com/store/"), "https://shop.example.com/store");
});

check("the REST endpoint is built under wp-json, and empty params are dropped", () => {
  const url = wooEndpoint("shop.example.com", "products", { per_page: 24, search: "", page: 2 });
  assert.equal(url, "https://shop.example.com/wp-json/wc/v3/products?per_page=24&page=2");
  assert.equal(wooEndpoint("javascript:x", "products"), "");
});

// --- 5. The catalogue -------------------------------------------------------------------------

const wooProduct = {
  id: 41,
  name: "Composite kit",
  status: "publish",
  type: "simple",
  sku: "CMP-1",
  price: "1250.00",
  regular_price: "1400.00",
  on_sale: true,
  stock_status: "instock",
  stock_quantity: 3,
  permalink: "https://shop.example.com/p/41",
  images: [{ src: "https://shop.example.com/img/41.jpg" }],
  categories: [{ id: 9, name: "Restorative" }],
  short_description: "<p>A <strong>7-shade</strong> kit &amp; bonding agent.</p>",
};

check("a simple in-stock product maps cleanly", () => {
  const product = mapWooProduct(wooProduct);
  assert.ok(product);
  assert.equal(product.price, 1250);
  assert.equal(product.regularPrice, 1400);
  assert.equal(product.onSale, true);
  assert.equal(product.inStock, true);
  assert.equal(product.stockQuantity, 3);
  assert.equal(product.imageUrl, "https://shop.example.com/img/41.jpg");
  assert.deepEqual(product.categoryNames, ["Restorative"]);
  assert.equal(product.description, "A 7-shade kit & bonding agent.");
});

check("variable, grouped, draft and unpurchasable products are dropped", () => {
  assert.equal(mapWooProduct({ ...wooProduct, type: "variable" }), null);
  assert.equal(mapWooProduct({ ...wooProduct, type: "grouped" }), null);
  assert.equal(mapWooProduct({ ...wooProduct, status: "draft" }), null);
  assert.equal(mapWooProduct({ ...wooProduct, purchasable: false }), null);
  assert.equal(mapWooProduct({ ...wooProduct, catalog_visibility: "hidden" }), null);
  assert.equal(mapWooProduct(null), null);
  assert.equal(mapWooProduct({ id: 0, name: "" }), null);
});

check("out of stock is reported, not hidden by the mapper", () => {
  const product = mapWooProduct({ ...wooProduct, stock_status: "outofstock" });
  assert.ok(product);
  assert.equal(product.inStock, false);
});

check("untracked stock is null, which is not zero", () => {
  const product = mapWooProduct({ ...wooProduct, stock_quantity: null });
  assert.ok(product);
  assert.equal(product.stockQuantity, null);
});

check("html in a description never reaches the card", () => {
  assert.equal(stripHtml("<p>Hello &amp; <em>welcome</em></p>"), "Hello & welcome");
  assert.equal(stripHtml("<script>alert(1)</script>safe"), "alert(1) safe");
});

check("an order read back from the shop keeps its status and total", () => {
  const mapped = mapWooOrder({ id: 812, number: "812", status: "processing", total: "3420.00", currency: "EGP" });
  assert.ok(mapped);
  assert.equal(mapped.wooOrderId, 812);
  assert.equal(mapped.status, "processing");
  assert.equal(mapped.total, 3420);
  assert.equal(mapWooOrder({ status: "processing" }), null);
});

console.log(`\nsupplyStore: ${passed} checks passed`);
