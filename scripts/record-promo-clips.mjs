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

const require = createRequire(import.meta.url);
const PW = "C:/Users/PC/AppData/Local/npm-cache/_npx/9833c18b2d85bc59/node_modules/playwright";
const { chromium } = require(PW);

const BASE = "https://alpha-v3-live.vercel.app";
const CLINIC = "Tbog4tv8bA4E0BqO6NWF";
/**
 * The patient the record beats open. Deliberately the fullest file the seed produces (29 ledger
 * rows, 15 notes) and the same person as the booking conversation, so the chart, the plan and the
 * WhatsApp thread on screen all belong to one patient rather than three strangers.
 */
const STAR = "REv947qYLGBe5SIQA2I9";

const SRC_PROFILE = "C:/Users/PC/AppData/Local/ms-playwright-mcp/mcp-chrome-c0d885c";

/** One entry per row of the script's table. `settle` is extra wait for slow-loading pages. */
const BEATS = [
  { n: 0,  url: `/`,                    label: "dashboard-open",  motion: "none" },
  { n: 1,  url: `/`,                    label: "dashboard",       motion: "none" },
  { n: 2,  url: `/appointments`,        label: "appointments",    motion: "scroll", settle: 3000 },
  { n: 3,  url: `/book/${CLINIC}`,      label: "online-booking",  motion: "scroll", settle: 3000 },
  { n: 4,  url: `/patients/${STAR}?tab=clinical`, label: "dental-chart", motion: "none", settle: 5000 },
  { n: 5,  url: `/patients/${STAR}?tab=plan`,     label: "treatment-plan", motion: "none", settle: 5000 },
  { n: 6,  url: `/chats?chat=201000000115`, label: "wa-reminder", motion: "none",   settle: 5000 },
  { n: 7,  url: `/chats?chat=201000000117`, label: "wa-bot",      motion: "none",   settle: 5000 },
  { n: 8,  url: `/chats`,               label: "chats-inbox",     motion: "scroll", settle: 4000 },
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

  fs.mkdirSync(outDir, { recursive: true });
  const profile = path.join(outDir, "profile");
  if (!fs.existsSync(profile)) {
    console.log("Copying signed-in profile…");
    fs.cpSync(SRC_PROFILE, profile, { recursive: true, force: true });
  }

  const videoDir = path.join(outDir, "raw");
  fs.mkdirSync(videoDir, { recursive: true });

  const ctx = await chromium.launchPersistentContext(profile, {
    headless: false,
    viewport: { width: 1920, height: 1080 },
    screen: { width: 1920, height: 1080 },
    channel: "chrome",
    args: ["--window-size=1920,1140", "--hide-scrollbars", "--force-device-scale-factor=1"],
    recordVideo: { dir: videoDir, size: { width: 1920, height: 1080 } },
  });

  await ctx.addInitScript((id) => {
    try { sessionStorage.setItem("preferredClinicId", id); } catch { /* private mode */ }
  }, CLINIC);

  const page = ctx.pages()[0] || (await ctx.newPage());
  const t0 = Date.now();
  const cuts = [];
  const beats = BEATS.filter((b) => !only || only.has(b.n));

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
  if (shown !== CLINIC) throw new Error(`Clinic not pinned (sessionStorage=${shown}). Refusing to record.`);

  await dismissFirstRun(page);

  for (const beat of beats) {
    const url = withClinic(beat.url);
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    } catch {
      console.log(`  ! ${beat.label}: navigation slow, continuing`);
    }
    await sleep(beat.settle ?? 2500);
    await page.evaluate(() => (document.scrollingElement || document.documentElement).scrollTo(0, 0));
    await sleep(400);

    const start = Date.now() - t0;
    if (beat.motion === "scroll") await slowScroll(page, hold);
    else await sleep(hold);
    const end = Date.now() - t0;

    cuts.push({ n: beat.n, label: beat.label, url, startMs: start, endMs: end });
    console.log(`  ${String(beat.n).padStart(2)} ${beat.label.padEnd(18)} ${(start / 1000).toFixed(1)}s → ${(end / 1000).toFixed(1)}s`);
  }

  const videoPath = await page.video().path();
  await ctx.close(); // the video file is only finalised on close
  fs.writeFileSync(path.join(outDir, "cuts.json"), JSON.stringify({ video: videoPath, cuts }, null, 2));
  console.log(`\nVideo: ${videoPath}`);
}

main().catch((e) => { console.error(String(e.stack || e)); process.exit(1); });
