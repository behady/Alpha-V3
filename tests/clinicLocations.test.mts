// Branch receipt and tax fields survive sanitising; the receipt prefix always has a fallback.
import assert from "node:assert/strict";
import { parseClinicBranches, receiptPrefixFor } from "../src/lib/clinicLocations";

const parsed = parseClinicBranches({ branches: [{ id: "h", name: "Heliopolis", rooms: [], receiptPrefix: "hel-1", etaBranchCode: " 12 ", taxRegistration: "100-200" }] });
assert.equal(parsed[0].receiptPrefix, "HEL1");
assert.equal(parsed[0].etaBranchCode, "12");
assert.equal(parsed[0].taxRegistration, "100-200");
assert.equal(parseClinicBranches({ branches: [{ id: "t", name: "Tagamoa", rooms: [] }] })[0].receiptPrefix, "", "absent stays absent-as-empty, never undefined");
const one = (name: string, receiptPrefix = "") => ({ id: name, name, receiptPrefix });
const solo = (b: ReturnType<typeof one>) => receiptPrefixFor(b, [b]);
assert.equal(solo(one("Heliopolis")), "HEL");
assert.equal(solo(one("التجمع")), "BR", "no Latin letters to borrow");
assert.equal(solo(one("x", "TAG")), "TAG");
// Two branches never resolve to one prefix (each counts its receipts on its own).
const arabic = [one("التجمع"), one("مدينة نصر"), one("الشيخ زايد")];
assert.deepEqual(arabic.map((b) => receiptPrefixFor(b, arabic)), ["BR", "BR2", "BR3"]);
const hel = [one("Heliopolis"), one("Heliopolis 2")];
assert.deepEqual(hel.map((b) => receiptPrefixFor(b, hel)), ["HEL", "HEL2"]);
const mixed = [one("Heliopolis"), one("Other", "HEL")];
assert.deepEqual(mixed.map((b) => receiptPrefixFor(b, mixed)), ["HEL2", "HEL"], "an explicit prefix is never altered; the derived one gives way");
const twoTyped = [one("A", "TAG"), one("B", "TAG")];
assert.deepEqual(twoTyped.map((b) => receiptPrefixFor(b, twoTyped)), ["TAG", "TAG"], "typed duplicates are left to the settings guard");
const tight = [one("Abcdef", "ABC"), one("Abcxyz")];
assert.equal(receiptPrefixFor(tight[1], tight), "ABC2");

console.log("clinicLocations: all checks passed");
