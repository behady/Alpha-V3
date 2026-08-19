export type TreatmentPlanPdfStep = {
  serviceName: string;
  teeth: string;
  quantity: number;
  unitPrice: number;
  note?: string;
};

export type TreatmentPlanPdfVisit = {
  /** e.g. "Visit 1 — Pain relief". Empty on legacy single-visit plans → header is skipped. */
  label: string;
  /** Formatted appointment date, or "" when not scheduled yet. */
  dateLabel: string;
  time?: string;
  steps: TreatmentPlanPdfStep[];
};

export type TreatmentPlanPdfPayload = {
  clinicName: string;
  rxHeader: string;
  address: string;
  phone: string;
  dateLabel: string;
  patientName: string;
  ageSex: string;
  doctor: string;
  planTitle: string;
  planDescription: string;
  visits: TreatmentPlanPdfVisit[];
  total: number;
  currency: string;
  language: "en" | "ar";
};

function esc(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function money(n: number): string {
  const v = Number(n) || 0;
  return v.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

/** Inline icon as img — html2canvas aligns these with text better than raw SVG. */
function contactIconImg(svgBody: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#64748b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${svgBody}</svg>`;
  const uri = `data:image/svg+xml,${encodeURIComponent(svg)}`;
  return `<img src="${uri}" width="12" height="12" alt="" style="display:inline-block;vertical-align:middle;margin:0 6px;border:0;flex-shrink:0;" />`;
}

function contactLine(iconSvgBody: string, text: string, marginBottom = "8px"): string {
  const label = esc(text);
  return `<p style="margin:0 0 ${marginBottom} 0;padding:0;font-size:12px;font-weight:600;color:#64748b;line-height:18px;">
    ${contactIconImg(iconSvgBody)}<span style="display:inline;vertical-align:middle;line-height:18px;">${label}</span>
  </p>`;
}

const ICON_PIN = '<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>';
const ICON_PHONE =
  '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>';
const ICON_CALENDAR =
  '<rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>';

function visitStepsSum(visit: TreatmentPlanPdfVisit): number {
  return visit.steps.reduce((sum, s) => sum + (Number(s.unitPrice) || 0) * (Number(s.quantity) || 1), 0);
}

/** Full HTML document: no external CSS, no Tailwind — only inline styles (html2canvas-safe). */
export function buildTreatmentPlanSrcDoc(p: TreatmentPlanPdfPayload): string {
  const ar = p.language === "ar";
  const dir = ar ? "rtl" : "ltr";
  const L = {
    docTitle: ar ? "خطة العلاج" : "Treatment Plan",
    date: ar ? "التاريخ" : "Date",
    patientName: ar ? "اسم المريض" : "Patient Name",
    ageSex: ar ? "السن / النوع" : "Age / Sex",
    doctor: ar ? "الطبيب" : "Doctor",
    step: "#",
    procedure: ar ? "الإجراء" : "Procedure",
    teeth: ar ? "الأسنان" : "Tooth / Teeth",
    qty: ar ? "العدد" : "Qty",
    unitPrice: ar ? "سعر الوحدة" : "Unit Price",
    lineTotal: ar ? "الإجمالي" : "Total",
    visitSubtotal: ar ? "إجمالي الزيارة" : "Visit subtotal",
    grandTotal: ar ? "الإجمالي الكلي" : "Grand Total",
    suggestedDate: ar ? "الموعد المقترح" : "Suggested date",
    notScheduled: ar ? "يُحدد لاحقاً" : "To be scheduled",
    signature: ar ? "توقيع الطبيب" : "Doctor's Signature",
    disclaimer: ar
      ? "هذه خطة علاج مقترحة. الأسعار تقديرية وقد تتغير حسب الفحص السريري، ومواعيد الزيارات مقترحة وتتأكد مع العيادة."
      : "This is a proposed treatment plan. Prices are estimates and may change according to clinical findings; visit dates are suggestions to be confirmed with the clinic.",
  };

  const descriptionBlock = p.planDescription.trim()
    ? `<p style="margin:0 0 20px 0;font-size:13px;font-weight:600;color:#475569;line-height:1.7;white-space:pre-wrap;">${esc(p.planDescription)}</p>`
    : "";

  const multiVisit = p.visits.length > 1;

  const tableHead = `<thead>
    <tr>
      <th style="padding:8px;border-bottom:2px solid #0f172a;font-size:9px;font-weight:900;color:#64748b;text-transform:uppercase;letter-spacing:0.05em;text-align:${ar ? "right" : "left"};width:28px;">${L.step}</th>
      <th style="padding:8px;border-bottom:2px solid #0f172a;font-size:9px;font-weight:900;color:#64748b;text-transform:uppercase;letter-spacing:0.05em;text-align:${ar ? "right" : "left"};">${L.procedure}</th>
      <th style="padding:8px;border-bottom:2px solid #0f172a;font-size:9px;font-weight:900;color:#64748b;text-transform:uppercase;letter-spacing:0.05em;text-align:${ar ? "right" : "left"};">${L.teeth}</th>
      <th style="padding:8px;border-bottom:2px solid #0f172a;font-size:9px;font-weight:900;color:#64748b;text-transform:uppercase;letter-spacing:0.05em;text-align:center;">${L.qty}</th>
      <th style="padding:8px;border-bottom:2px solid #0f172a;font-size:9px;font-weight:900;color:#64748b;text-transform:uppercase;letter-spacing:0.05em;text-align:${ar ? "left" : "right"};">${L.unitPrice} (${esc(p.currency)})</th>
      <th style="padding:8px;border-bottom:2px solid #0f172a;font-size:9px;font-weight:900;color:#64748b;text-transform:uppercase;letter-spacing:0.05em;text-align:${ar ? "left" : "right"};">${L.lineTotal} (${esc(p.currency)})</th>
    </tr>
  </thead>`;

  const stepRow = (s: TreatmentPlanPdfStep, i: number) => {
    const noteLine = s.note?.trim()
      ? `<div style="margin-top:3px;font-size:10.5px;font-weight:600;color:#64748b;line-height:1.5;">${esc(s.note)}</div>`
      : "";
    const lineTotal = (Number(s.unitPrice) || 0) * (Number(s.quantity) || 1);
    return `<tr style="page-break-inside:avoid;">
      <td style="padding:9px 8px;border-bottom:1px solid #e2e8f0;font-size:12px;font-weight:800;color:#94a3b8;vertical-align:top;">${i + 1}</td>
      <td style="padding:9px 8px;border-bottom:1px solid #e2e8f0;font-size:13px;font-weight:800;color:#0f172a;vertical-align:top;">${esc(s.serviceName)}${noteLine}</td>
      <td style="padding:9px 8px;border-bottom:1px solid #e2e8f0;font-size:12px;font-weight:700;color:#334155;vertical-align:top;white-space:nowrap;">${esc(s.teeth || "—")}</td>
      <td style="padding:9px 8px;border-bottom:1px solid #e2e8f0;font-size:12px;font-weight:700;color:#334155;text-align:center;vertical-align:top;">${Number(s.quantity) || 1}</td>
      <td style="padding:9px 8px;border-bottom:1px solid #e2e8f0;font-size:12px;font-weight:700;color:#334155;text-align:${ar ? "left" : "right"};vertical-align:top;white-space:nowrap;">${money(s.unitPrice)}</td>
      <td style="padding:9px 8px;border-bottom:1px solid #e2e8f0;font-size:13px;font-weight:900;color:#0f172a;text-align:${ar ? "left" : "right"};vertical-align:top;white-space:nowrap;">${money(lineTotal)}</td>
    </tr>`;
  };

  const visitsHtml = p.visits
    .map((visit) => {
      const hasHeader = multiVisit || visit.label.trim() !== "" || visit.dateLabel.trim() !== "";
      const dateText = visit.dateLabel.trim()
        ? `${visit.dateLabel}${visit.time ? ` · ${visit.time}` : ""}`
        : L.notScheduled;
      const header = hasHeader
        ? `<div style="display:flex;justify-content:space-between;align-items:center;gap:12px;background:#f1f5f9;border:1px solid #e2e8f0;border-radius:10px;padding:9px 14px;margin:0 0 8px 0;page-break-inside:avoid;">
            <span style="font-size:13px;font-weight:900;color:#0f172a;">${esc(visit.label)}</span>
            <span style="font-size:11px;font-weight:800;color:#475569;white-space:nowrap;">${contactIconImg(ICON_CALENDAR)}${L.suggestedDate}: ${esc(dateText)}</span>
          </div>`
        : "";
      const subtotalRow = multiVisit
        ? `<tr>
            <td colspan="5" style="padding:7px 8px;font-size:9px;font-weight:900;color:#94a3b8;text-transform:uppercase;letter-spacing:0.05em;text-align:${ar ? "left" : "right"};">${L.visitSubtotal}</td>
            <td style="padding:7px 8px;font-size:12px;font-weight:900;color:#334155;text-align:${ar ? "left" : "right"};white-space:nowrap;">${money(visitStepsSum(visit))} ${esc(p.currency)}</td>
          </tr>`
        : "";
      return `<div style="margin-bottom:16px;">
        ${header}
        <table style="width:100%;border-collapse:collapse;">
          ${tableHead}
          <tbody>
            ${visit.steps.map(stepRow).join("")}
            ${subtotalRow}
          </tbody>
        </table>
      </div>`;
    })
    .join("");

  const bodyInner = `
<div id="treatment-plan-pdf-source" dir="${dir}" style="box-sizing:border-box;width:210mm;min-height:297mm;margin:0 auto;padding:15mm;background:#ffffff;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:#0f172a;display:flex;flex-direction:column;">

  <div style="border-bottom:2px solid #0f172a;padding-bottom:20px;margin-bottom:20px;page-break-inside:avoid;">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;">
      <div style="width:64%;">
        <h2 style="margin:0 0 8px 0;font-size:24px;font-weight:900;text-transform:uppercase;letter-spacing:-0.02em;color:#0f172a;">${esc(p.clinicName)}</h2>
        <p style="margin:0;font-size:12px;font-weight:700;color:#475569;white-space:pre-wrap;line-height:1.5;">${esc(p.rxHeader)}</p>
      </div>
      <div style="width:34%;text-align:${ar ? "left" : "right"};">
        <p style="margin:0 0 4px 0;font-size:11px;font-weight:900;color:#27ae60;text-transform:uppercase;letter-spacing:0.08em;">${L.docTitle}</p>
        <p style="margin:0 0 2px 0;font-size:10px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.05em;">${L.date}</p>
        <p style="margin:0;font-size:14px;font-weight:900;color:#0f172a;">${esc(p.dateLabel)}</p>
      </div>
    </div>
  </div>

  <div style="background:#f8fafc;padding:14px 16px;border-radius:12px;margin-bottom:20px;display:flex;flex-wrap:wrap;justify-content:space-between;gap:12px;border:1px solid #f1f5f9;page-break-inside:avoid;">
    <div>
      <p style="margin:0 0 2px 0;font-size:9px;font-weight:900;color:#94a3b8;text-transform:uppercase;letter-spacing:0.05em;">${L.patientName}</p>
      <p style="margin:0;font-size:14px;font-weight:900;color:#0f172a;">${esc(p.patientName)}</p>
    </div>
    <div>
      <p style="margin:0 0 2px 0;font-size:9px;font-weight:900;color:#94a3b8;text-transform:uppercase;letter-spacing:0.05em;">${L.ageSex}</p>
      <p style="margin:0;font-size:14px;font-weight:700;color:#334155;">${esc(p.ageSex)}</p>
    </div>
    <div>
      <p style="margin:0 0 2px 0;font-size:9px;font-weight:900;color:#94a3b8;text-transform:uppercase;letter-spacing:0.05em;">${L.doctor}</p>
      <p style="margin:0;font-size:14px;font-weight:700;color:#334155;">${esc(p.doctor || "—")}</p>
    </div>
  </div>

  <h3 style="margin:0 0 8px 0;font-size:18px;font-weight:900;color:#0f172a;">${esc(p.planTitle)}</h3>
  ${descriptionBlock}

  ${visitsHtml}

  <div style="display:flex;justify-content:flex-end;margin-bottom:20px;page-break-inside:avoid;">
    <div style="background:#0f172a;color:#ffffff;border-radius:12px;padding:12px 20px;display:flex;align-items:center;gap:16px;">
      <span style="font-size:10px;font-weight:900;text-transform:uppercase;letter-spacing:0.08em;color:#94a3b8;">${L.grandTotal}</span>
      <span style="font-size:20px;font-weight:900;">${money(p.total)} ${esc(p.currency)}</span>
    </div>
  </div>

  <p style="margin:0 0 24px 0;font-size:10px;font-weight:600;color:#94a3b8;line-height:1.6;">${L.disclaimer}</p>

  <div style="margin-top:auto;padding-top:20px;border-top:1px solid #e2e8f0;display:flex;justify-content:space-between;align-items:flex-end;page-break-inside:avoid;">
    <div style="max-width:58%;">
      ${contactLine(ICON_PIN, p.address, "8px")}
      ${contactLine(ICON_PHONE, p.phone, "0")}
    </div>
    <div style="text-align:center;width:192px;">
      <div style="border-bottom:2px dashed #cbd5e1;height:32px;margin-bottom:8px;"></div>
      <p style="margin:0;font-size:10px;font-weight:900;color:#94a3b8;text-transform:uppercase;letter-spacing:0.05em;">${L.signature}</p>
      <p style="margin:8px 0 0 0;font-size:14px;font-weight:900;color:#0f172a;">${esc(p.doctor)}</p>
    </div>
  </div>
</div>`;

  return `<!DOCTYPE html><html dir="${dir}"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><style>@page{size:A4;margin:0;} @media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact;}}</style></head><body style="margin:0;background:#ffffff;">${bodyInner}</body></html>`;
}

async function treatmentPlanElementToPdfBlob(element: HTMLElement): Promise<Blob> {
  const html2pdfMod = await import("html2pdf.js");
  const html2pdf = html2pdfMod.default ?? html2pdfMod;
  const opt = {
    // The source template is already sized to full A4; non-zero jsPDF margins would crop it.
    margin: [0, 0, 0, 0] as [number, number, number, number],
    filename: "treatment-plan.pdf",
    image: { type: "jpeg" as const, quality: 0.95 },
    html2canvas: { scale: 2, useCORS: true },
    jsPDF: { unit: "mm" as const, format: "a4" as const, orientation: "portrait" as const },
    pagebreak: { mode: ["css", "legacy"] },
  };
  return html2pdf().set(opt).from(element).outputPdf("blob") as Promise<Blob>;
}

async function waitForTreatmentPlanPdfRoot(doc: Document, maxWaitMs = 4000): Promise<HTMLElement> {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    const root = doc.getElementById("treatment-plan-pdf-source");
    if (root) return root;
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
  }
  throw new Error("Treatment plan PDF root not found in iframe");
}

/**
 * Renders HTML in a detached iframe (no parent stylesheets), runs html2pdf on the root, removes iframe.
 * Uses document.write instead of srcdoc+onload to avoid a blank-frame race (common on slower clients).
 */
export async function treatmentPlanSrcDocToPdfBlob(srcDoc: string): Promise<Blob> {
  const iframe = document.createElement("iframe");
  iframe.setAttribute("title", "treatment-plan-pdf");
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.cssText =
    "position:fixed;left:-10000px;top:0;width:210mm;min-height:297mm;border:0;opacity:0;pointer-events:none;";

  document.body.appendChild(iframe);

  try {
    const doc = iframe.contentDocument ?? iframe.contentWindow?.document ?? null;
    if (!doc) {
      throw new Error("Cannot access treatment plan iframe document");
    }

    doc.open();
    doc.write(srcDoc);
    doc.close();

    if (doc.readyState === "loading") {
      await new Promise<void>((resolve) => {
        doc.addEventListener("DOMContentLoaded", () => resolve(), { once: true });
      });
    }

    const root = await waitForTreatmentPlanPdfRoot(doc);
    return await treatmentPlanElementToPdfBlob(root);
  } finally {
    iframe.remove();
  }
}

/** Uses the browser's native print engine (same pattern as the receipt printer). */
export function printTreatmentPlan(payload: TreatmentPlanPdfPayload): void {
  const srcDoc = buildTreatmentPlanSrcDoc(payload);

  const iframe = document.createElement("iframe");
  iframe.style.cssText = "position:absolute;width:0;height:0;border:none;visibility:hidden;";
  document.body.appendChild(iframe);

  const doc = iframe.contentWindow?.document;
  if (!doc) return;

  doc.open();
  doc.write(srcDoc);
  doc.close();

  iframe.contentWindow?.addEventListener("load", () => {
    setTimeout(() => {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();

      setTimeout(() => {
        document.body.removeChild(iframe);
      }, 2000);
    }, 500);
  });
}
