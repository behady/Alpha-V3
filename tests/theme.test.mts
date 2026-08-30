/**
 * Cases for the clinic theme layer.
 *
 * The boot script is the reason this file exists: it is a STRING that runs before the bundle, so
 * the compiler never sees it and a typo in it fails silently at runtime, on every page load, as a
 * colour flash nobody can explain. It is parsed and executed here against a fake DOM.
 *
 * Run: npx tsx tests/theme.test.mts
 */
import { THEME_BOOT_SCRIPT } from "../src/lib/theme/bootScript";
import { THEME_PRESETS, availablePresets, getPreset, DEFAULT_PRESET_ID } from "../src/lib/theme/presets";
import { ROLE_TOKENS, isSafeTokenName, isSafeTokenValue, sanitizeTokens } from "../src/lib/theme/tokens";

let pass = 0;
const fail: string[] = [];
function ok(name: string, cond: boolean, detail = "") {
  if (cond) pass++;
  else fail.push(`${name}${detail ? "\n      " + detail : ""}`);
}

/* ------------------------------------------------------- presets are complete */

for (const p of THEME_PRESETS) {
  const missing = ROLE_TOKENS.filter((t) => !(t in p.tokens));
  ok(`preset "${p.id}" defines every role token`, missing.length === 0, `missing: ${missing.join(", ")}`);

  const badName = Object.keys(p.tokens).filter((k) => !isSafeTokenName(k));
  ok(`preset "${p.id}" has no unknown tokens`, badName.length === 0, `unknown: ${badName.join(", ")}`);

  const badVal = Object.entries(p.tokens).filter(([, v]) => !isSafeTokenValue(v));
  ok(`preset "${p.id}" values are all colours`, badVal.length === 0, `bad: ${JSON.stringify(badVal)}`);
}

ok("preset ids are unique", new Set(THEME_PRESETS.map((p) => p.id)).size === THEME_PRESETS.length);
ok("the default preset exists", !!getPreset(DEFAULT_PRESET_ID));
ok("withheld presets are not offered", !availablePresets().some((p) => p.id === "graphite"));
ok("at least two themes are offered", availablePresets().length >= 2);

/* --- mint must be byte-identical to the stylesheet, or existing clinics get repainted --- */
import { readFileSync } from "fs";
const css = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");
const mint = getPreset("mint")!;
const drift: string[] = [];
for (const t of ROLE_TOKENS) {
  const m = css.match(new RegExp(`--${t}:\\s*(#[0-9A-Fa-f]{6})`));
  if (!m) { drift.push(`${t}: not found in globals.css`); continue; }
  if (m[1].toLowerCase() !== mint.tokens[t].toLowerCase()) {
    drift.push(`${t}: css ${m[1]} vs preset ${mint.tokens[t]}`);
  }
}
ok("mint matches globals.css exactly", drift.length === 0, drift.join("; "));

/* ---------------------------------------------------------- token guards */

ok("rejects an unknown token name", !isSafeTokenName("evil-token"));
ok("rejects a css injection value", !isSafeTokenValue("red; background:url(//x)"));
ok("rejects url()", !isSafeTokenValue("url(//attacker/x.png)"));
ok("rejects an over-long value", !isSafeTokenValue("#" + "a".repeat(60)));
ok("accepts a hex colour", isSafeTokenValue("#1A2130"));
ok("accepts rgba()", isSafeTokenValue("rgba(15, 23, 42, 0.5)"));
ok(
  "sanitize drops bad keys and values but keeps good ones",
  JSON.stringify(sanitizeTokens({ accent: "#123456", evil: "#000000", ink: "url(x)" })) ===
    JSON.stringify({ accent: "#123456" }),
);

/* ------------------------------------------------- the boot script actually runs */

// a DOM small enough to be honest about what the script touches
const setCalls: Record<string, string> = {};
function runBoot(store: Record<string, string>, session: Record<string, string>) {
  for (const k of Object.keys(setCalls)) delete setCalls[k];
  const sandbox = {
    localStorage: { getItem: (k: string) => (k in store ? store[k] : null) },
    sessionStorage: { getItem: (k: string) => (k in session ? session[k] : null) },
    document: { documentElement: { style: { setProperty: (k: string, v: string) => { setCalls[k] = v; } } } },
    JSON,
  };
  const fn = new Function(
    "localStorage", "sessionStorage", "document", "JSON",
    THEME_BOOT_SCRIPT,
  );
  fn(sandbox.localStorage, sandbox.sessionStorage, sandbox.document, sandbox.JSON);
  return { ...setCalls };
}

ok("boot script parses as javascript", (() => {
  try { new Function(THEME_BOOT_SCRIPT); return true; } catch { return false; }
})());

const dam = getPreset("damson")!;
const cache = JSON.stringify({
  v: 1,
  clinicId: "clinicA",
  byClinic: { clinicA: { presetId: "damson", tokens: dam.tokens } },
});

let out = runBoot({ "alpha.theme.v1": cache }, {});
ok("boot paints the cached clinic", out["--accent"] === dam.tokens["accent"], JSON.stringify(out["--accent"]));
ok("boot paints every role token", Object.keys(out).length === ROLE_TOKENS.length, `wrote ${Object.keys(out).length}`);

out = runBoot({}, {});
ok("boot paints nothing with no cache", Object.keys(out).length === 0);

out = runBoot({ "alpha.theme.v1": '{"v":1' }, {});
ok("boot survives corrupt json", Object.keys(out).length === 0);

out = runBoot({ "alpha.theme.v1": JSON.stringify({ v: 99, clinicId: "a", byClinic: {} }) }, {});
ok("boot ignores a future cache version", Object.keys(out).length === 0);

// the switch case: sessionStorage wins over the last-painted clinic
const sand = getPreset("sandstone")!;
const twoClinics = JSON.stringify({
  v: 1,
  clinicId: "clinicA",
  byClinic: { clinicA: { presetId: "damson", tokens: dam.tokens }, clinicB: { presetId: "sandstone", tokens: sand.tokens } },
});
out = runBoot({ "alpha.theme.v1": twoClinics }, { preferredClinicId: "clinicB" });
ok("boot honours the switched clinic", out["--accent"] === sand.tokens["accent"], String(out["--accent"]));

out = runBoot({ "alpha.theme.v1": twoClinics }, { preferredClinicId: "unknownClinic" });
ok("boot falls back when the preferred clinic is uncached", out["--accent"] === dam.tokens["accent"]);

// a poisoned cache must not become a css injection
const poisoned = JSON.stringify({
  v: 1, clinicId: "c",
  byClinic: { c: { presetId: "x", tokens: { accent: "url(//attacker/x)", ink: "#112233" } } },
});
out = runBoot({ "alpha.theme.v1": poisoned }, {});
ok("boot refuses a non-colour value", out["--accent"] === undefined && out["--ink"] === "#112233");

/* ------------------------------------------------------------- contrast

   Contrast is arithmetic, so it belongs in a test rather than in someone's judgement. The default
   theme shipped with eight failures for a long time -- including white button labels at 2.87 -- and
   nothing caught it, because nobody re-measures a colour once it is chosen.
*/

function srgbToLinear(c: number): number {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}
function luminance(hex: string): number {
  const h = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}
function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

function hueDistance(a: string, b: string): number {
  const hue = (hex: string) => {
    const h = hex.replace("#", "");
    const [r, g, bl] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
    const mx = Math.max(r, g, bl), mn = Math.min(r, g, bl), d = mx - mn;
    if (d === 0) return 0;
    const deg = mx === r ? ((g - bl) / d) % 6 : mx === g ? (bl - r) / d + 2 : (r - g) / d + 4;
    return (deg * 60 + 360) % 360;
  };
  const d = Math.abs(hue(a) - hue(b));
  return Math.min(d, 360 - d);
}

/** [label, foreground token, background token, minimum ratio] */
const PAIRS: [string, string, string, number][] = [
  ["body text",           "ink",           "surface",       4.5],
  ["body on backdrop",    "ink",           "surface-page",  4.5],
  ["secondary text",      "ink-body",      "surface",       4.5],
  ["muted text",          "ink-muted",     "surface",       4.5],
  ["faint text",          "ink-faint",     "surface",       3.0],
  ["faint on muted card", "ink-faint",     "surface-muted", 3.0],
  ["button label",        "ink-on-accent", "accent",        4.5],
  ["accent as icon",      "accent",        "surface",       3.0],
  ["ok text",             "ok",            "surface",       3.0],
  ["warn text",           "warn",          "surface",       3.0],
  ["danger text",         "danger",        "surface",       3.0],
  ["info text",           "info",          "surface",       3.0],
  ["ok on its tint",      "ok",            "ok-tint",       4.5],
  ["warn on its tint",    "warn",          "warn-tint",     4.5],
  ["danger on its tint",  "danger",        "danger-tint",   4.5],
  ["accent on its tint",  "accent",        "accent-tint",   4.5],
  ["hairline on card",    "line",          "surface",       1.2],
];

for (const preset of THEME_PRESETS) {
  for (const [label, fg, bg, need] of PAIRS) {
    const got = contrast(preset.tokens[fg], preset.tokens[bg]);
    ok(
      `${preset.id}: ${label} clears ${need}`,
      got >= need,
      `${preset.tokens[fg]} on ${preset.tokens[bg]} = ${got.toFixed(2)}`,
    );
  }
  /**
   * The brand and "this succeeded" must not read as one colour.
   *
   * Two ways to be distinguishable, and a colour needs only one: a different hue, or a different
   * weight. Checking contrast alone was wrong and this test failed damson for it -- a plum accent
   * and a green tick are 157 degrees apart and could not be confused by anyone, yet they sit at a
   * contrast ratio of 1.25 because they happen to share a lightness. Only the default theme, where
   * both really are green, has to earn its separation by weight.
   */
  const dHue = hueDistance(preset.tokens["accent"], preset.tokens["ok"]);
  const sep = contrast(preset.tokens["accent"], preset.tokens["ok"]);
  ok(
    `${preset.id}: accent is distinguishable from ok`,
    dHue >= 30 || sep >= 1.4,
    `hue apart ${dHue.toFixed(0)}deg, contrast ${sep.toFixed(2)}`,
  );
}

/* --------------------------------------------------------------- report */

console.log(`\n  ${pass} passed, ${fail.length} failed\n`);
if (fail.length) {
  for (const f of fail) console.error("  x " + f);
  process.exit(1);
}
console.log("  Theme layer cases pass.\n");
