// Branch receipt and tax fields survive sanitising; the receipt prefix always has a fallback.
import assert from "node:assert/strict";
import { parseClinicBranches, receiptPrefixFor } from "../src/lib/clinicLocations";

const parsed = parseClinicBranches({ branches: [{ id: "h", name: "Heliopolis", rooms: [], receiptPrefix: "hel-1", etaBranchCode: " 12 ", taxRegistration: "100-200" }] });
assert.equal(parsed[0].receiptPrefix, "HEL1");
assert.equal(parsed[0].etaBranchCode, "12");
assert.equal(parsed[0].taxRegistration, "100-200");
assert.equal(parseClinicBranches({ branches: [{ id: "t", name: "Tagamoa", rooms: [] }] })[0].receiptPrefix, "", "absent stays absent-as-empty, never undefined");
assert.equal(receiptPrefixFor({ name: "Heliopolis", receiptPrefix: "" }), "HEL");
assert.equal(receiptPrefixFor({ name: "التجمع", receiptPrefix: "" }), "BR", "no Latin letters to borrow");
assert.equal(receiptPrefixFor({ name: "x", receiptPrefix: "TAG" }), "TAG");

console.log("clinicLocations: all checks passed");
