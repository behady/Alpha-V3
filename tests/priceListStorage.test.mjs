// What price lists look like on the way BACK to Firestore. Run with tsx so the TS modules load.
//
// This file exists because of a bug with no symptom worth the name. `parsePriceLists` set
// `nameAr: undefined` on any list without an Arabic name, and what it returns is handed straight
// to setDoc() when anything on the pricing screen is saved. Firestore rejects an undefined value
// outright — "Unsupported field value: undefined" — thrown in the browser before the write is even
// sent, so no security rule, no network call and no server log was ever involved. The screen caught
// it and said "Could not save", which sent everybody looking at permissions.
//
// The shape of the failure is what made it hard to see: the FIRST list a clinic creates saves
// fine, because at that moment the only other list is the seeded Standard one, which does carry an
// Arabic name. Every action afterwards fails, because by then the re-read list does not. So the
// feature appears to work exactly once and is then dead — blanket discount, make-default,
// activate, delete and adding a second list all included.
//
// The assertions below are therefore about ABSENCE, not value: an optional field that is missing
// must be missing, not present-and-undefined. `JSON.stringify` would hide the difference, so every
// check here uses `in` / `hasOwnProperty` deliberately.
import assert from "node:assert/strict";
import {
  DEFAULT_PRICE_LIST,
  parsePriceLists,
  toStoredList,
  toStoredLists,
  STANDARD_LIST_ID,
} from "../src/lib/priceLists.ts";

/** Every undefined-valued key reachable from an object, the way Firestore would find them. */
function undefinedKeys(value, path = "") {
  if (Array.isArray(value)) {
    return value.flatMap((v, i) => undefinedKeys(v, `${path}[${i}]`));
  }
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([k, v]) =>
      v === undefined ? [`${path}.${k}`] : undefinedKeys(v, `${path}.${k}`)
    );
  }
  return [];
}

// --- the exact state that bricked the screen -----------------------------------------------------

// A clinic with the seeded Standard list plus one the user typed in. This is the document as it
// exists in Firestore the moment after "New list" succeeds.
const stored = {
  lists: [
    { id: STANDARD_LIST_ID, name: "Standard", nameAr: "الأساسي", generalDiscountPercent: 0, active: true, isDefault: true },
    { id: "opening_list", name: "opening list", generalDiscountPercent: 0, active: true, isDefault: false },
  ],
};

const reread = parsePriceLists(stored);
assert.equal(reread.length, 2);

// The bug, stated directly: re-reading must not invent an undefined field.
assert.deepEqual(
  undefinedKeys(reread),
  [],
  "parsePriceLists must not return undefined values — they are what setDoc refuses"
);
assert.equal(
  "nameAr" in reread[1],
  false,
  "a list with no Arabic name must have NO nameAr key, not a key set to undefined"
);

// The list that does have one keeps it.
assert.equal(reread[0].nameAr, "الأساسي");

// --- the write-side guarantee --------------------------------------------------------------------

// toStoredLists is the only thing that should ever reach setDoc, and it is unconditional: even
// handed an object that explicitly carries `nameAr: undefined`, it must not pass it on.
const hostile = toStoredLists([
  { id: "a", name: "A", nameAr: undefined, generalDiscountPercent: 10, active: true, isDefault: false },
  { id: "b", name: "B", nameAr: "  ", generalDiscountPercent: 0, active: true, isDefault: true },
  { id: "c", name: "C", nameAr: "عربي", generalDiscountPercent: 0, active: false, isDefault: false },
]);
assert.deepEqual(undefinedKeys(hostile), [], "toStoredLists must never emit an undefined value");
assert.equal("nameAr" in hostile[0], false, "an explicit undefined is dropped, not forwarded");
assert.equal("nameAr" in hostile[1], false, "a whitespace-only Arabic name is not a name");
assert.equal(hostile[2].nameAr, "عربي", "a real Arabic name survives the round trip");

// The seeded default survives a round trip unchanged — this is the very first thing ever written.
const seededTrip = toStoredLists(parsePriceLists(null));
assert.deepEqual(undefinedKeys(seededTrip), []);
assert.equal(seededTrip.length, 1);
assert.equal(seededTrip[0].id, STANDARD_LIST_ID);
assert.equal(seededTrip[0].nameAr, DEFAULT_PRICE_LIST.nameAr);

// --- the full create-then-edit sequence, which is what a user actually does ----------------------

// 1. Fresh clinic, nothing saved. 2. Add a list. 3. Re-read. 4. Change its blanket discount.
// Step 4 is where every clinic hit the wall; nothing in this chain may produce an undefined.
let lists = parsePriceLists(null);
lists = [...lists, { id: "insurance", name: "Insurance", generalDiscountPercent: 0, active: true, isDefault: false }];
const afterCreate = toStoredLists(lists);
assert.deepEqual(undefinedKeys(afterCreate), [], "the create write is clean");

const afterReread = parsePriceLists({ lists: afterCreate });
const afterBlanketChange = toStoredLists(
  afterReread.map((l) => (l.id === "insurance" ? { ...l, generalDiscountPercent: 20 } : l))
);
assert.deepEqual(
  undefinedKeys(afterBlanketChange),
  [],
  "changing the blanket discount after a re-read is the write that used to fail"
);
assert.equal(afterBlanketChange.find((l) => l.id === "insurance").generalDiscountPercent, 20);

// --- normalisation still holds through the serializer --------------------------------------------

// Out-of-range percentages are clamped on the way out, not just on the way in.
const clamped = toStoredList({ id: "x", name: "X", generalDiscountPercent: 250, active: true, isDefault: false });
assert.equal(clamped.generalDiscountPercent, 100);
const negative = toStoredList({ id: "y", name: "Y", generalDiscountPercent: -5, active: true, isDefault: false });
assert.equal(negative.generalDiscountPercent, 0);

// Booleans are always real booleans, never undefined, whatever was handed in.
const sparse = toStoredList({ id: "z", name: "Z", generalDiscountPercent: 0 });
assert.equal(sparse.active, true, "a list with no `active` flag is active");
assert.equal(sparse.isDefault, false);
assert.deepEqual(undefinedKeys(sparse), []);

console.log("✓ priceListStorage: no optional field ever reaches Firestore as undefined");
