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

  const slotTime = arg("slot");
  if (slotTime) {
    const row = page.locator("div.border-dashed").filter({ hasText: slotTime }).first();
    await row.scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => {});
    await row.click({ position: { x: 700, y: 60 }, timeout: 8000 })
      .catch((e) => console.log(`  ! slot click failed: ${e.message.split(/\r?\n/)[0]}`));
    await sleep(Number(arg("after", 4000)));
  }

  // Type into a placeholder, then dump what appeared — search results are usually not buttons,
  // so the element listing alone cannot show them.
  const typeText = arg("type");
  if (typeText) {
    const ph = arg("into", "دور بالاسم");
    const box = page.getByPlaceholder(ph, { exact: false }).first();
    await box.click({ timeout: 8000 }).catch((e) => console.log("  ! type click: " + e.message));
    await box.pressSequentially(typeText, { delay: 120 }).catch(() => {});
    await sleep(Number(arg("after", 4000)));
    const hits = await page.evaluate((needle) => {
      const out = [];
      for (const el of document.querySelectorAll("*")) {
        if (el.children.length) continue;
        const t = (el.textContent || "").trim();
        if (!t.includes(needle)) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 5) continue;
        const path = [];
        for (let n = el; n && path.length < 5; n = n.parentElement) {
          path.push(`${n.tagName.toLowerCase()}${n.className && typeof n.className === "string" ? "." + n.className.trim().split(/\s+/).slice(0, 3).join(".") : ""}`);
        }
        out.push({ t: t.slice(0, 40), x: Math.round(r.x), y: Math.round(r.y), path: path.join(" < ") });
      }
      return out.slice(0, 12);
    }, typeText);
    console.log(`
Leaf nodes containing "${typeText}"
${"-".repeat(72)}`);
    for (const h of hits) console.log(`${String(h.x).padStart(5)},${String(h.y).padStart(5)}  "${h.t}"
        ${h.path}`);
  }

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

  /**
   * Clickable things that are not buttons — the diary's empty slots are plain divs carrying a
   * click handler, so the element listing above cannot see them and a flow that books from the
   * dashboard has nothing to aim at.
   */
  if (process.argv.includes("--slots")) {
    const slots = await page.evaluate(() => {
      const out = [];
      for (const el of document.querySelectorAll("div,td,li")) {
        const r = el.getBoundingClientRect();
        if (r.width < 30 || r.height < 12 || r.height > 200) continue;
        if (getComputedStyle(el).cursor !== "pointer") continue;
        // Only leaf-ish nodes: a pointer container wrapping the whole grid is not a slot.
        if (el.querySelectorAll("div,td,li").length > 3) continue;
        out.push({
          cls: String(el.className || "").slice(0, 70),
          text: (el.innerText || "").replace(/\s+/g, " ").trim().slice(0, 40),
          x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
        });
      }
      return out.slice(0, 40);
    });
    console.log(`
Pointer-cursor elements (possible slots)
${"-".repeat(72)}`);
    for (const s of slots) {
      console.log(`${String(s.x).padStart(4)},${String(s.y).padStart(5)} ${String(s.w).padStart(4)}x${String(s.h).padStart(3)}  "${s.text}"  .${s.cls}`);
    }
  }

  if (arg("shot")) await page.screenshot({ path: arg("shot") });
  await ctx.close();
}

main().catch((e) => { console.error(String(e.stack || e)); process.exit(1); });
