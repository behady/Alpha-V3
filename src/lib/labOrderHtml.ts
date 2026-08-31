/**
 * The lab order sheet, as HTML.
 *
 * Deliberately Firebase-free, the same split `procedurePricing.ts` draws against `ledgerWrite.ts`.
 * Everything here is a pure function of a case plus a few strings, so the layout can be unit
 * tested and rendered to a file without a browser, a login or a clinic — which is the only way
 * anyone was ever going to check what actually comes out of the printer.
 *
 * The driving of the print dialog, and the reads that fetch the clinic header, logo and QR, live
 * in `labOrderPrint.ts` next door.
 *
 * Three decisions on this page are load-bearing rather than cosmetic:
 *
 *   - **The code is printed twice** — as large text and as a QR of the same string. Whoever
 *     receives the bag either types the number or points a phone at it, and if the paper is
 *     smudged the number is still written on the bag in marker. Three copies of one fact,
 *     because the trip to the lab and back destroys paper.
 *   - **Only the patient’s FIRST name.** The full name never leaves the clinic on a page that
 *     travels; the code carries the identity, and a human at the lab can still tell two cases
 *     apart.
 *   - **Only the fields this work type wants.** A surgical guide has no shade, and an empty
 *     “Shade: ______” line on a printed order is where a mistake hides.
 */

import {
  ABUTMENT_OPTIONS,
  FDI_LOWER,
  FDI_UPPER,
  GUIDE_TYPE_OPTIONS,
  RETENTION_OPTIONS,
  formatPalmer,
  optionLabel,
  toPalmer,
  workTypeFor,
  workTypeLabel,
  type LabCase,
  type LabOrderPaper,
} from "@/lib/labCases";

export type LabOrderClinic = {
  name: string;
  phone: string;
  address: string;
  branchName: string;
};

/**
 * A local 4-replace escaper.
 *
 * Deliberately not imported from one of the other PDF modules: each has its own variant and they
 * genuinely differ (one also escapes `'`, another does not escape `"`), so borrowing one silently
 * changes behaviour.
 */
function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}


function fmtDate(iso: string | undefined, language: "en" | "ar"): string {
  if (!iso) return "—";
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(language === "ar" ? "ar-EG" : "en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

const INK = "#14171A";
const MUTED = "#6A716F";
const RULE = "#D9DCD8";
const ACCENT = "#1F4E5F";

function labelCell(label: string, value: string): string {
  return `<td style="padding:6px 8px 6px 0;border-right:1px solid #EDEFEB;vertical-align:top;">
    <div style="font-size:6.5pt;letter-spacing:0.09em;text-transform:uppercase;color:${MUTED};margin-bottom:1px;">${esc(label)}</div>
    <div style="font-size:9pt;font-weight:600;color:${INK};">${esc(value || "—")}</div>
  </td>`;
}

function specRow(label: string, value: string): string {
  return `<tr>
    <td style="padding:2px 0;font-size:6.5pt;letter-spacing:0.09em;text-transform:uppercase;color:${MUTED};white-space:nowrap;vertical-align:top;">${esc(label)}</td>
    <td style="padding:2px 0 2px 10px;font-size:9pt;font-weight:600;color:${INK};text-align:right;border-bottom:1px dotted ${RULE};">${esc(value)}</td>
  </tr>`;
}

/**
 * The tooth chart.
 *
 * Plain table cells, not the app's `ToothSVG`: that component renders through `next/image` with
 * `fill`, needs a positioned ancestor, and is documented as unsafe in a print iframe. Numbers in
 * boxes also survive a bad photocopy, which a tooth-shaped graphic does not.
 *
 * Upper arch first and quadrant 1 leftmost, so the chart is read as if facing the patient — the
 * way every dentist reads one.
 */
function toothChartHtml(teeth: number[]): string {
  const on = new Set(teeth);

  // Palmer positions, not FDI codes: 8→1 out to the midline, then 1→8 away from it, with the
  // quadrant cross drawn through the middle. This IS the Palmer grid — the bracket on a written
  // tooth is just the corner of this cross, so a technician reads the chart and the text line as
  // one thing rather than two notations for the same mouth.
  const cell = (id: number, borders: string) => {
    const lit = on.has(id);
    const position = toPalmer(id)?.position ?? "";
    return `<td style="width:14px;height:14px;padding:0;text-align:center;vertical-align:middle;${borders}background:${lit ? ACCENT : "#FFFFFF"};color:${lit ? "#FFFFFF" : "#9AA09D"};font-size:5.5pt;font-weight:${lit ? 700 : 400};">${position}</td>`;
  };

  const MID = `border-right:2px solid ${INK};`;
  const OCCLUSAL = `border-bottom:2px solid ${INK};`;

  const row = (right: number[], left: number[], lower: boolean) =>
    `<tr>${right
      .map((id, i) => cell(id, (i === right.length - 1 ? MID : "") + (lower ? "" : OCCLUSAL)))
      .join("")}${left.map((id) => cell(id, lower ? "" : OCCLUSAL)).join("")}</tr>`;

  return `<table cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
    ${row(FDI_UPPER.slice(0, 8), FDI_UPPER.slice(8), false)}
    ${row(FDI_LOWER.slice(0, 8), FDI_LOWER.slice(8), true)}
  </table>`;
}

/** One order, laid out to fill whatever box it is given. */
function orderBodyHtml(
  labCase: LabCase,
  clinic: LabOrderClinic,
  qrDataUrl: string,
  logoHtml: string,
  language: "en" | "ar",
  compact: boolean
): string {
  const isAr = language === "ar";
  const wt = workTypeFor(labCase.workType);

  const bi = (en: string, ar: string) =>
    isAr ? `${ar} · ${en}` : en === ar ? en : `${en} · ${ar}`;

  // Only the fields this kind of work actually wants. An empty box on a lab order is where a
  // mistake hides, so a surgical guide simply has no shade row rather than a blank one.
  const specs: string[] = [];
  specs.push(specRow(bi("Work", "الشغل"), workTypeLabel(labCase.workType, "en")));
  if (wt.units && labCase.units) specs.push(specRow(bi("Units", "عدد"), String(labCase.units)));
  if (labCase.material) specs.push(specRow(bi("Material", "الخامة"), labCase.material));
  if (wt.bodyShade && labCase.bodyShade) specs.push(specRow(bi("Body shade", "لون الجسم"), labCase.bodyShade));
  if (wt.cervicalShade && labCase.cervicalShade) specs.push(specRow(bi("Cervical shade", "لون العنق"), labCase.cervicalShade));
  if (wt.gumShade && labCase.gumShade) specs.push(specRow(bi("Gum", "اللثة"), labCase.gumShade));
  if (wt.implant && labCase.implantSystem) specs.push(specRow(bi("Implant", "الزرعة"), labCase.implantSystem));
  if (wt.implant && labCase.implantPlatform) specs.push(specRow(bi("Platform", "المقاس"), labCase.implantPlatform));
  if (wt.implant && labCase.abutmentType) specs.push(specRow(bi("Abutment", "الدعامة"), optionLabel(ABUTMENT_OPTIONS, labCase.abutmentType, "en")));
  if (wt.implant && labCase.retention) specs.push(specRow(bi("Retention", "التثبيت"), optionLabel(RETENTION_OPTIONS, labCase.retention, "en")));
  if (wt.guide && labCase.guideType) specs.push(specRow(bi("Guide", "الدليل"), optionLabel(GUIDE_TYPE_OPTIONS, labCase.guideType, "en")));
  if (wt.guide && labCase.sleeveSystem) specs.push(specRow(bi("Sleeve", "الكم"), labCase.sleeveSystem));
  if (labCase.agreedPrice > 0) {
    specs.push(specRow(bi("Agreed", "المتفق عليه"), `${Math.round(labCase.agreedPrice).toLocaleString("en-US")} EGP`));
  }

  const logoImg = logoHtml || "";

  // The patient is a first name plus the code. The full name is deliberately absent.
  const patientLine = [labCase.patientFirstName || "—", labCase.code].filter(Boolean).join(" · ");

  const teethBlock = labCase.teeth.length
    ? `<div>
        <div style="font-size:6.5pt;letter-spacing:0.09em;text-transform:uppercase;color:${MUTED};margin-bottom:3px;">${esc(bi("Teeth", "الأسنان"))}</div>
        ${toothChartHtml(labCase.teeth)}
        <div style="font-size:9pt;font-weight:700;color:${INK};margin-top:4px;letter-spacing:0.06em;" dir="ltr">${esc(formatPalmer(labCase.teeth))}</div>
        <div style="font-size:6.5pt;color:${MUTED};margin-top:1px;" dir="ltr">FDI ${esc(labCase.teeth.join(", "))}</div>
      </div>`
    : `<div style="font-size:8pt;color:${MUTED};">${esc(bi("No specific teeth", "من غير أسنان محددة"))}</div>`;

  const notesBlock = labCase.notes
    ? `<div style="padding:6px 0;border-bottom:1px solid ${RULE};">
        <div style="font-size:6.5pt;letter-spacing:0.09em;text-transform:uppercase;color:${MUTED};margin-bottom:2px;">${esc(bi("Notes to the technician", "ملاحظات للفني"))}</div>
        <div style="font-size:8.5pt;color:${INK};line-height:1.35;">${esc(labCase.notes)}</div>
      </div>`
    : "";

  const remakeBanner = labCase.remakeOfId
    ? `<div style="margin-top:6px;padding:5px 8px;border:1px solid #E5B4AE;background:#FBEDEB;color:#8C2A22;font-size:8pt;font-weight:700;">
        ${esc(bi("REMAKE", "إعادة عمل"))} — ${esc(bi("replaces", "بدل"))} ${esc(labCase.remakeOfCode || "")}${labCase.remakeReason ? ` · ${esc(labCase.remakeReason)}` : ""}
      </div>`
    : "";

  /**
   * The signature strip only prints for work that physically leaves in someone's hand.
   *
   * A surgical guide and an aligner go out as files: there is nobody standing at the desk to sign
   * for them, and a signature line nobody can fill in trains people to ignore the ones that matter.
   */
  const footer =
    labCase.sentVia === "driver"
      ? `<table width="100%" cellspacing="0" cellpadding="0" style="margin-top:${compact ? 8 : 14}px;">
          <tr>
            ${["Handed over by|سلّمها", "Driver signature|توقيع المندوب", "Date &amp; time|التاريخ والوقت"]
              .map((pair) => {
                const [en, ar] = pair.split("|");
                return `<td style="width:33.33%;padding-right:14px;vertical-align:bottom;">
                  <div style="border-bottom:1px solid ${INK};height:${compact ? 16 : 22}px;"></div>
                  <div style="font-size:6.5pt;letter-spacing:0.08em;text-transform:uppercase;color:${MUTED};margin-top:3px;">${en} · ${ar}</div>
                </td>`;
              })
              .join("")}
          </tr>
        </table>`
      : `<div style="margin-top:${compact ? 8 : 14}px;padding:6px 8px;border:1px dashed ${RULE};color:${MUTED};font-size:8pt;font-weight:600;">
          ${esc(bi("Sent as digital files — nothing was handed to a driver.", "اتبعتت ملفات رقمية — مفيش حاجة اتسلمت لمندوب."))}
        </div>`;

  return `
  <div style="font-family:Tajawal,'Segoe UI',Arial,sans-serif;color:${INK};">
    <table width="100%" cellspacing="0" cellpadding="0" style="border-bottom:2px solid ${INK};padding-bottom:6px;">
      <tr>
        <td style="vertical-align:top;">
          ${logoImg}
          <div style="font-size:${compact ? 12 : 14}pt;font-weight:800;line-height:1.1;margin-top:${logoImg ? 4 : 0}px;">${esc(clinic.name || "—")}</div>
          <div style="font-size:6.5pt;letter-spacing:0.08em;text-transform:uppercase;color:${MUTED};margin-top:2px;">
            ${esc([clinic.branchName, clinic.phone].filter(Boolean).join(" · "))}
          </div>
        </td>
        <td style="vertical-align:top;text-align:right;white-space:nowrap;">
          <table cellspacing="0" cellpadding="0" style="float:right;">
            <tr>
              <td style="padding-right:8px;vertical-align:middle;">
                ${qrDataUrl ? `<img src="${esc(qrDataUrl)}" alt="" width="${compact ? 46 : 56}" height="${compact ? 46 : 56}" style="display:block;" />` : ""}
              </td>
              <td style="vertical-align:middle;text-align:left;">
                <div style="font-size:${compact ? 15 : 18}pt;font-weight:800;letter-spacing:0.02em;line-height:1;" dir="ltr">${esc(labCase.code)}</div>
                <div style="font-size:6pt;letter-spacing:0.1em;text-transform:uppercase;color:${MUTED};margin-top:3px;">${esc(bi("Lab case · keep with work", "حالة معمل · تفضل مع الشغل"))}</div>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>

    ${remakeBanner}

    <table width="100%" cellspacing="0" cellpadding="0" style="border-bottom:1px solid ${RULE};margin-top:2px;">
      <tr>
        ${labelCell(bi("Patient", "المريض"), patientLine)}
        ${labelCell(bi("Dentist", "الطبيب"), labCase.doctorName || "—")}
        ${labelCell(bi("Lab", "المعمل"), labCase.labName || "—")}
        ${labelCell(bi("Due back", "ميعاد الرجوع"), fmtDate(labCase.dueDate, language))}
      </tr>
    </table>

    <table width="100%" cellspacing="0" cellpadding="0" style="border-bottom:1px solid ${RULE};">
      <tr>
        <td style="width:52%;padding:7px 12px 7px 0;vertical-align:top;">${teethBlock}</td>
        <td style="width:48%;padding:7px 0;vertical-align:top;">
          <table width="100%" cellspacing="0" cellpadding="0">${specs.join("")}</table>
        </td>
      </tr>
    </table>

    ${notesBlock}
    ${footer}
  </div>`;
}

// ---------------------------------------------------------------------------
// The sheet
// ---------------------------------------------------------------------------

/**
 * Whether this sheet gives each order half a page or a whole one.
 *
 * Exported because the caller has to size the logo before it can hand the markup in, and a logo
 * scaled for a full page overruns the header on a half.
 */
export function isCompactPaper(paper: LabOrderPaper): boolean {
  return paper === "a4_two_up" || paper === "a5";
}

/**
 * Two-up is one A4 sheet holding two 148.5mm halves, not two `@page` rules.
 *
 * A second `@page` size does not repeat a page; it changes the sheet. The half-and-half layout is
 * the only thing that actually produces a sheet you can cut down the middle, with a dashed rule
 * printed on the fold so nobody has to guess where.
 */
export function buildLabOrderSrcDoc(
  labCase: LabCase,
  clinic: LabOrderClinic,
  qrDataUrl: string,
  logoHtml: string,
  language: "en" | "ar",
  paper: LabOrderPaper
): string {
  const isAr = language === "ar";
  const twoUp = paper === "a4_two_up";
  const pageSize = paper === "a5" ? "A5 portrait" : "A4 portrait";
  const body = orderBodyHtml(labCase, clinic, qrDataUrl, logoHtml, language, isCompactPaper(paper));

  const sheet = twoUp
    ? `<div class="half">${body}</div>
       <div class="fold"><span>${esc(isAr ? "قص هنا" : "cut here")}</span></div>
       <div class="half">${body}</div>`
    : `<div class="single">${body}</div>`;

  return `<!DOCTYPE html>
<html lang="${isAr ? "ar" : "en"}" dir="${isAr ? "rtl" : "ltr"}">
<head>
<meta charset="utf-8" />
<title>${esc(labCase.code)}</title>
<link href="https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700;800&display=swap" rel="stylesheet">
<style>
  @page { size: ${pageSize}; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #FFFFFF; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { font-family: Tajawal, 'Segoe UI', Arial, sans-serif; }
  .half { height: 148.5mm; padding: 9mm 10mm 7mm; overflow: hidden; }
  .single { min-height: ${paper === "a5" ? "210mm" : "297mm"}; padding: ${paper === "a5" ? "10mm" : "14mm"}; }
  .fold {
    position: relative; height: 0; border-top: 1px dashed #B9BEB9;
    text-align: center;
  }
  .fold span {
    position: relative; top: -6px; background: #FFFFFF; padding: 0 6px;
    font-size: 6pt; letter-spacing: 0.14em; text-transform: uppercase; color: #9AA09D;
  }
  table { border-collapse: collapse; }
  td { word-break: break-word; }
</style>
</head>
<body>${sheet}</body>
</html>`;
}
