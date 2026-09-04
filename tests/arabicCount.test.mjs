/**
 * The Arabic counting rule, at every boundary it changes on.
 *
 * These are the cases a bilingual screen gets wrong by accident, because the English rule has only
 * one boundary and Arabic has four. The team rail shipped reading "5 somebody can sign in" and the
 * Prices rail shipped reading "٥٠ علاجات"; both are one `n === 1 ? a : b` away from correct-looking
 * code, which is why they need a test rather than care.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");

// The module is TypeScript with no runtime dependencies; strip the types rather than adding a
// build step to a suite that is otherwise plain node.
const source = readFileSync(join(REPO, "src/lib/arabicCount.ts"), "utf8");
const body = source
  .replace(/export type CountedForms = \{[\s\S]*?\n\};\n/, "")
  .replace(/export function countedNoun\(n: number, isAr: boolean, forms: CountedForms\): string/,
           "export function countedNoun(n, isAr, forms)");
const { countedNoun } = await import(
  `data:text/javascript;base64,${Buffer.from(body, "utf8").toString("base64")}`
);

const TREATMENT = { one: "علاج واحد", two: "علاجين", few: "علاجات", many: "علاج" };
const EN = { one: "treatment", two: "treatments", few: "treatments", many: "treatments" };

let checks = 0;
const is = (actual, expected, why) => {
  assert.equal(actual, expected, why);
  checks += 1;
};

// --- Arabic: four shapes, and the rule repeating on the last two digits -------------------------
is(countedNoun(1, true, TREATMENT), "علاج واحد", "one drops the digit and takes واحد");
is(countedNoun(2, true, TREATMENT), "علاجين", "two drops the digit and takes the dual");
is(countedNoun(3, true, TREATMENT), "3 علاجات", "three starts the plural");
is(countedNoun(5, true, TREATMENT), "5 علاجات", "a five-person clinic is the commonest case here");
is(countedNoun(10, true, TREATMENT), "10 علاجات", "ten is the last of the plural");
is(countedNoun(11, true, TREATMENT), "11 علاج", "eleven returns to the singular");
is(countedNoun(52, true, TREATMENT), "52 علاج", "a real catalogue size stays singular");
is(countedNoun(100, true, TREATMENT), "100 علاج", "a round hundred counts like its last two digits");
is(countedNoun(103, true, TREATMENT), "103 علاجات", "the plural window repeats above a hundred");
is(countedNoun(111, true, TREATMENT), "111 علاج", "and so does the singular one");
is(countedNoun(0, true, TREATMENT), "0 علاج", "zero takes the singular, not the plural");

// --- English: one boundary, and the digit never leaves ------------------------------------------
is(countedNoun(1, false, EN), "1 treatment", "English keeps the digit at one");
is(countedNoun(2, false, EN), "2 treatments", "English has no dual");
is(countedNoun(5, false, EN), "5 treatments", "");
is(countedNoun(52, false, EN), "52 treatments", "English does not return to the singular");

// --- The failures this exists to prevent --------------------------------------------------------
assert.notEqual(countedNoun(5, true, TREATMENT), "5 علاج", "the English rule applied to Arabic");
assert.notEqual(countedNoun(52, true, TREATMENT), "52 علاجات", "the plural carried past ten");
checks += 2;

// --- Every counted noun in the dictionary must carry all four Arabic shapes ---------------------
// A screen that reaches for countedNoun needs one/two/few/many present in both languages; a
// missing `few` is the "٥ علاج" bug back again, and nothing else would catch it.
const text = readFileSync(join(REPO, "src/config/settingsText.ts"), "utf8");
for (const stem of ["treatment", "list", "brokenProfile", "signedInPerson", "branch", "room", "lab", "month", "request", "item", "hour", "slot"]) {
  for (const shape of ["One", "Two", "Few", "Many"]) {
    const key = `${stem}${shape}`;
    assert.ok(
      new RegExp(`\\b${key}:\\s*\\{`).test(text),
      `settingsText.ts has no "${key}". A counted noun needs all four Arabic shapes — without ` +
        `${shape.toLowerCase()} the screen falls back to English grammar in Arabic words`
    );
    checks += 1;
  }
}

console.log(`✓ arabicCount: ${checks} checks — the plural window, the return to the singular, and the repeat above 100`);
