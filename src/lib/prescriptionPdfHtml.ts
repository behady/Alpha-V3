import { clinicLogoImgHtml, getClinicLogo, type ClinicLogoAsset } from "@/lib/clinicLogo";

export type RxItem = { id: string; name: string; dose: string; note: string };

function esc(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Inline icon as img — html2canvas aligns these with text better than raw SVG. */
function contactIconImg(svgBody: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#64748b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${svgBody}</svg>`;
  const uri = `data:image/svg+xml,${encodeURIComponent(svg)}`;
  return `<img src="${uri}" width="12" height="12" alt="" style="display:inline-block;vertical-align:middle;margin-right:6px;border:0;flex-shrink:0;" />`;
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

export type PrescriptionPdfPayload = {
  clinicName: string;
  rxHeader: string;
  dateLabel: string;
  patientName: string;
  ageSex: string;
  diagnosis: string;
  doctor: string;
  address: string;
  phone: string;
  rxItems: RxItem[];
  /**
   * Optional clinic branding. Leave it unset and use `prescriptionPayloadToPdfBlob`, which
   * resolves it for you; only the data: URI form is ever drawn here (see `ClinicLogoAsset`).
   */
  logo?: ClinicLogoAsset;
};

/** Full HTML document: no external CSS, no Tailwind — only inline styles (html2canvas-safe). */
export function buildPrescriptionSrcDoc(p: PrescriptionPdfPayload): string {
  const diagnosisBlock =
    p.diagnosis.trim() !== ""
      ? `<div style="width:100%;margin-top:4px;padding-top:12px;border-top:1px solid #e2e8f0;">
          <p style="margin:0 0 4px 0;font-size:9px;font-weight:900;color:#94a3b8;text-transform:uppercase;letter-spacing:0.05em;">Diagnosis</p>
          <p style="margin:0;font-size:14px;font-weight:700;color:#334155;">${esc(p.diagnosis)}</p>
        </div>`
      : "";

  const drugsHtml = p.rxItems
    .map((item, index) => {
      const doseLine = item.dose
        ? `<p style="margin:4px 0 0 0;padding-left:24px;font-size:14px;font-weight:700;color:#334155;">• ${esc(item.dose)}</p>`
        : "";
      const noteLine = item.note
        ? `<p style="margin:4px 0 0 0;padding-left:24px;font-size:12px;font-weight:600;color:#64748b;">Note: ${esc(item.note)}</p>`
        : "";
      return `<div style="position:relative;margin-bottom:24px;">
        <div style="padding-left:8px;border-left:2px solid #e2e8f0;">
          <p style="margin:0 0 4px 0;font-size:16px;font-weight:900;color:#0f172a;">
            <span style="color:#94a3b8;margin-right:8px;">${index + 1}.</span>${esc(item.name)}
          </p>
          ${doseLine}
          ${noteLine}
        </div>
      </div>`;
    })
    .join("");

  // Margin rather than flex `gap`: html2canvas 1.4.1 does not honour gap on flex containers.
  const logoImg = clinicLogoImgHtml(p.logo, {
    maxHeight: 44,
    maxWidth: 110,
    extraStyle: "margin-right:14px;",
  });

  const bodyInner = `
<div id="prescription-pdf-source" style="box-sizing:border-box;width:148mm;min-height:210mm;margin:0 auto;padding:32px;background:#ffffff;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:#0f172a;display:flex;flex-direction:column;">
  <div style="border-bottom:2px solid #0f172a;padding-bottom:24px;margin-bottom:24px;">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;">
      <div style="width:66%;display:flex;align-items:flex-start;">
        ${logoImg}
        <div style="min-width:0;">
          <h2 style="margin:0 0 8px 0;font-size:24px;font-weight:900;text-transform:uppercase;letter-spacing:-0.02em;color:#0f172a;">${esc(p.clinicName)}</h2>
          <p style="margin:0;font-size:12px;font-weight:700;color:#475569;white-space:pre-wrap;line-height:1.5;">${esc(p.rxHeader)}</p>
        </div>
      </div>
      <div style="width:33%;text-align:right;">
        <p style="margin:0 0 4px 0;font-size:10px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.05em;">Date</p>
        <p style="margin:0;font-size:14px;font-weight:900;color:#0f172a;">${esc(p.dateLabel)}</p>
      </div>
    </div>
  </div>

  <div style="background:#f8fafc;padding:16px;border-radius:12px;margin-bottom:32px;display:flex;flex-wrap:wrap;justify-content:space-between;gap:12px;border:1px solid #f1f5f9;">
    <div>
      <p style="margin:0 0 2px 0;font-size:9px;font-weight:900;color:#94a3b8;text-transform:uppercase;letter-spacing:0.05em;">Patient Name</p>
      <p style="margin:0;font-size:14px;font-weight:900;color:#0f172a;">${esc(p.patientName)}</p>
    </div>
    <div style="text-align:right;">
      <p style="margin:0 0 2px 0;font-size:9px;font-weight:900;color:#94a3b8;text-transform:uppercase;letter-spacing:0.05em;">Age / Sex</p>
      <p style="margin:0;font-size:14px;font-weight:700;color:#334155;">${esc(p.ageSex)}</p>
    </div>
    ${diagnosisBlock}
  </div>

  <div style="margin-bottom:24px;">
    <span style="font-size:36px;font-family:Georgia,'Times New Roman',serif;font-weight:900;font-style:italic;color:#0f172a;">Rx</span>
  </div>

  <div style="flex:1;">
    ${drugsHtml}
  </div>

  <div style="margin-top:auto;padding-top:24px;border-top:1px solid #e2e8f0;display:flex;justify-content:space-between;align-items:flex-end;">
    <div style="max-width:58%;">
      ${contactLine(ICON_PIN, p.address, "8px")}
      ${contactLine(ICON_PHONE, p.phone, "0")}
    </div>
    <div style="text-align:center;width:192px;">
      <div style="border-bottom:2px dashed #cbd5e1;height:32px;margin-bottom:8px;"></div>
      <p style="margin:0;font-size:10px;font-weight:900;color:#94a3b8;text-transform:uppercase;letter-spacing:0.05em;">Doctor's Signature</p>
      <p style="margin:8px 0 0 0;font-size:14px;font-weight:900;color:#0f172a;">${esc(p.doctor)}</p>
    </div>
  </div>
</div>`;

  return `<!DOCTYPE html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head><body style="margin:0;background:#ffffff;">${bodyInner}</body></html>`;
}

export async function prescriptionElementToPdfBlob(element: HTMLElement): Promise<Blob> {
  const html2pdfMod = await import("html2pdf.js");
  const html2pdf = html2pdfMod.default ?? html2pdfMod;
  const opt = {
    // The source template is already sized to full A5 (148mm x 210mm).
    // Non-zero jsPDF margins shrink/crop content and can create a blank extra page.
    margin: [0, 0, 0, 0] as [number, number, number, number],
    filename: "prescription.pdf",
    image: { type: "jpeg" as const, quality: 0.95 },
    html2canvas: { scale: 2, useCORS: true },
    jsPDF: { unit: "mm" as const, format: "a5" as const, orientation: "portrait" as const },
  };
  return html2pdf().set(opt).from(element).outputPdf("blob") as Promise<Blob>;
}

async function waitForPrescriptionPdfRoot(
  doc: Document,
  maxWaitMs = 4000
): Promise<HTMLElement> {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    const root = doc.getElementById("prescription-pdf-source");
    if (root) return root;
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
  }
  throw new Error("Prescription PDF root not found in iframe");
}

/**
 * Renders HTML in a detached iframe (no parent stylesheets), runs html2pdf on the root, removes iframe.
 * Uses document.write instead of srcdoc+onload to avoid a blank-frame race (common on slower clients).
 */
export async function prescriptionSrcDocToPdfBlob(srcDoc: string): Promise<Blob> {
  const iframe = document.createElement("iframe");
  iframe.setAttribute("title", "prescription-pdf");
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.cssText =
    "position:fixed;left:-10000px;top:0;width:148mm;min-height:210mm;border:0;opacity:0;pointer-events:none;";

  document.body.appendChild(iframe);

  try {
    const doc = iframe.contentDocument ?? iframe.contentWindow?.document ?? null;
    if (!doc) {
      throw new Error("Cannot access prescription iframe document");
    }

    doc.open();
    doc.write(srcDoc);
    doc.close();

    if (doc.readyState === "loading") {
      await new Promise<void>((resolve) => {
        doc.addEventListener("DOMContentLoaded", () => resolve(), { once: true });
      });
    }

    const root = await waitForPrescriptionPdfRoot(doc);
    return await prescriptionElementToPdfBlob(root);
  } finally {
    iframe.remove();
  }
}

/**
 * Build + render in one step, with the clinic logo resolved automatically.
 * This is the entry point every caller should use — going through
 * `buildPrescriptionSrcDoc` directly produces an unbranded prescription.
 */
export async function prescriptionPayloadToPdfBlob(p: PrescriptionPdfPayload): Promise<Blob> {
  const logo = p.logo ?? (await getClinicLogo());
  return prescriptionSrcDocToPdfBlob(buildPrescriptionSrcDoc({ ...p, logo }));
}
