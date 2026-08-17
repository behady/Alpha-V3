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
  toothTypeFromFDI,
  toothTypeFromPrimaryFDI,
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

function buildOdontogramHtml(
  teethData: Record<string, ToothData>,
  isPrimary: boolean,
  language: string
): string {
  const upperList = isPrimary ? [...CQ1, ...CQ2] : [...Q1, ...Q2];
  const lowerList = isPrimary ? [...CQ4, ...CQ3] : [...Q4, ...Q3];
  
  const rightLbl = language === "ar" ? "يمين" : "RIGHT";
  const leftLbl = language === "ar" ? "يسار" : "LEFT";

  const renderTooth = (fdi: number) => {
    const type = isPrimary ? toothTypeFromPrimaryFDI(fdi) : toothTypeFromFDI(fdi);
    const isUpper = isUpperFDI(fdi);
    const statuses = getStatusesFromTooth(teethData[String(fdi)]);
    const missing = isMissingStatus(statuses);
    
    let hasCrown = false;
    statuses.forEach(s => {
      const opt = findOption(s);
      if (opt?.cat === "restoration" && (s === "rest_crown" || s === "rest_implant")) {
         hasCrown = true;
      }
    });
    
    let baseSrc = `/teeth/${type}.png`;
    if (hasCrown) {
      baseSrc = `/teeth/crown_${type}.png`;
    }

    const q = Math.floor(fdi / 10);
    const scaleX = (q === 2 || q === 3 || q === 6 || q === 7) ? -1 : 1;
    const scaleY = (q === 3 || q === 4 || q === 7 || q === 8) ? -1 : 1;

    const surfaces = teethData[String(fdi)]?.surfaces || {};
    let surfaceHtml = "";
    
    if (!missing && Object.keys(surfaces).length > 0) {
      const surfaceColors: Record<string, string> = {};
      const activeS: string[] = [];
      Object.entries(surfaces).forEach(([surf, sids]) => {
         if (sids.length > 0) {
           activeS.push(surf);
           const cat = findOption(sids[0])?.cat;
           const cObj = findCategory(cat || "");
           if (cObj) surfaceColors[surf] = cObj.color;
         }
      });
      
      let paths = "";
      if (activeS.includes("O") && surfaceColors["O"]) {
         paths += `<path d="${isUpper ? 'M 50 50 L 50 10' : 'M 50 50 L 50 90'}" stroke="${surfaceColors['O']}" stroke-width="8" stroke-linecap="round" fill="none" />`;
      }
      if (activeS.includes("B") && surfaceColors["B"]) {
         paths += `<path d="${isUpper ? 'M 20 50 C 20 80, 80 80, 80 50 Z' : 'M 20 50 C 20 20, 80 20, 80 50 Z'}" fill="${surfaceColors['B']}" opacity="0.7" />`;
      }
      if (paths) {
         surfaceHtml = `<svg viewBox="0 0 100 100" style="position:absolute;inset:0;width:100%;height:100%;z-index:20;opacity:0.8;mix-blend-mode:multiply;">${paths}</svg>`;
      }
    }

    return `
      <div style="display:flex;flex-direction:column;align-items:center;width:40px;">
        <div style="position:relative;width:34px;height:60px;display:flex;align-items:center;justify-content:center;opacity:${missing ? 0.2 : 1};">
           <img src="${baseSrc}" style="position:absolute;width:100%;height:100%;object-fit:contain;transform:scale(${scaleX}, ${scaleY});" />
           ${surfaceHtml}
        </div>
        <div style="font-size:11px;font-weight:bold;color:#64748b;margin-top:4px;">${fdi}</div>
      </div>
    `;
  };

  const renderRow = (list: number[]) => {
    const half = list.length / 2;
    const left = list.slice(0, half);
    const right = list.slice(half);
    return `
      <div style="display:flex;justify-content:center;gap:4px;width:100%;">
        <div style="display:flex;gap:4px;">
           ${left.map(fdi => renderTooth(fdi)).join("")}
        </div>
        <div style="width:24px;"></div>
        <div style="display:flex;gap:4px;">
           ${right.map(fdi => renderTooth(fdi)).join("")}
        </div>
      </div>
    `;
  };

  return `
    <div style="border:1px solid #e2e8f0;border-radius:12px;padding:24px;background:#ffffff;position:relative;">
      <div style="display:flex;justify-content:space-between;color:#94a3b8;font-size:10px;font-weight:bold;margin-bottom:16px;">
        <span>${rightLbl}</span>
        <span>${leftLbl}</span>
      </div>
      <div style="display:flex;flex-direction:column;gap:32px;">
        ${renderRow(upperList)}
        <div style="border-top:1px dashed #cbd5e1;width:100%;"></div>
        ${renderRow(lowerList)}
      </div>
    </div>
  `;
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

  const odontogramHtml = buildOdontogramHtml(teethData, isPrimary, language);

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

      const byCat = new Map<string, any[]>();
      statuses.forEach(sid => {
        const opt = findOption(sid);
        if (!opt) return;
        const arr = byCat.get(opt.cat) || [];
        arr.push(opt);
        byCat.set(opt.cat, arr);
      });
      let findings = Array.from(byCat.entries())
        .map(([catId, opts]) => {
          const plain = CATEGORY_PLAIN[catId];
          const head = plain ? (isAr ? plain.ar : plain.en) : findCategory(catId)?.labelEn || catId;
          const itemsHtml = opts.map((opt: any) => {
            const label = isAr ? opt.labelAr : opt.labelEn;
            let res = `<div style="margin-top: 4px;">&bull; <strong>${esc(label)}</strong></div>`;
            
            const desc = isAr ? opt.descAr : opt.descEn;
            if (desc) {
              res += `<div style="font-size: 10px; color: #64748b; margin-left: ${isAr ? '0' : '10px'}; margin-right: ${isAr ? '10px' : '0'}; line-height: 1.3;">${esc(desc)}</div>`;
            }
            
            const tx = isAr ? opt.treatmentsAr : opt.treatmentsEn;
            if (tx && tx.length > 0) {
              res += `<div style="font-size: 10px; color: #475569; margin-left: ${isAr ? '0' : '10px'}; margin-right: ${isAr ? '10px' : '0'}; margin-top: 2px;">
                        <span style="background: #f1f5f9; padding: 1px 4px; border-radius: 3px; font-weight: bold;">
                          ${isAr ? "العلاج المقترح:" : "Suggested Tx:"}
                        </span> ${esc(tx.join(" | "))}
                      </div>`;
            }
            return res;
          }).join("");
          return `<div style="margin-bottom: 6px;"><strong>[${esc(head)}]</strong>${itemsHtml}</div>`;
        })
        .join("");

      // Append Perio data if exists
      if (data?.perio) {
        const b = data.perio.buccal;
        const l = data.perio.lingual;
        if (b || l) {
          findings += `<div style="margin-top: 8px; font-size: 10px; color: #475569; background: #f8fafc; padding: 6px; border-radius: 4px; border: 1px solid #e2e8f0;">
            <strong style="color: #334155;">${isAr ? "قياسات اللثة (GM/PD)" : "Periodontal Probing (GM/PD)"}</strong><br/>
            ${b ? `<div style="margin-top: 2px;">${isAr ? "الشدقي (Buccal)" : "Buccal"} &rarr; GM: [${b.gm.join(", ")}] | PD: [${b.pd.join(", ")}]</div>` : ""}
            ${l ? `<div style="margin-top: 2px;">${isAr ? "اللساني (Lingual)" : "Lingual"} &rarr; GM: [${l.gm.join(", ")}] | PD: [${l.pd.join(", ")}]</div>` : ""}
          </div>`;
        }
      }

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
      <div style="margin-bottom:16px;">
        ${odontogramHtml}
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
        <table style="width:100%;border-collapse:collapse;margin-bottom:30px;font-size:12px;box-shadow: 0 1px 3px rgba(0,0,0,0.05);border-radius:8px;overflow:hidden;">
          <thead>
            <tr>
              <th style="border-bottom:2px solid #e2e8f0;padding:12px;text-align:center;background:#f8fafc;color:#475569;font-weight:800;width:40px;">${isAr ? "السن" : "Tooth"}</th>
              <th style="border-bottom:2px solid #e2e8f0;padding:12px;text-align:${isAr ? "right" : "left"};background:#f8fafc;color:#475569;font-weight:800;width:100px;">${isAr ? "المنطقة" : "Area"}</th>
              <th style="border-bottom:2px solid #e2e8f0;padding:12px;text-align:${isAr ? "right" : "left"};background:#f8fafc;color:#475569;font-weight:800;">${isAr ? "التشخيص" : "Findings"}</th>
              <th style="border-bottom:2px solid #e2e8f0;padding:12px;text-align:${isAr ? "right" : "left"};background:#f8fafc;color:#475569;font-weight:800;width:25%;">${isAr ? "ملاحظات" : "Notes"}</th>
            </tr>
          </thead>
          <tbody>
            ${rows.join('')}
          </tbody>
        </table>
      ` : `
        <p style="color: #94a3b8; font-style: italic;">${isAr ? "لا توجد تشخيصات مسجلة." : "No diagnoses recorded."}</p>
      `}
    </div>
  `;

  try {
    // Dynamic import to avoid SSR issues
    const { htmlToPdfBlob, buildReportHtmlBase } = await import("@/components/reports/reportPdfHtmlUtils");
    
    // Wrap the raw inner HTML with our styled template base (includes Tajawal font)
    const fullHtml = buildReportHtmlBase(isAr ? "تقرير التشخيص السني" : "Dental Diagnosis Report", language, html);
    
    const blob = await htmlToPdfBlob(fullHtml, "diagnosis-container");

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
    // Rethrown rather than alerted: this is a library, so it has no toast of its own, and
    // swallowing the failure here meant the caller's own error handler never ran — the user got
    // a raw browser alert instead of the app's message.
    throw e;
  }
}
