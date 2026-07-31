import {
  DIAGNOSIS_CATEGORIES,
  findCategory,
  findOption,
  getStatusesFromTooth,
  getStatusZone,
  isMissingStatus,
  getPrimaryCategoryForStatuses,
  type ToothData,
} from "@/lib/diagnosisCatalog";
import {
  occlusalShapeFor,
  toothTypeFromFDI,
  toothTypeFromPrimaryFDI,
  TOOTH_BODY,
  TOOTH_STROKE,
} from "@/components/teeth/ToothSVG";

function isUpperFDI(fdi: number): boolean {
  const q = Math.floor(fdi / 10);
  return q === 1 || q === 2 || q === 5 || q === 6;
}

const Q1 = [18, 17, 16, 15, 14, 13, 12, 11];
const Q2 = [21, 22, 23, 24, 25, 26, 27, 28];
const Q4 = [48, 47, 46, 45, 44, 43, 42, 41];
const Q3 = [31, 32, 33, 34, 35, 36, 37, 38];
const CQ1 = [55, 54, 53, 52, 51];
const CQ2 = [61, 62, 63, 64, 65];
const CQ4 = [85, 84, 83, 82, 81];
const CQ3 = [71, 72, 73, 74, 75];

const CATEGORY_PLAIN: Record<string, { en: string; ar: string }> = {
  caries: { en: "Tooth decay (cavity)", ar: "تسوس (تجويف)" },
  pulp: { en: "Nerve inside the tooth", ar: "عصب داخل السن" },
  periapical: { en: "Infection around the root tip", ar: "التهاب حول طرف الجذر" },
  sensitivity: { en: "Sensitive tooth", ar: "حساسية" },
  wear: { en: "Worn tooth surface", ar: "تآكل سطح السن" },
  trauma: { en: "Injury / fracture", ar: "إصابة / كسر" },
  perio: { en: "Gum & bone support", ar: "اللثة والعظم الداعم" },
  development: { en: "Growth / eruption", ar: "النمو والبزوغ" },
  restoration: { en: "Existing filling / crown", ar: "حشوة / تركيبة سابقة" },
  surgery: { en: "Missing / removed tooth", ar: "سن مفقود / مخلوع" },
};

const esc = (s: string) => (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function toothMarkup(
  fdi: number,
  isPrimary: boolean,
  statuses: string[],
  x: number,
  rowTop: number,
  s: number,
  toothW: number
): { defs: string; body: string } {
  const type = isPrimary ? toothTypeFromPrimaryFDI(fdi) : toothTypeFromFDI(fdi);
  const upper = isUpperFDI(fdi);
  const missing = isMissingStatus(statuses);
  const primaryCat = getPrimaryCategoryForStatuses(statuses);
  
  const accent = primaryCat?.color ?? TOOTH_STROKE;
  const fillAccent = primaryCat ? `${primaryCat.color}40` : TOOTH_BODY;

  const { paths } = occlusalShapeFor(type);

  const q = Math.floor(fdi / 10);
  const scaleX = (q === 2 || q === 3 || q === 6 || q === 7) ? -1 : 1;
  const scaleY = (q === 3 || q === 4 || q === 7 || q === 8) ? -1 : 1;

  let inner = "";
  if (missing) {
    inner = paths.map((p) => `<path d="${p.d}" fill="transparent" stroke="#cbd5e1" stroke-width="1" stroke-dasharray="4 4" />`).join("") +
            `<line x1="10" y1="10" x2="90" y2="90" stroke="#94a3b8" stroke-width="3" />
             <line x1="90" y1="10" x2="10" y2="90" stroke="#94a3b8" stroke-width="3" />`;
  } else {
    inner = paths.map((p) => `<path d="${p.d}" fill="${primaryCat ? fillAccent : TOOTH_BODY}" stroke="${accent}" stroke-width="2" stroke-linejoin="round"/>`).join("");
  }

  const body = `
    <g transform="translate(${x}, ${rowTop}) scale(${s})">
      <g transform="translate(50, 50) scale(${scaleX}, ${scaleY}) translate(-50, -50)">
        ${inner}
      </g>
    </g>`;
  
  const numY = rowTop + 100 * s + 11;
  const numX = x + (toothW / 2);
  const numberLabel = `<text x="${numX}" y="${numY}" font-family="system-ui, -apple-system, sans-serif" font-size="9" font-weight="700" fill="#64748b" text-anchor="middle">${fdi}</text>`;

  return { defs: "", body: body + numberLabel };
}

function buildOdontogramSvg(
  teethData: Record<string, ToothData>,
  isPrimary: boolean,
  language: string
): { svg: string; width: number; height: number } {
  const upperList = isPrimary ? [...CQ1, ...CQ2] : [...Q1, ...Q2];
  const lowerList = isPrimary ? [...CQ4, ...CQ3] : [...Q4, ...Q3];
  const half = upperList.length / 2;

  const toothW = 44;
  const cellW = 50;
  const s = toothW / 100;
  const spacer = 16;
  const marginX = 24;
  const width = marginX * 2 + upperList.length * cellW + spacer;

  const labelH = 26;
  const rowTooth = 100 * s; 
  const numH = 16;
  const rowGap = 26;
  const upperTop = labelH;
  const lowerTop = upperTop + rowTooth + numH + rowGap;
  const height = lowerTop + rowTooth + numH + 8;

  const defsArr: string[] = [];
  const bodyArr: string[] = [];

  const place = (list: number[], rowTop: number) => {
    list.forEach((fdi, i) => {
      const x = marginX + i * cellW + (i >= half ? spacer : 0);
      const statuses = getStatusesFromTooth(teethData[String(fdi)]);
      const { defs, body } = toothMarkup(fdi, isPrimary, statuses, x, rowTop, s, toothW);
      defsArr.push(defs);
      bodyArr.push(body);
    });
  };
  place(upperList, upperTop);
  place(lowerList, lowerTop);

  const midY = upperTop + rowTooth + numH + rowGap / 2;
  const rightLbl = language === "ar" ? "يمين" : "RIGHT";
  const leftLbl = language === "ar" ? "يسار" : "LEFT";

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100%" viewBox="0 0 ${width} ${height}" style="max-width: ${width}px;">
    <rect x="0" y="0" width="${width}" height="${height}" fill="#ffffff"/>
    <defs>${defsArr.join("")}</defs>
    <text x="${marginX}" y="16" font-family="system-ui, -apple-system, sans-serif" font-size="10" font-weight="700" fill="#94a3b8" text-anchor="start">${rightLbl}</text>
    <text x="${width - marginX}" y="16" font-family="system-ui, -apple-system, sans-serif" font-size="10" font-weight="700" fill="#94a3b8" text-anchor="end">${leftLbl}</text>
    <line x1="${marginX}" y1="${midY}" x2="${width - marginX}" y2="${midY}" stroke="#e2e8f0" stroke-width="1" stroke-dasharray="4 4"/>
    ${bodyArr.join("")}
  </svg>`;

  return { svg, width, height };
}

export interface DiagnosisReportInput {
  patient: { name?: string; phone?: string; id?: string };
  teethData: Record<string, ToothData>;
  isPrimary: boolean;
  language: string;
  clinicName?: string;
}

export async function generateDiagnosisReport(input: DiagnosisReportInput): Promise<void> {
  const { patient, teethData, isPrimary, language, clinicName } = input;
  const isAr = language === "ar";
  const dir = isAr ? "rtl" : "ltr";

  const { svg } = buildOdontogramSvg(teethData, isPrimary, language);

  const presentCats = DIAGNOSIS_CATEGORIES.filter(c => c.id !== "healthy").filter(cat =>
    Object.values(teethData).some(d =>
      getStatusesFromTooth(d).some(s => findOption(s)?.cat === cat.id && s !== "healthy")
    )
  );

  const rows: string[] = [];
  Object.keys(teethData)
    .map(k => Number(k))
    .filter(n => !Number.isNaN(n))
    .sort((a, b) => a - b)
    .forEach(fdi => {
      const data = teethData[String(fdi)];
      const statuses = getStatusesFromTooth(data).filter(s => s && s !== "healthy");
      if (statuses.length === 0 && !data?.notes) return;

      const zones = new Set(statuses.map(getStatusZone));
      let area = "";
      const hasCrown = zones.has("crown") || zones.has("both");
      const hasRoot = zones.has("root") || zones.has("both");
      if (hasCrown && hasRoot) area = isAr ? "التاج والجذر" : "Crown & root";
      else if (hasRoot) area = isAr ? "الجذر / الداخل" : "Root / inside";
      else if (hasCrown) area = isAr ? "السطح / التاج" : "Surface / crown";

      const byCat = new Map<string, string[]>();
      statuses.forEach(sid => {
        const opt = findOption(sid);
        if (!opt) return;
        const label = isAr ? opt.labelAr : opt.labelEn;
        const arr = byCat.get(opt.cat) || [];
        arr.push(label);
        byCat.set(opt.cat, arr);
      });
      const findings = Array.from(byCat.entries())
        .map(([catId, labels]) => {
          const plain = CATEGORY_PLAIN[catId];
          const head = plain ? (isAr ? plain.ar : plain.en) : findCategory(catId)?.labelEn || catId;
          return `<strong>${esc(head)}:</strong> ${esc(labels.join(", "))}`;
        })
        .join("<br>");

      rows.push(`
        <tr>
          <td style="text-align: center; font-weight: bold;">${fdi}</td>
          <td>${esc(area)}</td>
          <td>${findings}</td>
          <td>${esc((data?.notes || "").trim())}</td>
        </tr>
      `);
    });

  const html = `
    <div id="diagnosis-container" style="box-sizing:border-box;max-width:190mm;margin:0 auto;color:#0f172a;padding:10mm 15mm;font-family:system-ui,-apple-system,sans-serif;font-size:12px;line-height:1.5;">
      <div style="background:#0f172a;color:white;padding:16px;border-radius:12px;margin-bottom:24px;display:flex;justify-content:space-between;align-items:center;">
        <div>
          <h1 style="margin:0;font-size:18px;text-transform:uppercase;letter-spacing:1px;">${esc(clinicName || "ALPHA DENTAL")}</h1>
          <p style="margin:4px 0 0;font-size:12px;opacity:0.9;">${isAr ? "تقرير التشخيص السني" : "Dental Diagnosis Report"}</p>
        </div>
        <div style="text-align:${isAr ? "left" : "right"};font-size:11px;color:#cbd5e1;">
          <div style="margin-bottom:4px;">${new Date().toLocaleDateString("en-GB")}</div>
          <div>${isPrimary ? (isAr ? "أسنان لبنية" : "Primary dentition") : (isAr ? "أسنان دائمة" : "Adult dentition")}</div>
        </div>
      </div>
      
      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:12px 16px;margin-bottom:24px;">
        <h2 style="margin:0 0 4px;font-size:14px;color:#0f172a;">${esc(patient.name || "—")}</h2>
        <p style="margin:0;font-size:11px;color:#64748b;">${isAr ? "هاتف" : "Phone"}: ${esc(patient.phone || "—")}</p>
      </div>

      <h3 style="font-size:14px;font-weight:800;color:#334155;margin:0 0 10px;border-bottom:2px solid #e2e8f0;padding-bottom:6px;">${isAr ? "خريطة الأسنان" : "Tooth map"}</h3>
      <div style="margin-bottom:16px;text-align:center;background:white;padding:16px;border:1px solid #e2e8f0;border-radius:12px;">
        ${svg}
      </div>

      ${presentCats.length ? `
        <div style="display:flex;flex-wrap:wrap;gap:12px;margin-bottom:24px;padding:12px;background:#f8fafc;border-radius:12px;">
          ${presentCats.map(cat => `
            <div style="display:flex;align-items:center;gap:6px;font-size:11px;color:#475569;font-weight:600;">
              <div style="width:10px;height:10px;border-radius:50%;background:${cat.color};"></div>
              <span>${esc((isAr ? cat.labelAr : cat.labelEn) || cat.id)}</span>
            </div>
          `).join('')}
        </div>
      ` : ''}

      <h3 style="font-size:14px;font-weight:800;color:#334155;margin:0 0 10px;border-bottom:2px solid #e2e8f0;padding-bottom:6px;">${isAr ? "ملخص التشخيصات" : "Findings summary"}</h3>
      ${rows.length > 0 ? `
        <table style="width:100%;border-collapse:collapse;margin-bottom:30px;font-size:11px;">
          <thead>
            <tr>
              <th style="border:1px solid #e2e8f0;padding:10px;text-align:${isAr ? "right" : "left"};background:#0f172a;color:white;font-weight:bold;width:40px;text-align:center;">${isAr ? "السن" : "Tooth"}</th>
              <th style="border:1px solid #e2e8f0;padding:10px;text-align:${isAr ? "right" : "left"};background:#0f172a;color:white;font-weight:bold;width:100px;">${isAr ? "المنطقة" : "Area"}</th>
              <th style="border:1px solid #e2e8f0;padding:10px;text-align:${isAr ? "right" : "left"};background:#0f172a;color:white;font-weight:bold;">${isAr ? "التشخيص" : "Findings"}</th>
              <th style="border:1px solid #e2e8f0;padding:10px;text-align:${isAr ? "right" : "left"};background:#0f172a;color:white;font-weight:bold;width:25%;">${isAr ? "ملاحظات" : "Notes"}</th>
            </tr>
          </thead>
          <tbody>
            ${rows.join('')}
          </tbody>
        </table>
      ` : `
        <p style="color: #94a3b8; font-style: italic;">${isAr ? "لا توجد تشخيصات مسجلة." : "No diagnoses recorded."}</p>
      `}

      <div style="text-align:center;font-size:10px;color:#94a3b8;margin-top:40px;border-top:1px solid #e2e8f0;padding-top:16px;">
        ${isAr ? "هذا التقرير هو ملخص سريري ولا يغني عن استشارة طبيب الأسنان الخاص بك." : "This report is a clinical summary and does not replace a consultation with your dentist."}
      </div>
    </div>
  `;

  try {
    // Dynamic import to avoid SSR issues
    const { htmlToPdfBlob } = await import("@/components/reports/reportPdfHtmlUtils");
    const blob = await htmlToPdfBlob(html, "diagnosis-container");

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const safeName = (patient.name || "patient").replace(/[^wu0600-u06FF -]/g, "").trim() || "patient";
    a.download = `Diagnosis_${safeName}_${new Date().toISOString().slice(0, 10)}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (e) {
    console.error("Diagnosis PDF Generation failed:", e);
    alert(isAr ? "فشل إنشاء ملف PDF" : "Failed to generate PDF");
  }
}
