/**
 * Turns a model-written string into HTML for the non-React render paths — the printed treatment
 * plan, and anything else built by string concatenation rather than by React.
 *
 * The chat bubbles solve the same problem with react-markdown (see components/ai/AssistantMarkdown).
 * That is not available here: these documents are assembled as HTML strings and then rendered in a
 * detached iframe for html2pdf, so there is no React tree to hang components off.
 *
 * ORDER IS THE WHOLE SAFETY ARGUMENT.
 *
 * Escaping happens FIRST, on the raw string, before a single tag is produced. After that step the
 * text provably contains no `<` or `>` of its own, so every tag in the output is one this file
 * created. A model that writes `<script>` gets `&lt;script&gt;` and is read as words by the patient.
 * The alternative order — convert then escape, or convert and trust — would make the printed plan an
 * HTML injection sink fed by text a patient typed into a note.
 *
 * Deliberately NOT supported, matching the on-screen renderer:
 *   • images  — dropped. In a document that is emailed and printed, a remote image is both a
 *               tracking pixel and a hole in the page when the reader is offline.
 *   • links   — the text is kept, the href is discarded. A printed anchor is not clickable anyway,
 *               and keeping one would let a note-borne URL ride onto clinic letterhead.
 */

/** Escapes every character that could begin markup. Runs before anything else. */
function esc(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Arabic (+ supplements and presentation forms) and Hebrew. */
const RTL = "\\u0590-\\u05FF\\u0600-\\u06FF\\u0750-\\u077F\\u08A0-\\u08FF\\uFB1D-\\uFDFF\\uFE70-\\uFEFF";
const RTL_ANY = new RegExp(`[${RTL}]`);
const RTL_RUN = new RegExp(`[${RTL}][${RTL}\\s\\u064B-\\u0652\\u0670]*`, "g");

/** Letters for flanking checks. Arabic counts, so `__` inside an Arabic word is not a delimiter. */
const WORD = `A-Za-z0-9_${RTL}`;
const STRONG_US = new RegExp(`(^|[^${WORD}])__([^_]+)__(?![${WORD}])`, "g");

const EM_OPEN = '<em style="font-style:italic;">';
const STRONG_OPEN = '<strong style="font-weight:900;">';
const CODE_OPEN = '<code style="font-family:monospace;font-size:0.92em;">';
const DEL_OPEN = '<span style="text-decoration:line-through;">';

/**
 * An emphasis body may contain tags an earlier pass emitted, but only whole ones.
 *
 * The passes run in sequence over a string that already contains markup, so a later delimiter can
 * otherwise match straight through a tag: in "*a`b* c`" the code pass fires first and the italic
 * pass then captures `a<code …>b`, closing </em> inside the still-open <code>. The browser repairs
 * that, but it repairs it into a second stray <code> run. Counting openers against closers rejects
 * the straddling bodies while still allowing genuine nesting such as "**Take `2` tabs**".
 */
function balanced(body: string): boolean {
  return (body.match(/<[a-z]/g) || []).length === (body.match(/<\//g) || []).length;
}

/**
 * Isolates right-to-left runs so the neutrals around them — brackets, commas, the currency — keep
 * the paragraph's direction instead of being dragged into the run.
 *
 * `<bdi>` carries `unicode-bidi: isolate` from the UA stylesheet, but html2canvas reads computed
 * styles rather than assuming UA defaults, so the property is also written inline. Safe to run last:
 * it only ever matches Arabic and Hebrew letters, and every tag this file emits is pure ASCII, so it
 * cannot reach inside one.
 */
function isolateRtl(html: string): string {
  if (!RTL_ANY.test(html)) return html;
  return html.replace(RTL_RUN, (run) => {
    // trimEnd, not /\s+$/ — the regex backtracks quadratically over a long internal whitespace
    // span inside one run (an 80KB description took ~5.8s; this is ~0.005ms).
    const trimmed = run.trimEnd();
    if (!trimmed) return run;
    return `<bdi style="unicode-bidi:isolate;">${trimmed}</bdi>${run.slice(trimmed.length)}`;
  });
}

/** Inline markdown, applied to already-escaped text. */
function inlineMd(escaped: string): string {
  return (
    escaped
      // Images first — otherwise the link rule eats the `[alt](src)` half and leaves a stray `!`.
      // `[` is excluded from the label classes: with `[^\]]*` an unterminated run of brackets made
      // every new `[` a fresh start position over the same tail, which is quadratic (a 400KB input
      // took ~61s). The `[^)]*` URL classes are deliberately left alone — narrowing those would
      // break a legitimate "[a](b(c))".
      .replace(/!\[[^\][]*\]\([^)]*\)/g, "")
      .replace(/\[([^\][]+)\]\([^)]*\)/g, "$1")
      .replace(/`([^`]+)`/g, `${CODE_OPEN}$1</code>`)
      // ***both*** before **bold**, or the bold rule claims the leading star and the italic rule
      // then crosses the tags it emitted.
      .replace(/\*\*\*([^\s*](?:[^*\n]*[^\s*])?)\*\*\*/g, (m, b) =>
        balanced(b) ? `${EM_OPEN}${STRONG_OPEN}${b}</strong></em>` : m)
      // Bold before italic, or `**x**` reads as an italic wrapping `*x*`.
      .replace(/\*\*([^*]+)\*\*/g, (m, b) => (balanced(b) ? `${STRONG_OPEN}${b}</strong>` : m))
      .replace(STRONG_US, (m, pre, b) => (balanced(b) ? `${pre}${STRONG_OPEN}${b}</strong>` : m))
      // The delimiter may not sit against a space on the inside, or "5 * 3 * 2" becomes
      // "5 <em>3 </em> 2"; and it may not sit against a word character on the outside, or a printed
      // dose like "2*3*4 mg" turns into emphasis. Together these are the cheap equivalent of
      // CommonMark's left/right-flanking rule, written without lookbehind.
      .replace(/(^|[^*\w])\*([^\s*](?:[^*\n]*[^\s*])?)\*(?!\w)/g, (m, pre, b) =>
        balanced(b) ? `${pre}${EM_OPEN}${b}</em>` : m)
      .replace(/~~([^~]+)~~/g, (m, b) => (balanced(b) ? `${DEL_OPEN}${b}</span>` : m))
  );
}

const BULLET = /^\s*[-*•]\s+/;
/**
 * Capped at three digits on purpose: a four-digit run is a year, not a list marker. The captured
 * number is used to decide whether these lines are a list at all — see the sequence test below.
 */
const NUMBERED = /^\s*(\d{1,3})[.)]\s+/;

/**
 * Block-level render: paragraphs, bullet lists and numbered lists.
 *
 * Headings collapse to bold paragraphs. A model-written `##` inside a treatment plan is not a
 * document section, it is the model reaching for emphasis, and a real `<h2>` would outrank the
 * clinic's own headings on the page.
 */
export function modelTextToHtml(
  raw: string,
  opts: { ar: boolean; paragraphStyle?: string; listStyle?: string } = { ar: false },
): string {
  const text = String(raw ?? "").trim();
  if (!text) return "";

  const pStyle = opts.paragraphStyle ?? "margin:0 0 8px 0;";
  const lStyle = opts.listStyle ?? `margin:0 0 8px 0;${opts.ar ? "padding-right:18px;" : "padding-left:18px;"}`;

  const blocks = esc(text).split(/\n\s*\n/);
  const out: string[] = [];

  for (const block of blocks) {
    const lines = block.split("\n").filter((l) => l.trim() !== "");
    if (!lines.length) continue;

    const allBullet = lines.every((l) => BULLET.test(l));

    /**
     * A dental plan is full of lines that open with a number and a dot — FDI tooth notation above
     * all ("16. Deep caries" / "26. Watch"). Treating those as an ordered list stripped the marker
     * and renumbered the block from 1, which deleted the tooth numbers from the sheet the patient
     * takes home. A real ordered list counts up by one; clinical data does not, so the sequence is
     * what separates them. When the list is genuine but starts elsewhere, `start` preserves it.
     */
    const nums = lines.map((l) => {
      const m = l.match(NUMBERED);
      return m ? Number(m[1]) : NaN;
    });
    const isOrderedList =
      nums.every((n) => !Number.isNaN(n)) && nums.every((n, i) => i === 0 || n === nums[i - 1] + 1);

    if (allBullet || isOrderedList) {
      const tag = allBullet ? "ul" : "ol";
      const startAttr = !allBullet && nums[0] !== 1 ? ` start="${nums[0]}"` : "";
      const items = lines
        .map((l) => l.replace(allBullet ? BULLET : NUMBERED, ""))
        .map((l) => `<li style="margin:0 0 3px 0;">${isolateRtl(inlineMd(l.trim()))}</li>`)
        .join("");
      out.push(`<${tag}${startAttr} style="${lStyle}">${items}</${tag}>`);
      continue;
    }

    const isHeading = lines.length === 1 && /^\s*#{1,6}\s+/.test(lines[0]);
    const body = lines
      .map((l) => isolateRtl(inlineMd(l.replace(/^\s*#{1,6}\s+/, "").trim())))
      .join("<br/>");
    out.push(`<p style="${pStyle}${isHeading ? "font-weight:900;" : ""}">${body}</p>`);
  }

  return out.join("");
}

/**
 * Inline-only render, for short strings that sit inside an existing element — a step note, a visit
 * label — where a `<p>` or a `<ul>` would break the row it lives in. Markdown still resolves;
 * newlines become `<br/>`; no block element is ever produced.
 */
export function modelTextToInlineHtml(raw: string): string {
  const text = String(raw ?? "").trim();
  if (!text) return "";
  return text
    .split("\n")
    .map((l) => isolateRtl(inlineMd(esc(l).replace(/^\s*(?:#{1,6}|[-*•])\s+/, "").trim())))
    .filter(Boolean)
    .join("<br/>");
}
