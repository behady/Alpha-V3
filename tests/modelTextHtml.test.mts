/**
 * Cases for the model-text → HTML renderer used by the printed treatment plan.
 *
 * Most of these come from an adversarial review of the first version: every one of them is a bug
 * that shipped in that draft, so they are here to stop it coming back rather than to describe
 * something that was designed.
 *
 * Run: npx tsx tests/modelTextHtml.test.mts
 */
import { modelTextToHtml, modelTextToInlineHtml } from "../src/lib/modelTextHtml";

let pass = 0;
const failures: string[] = [];

function check(name: string, actual: string, predicate: (s: string) => boolean, expectation: string) {
  if (predicate(actual)) {
    pass++;
  } else {
    failures.push(`${name}\n    expected: ${expectation}\n    actual:   ${actual}`);
  }
}

const has = (needle: string) => (s: string) => s.includes(needle);
const lacks = (needle: string) => (s: string) => !s.includes(needle);

/* ---------------------------------------------------------------- safety */

const INJECT = `<script>alert('xss')</script> <img src=x onerror="alert(1)"> <a href="x">y</a>`;
check("no live script tag", modelTextToHtml(INJECT), lacks("<script"), "script escaped");
check("no live img tag", modelTextToHtml(INJECT), lacks("<img"), "img escaped");
check("no live anchor", modelTextToHtml(INJECT), lacks("<a "), "anchor escaped");
check("script shown as text", modelTextToHtml(INJECT), has("&lt;script&gt;"), "&lt;script&gt;");
check("quotes escaped", modelTextToHtml(`say "hi" it's`), (s) => s.includes("&quot;") && s.includes("&#39;"), "entities");

check("markdown image dropped", modelTextToHtml("a ![x](https://e/p?owed=7) b"), lacks("https://e/p"), "url gone");
check("link href dropped, text kept", modelTextToHtml("see [our site](https://e/x) now"),
  (s) => s.includes("our site") && !s.includes("https://e/x"), "text without href");

/* ------------------------------------------------- the tooth-number bug */

const TEETH = modelTextToHtml("16. Deep caries, needs RCT\n26. Watch");
check("FDI tooth numbers survive", TEETH, (s) => s.includes("16.") && s.includes("26."), "16. and 26. present");
check("tooth lines are not an ol", TEETH, lacks("<ol"), "paragraph, not a list");

const REALLIST = modelTextToHtml("1. First\n2. Second\n3. Third");
check("a real 1,2,3 list is a list", REALLIST, has("<ol"), "<ol>");
check("list starting at 1 needs no start attr", REALLIST, lacks("start="), "no start=");

const OFFSET = modelTextToHtml("3. Third\n4. Fourth");
check("consecutive list starting at 3 keeps its start", OFFSET, has('start="3"'), 'start="3"');

check("a four-digit year is never a marker", modelTextToHtml("2026. The plan begins later."),
  (s) => s.includes("2026.") && !s.includes("<ol"), "year preserved as text");
check("a price line is never a marker", modelTextToHtml("1500. EGP due at the second visit"),
  has("1500."), "1500. preserved");

/* -------------------------------------------------------- mis-nesting */

const STRADDLE = modelTextToHtml("*a`b* c`");
check("interleaved delimiters do not cross tags", STRADDLE,
  (s) => { const o = (s.match(/<(em|strong|code|span)[ >]/g) || []).length;
           const c = (s.match(/<\/(em|strong|code|span)>/g) || []).length; return o === c; },
  "balanced tags");
check("bold around code still works", modelTextToHtml("**Take `2` tabs**"),
  (s) => s.includes("<strong") && s.includes("<code"), "both tags");

/* ----------------------------------------------------- emphasis rules */

check("spaced asterisks stay maths", modelTextToHtml("5 * 3 * 2 = 30"), has("5 * 3 * 2"), "verbatim");
check("intraword asterisks stay maths", modelTextToHtml("Dose: 2*3*4 mg"), has("2*3*4"), "verbatim");
check("genuine italic still italicises", modelTextToHtml("Take *one* tablet"), has("<em"), "<em>");
check("genuine bold still bolds", modelTextToHtml("The **root canal** first"), has("<strong"), "<strong>");
check("bold+italic triple", modelTextToHtml("***very important***"),
  (s) => s.includes("<em") && s.includes("<strong"), "both");
check("underscores in filenames are not bold", modelTextToHtml("x_ray__2026__final.png"),
  lacks("<strong"), "no <strong>");
check("real __bold__ still bolds", modelTextToHtml("see __the plan__ now"), has("<strong"), "<strong>");

/* ---------------------------------------------------------- bidi */

const AR = modelTextToHtml("1,950 EGP (*حشو نصف العصب اطفال*), paid in full.");
check("arabic run is isolated", AR, has("<bdi"), "<bdi>");
check("arabic run keeps its text", AR, has("حشو نصف العصب اطفال"), "arabic intact");
check("pure english gets no bdi", modelTextToHtml("All settled."), lacks("<bdi"), "no <bdi>");

/* ------------------------------------------------------- inline variant */

check("inline emits no block element", modelTextToInlineHtml("- **a**\n- b"),
  (s) => !s.includes("<p") && !s.includes("<ul") && !s.includes("<li"), "inline only");
check("inline still resolves markdown", modelTextToInlineHtml("Use **rubber dam**"), has("<strong"), "<strong>");
check("empty input is empty", modelTextToInlineHtml("  "), (s) => s === "", "empty string");

/* ------------------------------------------------------------- ReDoS */

function timed(fn: () => void): number {
  const t = Date.now();
  fn();
  return Date.now() - t;
}
const BUDGET_MS = 1000;
check("long unterminated brackets are fast",
  String(timed(() => modelTextToHtml("[".repeat(20000) + "](" + "x".repeat(20000)))),
  (ms) => Number(ms) < BUDGET_MS, `< ${BUDGET_MS}ms`);
check("long arabic run with whitespace is fast",
  String(timed(() => modelTextToHtml("م" + " ".repeat(40000) + "م"))),
  (ms) => Number(ms) < BUDGET_MS, `< ${BUDGET_MS}ms`);
check("long image syntax is fast",
  String(timed(() => modelTextToHtml("![" + "a[".repeat(20000) + "](" + "x".repeat(20000)))),
  (ms) => Number(ms) < BUDGET_MS, `< ${BUDGET_MS}ms`);

/* ------------------------------------------------------------- report */

console.log(`\n  ${pass} passed, ${failures.length} failed\n`);
if (failures.length) {
  for (const f of failures) console.error("  ✗ " + f + "\n");
  process.exit(1);
}
console.log("  All model-text rendering cases pass.\n");
