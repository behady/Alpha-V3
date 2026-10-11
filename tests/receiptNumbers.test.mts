// Receipt numbers count per branch: its own counter document, its own prefix.
import assert from "node:assert/strict";
import { receiptCounterDocId, formatReceiptNumber, normalizeReceiptSettings } from "../src/lib/receiptSettings";
import { buildDentalReceiptSrcDoc, sampleReceiptPayload } from "../src/lib/receiptRender";

assert.equal(receiptCounterDocId(null), "receipt_counter");
assert.equal(receiptCounterDocId("hel"), "receipt_counter_hel");
const s = { numberPrefix: "R-", numberIncludesYear: false };
assert.equal(formatReceiptNumber(s, 5, "2026-10-11"), "R-0005");
assert.equal(formatReceiptNumber(s, 5, "2026-10-11", "HEL"), "HEL-0005");
assert.equal(formatReceiptNumber(s, 5, "2026-10-11", ""), "R-0005", "an empty override leaves the clinic's prefix");
assert.equal(formatReceiptNumber({ ...s, numberIncludesYear: true }, 5, "2026-10-11", "TAG"), "TAG-2026-0005");

// The printed receipt: the branch's name and address under the clinic name, its own tax identity.
const letterhead = { clinicName: "Alpha Dental", clinicPhone: "+20 100 000 0000", clinicAddress: "Nasr City" };
const eta = normalizeReceiptSettings({ eta: { enabled: true, rin: "123456789", branchCode: "0" } });
const branch = { id: "tag", name: "Tagamoa", address: "5th Settlement", phone: "", code: "", rooms: [], receiptPrefix: "TAG", etaBranchCode: "77", taxRegistration: "987654321" };
const plain = buildDentalReceiptSrcDoc(sampleReceiptPayload("payment", letterhead), eta);
assert.ok(!plain.includes("Tagamoa") && plain.includes("123456789"), "no branch: the clinic-wide receipt, unchanged");
const withBranch = buildDentalReceiptSrcDoc({ ...sampleReceiptPayload("payment", letterhead), branch }, eta);
assert.ok(withBranch.includes("Tagamoa") && withBranch.includes("5th Settlement"), "the branch name and address print under the clinic name");
assert.ok(withBranch.includes("987654321") && !withBranch.includes("123456789"), "the branch's tax registration replaces the clinic's");
assert.ok(withBranch.includes(">77<"), "the branch's ETA code replaces the clinic's");
const bare = buildDentalReceiptSrcDoc({ ...sampleReceiptPayload("payment", letterhead), branch: { ...branch, etaBranchCode: "", taxRegistration: "" } }, eta);
assert.ok(bare.includes("123456789") && bare.includes(">0<"), "a branch with no tax identity of its own falls back to the clinic's");

console.log("receiptNumbers: all checks passed");
