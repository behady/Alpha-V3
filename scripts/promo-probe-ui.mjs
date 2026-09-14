/**
 * Lists what is clickable on a page of the live app, so the reel's workflows can be scripted
 * against real controls instead of guessed selectors.
 *
 *   node scripts/promo-probe-ui.mjs /appointments
 *   node scripts/promo-probe-ui.mjs "/patients/REv947qYLGBe5SIQA2I9/diagnosis" --click "خطة العلاج"
 *
 * Opens the same signed-in profile the recorder uses, pinned to the demo clinic, and prints every
 * button, link, input and tab with its visible text and position. `--click` follows one control
 * first, so a dialog's contents can be listed too.
 *
 * Read-only by intent: it clicks what you name and nothing else, and it never submits a form.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const PW = "C:/Users/PC/AppData/Local/npm-cache/_npx/9833c18b2d85bc59/node_modules/playwright";
const { chromium } = require(PW);

const BASE = "https://alpha-v3-live.vercel.app";
const CLINIC = "Tbog4tv8bA4E0BqO6NWF";
const PROFILE_SRC = "C:/Users/PC/AppData/Local/ms-playwright-mcp/mcp-chrome-c0d885c";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
}

async function main() {
  // Git Bash rewrites a leading-slash argument into a Windows path before node ever sees it,
  // so accept the bare form too and put the slash back on.
  let target = process.argv[2];
  if (!target || target.startsWith("--")) throw new Error("Pass a path, e.g. appointments");
  target = target.replace(/^.*Git[\/]/, "/").replace(/^(?!\/)/, "/");

  const profile = arg("profile", path.join(process.env.TEMP || ".", "promo-probe-profile"));
  if (!fs.existsSync(profile)) fs.cpSync(PROFILE_SRC, profile, { recursive: true, force: true });

  const ctx = await chromium.launchPersistentContext(profile, {
    headless: false,
    channel: "chrome",
    viewport: { width: 1536, height: 864 },
    deviceScaleFactor: 1.25,
  });
  await ctx.addInitScript((id) => {
    try { sessionStorage.setItem("preferredClinicId", id); } catch { /* private mode */ }
  }, CLINIC);

  const page = ctx.pages()[0] || (await ctx.newPage());
  await page.goto(BASE + target, { waitUntil: "domcontentloaded" });
  await sleep(Number(arg("settle", 9000)));

  const clickText = arg("click");
  if (clickText) {
    const el = page.locator(`text=${clickText}`).first();
    await el.click({ timeout: 8000 }).catch((e) => console.log(`  ! click failed: ${e.message.split("\n")[0]}`));
    await sleep(Number(arg("after", 4000)));
  }

  const found = await page.evaluate(() => {
    const out = [];
    const sel = 'button, a[href], [role="button"], [role="tab"], input, select, textarea, [contenteditable="true"]';
    for (const el of document.querySelectorAll(sel)) {
      const r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) continue;
      const style = getComputedStyle(el);
      if (style.visibility === "hidden" || style.display === "none" || Number(style.opacity) === 0) continue;
      const label =
        (el.innerText || el.value || el.placeholder || el.getAttribute("aria-label") || "")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 60);
      out.push({
        tag: el.tagName.toLowerCase(),
        role: el.getAttribute("role") || "",
        label,
        href: el.getAttribute("href") || "",
        x: Math.round(r.x),
        y: Math.round(r.y),
        w: Math.round(r.width),
        h: Math.round(r.height),
      });
    }
    return out;
  });

  console.log(`\n${target}${clickText ? `  (after clicking "${clickText}")` : ""}\n${"-".repeat(72)}`);
  for (const f of found) {
    if (!f.label && !f.href) continue;
    console.log(
      `${f.tag.padEnd(8)} ${String(f.role).padEnd(7)} ${String(f.x).padStart(4)},${String(f.y).padStart(4)} ` +
      `${String(f.w).padStart(4)}x${String(f.h).padStart(3)}  ${f.label}${f.href ? `   -> ${f.href}` : ""}`
    );
  }
  console.log(`${"-".repeat(72)}\n${found.length} interactive elements`);

  if (arg("shot")) await page.screenshot({ path: arg("shot") });
  await ctx.close();
}

main().catch((e) => { console.error(String(e.stack || e)); process.exit(1); });
