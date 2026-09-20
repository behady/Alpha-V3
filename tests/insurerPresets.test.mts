// The insurer presets and the monogram that stands in for a logo.
//
// Two small things guarded for the same reason: a payer's name is STAMPED on every case recorded
// under it, so the name is data, not a label. Three spellings of "NEXtCARE" are three columns in
// the report that never add up, which is what the preset list exists to prevent — and a badge that
// changed colour between two reports would be read as two insurers, which is worse than no colour.
//
// Run with tsx: npm run test:insurers
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  INSURER_GROUPS,
  INSURER_PRESETS,
  insurerBadge,
  insurerInitials,
  insurerTone,
  presetsIn,
} from "../src/lib/insurerPresets";

const REPO = join(import.meta.dirname, "..");
let checks = 0;
function ok(condition: unknown, message: string) {
  assert.ok(condition, message);
  checks++;
}
function eq<T>(actual: T, expected: T, message: string) {
  assert.deepEqual(actual, expected, message);
  checks++;
}

// --- 1. The list is coherent and bilingual -----------------------------------------------------
{
  const names = new Set<string>();
  for (const p of INSURER_PRESETS) {
    ok(!names.has(p.name), `"${p.name}" is listed twice — two chips, one insurer`);
    names.add(p.name);
    ok(p.name.trim().length > 1, `a preset has no usable English name`);
    ok(p.nameAr.trim().length > 1, `"${p.name}" has no Arabic name, and the whole app is bilingual`);
    ok(/[؀-ۿ]/.test(p.nameAr), `"${p.name}" has a non-Arabic string in its Arabic name`);
    ok(
      INSURER_GROUPS.some((g) => g.id === p.group),
      `"${p.name}" is in group "${p.group}", which has no heading — the chip would not render`
    );
  }
  for (const g of INSURER_GROUPS) {
    ok(presetsIn(g.id).length > 0, `group "${g.id}" is empty and would render as a heading with nothing under it`);
  }

  // The networks come first because the name on a patient's card is usually the administrator,
  // not the insurer behind it — so that is the list a receptionist is actually scanning.
  eq(INSURER_GROUPS[0].id, "tpa", "the networks are listed first");
  ok(INSURER_PRESETS.length >= 15, "the list has shrunk to the point of not being worth picking from");

  // Both belong: the AXA-to-gig rebrand was the Gulf business, not Egypt.
  ok(INSURER_PRESETS.some((p) => p.name === "AXA Egypt"), "AXA Egypt is still a separate company and belongs");
  ok(INSURER_PRESETS.some((p) => p.name === "gig Egypt"), "gig Egypt belongs too");
}

// --- 2. Initials, in both scripts --------------------------------------------------------------
{
  eq(insurerInitials("MetLife Egypt"), "M", "the word Egypt carries no information and is dropped, leaving one letter");
  eq(insurerInitials("Misr Insurance"), "MI", "two words, two letters");
  eq(insurerInitials("NEXtCARE"), "N", "a single word gives one letter rather than an invented second");
  eq(insurerInitials("gig Egypt"), "G", "lowercase names are still shown uppercase");
  eq(insurerInitials("Engineers' Syndicate"), "ES", "an apostrophe separates words rather than becoming one");
  eq(insurerInitials("Health Insurance Organization"), "HI", "at most two letters, however many words");

  // Arabic has no uppercase, so the fold is a no-op — the letters must survive it unchanged.
  eq(insurerInitials("مصر للتأمين"), "مل", "an Arabic name gives Arabic initials");
  eq(insurerInitials("الهيئة العامة للتأمين الصحي"), "هع", "the definite article is skipped, not initialled");

  eq(insurerInitials(""), "?", "an empty name still draws something");
  eq(insurerInitials("   "), "?", "and so does whitespace");
  ok(insurerInitials("MetLife Egypt").length <= 2, "a badge never holds more than two letters");
}

// --- 3. The tone is stable, which is the whole point -------------------------------------------
{
  eq(
    insurerTone("AXA Egypt"),
    insurerTone("AXA Egypt"),
    "the same name must always give the same colour — an insurer that changed colour between two reports reads as two insurers"
  );
  eq(insurerTone(" AXA Egypt "), insurerTone("AXA Egypt"), "and stray spacing must not change it");
  ok(/^#[0-9a-f]{6}$/i.test(insurerTone("MedNet Egypt")), "a tone is a usable hex colour");

  // Not a hard guarantee of uniqueness — eight tones cannot cover twenty names — but the preset
  // list must not collapse onto one or two, which would make the colour useless.
  const tones = new Set(INSURER_PRESETS.map((p) => insurerTone(p.name)));
  ok(tones.size >= 5, `the presets only use ${tones.size} distinct tones; the colour stops distinguishing anything`);

  eq(insurerBadge("Bupa Egypt"), { initials: "B", tone: insurerTone("Bupa Egypt") }, "the badge bundles both");
}

// --- 4. No trademarked marks are shipped -------------------------------------------------------
//
// The reason this feature draws a monogram instead of using the real logos: every one of these is
// a registered trademark, and shipping a library of other companies' marks inside a product sold
// to clinics is a disproportionate risk for a nicety. A future change that quietly adds an image
// URL or a bundled asset should have to argue with this test first.
{
  const lib = readFileSync(join(REPO, "src/lib/insurerPresets.ts"), "utf8");
  ok(!/https?:\/\/[^\s"']*\.(png|jpe?g|svg|webp)/i.test(lib), "a preset points at a remote logo image");
  ok(!/logoUrl|logoSrc|iconUrl/.test(lib), "a preset carries a logo field — the badge is drawn, not fetched");

  const badge = readFileSync(join(REPO, "src/components/shared/InsurerBadge.tsx"), "utf8");
  ok(!/<img|next\/image/.test(badge), "the badge renders an image rather than the monogram it is supposed to draw");
  ok(/insurerBadge\(name\)/.test(badge), "the badge no longer derives its initials and tone from the name");
}

// --- 5. The screens use it ---------------------------------------------------------------------
{
  const wizard = readFileSync(join(REPO, "src/components/settings/PayersSettings.tsx"), "utf8");
  ok(/INSURER_GROUPS/.test(wizard) && /presetsIn/.test(wizard), "the wizard no longer offers the preset names");
  ok(
    /placeholder=\{isAr \? "مثال: أكسا" : "e\.g\. AXA"\}/.test(wizard) || /<input/.test(wizard),
    "the wizard must still allow a name to be typed — a preset list that refuses the unlisted case is worse than none"
  );
  for (const rel of [
    "src/components/reports/PayerReport.tsx",
    "src/components/reports/CaseSheetReport.tsx",
  ]) {
    ok(/InsurerBadge/.test(readFileSync(join(REPO, rel), "utf8")), `${rel} does not show the payer badge`);
  }
}

console.log(`insurerPresets: ${checks} checks passed across ${INSURER_PRESETS.length} presets`);
