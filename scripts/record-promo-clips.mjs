/**
 * Records the promo reel's screen footage from the live app, signed in.
 *
 *   node scripts/record-promo-clips.mjs --out <dir> [--hold 10] [--only 3,4,5]
 *
 * Records ONE continuous video and writes cuts.json marking where each beat's hold window
 * starts and ends, rather than a video per beat: relaunching the browser nineteen times is
 * slow, and a per-beat recording necessarily contains that beat's own navigation flash.
 * Trimming a single take to the logged windows gives clean segments.
 *
 * The browser reuses a COPY of the Playwright-MCP Chrome profile, which is already signed in —
 * the copy matters, because Chrome locks a profile directory and the MCP may be holding it.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { chapter as loadChapter } from "./promo-chapters.mjs";

const require = createRequire(import.meta.url);
const PW = "C:/Users/PC/AppData/Local/npm-cache/_npx/9833c18b2d85bc59/node_modules/playwright";
const { chromium } = require(PW);

const BASE = "https://alpha-v3-live.vercel.app";
/**
 * The clinic the browser is pinned to. The demo clinic by default; `--clinic <id>` swaps it,
 * which the walkthrough needs — its first parts run on a clinic created on camera, whose id is
 * only known after that take.
 */
const clinicArg = process.argv.includes("--clinic") ? process.argv[process.argv.indexOf("--clinic") + 1] : null;
const CLINIC = clinicArg || "Tbog4tv8bA4E0BqO6NWF";
/**
 * The patient the record beats open. Deliberately the fullest file the seed produces (29 ledger
 * rows, 15 notes) and the same person as the booking conversation, so the chart, the plan and the
 * WhatsApp thread on screen all belong to one patient rather than three strangers.
 */
const STAR = "REv947qYLGBe5SIQA2I9";

/**
 * The signed-in profile to copy when the output folder has none yet. `--profile-from <dir>`
 * points at a previous take's profile instead of the raw MCP one, which carries the language
 * choice and the dismissed tour with it — the raw profile shows both overlays on the first shot.
 */
const SRC_PROFILE = process.argv.includes("--profile-from")
  ? process.argv[process.argv.indexOf("--profile-from") + 1]
  : "C:/Users/PC/AppData/Local/ms-playwright-mcp/mcp-chrome-c0d885c";

/** The user's own display scaling. CSS_WIDTH * ZOOM is the recorded pixel size. */
const ZOOM = 1.25;
const CSS_WIDTH = 1536;
const CSS_HEIGHT = 864;

/** One entry per row of the script's table. `settle` is extra wait for slow-loading pages. */
const BEATS = [
  { n: 0,  url: `/`,                    label: "dashboard-open",  motion: "none" },
  { n: 1,  url: `/`,                    label: "dashboard",       motion: "none" },
  { n: 2,  url: `/appointments`,        label: "appointments",    motion: "scroll", settle: 3000 },
  { n: 3,  url: `/book/${CLINIC}`,      label: "online-booking",  motion: "scroll", settle: 3000 },
  // The chart lives on its own route (TeethChart); ?tab=clinical is the written record, which
  // is a different promise from "his teeth, drawn in front of you".
  { n: 4,  url: `/patients/${STAR}/diagnosis`, label: "dental-chart", motion: "none", settle: 6000 },
  { n: 5,  url: `/patients/${STAR}?tab=plan`,     label: "treatment-plan", motion: "none", settle: 5000 },
  { n: 6,  url: `/chats?chat=201000000115`, label: "wa-reminder", motion: "none",   settle: 5000 },
  { n: 7,  url: `/chats?chat=201000000117`, label: "wa-bot",      motion: "none",   settle: 5000 },
  // Opened on the handed-off thread, not the bare list: with nothing selected, two thirds of
  // the frame is the "pick a conversation" empty state.
  { n: 8,  url: `/chats?chat=201000000108`, label: "chats-inbox", motion: "none", settle: 5000 },
  { n: 9,  url: `/finance`,             label: "finance",         motion: "scroll", settle: 3000 },
  { n: 10, url: `/reports`,             label: "reports",         motion: "scroll", settle: 4000 },
  { n: 11, url: `/lab`,                 label: "lab",             motion: "scroll" },
  { n: 12, url: `/ortho`,               label: "ortho",           motion: "scroll" },
  { n: 13, url: `/inventory`,           label: "inventory",       motion: "scroll" },
  { n: 14, url: `/attendance`,          label: "attendance",      motion: "scroll", settle: 3000 },
  { n: 15, url: `/ai`,                  label: "ai",              motion: "scroll" },
  { n: 16, url: `/leads`,               label: "leads",           motion: "scroll" },
  { n: 17, url: `/marketing`,           label: "marketing",       motion: "scroll" },
  { n: 18, url: `/`,                    label: "closing",         motion: "none" },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * There is no ?clinic= query param — ClinicContext picks the clinic from
 * sessionStorage.preferredClinicId, falling back to the account's defaultClinicId. The first
 * test recording relied on the query string, silently got the fallback, and put the REAL
 * clinic's patients on camera. An init script re-asserts the choice on every document load.
 */
function withClinic(rel) {
  return rel.startsWith("/") ? BASE + rel : rel;
}

/**
 * Performs one beat's scripted screen work, on camera.
 *
 * Every step is deliberately slow: a click that lands instantly reads as a glitch rather than as
 * someone using the software. A step that cannot find its target is reported and skipped rather
 * than thrown — losing one gesture is recoverable, losing the whole take is not — and the summary
 * counts them so a silently broken flow cannot pass unnoticed.
 */
async function runActions(page, actions, report) {
  for (const a of actions) {
    try {
      if (a.do === "wait") { await sleep(a.ms); continue; }
      if (a.do === "scroll") { await slowScroll(page, a.ms); continue; }

      /**
       * Scrolls whatever is under the pointer, which is the only thing that works here: the
       * diary, the chat thread and the settings panes all scroll inside their own containers,
       * so scrolling document.scrollingElement moves nothing and records a still frame.
       */
      if (a.do === "wheel") {
        await page.mouse.move(a.x ?? CSS_WIDTH / 2, a.y ?? CSS_HEIGHT / 2);
        /**
         * Few, large increments — not many small ones. Each mouse.wheel is a round trip to the
         * browser, and on a heavy settings page they cost far more than the sleep between them:
         * a beat asking for 8 seconds of scrolling took 96, because 66 wheel events each took
         * over a second. Capped at 25 steps, the beat lasts about as long as it says it will.
         */
        const want = a.ms || 3000;
        const steps = Math.max(1, Math.min(25, Math.round(want / 200)));
        const gap = Math.max(60, Math.round(want / steps));
        const perStep = Math.round((a.dy ?? 90) * ((want / 120) / steps));
        for (let i = 0; i < steps; i++) {
          await page.mouse.wheel(0, perStep);
          await sleep(gap);
        }
        continue;
      }
      /**
       * Brings a named thing into view. Preferred over a blind wheel for a payoff shot: a fixed
       * scroll distance lands wherever the page happens to be that day, and the booking this
       * chapter just made ended up off screen below the fold.
       */
      if (a.do === "scrollTo") {
        const loc = page.getByText(a.text, { exact: !!a.exact });
        const target = a.which === "last" ? loc.last() : loc.first();
        await target.scrollIntoViewIfNeeded({ timeout: 8000 });
        await sleep(a.ms || 1500);
        continue;
      }
      /**
       * Clicks an empty slot in the desk schedule.
       *
       * The rows are plain divs with a click handler, not buttons, so nothing in the element
       * listing can see them — they are found by the dashed border they all share plus the time
       * label they carry. Clicking the row rather than the label matters: the label is a small
       * floating chip and the handler is on the row.
       */
      if (a.do === "clickSlot") {
        const row = page.locator("div.border-dashed").filter({ hasText: a.time }).first();
        await row.scrollIntoViewIfNeeded({ timeout: 8000 });
        await sleep(800);
        await row.click({ position: { x: 700, y: 60 }, timeout: 8000 });
        await sleep(1200);
        continue;
      }
      /**
       * Clicks the first visible, enabled control whose text matches a pattern. For the things a
       * page names differently every day — a time slot, a search result — where an exact label
       * is not knowable in advance.
       */
      if (a.do === "clickMatch") {
        const root = a.within ? page.locator(a.within).first() : page;
        const re = new RegExp(a.pattern);
        const cands = root.locator("button, [role=button], a, li, option, div[class*=cursor-pointer]");
        const count = await cands.count();
        let hit = null;
        for (let i = 0; i < count && !hit; i++) {
          const c = cands.nth(i);
          const t = ((await c.innerText().catch(() => "")) || "").trim();
          if (!t || !re.test(t)) continue;
          if (!(await c.isVisible().catch(() => false))) continue;
          if (await c.isDisabled().catch(() => false)) continue;
          hit = c;
        }
        if (!hit) throw new Error(`nothing visible matches /${a.pattern}/`);
        await hit.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
        await sleep(400);
        await hit.click({ timeout: 6000 });
        await sleep(900);
        continue;
      }
      if (a.do === "press") { await page.keyboard.press(a.key); await sleep(600); continue; }

      if (a.do === "click" || a.do === "clickFirst") {
        // `exact` matters more than it looks: "يوم" (Day) is a substring of "اليوم" (Today), so a
        // loose match can click the wrong control and silently record the wrong view.
        /**
         * `within` scopes the search to one container, and it is not optional for anything
         * whose text also appears on the page behind a dialog. Clicking the patient's name in
         * the booking modal's results matched his EXISTING appointment card in the schedule
         * first — which closed the modal, opened an edit panel, and left the rest of the flow
         * clicking at controls that were no longer there.
         */
        const root = a.within ? page.locator(a.within).first() : page;
        const loc = a.sel
          ? root.locator(a.sel)
          : a.role
            ? root.getByRole(a.role, { name: a.text, exact: !!a.exact })
            : root.getByText(a.text, { exact: !!a.exact });
        // An optional step waits briefly: it is checking whether something appeared, and a full
        // timeout on a prompt that never showed adds a quarter-minute of silence to the beat.
        const t = a.timeout ?? (a.optional ? 2000 : 8000);
        await loc.first().scrollIntoViewIfNeeded({ timeout: a.optional ? 1200 : 4000 }).catch(() => {});
        await sleep(a.optional ? 200 : 500);
        await loc.first().click({ timeout: t });
        await sleep(900);
        continue;
      }

      if (a.do === "fill") {
        const loc = a.sel
          ? page.locator(a.sel)
          : page.getByPlaceholder(a.placeholder, { exact: false });
        await loc.first().click({ timeout: 8000 });
        await sleep(400);
        // Typed a character at a time: a value that appears all at once looks like a paste, and
        // the search-as-you-type results are half the point of the shot.
        await loc.first().pressSequentially(a.text, { delay: a.perChar || 120 });
        continue;
      }

      /**
       * Picks a dropdown by what it CONTAINS, not by its position.
       *
       * Position was the first attempt and it broke: the page's own branch filter sits in the
       * DOM among the dialog's selects, so "the first select" was the toolbar, not the time.
       * `has` identifies the right control by an option only it could have.
       */
      if (a.do === "selectWhere") {
        let target = null;
        let options = [];
        // Retried: choosing one value re-renders the dialog, and for a moment the next dropdown
        // is detached. A single pass caught that gap and reported the control as missing.
        for (let attempt = 0; attempt < 4 && !target; attempt++) {
          if (attempt) await sleep(1200);
          const selects = page.locator("select");
          const count = await selects.count();
          for (let i = 0; i < count; i++) {
            const candidate = selects.nth(i);
            const texts = await candidate.locator("option").allTextContents().catch(() => []);
            if (!texts.some((t) => t.includes(a.has))) continue;
            await candidate.scrollIntoViewIfNeeded({ timeout: 2500 }).catch(() => {});
            if (!(await candidate.isVisible().catch(() => false))) continue;
            target = candidate;
            options = texts;
            break;
          }
        }
        if (!target) throw new Error(`no visible select containing "${a.has}"`);
        // pickIndex chooses by position when the option text is not knowable — "the first real
        // choice after the placeholder" on a select seeded with the clinic's own list.
        const idx = Number.isInteger(a.pickIndex) ? a.pickIndex : options.findIndex((t) => t.includes(a.pick));
        if (idx === -1) throw new Error(`"${a.pick}" not among ${options.length} options of "${a.has}"`);
        await target.selectOption({ index: idx });
        await sleep(700);
        continue;
      }

      throw new Error(`unknown action "${a.do}"`);
    } catch (e) {
      // `optional` steps handle something that may or may not appear — a conflict prompt, a
      // consent banner. Reporting those as misses would bury the ones that actually matter.
      if (a.optional) continue;
      report.push(`${a.do} ${a.text || a.placeholder || a.sel || a.index}: ${String(e.message).split(/\r?\n/)[0]}`);
    }
  }
}

/** A slow, even scroll reads as deliberate on camera; a mouse-wheel jump does not. */
async function slowScroll(page, ms) {
  const steps = Math.max(1, Math.round(ms / 100));
  await page.evaluate(async (steps) => {
    const el = document.scrollingElement || document.documentElement;
    const max = Math.max(0, el.scrollHeight - el.clientHeight);
    const target = Math.min(max, 700);
    for (let i = 1; i <= steps; i++) {
      el.scrollTo(0, (target * i) / steps);
      await new Promise((r) => setTimeout(r, 100));
    }
  }, steps);
}

/**
 * Clears the overlays a clinic shows the first time an account opens it — the language picker,
 * and whatever welcome/tour card follows. These only appear once per account per clinic, so they
 * are invisible when testing against a clinic already opened and then sit over the first shot.
 * Arabic is chosen deliberately: the narration is Egyptian Arabic, so the UI must match.
 */
async function dismissFirstRun(page) {
  const arabic = page.locator('button:has-text("العربية")').first();
  if (await arabic.isVisible({ timeout: 8000 }).catch(() => false)) {
    await arabic.click().catch(() => {});
    await sleep(6000);
  }
  // The welcome tour parks a step card in the corner and follows you from page to page, so
  // closing it once is not enough — this turns it off for the account outright.
  const stopTour = page.locator('text=بطل الشرح خالص').first();
  if (await stopTour.isVisible({ timeout: 5000 }).catch(() => false)) {
    await stopTour.click().catch(() => {});
    await sleep(2500);
    // Some builds ask for confirmation before switching it off.
    const confirm = page.locator('button:has-text("تأكيد"), button:has-text("بطل"), button:has-text("نعم")').first();
    if (await confirm.isVisible({ timeout: 2500 }).catch(() => false)) {
      await confirm.click().catch(() => {});
      await sleep(2000);
    }
  }

  // Anything still floating over the page: close buttons, then Escape as a backstop.
  for (let i = 0; i < 3; i++) {
    const closer = page.locator('[aria-label="Close"], [aria-label="إغلاق"], button:has-text("Skip"), button:has-text("تخطي")').first();
    if (!(await closer.isVisible({ timeout: 1500 }).catch(() => false))) break;
    await closer.click().catch(() => {});
    await sleep(1200);
  }
  await page.keyboard.press("Escape").catch(() => {});
  await sleep(1500);
}

async function main() {
  const args = process.argv.slice(2);
  const outDir = args[args.indexOf("--out") + 1];
  if (!outDir || outDir.startsWith("--")) throw new Error("Pass --out <dir>.");
  const hold = Number(args.includes("--hold") ? args[args.indexOf("--hold") + 1] : 10) * 1000;
  const only = args.includes("--only")
    ? new Set(args[args.indexOf("--only") + 1].split(",").map(Number))
    : null;
  // A named chapter swaps the beat list for a scripted workflow; without it the 19-beat reel runs.
  const chapterName = args.includes("--chapter") ? args[args.indexOf("--chapter") + 1] : null;

  fs.mkdirSync(outDir, { recursive: true });
  const profile = path.join(outDir, "profile");
  if (!fs.existsSync(profile)) {
    console.log("Copying signed-in profile…");
    fs.cpSync(SRC_PROFILE, profile, { recursive: true, force: true });
  }

  const videoDir = path.join(outDir, "raw");
  fs.mkdirSync(videoDir, { recursive: true });

  /**
   * The recording must match what the user actually sees, and their Windows display runs at 125%
   * (1920x1080 native, 1536x864 logical). Recording a 1920-wide CSS viewport at scale 1 fits 25%
   * more page into the frame, so every control came out noticeably smaller than in their own
   * browser. A 1536x864 viewport at deviceScaleFactor 1.25 is 1920x1080 of real pixels with the
   * layout they see.
   */
  const ctx = await chromium.launchPersistentContext(profile, {
    headless: false,
    viewport: { width: CSS_WIDTH, height: CSS_HEIGHT },
    screen: { width: CSS_WIDTH, height: CSS_HEIGHT },
    deviceScaleFactor: ZOOM,
    channel: "chrome",
    args: [`--window-size=${CSS_WIDTH},${CSS_HEIGHT + 120}`, "--hide-scrollbars"],
    recordVideo: { dir: videoDir, size: { width: CSS_WIDTH * ZOOM, height: CSS_HEIGHT * ZOOM } },
  });

  /**
   * `--no-pin` leaves the clinic choice to the app. The take that CREATES a clinic must not be
   * dragged back to the demo clinic on its next navigation — the onboarding page sets
   * preferredClinicId to the new clinic itself, and re-pinning would undo that.
   */
  const NO_PIN = process.argv.includes("--no-pin");
  /**
   * `--pin-once` pins the FIRST load only and then defers to the app. The take that creates a
   * clinic needs both: without a pin its first screen is the account's default clinic — the real
   * one, with real patients — and with a pin on every load the onboarding page's own switch to
   * the new clinic is overwritten on the next navigation, so the setup wizard ran on the demo
   * clinic while the narration talked about the new one.
   */
  const PIN_ONCE = process.argv.includes("--pin-once");
  if (!NO_PIN) await ctx.addInitScript(({ id, once }) => {
    try {
      if (once && sessionStorage.getItem("preferredClinicId")) return;
      sessionStorage.setItem("preferredClinicId", id);
    } catch { /* private mode */ }
  }, { id: CLINIC, once: PIN_ONCE });

  const page = ctx.pages()[0] || (await ctx.newPage());
  const t0 = Date.now();
  const cuts = [];
  const loaded = chapterName ? await loadChapter(chapterName) : null;
  const source = loaded ? loaded.beats : BEATS;
  if (loaded) console.log(`Chapter: ${loaded.title}`);
  const beats = source.filter((b) => !only || only.has(b.n));

  // Land on the clinic-scoped root once: the app is superadmin here and a bare load
  // resolves to /superadmin instead of a clinic.
  // First load seeds sessionStorage via the init script; the reload is what makes
  // ClinicContext resolve against it rather than the account default.
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  await sleep(6000);
  await page.reload({ waitUntil: "domcontentloaded" });
  await sleep(8000);
  const shown = await page.evaluate(() => {
    try { return sessionStorage.getItem("preferredClinicId"); } catch { return null; }
  });
  if (!NO_PIN && shown !== CLINIC) throw new Error(`Clinic not pinned (sessionStorage=${shown}). Refusing to record.`);

  await dismissFirstRun(page);

  const misses = [];
  for (const beat of beats) {
    // A chapter beat without a url continues on the page the previous beat left behind — that
    // continuity IS the demo, so re-navigating between steps of one flow would undo it.
    const url = beat.url ? withClinic(beat.url.replace("__CLINIC__", CLINIC)) : null;
    if (url) {
      try {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
      } catch {
        console.log(`  ! ${beat.label}: navigation slow, continuing`);
      }
      await sleep(beat.settle ?? 2500);
      await page.evaluate(() => (document.scrollingElement || document.documentElement).scrollTo(0, 0));
    } else {
      await sleep(beat.settle ?? 800);
    }
    await sleep(400);

    const start = Date.now() - t0;
    const report = [];
    if (beat.actions) await runActions(page, beat.actions, report);
    else if (beat.motion === "scroll") await slowScroll(page, hold);
    else await sleep(hold);
    const end = Date.now() - t0;

    for (const r of report) misses.push(`beat ${beat.n} (${beat.label}): ${r}`);
    cuts.push({ n: beat.n, label: beat.label, url, startMs: start, endMs: end, actions: !!beat.actions });
    console.log(
      `  ${String(beat.n).padStart(2)} ${beat.label.padEnd(18)} ${(start / 1000).toFixed(1)}s → ${(end / 1000).toFixed(1)}s` +
      `  (${((end - start) / 1000).toFixed(1)}s)${report.length ? `  ${report.length} MISSED` : ""}`
    );
  }

  if (misses.length) {
    console.log(`\n${misses.length} action(s) did not land — the beat was recorded anyway:`);
    for (const m of misses) console.log(`  ! ${m}`);
  }

  const videoPath = await page.video().path();
  await ctx.close(); // the video file is only finalised on close
  fs.writeFileSync(path.join(outDir, "cuts.json"), JSON.stringify({ video: videoPath, cuts }, null, 2));
  console.log(`\nVideo: ${videoPath}`);
}

main().catch((e) => { console.error(String(e.stack || e)); process.exit(1); });
