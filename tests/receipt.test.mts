/**
 * The receipt: its settings, its numbering, its ETA document and its HTML.
 *
 *   npx tsx tests/receipt.test.mts
 *
 * Pins what a clinic and the Tax Authority both depend on: numbers run in order and print the
 * same way everywhere; every settings switch actually changes the paper; the ETA JSON adds up
 * the way the Authority validates it; medical services print as VAT-exempt.
 */

import assert from "node:assert/strict";
import {
  DEFAULT_RECEIPT_SETTINGS,
  etaMissingFields,
  etaPaymentMethodCode,
  formatReceiptNumber,
  normalizeReceiptSettings,
} from "../src/lib/receiptSettings";
import { buildEtaReceiptDocument, etaItemCode } from "../src/lib/etaReceipt";
import {
  buildDentalReceiptSrcDoc,
  buildPaymentReceiptPayload,
  sampleReceiptPayload,
  type ReceiptLedgerTransaction,
} from "../src/lib/receiptRender";

let passed = 0;
function ok(cond: unknown, msg: string) {
  assert.ok(cond, msg);
  passed++;
}
function eq<T>(a: T, b: T, msg: string) {
  assert.deepEqual(a, b, msg);
  passed++;
}

// --- 1. Settings normalise to a complete object, whatever is stored -----------------------------

{
  const empty = normalizeReceiptSettings(null);
  eq(empty, DEFAULT_RECEIPT_SETTINGS, "nothing stored → the defaults, exactly");

  const junk = normalizeReceiptSettings({
    template: "neon",
    accent: "red",
    font: 42,
    paper: "letter",
    language: "fr",
    logoSize: "huge",
    show: { teeth: false, bogus: true },
    eta: { enabled: "yes", vatRate: 250, address: { governate: 7 } },
    numberPrefix: "REC-2026-THIS-IS-TOO-LONG",
  });
  eq(junk.template, "classic", "unknown template falls back");
  eq(junk.accent, "#111827", "non-hex accent falls back");
  eq(junk.font, "tajawal", "non-string font falls back");
  eq(junk.paper, "a4", "unknown paper falls back");
  eq(junk.language, "ar", "unknown language falls back");
  eq(junk.show.teeth, false, "a stored switch is honoured");
  eq(junk.show.discounts, true, "a missing switch keeps its default");
  ok(!("bogus" in junk.show), "unknown switches are dropped, not stored");
  eq(junk.eta.enabled, false, "a non-boolean ETA switch is off");
  eq(junk.eta.vatRate, 14, "a VAT rate outside 0-100 falls back");
  eq(junk.eta.address.governate, "", "a non-string address part is blank");
  eq(junk.numberPrefix.length, 12, "the prefix is capped");

  const valid = normalizeReceiptSettings({ template: "thermal", accent: "#0F766E", eta: { enabled: true, rin: " 123456789 " } });
  eq(valid.template, "thermal", "a valid template is kept");
  eq(valid.accent, "#0f766e", "accent is lower-cased");
  eq(valid.eta.rin, "123456789", "the registration number is trimmed");
}

// --- 2. Receipt numbers ---------------------------------------------------------------------------

{
  const s = { numberPrefix: "R-", numberIncludesYear: true };
  eq(formatReceiptNumber(s, 12, "2026-09-26"), "R-2026-0012", "prefix, year, zero-padded sequence");
  eq(formatReceiptNumber({ ...s, numberIncludesYear: false }, 12, "2026-09-26"), "R-0012", "year can be left out");
  eq(formatReceiptNumber({ numberPrefix: "", numberIncludesYear: false }, 12345, "2026-09-26"), "12345", "past 9,999 the number just grows");
  eq(formatReceiptNumber(s, 0, "2026-09-26"), "R-2026-0001", "a sequence below 1 is 1 — numbering starts at one");
  eq(formatReceiptNumber(s, 3, "not a date"), formatReceiptNumber(s, 3, new Date()), "a bad date uses today's year");
}

// --- 3. Payment-method codes ----------------------------------------------------------------------

{
  eq(etaPaymentMethodCode("Cash"), "C", "Cash → C");
  eq(etaPaymentMethodCode("كاش"), "C", "Arabic cash → C");
  eq(etaPaymentMethodCode(""), "C", "blank → C (the default method everywhere)");
  eq(etaPaymentMethodCode("Visa"), "V", "Visa → V");
  eq(etaPaymentMethodCode("Card"), "V", "Card → V");
  eq(etaPaymentMethodCode("فيزا"), "V", "Arabic visa → V");
  eq(etaPaymentMethodCode("Instapay"), "O", "a wallet has no code of its own → O");
}

// --- 4. The ETA document adds up ------------------------------------------------------------------

const etaSettings = normalizeReceiptSettings({
  eta: {
    enabled: true,
    rin: "123456789",
    branchCode: "0",
    deviceSerialNumber: "POS-1",
    activityCode: "8620",
    address: { governate: "Cairo", regionCity: "Heliopolis", street: "El Nozha", buildingNumber: "74" },
  },
});

{
  eq(etaMissingFields(etaSettings), [], "a complete seller block reports nothing missing");
  eq(etaMissingFields(DEFAULT_RECEIPT_SETTINGS), ["rin", "deviceSerialNumber", "address.governate", "address.regionCity", "address.street", "address.buildingNumber"], "the defaults name what is still owed");
  eq(etaItemCode("123456789", "abc 123"), "EG-123456789-abc123", "item codes are EG-{rin}-{code}, unsafe characters dropped");

  const doc = buildEtaReceiptDocument(etaSettings, {
    receiptNumber: "R-2026-0007",
    issuedAtIso: "2026-09-26T10:15:30.123Z",
    clinicName: "Alpha Dental",
    buyer: { name: "Ahmed", mobile: "+201001234567" },
    lines: [
      { internalCode: "p1", description: "Root canal", quantity: 1, unitPrice: 3000, discount: 500 },
      { internalCode: "p2", description: "Filling", quantity: 2, unitPrice: 400, discount: 0 },
    ],
    paymentMethod: "Visa",
  });

  eq(doc.documentType, { receiptType: "S", typeVersion: "1.2" }, "a sale receipt, schema 1.2");
  eq(doc.header.dateTimeIssued, "2026-09-26T10:15:30Z", "issued in UTC, no milliseconds");
  eq(doc.header.currency, "EGP", "EGP by default");
  ok(!("exchangeRate" in doc.header), "no exchange rate for EGP");
  eq(doc.seller.rin, "123456789", "seller carries the registration number");
  eq(doc.seller.branchAddress.country, "EG", "an Egyptian issuer");
  eq(doc.buyer, { type: "P", name: "Ahmed", mobileNumber: "+201001234567" }, "a patient is a natural person");
  eq(doc.paymentMethod, "V", "Visa → V");

  eq(doc.totalSales, 3800, "totalSales = Σ quantity × unit price");
  eq(doc.totalCommercialDiscount, 500, "discounts are summed");
  eq(doc.netAmount, 3300, "netAmount = Σ net after discount (no VAT: net = paid)");
  eq(doc.totalAmount, 3300, "totalAmount is what the patient actually paid");
  eq(doc.taxTotals, [{ taxType: "T1", amount: 0 }], "medical services: VAT line present, amount zero");
  eq(doc.itemData[0].taxableItems, [{ taxType: "T1", amount: 0, subType: "V003", rate: 0 }], "each line says exempt (V003)");
  eq(doc.itemData[0].commercialDiscountData, [{ amount: 500, description: "Discount" }], "a discounted line carries its discount");
  ok(!("commercialDiscountData" in doc.itemData[1]), "an undiscounted line carries no discount block");
  eq(doc.itemData[1].totalSale, 800, "quantity 2 × 400");
  eq(doc.itemData[0].itemCode, "EG-123456789-p1", "item codes are built from the RIN");
  ok(doc.header.uuid === "" && doc.header.previousUUID === "", "UUIDs are Phase 2: left empty, never faked");
}

{
  // Standard VAT is carved OUT of what was paid, never added on top of it.
  const vat = normalizeReceiptSettings({ ...etaSettings, eta: { ...etaSettings.eta, vat: "standard", vatRate: 14 } });
  const doc = buildEtaReceiptDocument(vat, {
    receiptNumber: "R-1",
    issuedAtIso: "2026-01-01T00:00:00Z",
    clinicName: "X",
    buyer: { name: "Y" },
    lines: [{ internalCode: "a", description: "Whitening", quantity: 1, unitPrice: 1140, discount: 0 }],
    paymentMethod: "Cash",
  });
  eq(doc.totalAmount, 1140, "the patient paid 1140, the receipt says 1140");
  eq(doc.netAmount, 1000, "net is 1140 / 1.14");
  eq(doc.taxTotals[0].amount, 140, "VAT is the difference");
  eq(doc.itemData[0].taxableItems[0].subType, "V001", "standard-rated lines are V001");
}

// --- 5. One payment's receipt is built from the account ------------------------------------------

const ledger: ReceiptLedgerTransaction[] = [
  { id: "proc1", date: "2026-09-01", description: "Root canal (T: 36)", type: "procedure", cost: 2500, paid: 0, listPrice: 3000, discountAmount: 500, doctorName: "Dr. Sara" },
  { id: "proc2", date: "2026-09-10", description: "Filling (T: 14)", type: "procedure", cost: 800, paid: 0 },
  { id: "pay1", date: "2026-09-01", description: "Deposit", type: "payment", cost: 0, paid: 1500, method: "Cash", procedureId: "proc1", receiptNumber: "R-2026-0001", addedBy: "Mona" },
  { id: "pay2", date: "2026-09-10", description: "Second", type: "payment", cost: 0, paid: 1000, method: "Visa", procedureId: "proc1", receiptNumber: "R-2026-0002" },
  { id: "pay3", date: "2026-09-20", description: "Later", type: "payment", cost: 0, paid: 800, method: "Cash", procedureId: "proc2", receiptNumber: "R-2026-0003" },
  { id: "gone", date: "2026-09-21", description: "Deleted", type: "payment", cost: 0, paid: 999, status: "deleted", procedureId: "proc1" },
];

const base = {
  clinicName: "Alpha Dental",
  clinicPhone: "+20100",
  clinicAddress: "Cairo",
  patientName: "Ahmed",
  patientPhone: "+20111",
  patientId: "patient1",
  transactions: ledger,
};

{
  const r = buildPaymentReceiptPayload({ ...base, paymentId: "pay2" })!;
  ok(r, "a known payment builds a receipt");
  eq(r.kind, "payment", "kind is payment");
  eq(r.receiptSerial, "R-2026-0002", "the stored receipt number is what prints");
  eq(r.payment?.amount, 1000, "the amount is the payment's");
  eq(r.payment?.method, "Visa", "the method is the payment's");
  eq(r.payment?.charge?.description, "Root canal", "the charge it settles, without the tooth suffix");
  eq(r.payment?.charge?.teeth, "36", "tooth parsed out of the description");
  eq(r.payment?.charge?.paidBefore, 1500, "what was paid on that charge before this payment");
  eq(r.payment?.charge?.remainingAfter, 0, "2500 − 1500 − 1000 = settled");
  eq(r.payment?.charge?.listPrice, 3000, "the list price rides along so the discount can show");
  // Balance after pay2, on 2026-09-10: charges 3300, paid 2500 → 800 still owed (pay3 is later).
  eq(r.balance, 800, "the account balance is as of this payment, not today");

  const first = buildPaymentReceiptPayload({ ...base, paymentId: "pay1" })!;
  eq(first.payment?.charge?.paidBefore, 0, "the first payment on a charge had nothing before it");
  eq(first.payment?.charge?.remainingAfter, 1000, "and 1000 was left after it");
  eq(first.payment?.collectedBy, "Mona", "who took the money");

  ok(buildPaymentReceiptPayload({ ...base, paymentId: "gone" }) === null, "a deleted payment gets no receipt");
  ok(buildPaymentReceiptPayload({ ...base, paymentId: "proc1" }) === null, "a charge is not a payment");
  const noNumber = buildPaymentReceiptPayload({ ...base, transactions: ledger.map((t) => ({ ...t, receiptNumber: null })), paymentId: "pay3" })!;
  ok(/^P-[A-Z0-9]+$/.test(noNumber.receiptSerial), `a payment older than numbering prints a stable id, got ${noNumber.receiptSerial}`);
}

// --- 6. The HTML honours the settings --------------------------------------------------------------

const letterhead = { clinicName: "Alpha Dental", clinicPhone: "+20 100 000 0000", clinicAddress: "Nasr City", leadDoctorName: "Dr. Sara", clinicEmail: "hi@alpha.test" };

{
  const html = buildDentalReceiptSrcDoc(sampleReceiptPayload("payment", letterhead));
  ok(html.includes('dir="rtl"') && html.includes('lang="ar"'), "default receipt is Arabic RTL");
  ok(html.includes("إيصال استلام نقدية"), "payment receipt title in Arabic");
  ok(html.includes("R-2026-0042"), "the sample payment's number prints");
  ok(!html.includes("hi@alpha.test"), "email is off by default");
  ok(!html.includes("بيانات الإيصال الضريبي"), "no tax block until the switch is on");
  ok(html.includes("size: A4 portrait"), "A4 by default");
  ok(html.includes("Tajawal"), "Tajawal by default");

  const en = buildDentalReceiptSrcDoc(sampleReceiptPayload("payment", letterhead), normalizeReceiptSettings({ language: "en" }));
  ok(en.includes('dir="ltr"') && en.includes("Payment receipt"), "English flips direction and labels");
  ok(en.includes("EGP 1,000"), "English money format");

  const both = buildDentalReceiptSrcDoc(sampleReceiptPayload("payment", letterhead), normalizeReceiptSettings({ language: "both" }));
  ok(both.includes("رقم الإيصال · Receipt no."), "both languages side by side");

  const email = buildDentalReceiptSrcDoc(sampleReceiptPayload("payment", letterhead), normalizeReceiptSettings({ show: { clinicEmail: true } }));
  ok(email.includes("hi@alpha.test"), "switching the email on prints it");

  const noDoctor = buildDentalReceiptSrcDoc(sampleReceiptPayload("payment", letterhead), normalizeReceiptSettings({ show: { leadDoctor: false } }));
  ok(!noDoctor.includes("د. Sara"), "switching the lead dentist off removes the name from the header");

  const thermal = buildDentalReceiptSrcDoc(sampleReceiptPayload("payment", letterhead), normalizeReceiptSettings({ template: "thermal" }));
  ok(thermal.includes("size: 80mm auto") && thermal.includes("width: 72mm"), "thermal template is a narrow roll");

  const modern = buildDentalReceiptSrcDoc(sampleReceiptPayload("statement", letterhead), normalizeReceiptSettings({ template: "modern", accent: "#0f766e", font: "cairo", paper: "a5" }));
  ok(modern.includes("background: #0f766e"), "the accent paints the modern header band");
  ok(modern.includes("Cairo") && modern.includes("size: A5 portrait"), "font and paper follow the settings");
  ok(modern.includes("كشف حساب"), "statement title");
  ok(modern.includes("سجل الدفعات"), "statement lists payments by default");

  const noHistory = buildDentalReceiptSrcDoc(sampleReceiptPayload("statement", letterhead), normalizeReceiptSettings({ show: { paymentsHistory: false } }));
  ok(!noHistory.includes("سجل الدفعات"), "the payments table can be switched off");

  const footer = buildDentalReceiptSrcDoc(sampleReceiptPayload("payment", letterhead), normalizeReceiptSettings({ footerText: "شكراً لزيارتكم", headerNote: "أهلاً بكم", show: { signatureLine: true } }));
  ok(footer.includes("شكراً لزيارتكم") && !footer.includes("لا تتطلب توقيع"), "a custom footer replaces the default line");
  ok(footer.includes("أهلاً بكم"), "the header note prints");
  ok(footer.includes('class="sig"'), "a signature line can be added");

  const escaped = buildDentalReceiptSrcDoc(sampleReceiptPayload("payment", { ...letterhead, clinicName: "<script>alert(1)</script>" }));
  ok(!escaped.includes("<script>alert"), "clinic name is HTML-escaped");
}

// --- 7. The tax block on paper --------------------------------------------------------------------

{
  const html = buildDentalReceiptSrcDoc(sampleReceiptPayload("payment", letterhead), etaSettings);
  ok(html.includes("بيانات الإيصال الضريبي"), "the tax block prints when enabled with a RIN");
  ok(html.includes("123456789"), "the registration number prints");
  ok(html.includes("معفى — خدمات طبية (T1 / V003)"), "VAT line says exempt for medical services");
  ok(html.includes("سعر الوحدة"), "the item table gains unit price columns");
  ok(html.includes("لم يُرسل بعد إلى منظومة الإيصال الإلكتروني"), "without a UUID the receipt says it is not yet submitted");
  ok(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z/.test(html), "issued time printed in UTC to the second");
  ok(html.includes(">V<"), "the Visa sample payment prints its method code");

  const off = buildDentalReceiptSrcDoc(sampleReceiptPayload("payment", letterhead), normalizeReceiptSettings({ eta: { enabled: true } }));
  ok(!off.includes("بيانات الإيصال الضريبي"), "enabled but no registration number → nothing prints; a tax block with no number is worse than none");

  const withUuid = buildDentalReceiptSrcDoc({ ...sampleReceiptPayload("payment", letterhead), etaUuid: "ABCDEF0123456789" }, etaSettings);
  ok(withUuid.includes("ABCDEF0123456789") && !withUuid.includes("لم يُرسل بعد"), "a returned UUID prints in place of the pending note");
}

console.log(`receipt: ${passed} checks passed`);
