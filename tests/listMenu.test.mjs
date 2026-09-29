// Each price list has its own menu of treatments. Run with tsx so the TS modules load.
//
// Until now a list could only change PRICES: every list showed the same treatments, and the only
// way to take a treatment off a list was to make the list an insurer and untick it there. Two
// things a clinic wanted were impossible: a treatment that exists on one list alone (an insurer's
// own tariff item, a package sold only to a partner) and a normal treatment simply not offered on
// a list. The rules below are what make those two things safe:
//
//   1. A treatment that belongs to a list (`listId`) is offered on that list and nowhere else —
//      not on Standard, not on any other list, whatever the insurer's coverage says.
//   2. A shared treatment a list has hidden (`hiddenServiceIds`) is off that list and nowhere
//      else. Hiding is per list; the Standard list is never hidden from by the screen, but the
//      rule still honours the data if it ever is.
//   3. Everything else is exactly what it was: the insurer's coverage still applies, and a list
//      with nothing configured shows every shared treatment.
import assert from "node:assert/strict";
import { parsePriceLists, toStoredList, STANDARD_LIST_ID } from "../src/lib/priceLists.ts";
import { ownedByAnotherList, serviceMenuFilter } from "../src/lib/serviceMenu.ts";
import { PRIVATE_PAYER } from "../src/lib/payers.ts";

const L = (id, extra = {}) => ({ id, name: id, generalDiscountPercent: 0, active: true, isDefault: false, ...extra });

const lists = [
  L(STANDARD_LIST_ID, { isDefault: true }),
  L("axa", { hiddenServiceIds: ["whitening"] }),
  L("family"),
];
const axaPayer = { id: "payer-axa", name: "AXA", priceListId: "axa", active: true, isDefault: false, services: ["scaling", "axa_prophy"] };
const payers = [PRIVATE_PAYER, axaPayer];

const scaling = { id: "scaling" };
const whitening = { id: "whitening" };
const axaProphy = { id: "axa_prophy", listId: "axa" };
const familyPack = { id: "family_pack", listId: "family" };

// --- rule 1: a list-only treatment is offered on its list alone ---
assert.equal(ownedByAnotherList(axaProphy, "axa"), false);
assert.equal(ownedByAnotherList(axaProphy, STANDARD_LIST_ID), true);
assert.equal(ownedByAnotherList(axaProphy, null), true, "no list in hand = the standard menu, which never shows another list's own treatments");
assert.equal(ownedByAnotherList(scaling, "axa"), false, "a shared treatment belongs to nobody");
assert.equal(ownedByAnotherList({ id: "x", listId: "" }, "axa"), false, "an empty listId is a shared treatment, not a treatment on the list named ''");

{
  const onStandard = serviceMenuFilter(lists, payers, STANDARD_LIST_ID);
  assert.equal(onStandard(scaling), true);
  assert.equal(onStandard(whitening), true, "hidden on AXA only, still on Standard");
  assert.equal(onStandard(axaProphy), false, "AXA's own item never reaches the standard menu");
  assert.equal(onStandard(familyPack), false);
}

// --- rule 2: hiding is per list ---
{
  const onFamily = serviceMenuFilter(lists, payers, "family");
  assert.equal(onFamily(whitening), true, "hidden on AXA does not mean hidden on Family");
  assert.equal(onFamily(familyPack), true);
  assert.equal(onFamily(axaProphy), false);
}
{
  const onAxa = serviceMenuFilter(lists, payers, "axa");
  assert.equal(onAxa(whitening), false, "hidden on this list");
  assert.equal(onAxa(axaProphy), true, "its own item, and the insurer covers it");
  assert.equal(onAxa(scaling), true, "shared, covered, not hidden");
}

// --- rule 3: the insurer's coverage still applies on top ---
{
  const onAxa = serviceMenuFilter(lists, payers, "axa");
  assert.equal(onAxa({ id: "crown" }), false, "not in the insurer's coverage, so not offered, exactly as before");
  const uncoveredOwn = { id: "axa_special", listId: "axa" };
  assert.equal(onAxa(uncoveredOwn), true, "a list's OWN treatment never needs a coverage tick — it was created on this list, that is the tick");
}
{
  // A service with no id cannot be judged and is offered rather than silently dropped — the same
  // choice `payerCoverageFilter` makes, kept here so the two filters never disagree.
  const onAxa = serviceMenuFilter(lists, payers, "axa");
  assert.equal(onAxa({ id: "" }), true);
}
{
  // An unknown list id (a deleted list still stamped on an old note) hides nothing and shows only
  // shared treatments — never another list's own.
  const onGone = serviceMenuFilter(lists, payers, "gone");
  assert.equal(onGone(scaling), true);
  assert.equal(onGone(whitening), true);
  assert.equal(onGone(axaProphy), false);
}

// --- storage: hiddenServiceIds round-trips, and is ABSENT when empty (Firestore rejects undefined) ---
{
  const parsed = parsePriceLists({ lists: [
    { id: "std", name: "Standard", hiddenServiceIds: ["a", " b ", "", 7, "a"] },
    { id: "open", name: "Open", hiddenServiceIds: [] },
    { id: "none", name: "None" },
  ] });
  assert.deepEqual(parsed[0].hiddenServiceIds, ["a", "b"], "trimmed, de-duplicated, strings only");
  assert.equal("hiddenServiceIds" in parsed[1], false, "empty array is stored as nothing");
  assert.equal("hiddenServiceIds" in parsed[2], false);

  const stored = toStoredList({ ...L("x"), hiddenServiceIds: ["a"] });
  assert.deepEqual(stored.hiddenServiceIds, ["a"]);
  assert.equal("hiddenServiceIds" in toStoredList({ ...L("y"), hiddenServiceIds: [] }), false);
  assert.equal("hiddenServiceIds" in toStoredList(L("z")), false);
  for (const s of [stored, toStoredList(L("z"))]) {
    for (const [k, v] of Object.entries(s)) assert.notEqual(v, undefined, `${k} must never be undefined`);
  }
}

console.log("listMenu: all assertions passed");
