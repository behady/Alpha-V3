// Price lists scoped to branches. Run with tsx so the TS module loads directly.
//
// A branch does not own a copy of the price structure — prices still live on the service, keyed by
// list id. What a branch owns is WHICH lists apply there. Everything below is about the two rules
// that fall out of that, both of which are easy to get subtly wrong:
//
//   1. "One default" is per SCOPE, not per clinic. A two-branch clinic has up to three defaults:
//      one per branch, plus the clinic-wide one covering a branch that has set none.
//   2. A list that belongs to branch A must never be quotable at branch B — not by being picked,
//      not by being inherited from the patient, not by being the last one standing.
import assert from "node:assert/strict";
import {
  listsForBranch,
  parsePriceLists,
  resolveActiveListId,
  toStoredLists,
  STANDARD_LIST_ID,
} from "../src/lib/priceLists.ts";

const L = (id, extra = {}) => ({
  id,
  name: id,
  generalDiscountPercent: 0,
  active: true,
  isDefault: false,
  ...extra,
});

/** Every undefined-valued key reachable from an object, the way Firestore would find them. */
function undefinedKeys(value, path = "") {
  if (Array.isArray(value)) return value.flatMap((v, i) => undefinedKeys(v, `${path}[${i}]`));
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([k, v]) =>
      v === undefined ? [`${path}.${k}`] : undefinedKeys(v, `${path}.${k}`)
    );
  }
  return [];
}

// --- scope-aware defaults -------------------------------------------------------------------

// Each branch keeps its own default, and the clinic-wide list keeps its own. Three defaults here
// is CORRECT — the old "exactly one default" rule would have thrown two of them away.
const threeScopes = parsePriceLists({
  lists: [
    L("standard", { isDefault: true }),
    L("downtown_ins", { branchId: "b_down", isDefault: true }),
    L("seaside_ins", { branchId: "b_sea", isDefault: true }),
  ],
});
assert.equal(threeScopes.filter((l) => l.isDefault).length, 3, "one default per scope, not one overall");

// Two defaults inside ONE scope is still ambiguous, and still collapses to the first.
const dupeInScope = parsePriceLists({
  lists: [
    L("a", { branchId: "b1", isDefault: true }),
    L("b", { branchId: "b1", isDefault: true }),
    L("c", { isDefault: true }),
  ],
});
assert.deepEqual(
  dupeInScope.filter((l) => l.isDefault).map((l) => l.id),
  ["a", "c"],
  "the second default in a scope is demoted; the other scope is untouched"
);

// A scope whose only default was deactivated promotes its first active list, so no branch that
// has lists is ever left without one.
const promoted = parsePriceLists({
  lists: [
    L("standard", { isDefault: true }),
    L("dead", { branchId: "b1", isDefault: true, active: false }),
    L("alive", { branchId: "b1" }),
  ],
});
assert.equal(promoted.find((l) => l.id === "alive").isDefault, true, "a scope promotes an active list");
assert.equal(promoted.find((l) => l.id === "dead").isDefault, false, "an inactive list is not a default");

// A branch whose every list is inactive gets no default rather than a broken one.
const allDead = parsePriceLists({
  lists: [L("standard", { isDefault: true }), L("x", { branchId: "b1", active: false })],
});
assert.equal(allDead.find((l) => l.id === "x").isDefault, false);

// --- which lists a branch may charge --------------------------------------------------------

const mixed = parsePriceLists({
  lists: [
    L("standard", { isDefault: true }),
    L("clinicwide_promo"),
    L("downtown_ins", { branchId: "b_down", isDefault: true }),
    L("seaside_ins", { branchId: "b_sea", isDefault: true }),
  ],
});

assert.deepEqual(
  listsForBranch(mixed, "b_down").map((l) => l.id),
  ["standard", "clinicwide_promo", "downtown_ins"],
  "a branch sees its own lists plus every clinic-wide one"
);
assert.equal(
  listsForBranch(mixed, "b_down").some((l) => l.id === "seaside_ins"),
  false,
  "and never another branch's"
);
// No branch in hand: everything, so a clinic that has never opened the Branches screen sees no
// change at all.
assert.equal(listsForBranch(mixed, null).length, 4);
assert.equal(listsForBranch(mixed, "").length, 4);

// --- resolving what to charge ---------------------------------------------------------------

// The branch's own default beats the clinic-wide one.
assert.equal(resolveActiveListId(mixed, null, null, "b_down"), "downtown_ins");
assert.equal(resolveActiveListId(mixed, null, null, "b_sea"), "seaside_ins");

// A branch with no list of its own charges what the clinic charges.
assert.equal(resolveActiveListId(mixed, null, null, "b_new"), "standard");

// No branch at all still works exactly as before branches existed.
assert.equal(resolveActiveListId(mixed, null, null, null), "standard");

// An explicit choice wins — but only where it is actually offered.
assert.equal(resolveActiveListId(mixed, "clinicwide_promo", null, "b_down"), "clinicwide_promo");
assert.equal(
  resolveActiveListId(mixed, "seaside_ins", null, "b_down"),
  "downtown_ins",
  "a list from another branch is refused and the branch default takes over"
);

// Same for a patient whose usual list belongs to the branch across town.
assert.equal(
  resolveActiveListId(mixed, null, "seaside_ins", "b_down"),
  "downtown_ins",
  "the patient's usual list does not follow them to a branch that does not offer it"
);
assert.equal(resolveActiveListId(mixed, null, "clinicwide_promo", "b_down"), "clinicwide_promo");

// An inactive list is never resolved to, whoever asked for it.
const withDead = parsePriceLists({
  lists: [L("standard", { isDefault: true }), L("old", { branchId: "b1", active: false })],
});
assert.equal(resolveActiveListId(withDead, "old", null, "b1"), "standard");

// The seeded clinic — no document at all — still resolves, branch or no branch.
assert.equal(resolveActiveListId(parsePriceLists(null), null, null, "b_any"), STANDARD_LIST_ID);

// --- storage ---------------------------------------------------------------------------------

// branchId survives a round trip, and absence stays absence. Firestore rejects undefined, and a
// list written with `branchId: undefined` would kill every save on the screen.
const stored = toStoredLists(mixed);
assert.deepEqual(undefinedKeys(stored), [], "no undefined reaches Firestore");
assert.equal("branchId" in stored.find((l) => l.id === "standard"), false, "clinic-wide has no branchId key");
assert.equal(stored.find((l) => l.id === "downtown_ins").branchId, "b_down");

// A blank or whitespace branchId is not a branch — it would match nothing and read as scoped.
const blanks = toStoredLists([L("a", { branchId: "   " }), L("b", { branchId: "" })]);
assert.deepEqual(undefinedKeys(blanks), []);
assert.equal("branchId" in blanks[0], false, "whitespace is not a branch id");
assert.equal("branchId" in blanks[1], false, "empty string is not a branch id");

// Round trip: parse(store(parse(x))) is stable, which is what stops a save from quietly
// reshuffling which list is default.
const once = parsePriceLists({ lists: toStoredLists(mixed) });
const twice = parsePriceLists({ lists: toStoredLists(once) });
assert.deepEqual(twice, once, "storing and re-reading changes nothing");

console.log("✓ priceListBranches: one default per scope, and no branch quotes another's prices");
