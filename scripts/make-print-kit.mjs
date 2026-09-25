/**
 * Print kit for the first dentist meetings: an A4 tri-fold brochure (two landscape pages,
 * outside + inside) and a business card with a QR (85×55 mm, front + back).
 *
 * Output: docs/marketing/print/brochure.pdf, card.pdf, plus PNG previews of each face.
 * Regenerated, never hand-edited: change CONTACT/URL/copy here and re-run.
 * Nothing is downloaded — Playwright comes out of the npx cache with the installed Chrome,
 * exactly as scripts/make-feature-cards.mjs does. Fonts come from Google Fonts at render time.
 *
 *   node scripts/make-print-kit.mjs [--out docs/marketing/print]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const PW = "C:/Users/PC/AppData/Local/npm-cache/_npx/9833c18b2d85bc59/node_modules/playwright";
const { chromium } = require(PW);
const QRCode = require("qrcode");

const args = process.argv.slice(2);
const argOf = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const OUT = resolve(argOf("out", "docs/marketing/print"));
mkdirSync(OUT, { recursive: true });

/* ------------------------------------------------------------ the facts */
// TODO: replace with the dedicated company SIM once bought (decided 2026-09-26).
// Until then this is the support WhatsApp already shown inside the app.
const CONTACT_DISPLAY = "0155 155 2440";
const URL = "https://alphadental.app";
const URL_DISPLAY = "alphadental.app";

const C = { ink: "#0A0A0B", paper: "#FFFFFF", grey: "#6B6F78", rule: "#D9DBE0", yellow: "#FACC15", ruleDark: "#2A2C33", inkOnDark: "#ECEBE8" };

const FONTS = `<link href="https://fonts.googleapis.com/css2?family=Noto+Kufi+Arabic:wght@400;700&family=Cairo:wght@300;400;600&family=Fraunces:opsz,wght@9..144,400&family=Geist+Mono:wght@400;500&display=swap" rel="stylesheet">`;

const BASE_CSS = `
@page { margin: 0; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { font-family: "Cairo", sans-serif; font-weight: 300; color: ${C.ink}; background: ${C.paper}; }
.kufi { font-family: "Noto Kufi Arabic", sans-serif; font-weight: 700; }
.mono { font-family: "Geist Mono", monospace; letter-spacing: .12em; text-transform: uppercase; font-size: 7.5pt; color: ${C.grey}; }
.serif { font-family: "Fraunces", serif; font-weight: 400; }
.ltr { direction: ltr; unicode-bidi: isolate; }
.rtl { direction: rtl; }
`;

/* --------------------------------------------------------- brochure */
// A4 landscape: 297 × 210 mm. Three panels of 99 mm. Fold marks are hairlines at 99 and 198.
// Outside (page 1), reading left→right when flat: [inside flap] [back cover] [front cover]
// for a right-to-left roll fold, so the front cover is the RIGHT panel and opens leftward,
// the way an Arabic reader expects.
const wordmark = (dark) => `
  <div class="wm ${dark ? "dark" : ""}">
    <span class="serif">Alpha</span><span class="serif thin">Dental</span>
  </div>`;

const arch = (filled, dark) => {
  // one arch of 16 crowns, the quiet dental motif shared with the feature plates
  const n = 16, cx = 60, cy = 60, rx = 52, ry = 40;
  let s = "";
  for (let i = 0; i < n; i++) {
    const t = Math.PI * (i / (n - 1));
    const x = cx - rx * Math.cos(t), y = cy - ry * Math.sin(t);
    const on = i === filled;
    s += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${on ? 3.2 : 2.1}" fill="${on ? C.yellow : "none"}" stroke="${on ? C.yellow : (dark ? C.ruleDark : C.rule)}" stroke-width="0.8"/>`;
  }
  return `<svg viewBox="0 0 120 70" width="34mm" height="20mm">${s}</svg>`;
};

const brochureCSS = `
${BASE_CSS}
.sheet { width: 297mm; height: 210mm; display: grid; grid-template-columns: 99mm 99mm 99mm; position: relative; overflow: hidden; page-break-after: always; }
.sheet:last-child { page-break-after: auto; }
.fold { position: absolute; top: 0; bottom: 0; width: 0; border-left: 0.2mm dashed ${C.rule}; }
.panel { padding: 14mm 11mm 12mm; display: flex; flex-direction: column; height: 210mm; direction: rtl; text-align: right; }
.panel.dark { background: ${C.ink}; color: ${C.inkOnDark}; }
.panel.dark .mono { color: #8A8F99; }
.wm { display: flex; gap: 2mm; align-items: baseline; direction: ltr; font-size: 15pt; letter-spacing: .01em; }
.wm .thin { font-weight: 300; opacity: .7; }
.wm.dark { color: ${C.inkOnDark}; }
h1 { font-family: "Noto Kufi Arabic", sans-serif; font-weight: 700; font-size: 30pt; line-height: 1.25; margin: 0; }
h2 { font-family: "Noto Kufi Arabic", sans-serif; font-weight: 700; font-size: 14pt; line-height: 1.35; margin: 0 0 3mm; }
p { margin: 0; font-size: 10.5pt; line-height: 1.7; }
p.en { direction: ltr; text-align: left; font-size: 8pt; color: ${C.grey}; line-height: 1.5; margin-top: 2mm; }
.dark p.en { color: #8A8F99; }
.spacer { flex: 1; }
.bar { height: 3mm; background: ${C.yellow}; width: 22mm; margin: 4mm 0 5mm; }
.hair { border-top: 0.3mm solid ${C.rule}; margin: 5mm 0; }
.dark .hair { border-color: ${C.ruleDark}; }
ul { margin: 0; padding: 0; list-style: none; display: grid; gap: 2.5mm; }
li { display: flex; gap: 3mm; align-items: flex-start; font-size: 10.5pt; line-height: 1.55; }
li::before { content: ""; flex: none; width: 2.2mm; height: 2.2mm; border: 0.3mm solid ${C.ink}; margin-top: 2.4mm; }
li.on::before { background: ${C.yellow}; border-color: ${C.yellow}; }
.dark li::before { border-color: ${C.inkOnDark}; }
.big { font-family: "Noto Kufi Arabic", sans-serif; font-weight: 700; font-size: 40pt; line-height: 1; }
.contact { display: grid; gap: 1.5mm; }
.contact .num { font-family: "Geist Mono", monospace; font-size: 15pt; letter-spacing: .04em; direction: ltr; text-align: right; }
.qr { width: 34mm; height: 34mm; }
.qr img { width: 100%; height: 100%; display: block; }
.trust { display: grid; grid-template-columns: 1fr 1fr; gap: 3mm 5mm; font-size: 9.5pt; line-height: 1.5; }
.trust div { border-top: 0.3mm solid ${C.rule}; padding-top: 2mm; }
.trust b { display: block; font-weight: 600; }
`;

const outside = `
<div class="sheet">
  <div class="fold" style="left:99mm"></div><div class="fold" style="left:198mm"></div>

  <!-- inside flap: the offer -->
  <div class="panel">
    <div class="mono">العرض · the offer</div>
    <div class="bar"></div>
    <h2>جرّبه شهر ببلاش، وكل حاجة مفتوحة</h2>
    <p>مش هتكتب مريض واحد. ابعتلنا ملف الإكسل أو صور الدفتر وإحنا بندخّلهم خلال ٤٨ ساعة. وبندرّب الريسبشن عندك بنفسنا.</p>
    <p class="en">30 days free, every module on. You type nothing: send Excel or photos of the book and we enter your patients within 48 hours. We train your reception ourselves.</p>
    <div class="hair"></div>
    <h2>رأيك بيتحسب</h2>
    <p>العيادات اللي بتقولنا رأيها خلال التجربة بتاخد <b>خصم ٣٠٪</b> على السنة الأولى.</p>
    <p class="en">Clinics that give feedback during the trial get 30% off the first year.</p>
    <div class="spacer"></div>
    <div class="trust">
      <div><b>بياناتك بتاعتك</b>تطلّعها إكسل أو PDF في أي وقت.</div>
      <div><b>خصوصية مكتوبة</b>صفحة واضحة بالعربي، مش شروط مخفية.</div>
      <div><b>بنستخدمه بنفسنا</b>عيادة المؤسّس شغّالة عليه كل يوم.</div>
      <div><b>ضمان</b>لو النظام قفل، الشهور المدفوعة وغير المستخدمة بترجعلك.</div>
    </div>
  </div>

  <!-- back cover: contact + QR -->
  <div class="panel">
    <div class="mono">ابدأ من هنا · start here</div>
    <div class="bar"></div>
    <h2>افتح حساب عيادتك في ٣ دقايق</h2>
    <p>امسح الكود، اكتب اسمك واسم العيادة، وابدأ. مفيش كارت بنكي ومفيش التزام.</p>
    <p class="en">Scan, enter your name and clinic name, start. No card, no commitment.</p>
    <div class="spacer"></div>
    <div class="qr"><img src="{{QR}}" alt="QR"></div>
    <div style="height:5mm"></div>
    <div class="contact">
      <div class="mono">web</div>
      <div class="num">${URL_DISPLAY}</div>
      <div class="mono" style="margin-top:2mm">whatsapp</div>
      <div class="num ltr">${CONTACT_DISPLAY}</div>
    </div>
    <div class="hair"></div>
    ${wordmark(false)}
  </div>

  <!-- front cover -->
  <div class="panel dark">
    ${wordmark(true)}
    <div class="spacer"></div>
    <h1>وقتك<br>يرجعلك.</h1>
    <div class="bar"></div>
    <p style="font-size:12pt">نظام إدارة عيادة الأسنان اللي عمله دكتور أسنان لعيادته، وبقى لعيادتك.</p>
    <p class="en">The dental clinic system a dentist built for his own clinic. Now for yours.</p>
    <div class="spacer"></div>
    <div style="display:flex;justify-content:space-between;align-items:flex-end">
      <div class="mono">تجربة ٣٠ يوم مجاناً</div>
      ${arch(15, true)}
    </div>
  </div>
</div>`;

const inside = `
<div class="sheet">
  <div class="fold" style="left:99mm"></div><div class="fold" style="left:198mm"></div>

  <div class="panel">
    <div class="mono">٠١ · whatsapp</div>
    <div class="bar"></div>
    <h2>واتساب بيرد لوحده، ٢٤ ساعة</h2>
    <p>المريض يبعت «عايز أحجز» الساعة ٢ بالليل، والنظام يسأله على الدكتور واليوم والساعة، ويحجزله، ويفكّره قبل الميعاد. وانت نايم.</p>
    <p class="en">A patient writes "I want to book" at 2 a.m. The system asks doctor, day, time, books it, and sends the reminder. While you sleep.</p>
    <div class="hair"></div>
    <ul>
      <li class="on">حجز وتأكيد ذاتي على واتساب</li>
      <li>تذكير قبل الميعاد ومتابعة اللي غاب</li>
      <li>صندوق رسائل واحد للعيادة كلها</li>
      <li>ردود بالعربي بأسلوب عيادتك</li>
    </ul>
    <div class="spacer"></div>
    ${arch(0, false)}
  </div>

  <div class="panel">
    <div class="mono">٠٢ · the patient file</div>
    <div class="bar"></div>
    <h2>ملف المريض كله على موبايلك</h2>
    <p>شارت الأسنان، التشخيص على السنّة، خطة العلاج بالأسعار، الأشعة، والروشتة. على اللابتوب وعلى تطبيق أندرويد بالعربي، للدكتور وللريسبشن.</p>
    <p class="en">Tooth chart, diagnosis per tooth, priced treatment plan, x-rays, prescriptions. On the laptop and an Arabic Android app, for dentist and reception.</p>
    <div class="hair"></div>
    <ul>
      <li class="on">شارت تفاعلي وتشخيص بضغطة</li>
      <li>خطة علاج تتطبع PDF للمريض</li>
      <li>أجندة اليوم بالألوان لكل مرحلة</li>
      <li>جولة تعليمية جوّه النظام</li>
    </ul>
    <div class="spacer"></div>
    ${arch(5, false)}
  </div>

  <div class="panel">
    <div class="mono">٠٣ · money</div>
    <div class="bar"></div>
    <h2>مين دفع، مين عليه، ونصيب كل دكتور</h2>
    <p>كل حالة بفلوسها. المتأخرات في قايمة واحدة، وحساب نصيب كل دكتور آخر الشهر بيتعمل لوحده. من غير دفتر ومن غير خناق.</p>
    <p class="en">Every case with its money. Outstanding balances in one list, each dentist's share computed at month end. No notebook, no arguments.</p>
    <div class="hair"></div>
    <ul>
      <li class="on">قايمة المتأخرات بضغطة</li>
      <li>نسبة كل دكتور محسوبة تلقائي</li>
      <li>دخل اليوم والشهر في لحظتها</li>
      <li>تقارير تتصدّر إكسل</li>
    </ul>
    <div class="spacer"></div>
    ${arch(10, false)}
  </div>
</div>`;

/* ----------------------------------------------------------- card */
const cardCSS = `
${BASE_CSS}
.card { width: 85mm; height: 55mm; padding: 6mm 7mm; position: relative; overflow: hidden; page-break-after: always; display: flex; flex-direction: column; }
.card:last-child { page-break-after: auto; }
.card.dark { background: ${C.ink}; color: ${C.inkOnDark}; }
.card.dark .mono { color: #8A8F99; }
.wm { display: flex; gap: 1.5mm; align-items: baseline; direction: ltr; font-size: 14pt; }
.wm .thin { font-weight: 300; opacity: .7; }
.tag { font-family: "Noto Kufi Arabic", sans-serif; font-weight: 700; font-size: 9.5pt; direction: rtl; text-align: right; line-height: 1.5; }
.spacer { flex: 1; }
.dot { width: 3mm; height: 3mm; background: ${C.yellow}; }
.back { display: grid; grid-template-columns: 30mm 1fr; gap: 5mm; align-items: center; height: 100%; }
.qr img { width: 30mm; height: 30mm; display: block; }
.num { font-family: "Geist Mono", monospace; font-size: 9.5pt; letter-spacing: .04em; direction: ltr; }
.rtl { direction: rtl; text-align: right; }
.offer { font-family: "Noto Kufi Arabic", sans-serif; font-weight: 700; font-size: 10pt; line-height: 1.5; }
`;

const card = `
<div class="card dark">
  <div class="wm"><span class="serif">Alpha</span><span class="serif thin">Dental</span></div>
  <div class="spacer"></div>
  <div class="tag">نظام إدارة عيادة الأسنان.<br>واتساب بيرد لوحده، ملف المريض على موبايلك، وفلوسك واضحة.</div>
  <div style="height:3mm"></div>
  <div class="dot"></div>
</div>
<div class="card">
  <div class="back">
    <div class="qr"><img src="{{QR}}" alt="QR"></div>
    <div class="rtl" style="display:grid;gap:1.5mm">
      <div class="offer">جرّبه ٣٠ يوم ببلاش.<br>امسح الكود وابدأ.</div>
      <div class="mono" style="margin-top:2mm">web</div>
      <div class="num">${URL_DISPLAY}</div>
      <div class="mono" style="margin-top:1mm">whatsapp</div>
      <div class="num">${CONTACT_DISPLAY}</div>
    </div>
  </div>
</div>`;

/* ---------------------------------------------------------- render */
const html = (css, body) => `<!doctype html><html lang="ar"><head><meta charset="utf-8">${FONTS}<style>${css}</style></head><body>${body}</body></html>`;

(async () => {
  const qr = await QRCode.toDataURL(URL, { errorCorrectionLevel: "M", margin: 1, width: 600, color: { dark: "#0A0A0B", light: "#FFFFFF" } });
  const browser = await chromium.launch({ channel: "chrome" });
  const ctx = await browser.newContext({ deviceScaleFactor: 2 });
  const page = await ctx.newPage();

  async function render(name, css, body, size) {
    await page.setContent(html(css, body).replaceAll("{{QR}}", qr), { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(400);
    await page.pdf({ path: join(OUT, `${name}.pdf`), width: size.w, height: size.h, printBackground: true, preferCSSPageSize: false });
    // PNG previews, one per page/face
    const faces = await page.$$(size.sel);
    for (let i = 0; i < faces.length; i++) {
      await faces[i].screenshot({ path: join(OUT, `${name}-${i + 1}.png`) });
    }
    console.log(`${name}: ${faces.length} face(s) → ${OUT}`);
  }

  await render("brochure", brochureCSS, outside + inside, { w: "297mm", h: "210mm", sel: ".sheet" });
  await render("card", cardCSS, card, { w: "85mm", h: "55mm", sel: ".card" });

  writeFileSync(join(OUT, "README.md"), `# Print kit

Generated by \`node scripts/make-print-kit.mjs\`. Do not edit the PDFs by hand.

- **brochure.pdf** — A4 landscape, 2 pages. Page 1 is the OUTSIDE (flap / back / front cover),
  page 2 the INSIDE (three feature panels). Print double-sided, flip on the short edge, roll-fold
  so the black front cover is on top and opens to the left.
- **card.pdf** — 85 × 55 mm, 2 pages (front / back). Any print shop's standard business card size.
- **\\*.png** — previews of each face at 2×, for WhatsApp or a quick look.

Contact number on both is **${CONTACT_DISPLAY}** (the in-app support WhatsApp). Replace
\`CONTACT_DISPLAY\` in the script with the dedicated company SIM before the paid print run.
The QR points at ${URL}.
`);
  await browser.close();
})();
