// Treatments added while booking, before the booking is confirmed.
//
// The price typed is the price for ONE unit; the service's own rule says how many units the picked
// teeth make (per tooth, per jaw, or flat). The server applies the same rule when the booking is
// saved (lib/procedurePricing), so what the popup shows is what gets charged.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { newStagedId, stagedChargeTotal, stagedLineTotal, stagedUnits, toothListLabel } from "../src/lib/stagedProcedures";

const filling = { cost: 900, addToLedger: true, teeth: ["16", "17"], pricingMode: "per_tooth" as const };
assert.equal(stagedUnits(filling), 2);
assert.equal(stagedLineTotal(filling), 1800, "900 a tooth, two teeth");

assert.equal(stagedUnits({ cost: 900, addToLedger: true }), 1, "no teeth picked = a general treatment, one unit (as before)");
assert.equal(stagedLineTotal({ cost: 900, addToLedger: true }), 900);

const scaling = { cost: 550, addToLedger: true, teeth: ["11", "21", "31", "41"], pricingMode: "per_arch" as const };
assert.equal(stagedUnits(scaling), 2, "both jaws");
assert.equal(stagedLineTotal(scaling), 1100);

const consult = { cost: 300, addToLedger: true, teeth: ["16", "17", "26"], pricingMode: "flat" as const };
assert.equal(stagedLineTotal(consult), 300, "a flat price ignores the teeth");

assert.equal(stagedLineTotal({ cost: 700, addToLedger: true, teeth: ["16", "17"], pricingMode: "nonsense" }), 1400, "an unknown rule falls back to per tooth, like the server");
assert.equal(stagedLineTotal({ cost: 333.34, addToLedger: true, teeth: ["16", "17", "18"] }), 1000.02, "rounded to piastres, the way the server rounds");

assert.equal(
  stagedChargeTotal([filling, scaling, { cost: 999, addToLedger: false, teeth: ["11"] }]),
  2900,
  "a treatment kept off the books is not charged",
);

assert.equal(toothListLabel(["17", "16", "55"]), "16, 17, 55", "teeth listed in number order");
assert.equal(toothListLabel([]), "");

// Each staged treatment is saved under its id as a request key (api/clinical/procedures writes a
// key once), so the id must pass the server's key rule and never repeat.
const ids = new Set(Array.from({ length: 500 }, () => newStagedId()));
assert.equal(ids.size, 500, "staged ids never repeat");
for (const id of ids) assert.match(id, /^[A-Za-z0-9_-]{8,100}$/, "a staged id is a usable request key");

// The 2026-10-13 duplicate charges: autosave re-sent staged treatments on every settled edit.
// Autosave must never carry them, and an existing visit in the side drawer adds treatments on the
// spot (AppointmentMoneyTab) instead of staging them for a later save.
const modal = readFileSync(new URL("../src/components/BookingModal.tsx", import.meta.url), "utf8");
assert.match(modal, /onAutosave\(\{ \.\.\.buildPayload\(\), sessionProcedures: \[\] \}\)/, "autosave sends no staged treatments");
assert.doesNotMatch(modal, /onAutosave\(buildPayload\(\)\)/, "no autosave path sends the whole form with its staged treatments");
const flat = modal.replace(/\r/g, "");
const drawerAt = flat.indexOf("{editAppointment ? (\n  // An existing visit records");
assert.ok(drawerAt >= 0, "the drawer's treatment section branches on an existing visit");
const drawerBlock = flat.slice(drawerAt).split("\n").slice(0, 10).join("\n");
assert.match(drawerBlock, /<AppointmentMoneyTab [^\n]*section="service"[^\n]*\/>\n {2}<\/div>\n\) : \(\n {2}addProcedureSection\n\)\}/, "the drawer edits an existing visit's treatments in place");
const booking = readFileSync(new URL("../src/lib/bookingService.ts", import.meta.url), "utf8");
assert.match(booking, /requestKey: sp\.id/, "a staged treatment is saved under its id");

console.log("stagedProcedures: all checks passed");
