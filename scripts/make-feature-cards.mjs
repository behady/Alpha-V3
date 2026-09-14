/**
 * Arabic marketing plates — one PNG per sellable feature.
 *
 * Every plate is the same specimen tray: near-black ground, one hairline frame, a figure drawn
 * from drafting primitives, and a single yellow fill spent exactly once. The recurring motif in
 * the bottom corner is one arch of sixteen hairline crowns with this plate's position filled,
 * so any two plates side by side declare themselves members of one catalogue. See
 * docs/marketing/feature-cards-ar/PHILOSOPHY.md.
 *
 * Regenerated, never hand-edited: change the copy or a figure here and re-run. Nothing is
 * downloaded — Playwright comes out of the npx cache with the installed Chrome, exactly as
 * scripts/record-promo-clips.mjs does.
 *
 *   node scripts/make-feature-cards.mjs [--out docs/marketing/feature-cards-ar] [--only 07]
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const PW = "C:/Users/PC/AppData/Local/npm-cache/_npx/9833c18b2d85bc59/node_modules/playwright";
const { chromium } = require(PW);

const args = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const OUT = resolve(argOf("out", "docs/marketing/feature-cards-ar"));
const ONLY = argOf("only", null);
const FONT_DIR = "C:/Users/PC/.claude/skills/canvas-design/canvas-fonts";

/* ------------------------------------------------------------------ palette */
const C = {
  ground: "#0A0A0B",
  frame: "#22242A",
  rule: "#2E3138",
  grey: "#585C65",
  greyBright: "#8A8F99",
  ink: "#ECEBE8",
  yellow: "#FACC15",
};

/* --------------------------------------------------------------- primitives */
const R2 = (n) => Math.round(n * 100) / 100;
/**
 * A dental arch: n positions along a horseshoe that opens downward, the way a chart of the upper
 * jaw is drawn. The first version swept a half-ellipse and mirrored it for the lower jaw, which
 * at footer scale closed into a ring of dots and read as nothing at all.
 */
function archPoints(n, cx, cy, rx, ry) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0.5 : i / (n - 1);
    // Swept a little past each equator so the ends run back down, as the posterior teeth do.
    const a = Math.PI * (1.06 - t * 1.12);
    out.push([R2(cx + Math.cos(a) * rx), R2(cy - Math.sin(a) * ry)]);
  }
  return out;
}
/** The catalogue motif: one arch of 16 crowns, this plate's position filled. Identical everywhere. */
function dentition(markIndex) {
  const n = 16;
  const pts = archPoints(n, 86, 92, 76, 64);
  const mark = ((markIndex - 1) % n) + 1;
  const w = 7.6;
  return `<g>
    <path d="M ${pts.map(([x, y], i) => `${i ? "L" : ""} ${x} ${y}`).join(" ")}" stroke="#212429" stroke-width="0.9" fill="none"/>
    ${pts
      .map(([x, y], i) => {
        const on = i === mark - 1;
        return `<rect x="${R2(x - w / 2)}" y="${R2(y - w / 2)}" width="${w}" height="${w}" rx="1.6" fill="${on ? C.yellow : "none"}" stroke="${on ? C.yellow : C.grey}" stroke-width="1"/>`;
      })
      .join("")}
  </g>`;
}

/* ------------------------------------------------------------------ figures */
/* Each figure draws inside a 560 x 480 box at (0,0). Three stroke weights only: 0.8, 1.4, 2.6. */
const hair = `stroke="${C.rule}" stroke-width="0.8" fill="none"`;
const line = `stroke="${C.grey}" stroke-width="1.4" fill="none"`;
const bold = `stroke="${C.ink}" stroke-width="2.6" fill="none"`;
const gold = `stroke="${C.yellow}" stroke-width="2.6" fill="none"`;

/** A faint lattice behind every figure — the graph paper of the imaginary discipline. */
function lattice(cols = 14, rows = 12, step = 40, x0 = 0, y0 = 0) {
  let s = "";
  for (let c = 0; c <= cols; c++) s += `<line x1="${x0 + c * step}" y1="${y0}" x2="${x0 + c * step}" y2="${y0 + rows * step}" stroke="#15171C" stroke-width="0.7"/>`;
  for (let r = 0; r <= rows; r++) s += `<line x1="${x0}" y1="${y0 + r * step}" x2="${x0 + cols * step}" y2="${y0 + r * step}" stroke="#15171C" stroke-width="0.7"/>`;
  return s;
}

const FIGURES = {
  /* رسائل تلقائية — a time axis sampled at equal intervals, one send completed. */
  autoMessages: () => {
    let s = `<line x1="60" y1="40" x2="60" y2="440" ${line}/>`;
    for (let i = 0; i < 6; i++) {
      const y = 70 + i * 74;
      const on = i === 3;
      s += `<line x1="52" y1="${y}" x2="68" y2="${y}" ${on ? gold : hair}/>`;
      s += `<rect x="110" y="${y - 22}" width="${330 - i * 18}" height="44" rx="8" ${on ? gold : hair}/>`;
      for (let k = 0; k < 2; k++)
        s += `<line x1="128" y1="${y - 8 + k * 14}" x2="${128 + (250 - i * 24) * (k ? 0.55 : 1)}" y2="${y - 8 + k * 14}" stroke="${on ? "#7A6412" : "#1E2027"}" stroke-width="2"/>`;
    }
    return s;
  },

  /* بوت — a keyword field routed deterministically into one reply. */
  bot: () => {
    let s = "";
    const pts = [];
    for (let r = 0; r < 7; r++)
      for (let c = 0; c < 8; c++) {
        const x = 46 + c * 52, y = 38 + r * 42;
        const trig = (r === 1 && c === 1) || (r === 3 && c === 0) || (r === 5 && c === 3);
        if (trig) pts.push([x, y]);
        s += trig
          ? `<rect x="${x - 7}" y="${y - 7}" width="14" height="14" fill="none" stroke="${C.ink}" stroke-width="1.8"/>`
          : `<circle cx="${x}" cy="${y}" r="2.4" fill="#2A2D34"/>`;
      }
    const bus = 306, hubY = 388;
    s += pts.map(([x, y]) => `<path d="M ${x + 12} ${y} L ${bus} ${y} L ${bus} ${hubY}" stroke="${C.grey}" stroke-width="1.4" fill="none"/>`).join("");
    s += `<line x1="${bus}" y1="${hubY}" x2="386" y2="${hubY}" ${bold}/>`;
    s += `<rect x="386" y="${hubY - 46}" width="92" height="92" fill="${C.yellow}"/>`;
    [0, 1, 2].forEach((k) => (s += `<rect x="404" y="${hubY - 18 + k * 16}" width="${[56, 38, 48][k]}" height="4" fill="#0A0A0B"/>`));
    s += `<circle cx="${bus}" cy="${hubY}" r="5" fill="${C.ink}"/>`;
    return s;
  },

  /* ملفات PDF — three sheets, ruled, the top one issued. */
  pdf: () => {
    let s = "";
    for (let i = 2; i >= 0; i--) {
      const x = 120 + i * 26, y = 50 + i * 30;
      s += `<rect x="${x}" y="${y}" width="270" height="350" ${i === 0 ? bold : hair}/>`;
    }
    for (let k = 0; k < 9; k++)
      s += `<line x1="150" y1="${96 + k * 30}" x2="${k === 0 ? 300 : k % 3 === 0 ? 330 : 360}" y2="${96 + k * 30}" stroke="${k === 0 ? C.greyBright : "#1E2027"}" stroke-width="${k === 0 ? 3 : 2}"/>`;
    s += `<path d="M 120 50 L 390 50 L 390 400 L 120 400 Z" ${bold}/>`;
    s += `<rect x="330" y="330" width="46" height="46" fill="${C.yellow}"/>`;
    s += `<path d="M 340 353 l 8 9 l 16 -18" stroke="#0A0A0B" stroke-width="3.4" fill="none"/>`;
    return s;
  },

  /* المساعد الذكي — a fan of questions converging on one answer. */
  aiChat: () => {
    let s = `<circle cx="280" cy="240" r="170" ${hair}/><circle cx="280" cy="240" r="110" ${hair}/>`;
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * Math.PI * 2;
      const r1 = 118, r2 = i % 4 === 0 ? 176 : 162;
      s += `<line x1="${R2(280 + Math.cos(a) * r1)}" y1="${R2(240 + Math.sin(a) * r1)}" x2="${R2(280 + Math.cos(a) * r2)}" y2="${R2(240 + Math.sin(a) * r2)}" stroke="${i % 12 === 0 ? C.greyBright : C.rule}" stroke-width="${i % 12 === 0 ? 1.6 : 0.8}"/>`;
    }
    s += `<circle cx="280" cy="240" r="46" fill="${C.yellow}"/>`;
    s += `<circle cx="280" cy="240" r="72" ${line}/>`;
    return s;
  },

  /* التنبيهات الاستباقية — a sampled series with the one anomaly found. */
  proactive: () => {
    const h = [42, 58, 51, 63, 47, 55, 60, 49, 44, 57, 52, 66, 48, 128, 53, 45, 61, 50, 56, 43, 59, 47, 54, 46];
    let s = `<line x1="40" y1="400" x2="520" y2="400" ${line}/>`;
    s += h
      .map((v, i) => {
        const on = i === 13;
        const x = 52 + i * 19.6;
        return `<rect x="${x}" y="${400 - v * 1.9}" width="9" height="${v * 1.9}" fill="${on ? C.yellow : "#22252B"}"/>`;
      })
      .join("");
    s += `<line x1="40" y1="${400 - 62 * 1.9}" x2="520" y2="${400 - 62 * 1.9}" stroke="${C.rule}" stroke-width="0.8" stroke-dasharray="3 6"/>`;
    s += `<circle cx="${52 + 13 * 19.6 + 4.5}" cy="${400 - 128 * 1.9 - 26}" r="13" ${gold}/>`;
    return s;
  },

  /* ملخصات داخل الملف — eight lines of record collapsed into two. */
  embedded: () => {
    let s = `<rect x="60" y="40" width="240" height="400" ${hair}/>`;
    for (let k = 0; k < 13; k++)
      s += `<line x1="84" y1="${72 + k * 28}" x2="${k % 3 === 0 ? 250 : k % 2 ? 276 : 232}" y2="${72 + k * 28}" stroke="#20232A" stroke-width="2.6"/>`;
    s += `<path d="M 322 150 L 348 150 L 348 330 L 322 330" ${gold}/>`;
    s += `<rect x="372" y="196" width="150" height="88" ${bold}/>`;
    s += `<line x1="392" y1="228" x2="502" y2="228" stroke="${C.greyBright}" stroke-width="3"/><line x1="392" y1="252" x2="462" y2="252" stroke="${C.greyBright}" stroke-width="3"/>`;
    return s;
  },

  /* الملاحظات الصوتية — speech, measured, then written. */
  voice: () => {
    const amp = [8, 14, 26, 40, 58, 74, 52, 33, 47, 66, 88, 61, 39, 24, 45, 70, 92, 68, 41, 27, 18, 31, 49, 63, 44, 29, 16, 22, 37, 20, 11, 7];
    let s = "";
    s += amp
      .map((v, i) => {
        const x = 52 + i * 15.2;
        const on = i >= 9 && i <= 18;
        return `<rect x="${x}" y="${170 - v}" width="6" height="${v * 2}" rx="3" fill="${on ? C.yellow : "#23262D"}"/>`;
      })
      .join("");
    s += `<line x1="40" y1="300" x2="520" y2="300" ${hair}/>`;
    for (let k = 0; k < 4; k++)
      s += `<line x1="${k === 0 ? 100 : 60}" y1="${340 + k * 30}" x2="${[460, 420, 470, 300][k]}" y2="${340 + k * 30}" stroke="${C.grey}" stroke-width="3"/>`;
    return s;
  },

  /* الحجز الإلكتروني — a month, one slot taken from outside. */
  booking: () => {
    let s = "";
    for (let r = 0; r < 5; r++)
      for (let c = 0; c < 7; c++) {
        const x = 108 + c * 52, y = 120 + r * 52;
        const on = r === 2 && c === 4;
        s += `<rect x="${x}" y="${y}" width="36" height="36" ${on ? "" : hair} ${on ? `fill="${C.yellow}"` : ""}/>`;
      }
    for (let c = 0; c < 7; c++) s += `<line x1="${108 + c * 52 + 6}" y1="92" x2="${108 + c * 52 + 30}" y2="92" stroke="${C.grey}" stroke-width="2"/>`;
    s += `<path d="M 520 400 C 470 400 460 330 434 296" ${line}/>`;
    s += `<circle cx="520" cy="400" r="9" fill="${C.ink}"/>`;
    return s;
  },

  /* عملاء الإعلانات — a funnel that ends in one patient. */
  leads: () => {
    const rows = [11, 9, 7, 5, 3, 1];
    let s = "";
    rows.forEach((n, r) => {
      const y = 56 + r * 66;
      for (let i = 0; i < n; i++) {
        const x = 280 - ((n - 1) * 44) / 2 + i * 44;
        const last = r === rows.length - 1;
        s += last
          ? `<rect x="${x - 16}" y="${y - 16}" width="32" height="32" fill="${C.yellow}"/>`
          : `<circle cx="${x}" cy="${y}" r="7" fill="none" stroke="${r < 2 ? C.grey : C.greyBright}" stroke-width="1.4"/>`;
      }
    });
    s += `<path d="M 40 30 L 520 30 L 320 452 L 240 452 Z" ${hair}/>`;
    return s;
  },

  /* متابعة المعمل — a closed loop with one case in transit. */
  lab: () => {
    let s = `<circle cx="280" cy="240" r="150" ${hair}/>`;
    const stations = [
      [280 - 150, 240],
      [280, 240 - 150],
      [280 + 150, 240],
      [280, 240 + 150],
    ];
    for (let i = 0; i < 4; i++) {
      const [x, y] = stations[i];
      const on = i === 1;
      s += on
        ? `<rect x="${x - 26}" y="${y - 26}" width="52" height="52" fill="${C.yellow}"/>`
        : `<rect x="${x - 22}" y="${y - 22}" width="44" height="44" ${line}/>`;
    }
    for (let i = 0; i < 4; i++) {
      const a0 = (i / 4) * Math.PI * 2 + 0.16, a1 = ((i + 1) / 4) * Math.PI * 2 - 0.16;
      const p = (a) => `${R2(280 + Math.cos(a) * 150)} ${R2(240 + Math.sin(a) * 150)}`;
      s += `<path d="M ${p(a0)} A 150 150 0 0 1 ${p(a1)}" stroke="${i === 0 ? C.yellow : C.grey}" stroke-width="${i === 0 ? 2.6 : 1.4}" fill="none"/>`;
    }
    return s;
  },

  /* التقويم — the arch, a wire, and the bracket being worked. */
  ortho: () => {
    const p = archPoints(9, 280, 344, 216, 202);
    let s = `<path d="M ${p.map(([x, y], i) => `${i ? "L" : ""} ${x} ${y}`).join(" ")}" ${line}/>`;
    s += p
      .map(([x, y], i) => {
        const on = i === 6;
        return on
          ? `<rect x="${x - 15}" y="${y - 15}" width="30" height="30" fill="${C.yellow}"/>`
          : `<rect x="${x - 12}" y="${y - 12}" width="24" height="24" ${bold}/>`;
      })
      .join("");
    const q = archPoints(9, 280, 344, 252, 238);
    s += `<path d="M ${q.map(([x, y], i) => `${i ? "L" : ""} ${x} ${y}`).join(" ")}" ${hair}/>`;
    return s;
  },

  /* المخزون — stacked units, one shelf at the line. */
  inventory: () => {
    const cols = [9, 6, 8, 2, 7];
    let s = `<line x1="40" y1="412" x2="520" y2="412" ${line}/>`;
    s += `<line x1="40" y1="${412 - 3 * 38}" x2="520" y2="${412 - 3 * 38}" stroke="${C.rule}" stroke-width="0.8" stroke-dasharray="3 6"/>`;
    cols.forEach((n, c) => {
      const x = 76 + c * 92;
      for (let i = 0; i < 9; i++) {
        const y = 412 - (i + 1) * 38 + 4;
        const filled = i < n;
        const low = c === 3 && filled;
        s += `<rect x="${x}" y="${y}" width="64" height="30" fill="${low ? C.yellow : filled ? "#23262D" : "none"}" stroke="${filled ? "none" : "#191C22"}" stroke-width="0.8"/>`;
      }
    });
    return s;
  },

  /* الحضور والرواتب — a timesheet, one column totalled. */
  attendance: () => {
    let s = "";
    for (let c = 0; c < 6; c++)
      for (let r = 0; r < 6; r++) {
        const x = 70 + c * 76, y = 56 + r * 52;
        const on = c === 4;
        s += `<rect x="${x}" y="${y}" width="52" height="34" ${hair}/>`;
        s += `<line x1="${x + 10}" y1="${y + 17}" x2="${x + 42 - (r % 3) * 8}" y2="${y + 17}" stroke="${on ? C.yellow : C.grey}" stroke-width="${on ? 3 : 2}"/>`;
      }
    s += `<line x1="60" y1="386" x2="520" y2="386" ${line}/>`;
    s += `<rect x="${70 + 4 * 76}" y="402" width="52" height="30" fill="${C.yellow}"/>`;
    return s;
  },

  /* التقارير — a polar record, one sector read. */
  reports: () => {
    let s = "";
    [170, 132, 94, 56].forEach((r, i) => (s += `<circle cx="280" cy="240" r="${r}" ${i === 3 ? line : hair}/>`));
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2 - Math.PI / 2;
      s += `<line x1="${R2(280 + Math.cos(a) * 56)}" y1="${R2(240 + Math.sin(a) * 56)}" x2="${R2(280 + Math.cos(a) * 170)}" y2="${R2(240 + Math.sin(a) * 170)}" stroke="${C.rule}" stroke-width="0.8"/>`;
    }
    const vals = [88, 132, 104, 150, 118, 96, 140, 112, 128, 100, 156, 120];
    s += `<path d="${vals
      .map((v, i) => {
        const a = (i / 12) * Math.PI * 2 - Math.PI / 2;
        return `${i ? "L" : "M"} ${R2(280 + Math.cos(a) * v)} ${R2(240 + Math.sin(a) * v)}`;
      })
      .join(" ")} Z" stroke="${C.greyBright}" stroke-width="1.4" fill="none"/>`;
    const a0 = (10 / 12) * Math.PI * 2 - Math.PI / 2, a1 = (11 / 12) * Math.PI * 2 - Math.PI / 2;
    const P = (a, r) => `${R2(280 + Math.cos(a) * r)} ${R2(240 + Math.sin(a) * r)}`;
    s += `<path d="M ${P(a0, 56)} L ${P(a0, 170)} A 170 170 0 0 1 ${P(a1, 170)} L ${P(a1, 56)} A 56 56 0 0 0 ${P(a0, 56)} Z" fill="${C.yellow}"/>`;
    return s;
  },

  /* أكثر من فرع — two identical charts, one system. */
  branches: () => {
    const one = (ox, oy, mark) => {
      const pts = archPoints(10, ox + 84, oy + 112, 64, 58);
      return `<path d="M ${pts.map(([x, y], i) => `${i ? "L" : ""} ${x} ${y}`).join(" ")}" ${hair}/>` + pts
        .map(([x, y], i) => `<rect x="${x - 4.5}" y="${y - 4.5}" width="9" height="9" fill="${i === mark ? C.yellow : "none"}" stroke="${i === mark ? C.yellow : C.grey}" stroke-width="1.2"/>`)
        .join("");
    };
    let s = `<rect x="34" y="96" width="196" height="200" ${hair}/><rect x="330" y="96" width="196" height="200" ${hair}/>`;
    s += one(48, 108, 4) + one(344, 108, 7);
    s += `<line x1="230" y1="196" x2="330" y2="196" ${line}/>`;
    s += `<rect x="266" y="182" width="28" height="28" fill="${C.yellow}"/>`;
    for (let i = 0; i < 2; i++) {
      const x = 34 + i * 296;
      s += `<line x1="${x + 26}" y1="336" x2="${x + 170}" y2="336" stroke="${C.rule}" stroke-width="0.9"/>`;
      s += `<line x1="${x + 26}" y1="354" x2="${x + 120}" y2="354" stroke="#191C22" stroke-width="0.9"/>`;
    }
    return s;
  },

  /* التسويق: المحتوى — a month of posts, one written. */
  marketingText: () => {
    let s = "";
    for (let r = 0; r < 4; r++)
      for (let c = 0; c < 4; c++) {
        const x = 76 + c * 112, y = 48 + r * 104, on = r === 1 && c === 2;
        s += `<rect x="${x}" y="${y}" width="88" height="80" ${on ? "" : hair} ${on ? `fill="${C.yellow}"` : ""}/>`;
        for (let k = 0; k < 3; k++)
          s += `<line x1="${x + 14}" y1="${y + 24 + k * 16}" x2="${x + 74 - k * 14}" y2="${y + 24 + k * 16}" stroke="${on ? "#0A0A0B" : "#1E2127"}" stroke-width="2.4"/>`;
      }
    return s;
  },

  /* التسويق: التصميم — one template, many sizes. */
  marketingDesign: () => {
    let s = "";
    const steps = 6;
    for (let i = 0; i < steps; i++) {
      const k = i * 30;
      const w = 306 - k * 0.94, h = 392 - k * 1.2;
      s += `<rect x="${R2(280 - w / 2)}" y="${R2(240 - h / 2)}" width="${R2(w)}" height="${R2(h)}" ${i === steps - 1 ? `fill="${C.yellow}" stroke="none"` : hair} transform="rotate(${R2(i * 1.15)} 280 240)"/>`;
    }
    const w = 306 - (steps - 1) * 30 * 0.94;
    const left = R2(280 - w / 2 + 24);
    s += `<g transform="rotate(${R2((steps - 1) * 1.15)} 280 240)">`;
    s += `<rect x="${left}" y="182" width="36" height="36" fill="#0A0A0B"/>`;
    [0, 1, 2].forEach((k) => (s += `<rect x="${left}" y="${246 + k * 18}" width="${[92, 62, 74][k]}" height="4.5" fill="#0A0A0B"/>`));
    s += "</g>";
    return s;
  },

  /* الغلاف — the whole dentition, once, large. */
  cover: () => {
    const outer = archPoints(16, 280, 350, 232, 238);
    const inner = archPoints(16, 280, 350, 172, 176);
    let s = `<path d="M ${outer.map(([x, y], i) => `${i ? "L" : ""} ${x} ${y}`).join(" ")}" ${hair}/>`;
    s += `<path d="M ${inner.map(([x, y], i) => `${i ? "L" : ""} ${x} ${y}`).join(" ")}" stroke="#15181D" stroke-width="0.8" fill="none"/>`;
    outer.forEach(([x, y], i) => {
      const on = i === 8;
      const [ix, iy] = inner[i];
      s += `<line x1="${x}" y1="${y}" x2="${ix}" y2="${iy}" stroke="${on ? "#6A5610" : "#15181D"}" stroke-width="0.9"/>`;
      s += `<rect x="${R2(x - 13)}" y="${R2(y - 13)}" width="26" height="26" rx="4" fill="${on ? C.yellow : "none"}" stroke="${on ? C.yellow : C.grey}" stroke-width="1.3"/>`;
    });
    return s;
  },
};

/* --------------------------------------------------------------------- copy */
/** Arabic names are the ones the app itself shows (src/lib/featureCatalog.ts). */
const PLATES = [
  {
    file: "00-cover",
    group: "النظام",
    name: "ألفا دنتال",
    promise: "العيادة بالكامل في شاشة واحدة",
    note: "نظام إدارة عيادات الأسنان، وسبعة عشر إضافة تتفعّل بالطلب",
    figure: "cover",
    unit: "CATALOGUE",
    cover: true,
  },
  { file: "01-whatsapp-auto", group: "واتساب", name: "رسائل واتساب التلقائية", promise: "التأكيد والتذكير والإيصال يوصلوا لوحدهم", note: "من غير حد يفتح الموبايل", figure: "autoMessages", unit: "SEND / AUTO" },
  { file: "02-whatsapp-bot", group: "واتساب", name: "بوت واتساب", promise: "يرد على المريض في ثانية، ويحجزله", note: "ردود جاهزة بكلماتك، وبدون تكلفة لكل رسالة", figure: "bot", unit: "REPLY / 0 EGP" },
  { file: "03-clinical-pdfs", group: "واتساب", name: "الروشتة على واتساب", promise: "الروشتة وخطة العلاج ملف PDF في إيد المريض", note: "بختم العيادة وبياناتها", figure: "pdf", unit: "PDF / SEND" },
  { file: "04-ai-assistant", group: "ذكاء اصطناعي", name: "المساعد الذكي", promise: "اسأل عن عيادتك، يجيبلك الرقم", note: "من بيانات عيادتك، مش من الإنترنت", figure: "aiChat", unit: "ASK / ANSWER" },
  { file: "05-ai-proactive", group: "ذكاء اصطناعي", name: "التنبيهات الاستباقية", promise: "يقولك على المشكلة قبل ما تسأل", note: "ملخص يومي، إيرادات ضايعة، ومرضى غابوا", figure: "proactive", unit: "SCAN / DAILY" },
  { file: "06-ai-embedded", group: "ذكاء اصطناعي", name: "ملخص الملف", promise: "تاريخ المريض كله في سطرين", note: "جوه الملف، قبل ما تقعده على الكرسي", figure: "embedded", unit: "N → 2" },
  { file: "07-ai-voice", group: "ذكاء اصطناعي", name: "الملاحظات الصوتية", promise: "اتكلم، والكشف يتكتب لوحده", note: "صوتك يتحول لملاحظات منظمة في الملف", figure: "voice", unit: "VOICE / TEXT" },
  { file: "08-online-booking", group: "وحدات", name: "الحجز الإلكتروني", promise: "لينك واحد، والمريض يحجز بنفسه", note: "الفرع والدكتور والوقت المتاح", figure: "booking", unit: "LINK / BOOK" },
  { file: "09-ads-leads", group: "وحدات", name: "عملاء الإعلانات", promise: "كل ليد من الإعلان يدخل ويترد عليه", note: "من فيسبوك وإنستجرام، ومتابعة تلقائية", figure: "leads", unit: "LEAD → CASE" },
  { file: "10-lab", group: "وحدات", name: "متابعة المعمل", promise: "كل حالة عند المعمل معروفة هي فين", note: "اتبعتت، جاهزة، وركّبت", figure: "lab", unit: "CASE / STAGE" },
  { file: "11-ortho", group: "وحدات", name: "التقويم", promise: "خطة كل حالة وزياراتها في مكان واحد", note: "من أول زيارة لآخر شد", figure: "ortho", unit: "CASE / VISIT" },
  { file: "12-inventory", group: "وحدات", name: "المخزون", promise: "تعرف الناقص قبل ما تقف عليه", note: "الكميات والتنبيهات والاستهلاك لكل علاج", figure: "inventory", unit: "STOCK / ALERT" },
  { file: "13-attendance", group: "وحدات", name: "الحضور والرواتب", promise: "ساعات الفريق ورواتبه بتتحسب لوحدها", note: "تسجيل من أجهزة العيادة بس", figure: "attendance", unit: "HOURS / PAY" },
  { file: "14-reports", group: "وحدات", name: "التقارير", promise: "إيراداتك وخدماتك وأطباؤك بالرقم", note: "أي فترة تختارها", figure: "reports", unit: "RANGE / SUM" },
  { file: "15-branches", group: "وحدات", name: "أكثر من فرع", promise: "فروعك كلها في نظام واحد", note: "أسعار ومواعيد وفريق لكل فرع", figure: "branches", unit: "N BRANCHES" },
  { file: "16-marketing-content", group: "تسويق", name: "المحتوى والخطة", promise: "محتوى وخطة نشر لعيادتك كل شهر", note: "مكتوبة بلهجة مرضاك", figure: "marketingText", unit: "PLAN / MONTH" },
  { file: "17-marketing-design", group: "تسويق", name: "التصميم", promise: "تصاميم بهوية عيادتك جاهزة للنشر", note: "قبل وبعد، عروض، ومواعيد", figure: "marketingDesign", unit: "BRAND / POST" },
];

/* --------------------------------------------------------------------- page */
const W = 1080, H = 1350;
const monoFont = (file, weight) =>
  `@font-face{font-family:"Plate Mono";src:url("file:///${FONT_DIR}/${file}") format("truetype");font-weight:${weight};font-style:normal;font-display:block}`;

function plateHtml(p, i, total) {
  const figure = FIGURES[p.figure]();
  const mark = p.cover ? 8 : ((i - 1) % 32) + 1;
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Noto+Kufi+Arabic:wght@300;500;700&family=Cairo:wght@300;400;600&display=swap" rel="stylesheet">
<style>
${monoFont("GeistMono-Regular.ttf", 400)}
${monoFont("GeistMono-Bold.ttf", 700)}
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:${W}px;height:${H}px;background:${C.ground};overflow:hidden}
.plate{position:relative;width:${W}px;height:${H}px;background:${C.ground}}
/* The frame: one hairline, inboard of the trim, and four corner ticks that prove it was drawn. */
.frame{position:absolute;inset:56px;border:0.8px solid ${C.frame}}
.tick{position:absolute;background:${C.grey}}
.mono{font-family:"Plate Mono",monospace;letter-spacing:0.18em;text-transform:uppercase;color:${C.grey}}
.head{position:absolute;top:96px;right:96px;left:96px;display:flex;align-items:baseline;justify-content:space-between}
.word{font-family:"Noto Kufi Arabic",sans-serif;font-weight:500;font-size:19px;letter-spacing:0.02em;color:${C.ink}}
.word small{display:block;font-family:"Plate Mono",monospace;font-size:10px;letter-spacing:0.42em;color:${C.grey};margin-top:7px}
.fig{position:absolute;top:${p.cover ? 256 : 214}px;left:${p.cover ? 232 : 194}px;width:${p.cover ? 616 : 692}px;height:${p.cover ? 528 : 593}px}
.rulemain{position:absolute;left:96px;right:96px;top:${p.cover ? 892 : 862}px;height:0.8px;background:${C.rule}}
.grp{position:absolute;right:96px;top:${p.cover ? 916 : 890}px;font-family:"Cairo",sans-serif;font-weight:600;
  font-size:17px;color:${C.yellow};letter-spacing:0.04em}
.name{position:absolute;right:96px;left:96px;top:${p.cover ? 946 : 926}px;font-family:"Noto Kufi Arabic",sans-serif;font-weight:700;
  font-size:${p.cover ? 94 : p.name.length > 18 ? 60 : 72}px;line-height:1.14;color:${C.ink};letter-spacing:-0.01em}
.promise{position:absolute;right:96px;left:180px;top:${p.cover ? 1084 : p.name.length > 18 ? 1012 : 1026}px;
  font-family:"Cairo",sans-serif;font-weight:300;font-size:32px;line-height:1.5;color:${C.greyBright}}
.note{position:absolute;right:96px;left:180px;top:${p.cover ? 1148 : 1098}px;font-family:"Cairo",sans-serif;font-weight:400;font-size:19px;color:${C.grey}}
.foot{position:absolute;bottom:96px;right:96px;left:96px;display:flex;align-items:flex-end;justify-content:space-between}
.chart{width:176px;height:112px}
.contact{text-align:left;font-family:"Cairo",sans-serif;font-weight:400;font-size:15px;color:${C.grey}}
/* Latin-to-right, or the RTL page reverses the groups and prints the number backwards. */
.contact b{display:block;direction:ltr;font-family:"Plate Mono",monospace;font-weight:700;font-size:22px;letter-spacing:0.05em;color:${C.ink};margin-top:7px}
.badge{position:absolute;top:96px;left:96px;text-align:left}
.badge .n{direction:ltr;font-family:"Plate Mono",monospace;font-weight:400;font-size:${p.cover ? 13 : 27}px;color:${C.ink};letter-spacing:0.1em}
.badge .n.ar{font-family:"Cairo",sans-serif;font-weight:600;font-size:16px;letter-spacing:0.02em}
.badge .u{font-family:"Plate Mono",monospace;font-size:9.5px;letter-spacing:0.34em;color:${C.grey};margin-top:6px}
.side{position:absolute;left:56px;top:50%;transform:translateY(-50%) rotate(180deg);writing-mode:vertical-rl;
  font-family:"Plate Mono",monospace;font-size:9.5px;letter-spacing:0.42em;color:#2C2F36;padding-left:18px}
</style></head><body><div class="plate">
  <div class="frame"></div>
  <div class="tick" style="right:56px;top:56px;width:26px;height:2px"></div>
  <div class="tick" style="right:56px;top:56px;width:2px;height:26px"></div>
  <div class="tick" style="left:56px;bottom:56px;width:26px;height:2px"></div>
  <div class="tick" style="left:56px;bottom:56px;width:2px;height:26px"></div>

  <div class="head">
    <div class="word">ألفا دنتال<small>alpha dental</small></div>
  </div>
  <div class="badge">
    <div class="n${p.cover ? " ar" : ""}"${p.cover ? ' style="direction:rtl"' : ""}>${p.cover ? "المجموعة الكاملة" : `${String(i).padStart(2, "0")} / ${total}`}</div>
    <div class="u">${p.unit}</div>
  </div>

  <div class="fig"><svg viewBox="0 0 560 480" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
    ${p.cover ? "" : lattice(14, 12, 40, 0, 0)}
    ${figure}
  </svg></div>

  <div class="rulemain"></div>
  ${p.cover ? "" : `<div class="grp">${p.group}</div>`}
  <div class="name">${p.name}</div>
  <div class="promise">${p.promise}</div>
  <div class="note">${p.note}</div>

  <div class="foot">
    ${p.cover ? '<span style="width:176px"></span>' : `<svg class="chart" viewBox="0 0 176 112" xmlns="http://www.w3.org/2000/svg">${dentition(mark)}</svg>`}
    <div class="contact">للتفعيل واتساب<b>0155 155 2440</b></div>
  </div>

  <div class="side">${p.cover ? "alpha dental management system" : `plate ${String(i).padStart(2, "0")} — ${p.unit}`}</div>
</div></body></html>`;
}

/* ---------------------------------------------------------------------- run */
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 2 });
const total = PLATES.length - 1;
const made = [];

for (let n = 0; n < PLATES.length; n++) {
  const p = PLATES[n];
  if (ONLY && !p.file.startsWith(ONLY)) continue;
  const html = plateHtml(p, n, total);
  const tmp = join(OUT, `.${p.file}.html`);
  writeFileSync(tmp, html, "utf8");
  await page.goto(`file:///${tmp.replace(/\\/g, "/")}`);
  // Webfonts must be in before the shot: an unshaped fallback is invisible in a thumbnail and
  // ruins the plate at full size.
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(220);
  const out = join(OUT, `${p.file}.png`);
  await page.screenshot({ path: out, type: "png" });
  made.push(out);
  console.log("→", p.file + ".png", p.name);
}

/* A contact sheet, because a series is judged as a series. */
if (!ONLY) {
  const files = made.map((f) => `file:///${f.replace(/\\/g, "/")}`);
  const sheetW = 1600;
  const cols = 6;
  const cell = Math.floor((sheetW - 40 - (cols - 1) * 12) / cols);
  const rows = Math.ceil(files.length / cols);
  const sheet = `<!doctype html><html><head><meta charset="utf-8"><style>
    body{margin:0;background:#17181B;padding:20px;display:grid;grid-template-columns:repeat(${cols},${cell}px);gap:12px}
    img{width:${cell}px;height:${Math.round((cell * H) / W)}px;display:block}</style></head>
    <body>${files.map((f) => `<img src="${f}">`).join("")}</body></html>`;
  const sheetPath = join(OUT, ".contact-sheet.html");
  writeFileSync(sheetPath, sheet, "utf8");
  await page.setViewportSize({ width: sheetW, height: 40 + rows * Math.round((cell * H) / W) + (rows - 1) * 12 });
  await page.goto(`file:///${sheetPath.replace(/\\/g, "/")}`);
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(OUT, "_contact-sheet.png"), type: "png" });
  console.log("→ _contact-sheet.png");
}

await browser.close();
void readFileSync;
console.log(`\n${made.length} plates in ${OUT}`);
