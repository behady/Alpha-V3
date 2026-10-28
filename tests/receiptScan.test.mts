/**
 * Receipt scan: the model's answer is cleaned before anyone sees it, and the save route only
 * attaches files from this clinic's own receipts folder.
 *
 * Run: npm run test:receipt-scan
 */
import assert from "node:assert/strict";
import {
  isDownloadUrlFor,
  isOwnReceiptPath,
  linesMatchTotal,
  normalizeReceiptScan,
  RECEIPT_CATEGORY_IDS,
  RECEIPT_RESPONSE_SCHEMA,
  buildReceiptPrompt,
} from "../src/lib/receiptScan";
import { EXPENSE_CATEGORY_LIST } from "../src/lib/expenseCategories";
import { expenseReceiptPath } from "../src/lib/storagePaths";

// Every category the reader may pick is a real expense category; payroll is not a receipt.
for (const id of RECEIPT_CATEGORY_IDS) assert.ok(EXPENSE_CATEGORY_LIST.some((c) => c.id === id), id);
assert.ok(!RECEIPT_CATEGORY_IDS.includes("Salary"));
assert.ok(RECEIPT_CATEGORY_IDS.includes("Supplies") && RECEIPT_CATEGORY_IDS.includes("Cleaning") && RECEIPT_CATEGORY_IDS.includes("Utilities"));
assert.deepEqual(RECEIPT_RESPONSE_SCHEMA.properties.lines.items.properties.category.enum, RECEIPT_CATEGORY_IDS);
assert.match(buildReceiptPrompt("ar", "2026-10-28"), /Supplies/);
assert.match(buildReceiptPrompt("ar", "2026-10-28"), /Today is 2026-10-28/);

// A mixed supplier invoice: one line per category, duplicates merged, junk dropped.
const mixed = normalizeReceiptScan({
  isReceipt: true,
  supplier: "  مكتب الأمل للمستلزمات ",
  date: "2026-10-27",
  total: 2170,
  lines: [
    { category: "Supplies", description: "كمبوزيت", amount: 1500 },
    { category: "Supplies", description: "جوانتي", amount: "350" },
    { category: "Cleaning", description: "مطهر", amount: 320 },
    { category: "Rocket fuel", description: "؟", amount: 0 },
    { category: "Nonsense", description: "x", amount: 10.555 },
  ],
  warnings: ["", "الإجمالي مكتوب بخط اليد"],
});
assert.ok(mixed);
assert.equal(mixed.supplier, "مكتب الأمل للمستلزمات");
assert.equal(mixed.date, "2026-10-27");
assert.deepEqual(
  mixed.lines.map((l) => [l.category, l.amount]),
  [["Supplies", 1850], ["Cleaning", 320], ["Other", 10.56]],
);
assert.equal(mixed.lines[0].description, "كمبوزيت، جوانتي");
assert.deepEqual(mixed.warnings, ["الإجمالي مكتوب بخط اليد"]);

// Bad dates are dropped rather than guessed; a missing total falls back to the sum.
const bill = normalizeReceiptScan({ isReceipt: true, supplier: "North Cairo Electricity", date: "2026-02-30", total: 0, lines: [{ category: "Utilities", description: "", amount: 912.4 }], warnings: [] });
assert.equal(bill?.date, "");
assert.equal(bill?.total, 912.4);

// Not a receipt: said so, no lines. Nothing readable: null.
assert.deepEqual(normalizeReceiptScan({ isReceipt: false, lines: [{ category: "Supplies", amount: 5 }] })?.lines, []);
assert.equal(normalizeReceiptScan({ isReceipt: true, lines: [] }), null);
assert.equal(normalizeReceiptScan("hello"), null);
assert.equal(normalizeReceiptScan([]), null);

// Totals.
assert.equal(linesMatchTotal([{ amount: 1850 }, { amount: 320 }], 2170), true);
assert.equal(linesMatchTotal([{ amount: 1850 }, { amount: 320 }], 2270), false);

// Paths: only this clinic's folder for this receipt, one file below it.
const path = expenseReceiptPath("clinicA", "r1", "IMG 2026.jpg");
assert.equal(path, "clinics/clinicA/expense_receipts/r1/IMG_2026.jpg");
assert.equal(isOwnReceiptPath(path, "clinicA", "r1"), true);
assert.equal(isOwnReceiptPath(path, "clinicB", "r1"), false);
assert.equal(isOwnReceiptPath(path, "clinicA", "r2"), false);
assert.equal(isOwnReceiptPath("clinics/clinicA/expense_receipts/r1/../../x.jpg", "clinicA", "r1"), false);
assert.equal(isOwnReceiptPath("clinics/clinicA/expense_receipts/r1/", "clinicA", "r1"), false);
assert.equal(isOwnReceiptPath(path, "clinicA", "r1/../r2"), false);
assert.throws(() => expenseReceiptPath(null, "r1", "a.jpg"));

// The photo link must be our Storage's link to exactly that file.
const url = `https://firebasestorage.googleapis.com/v0/b/bucket.appspot.com/o/${encodeURIComponent(path)}?alt=media&token=abc`;
assert.equal(isDownloadUrlFor(url, path), true);
assert.equal(isDownloadUrlFor(url, "clinics/clinicB/expense_receipts/r1/IMG_2026.jpg"), false);
assert.equal(isDownloadUrlFor(`https://evil.example/v0/b/x/o/${encodeURIComponent(path)}`, path), false);
assert.equal(isDownloadUrlFor("not a url", path), false);

console.log("receiptScan: ok");
