import { parseLedgerProcedureDescription } from "@/lib/ledgerProcedureParse";

function esc(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const LRM = "\u200E";

export type ReceiptPdfProcedureRow = {
  date: string;
  procedureLine: string;
  teeth?: string;
  pricingBreakdown?: string;
  doctorLine?: string;
  amount: number;
};

export type ReceiptPdfPaymentRow = {
  date: string;
  description: string;
  method: string;
  amount: number;
};

export type DentalReceiptPdfPayload = {
  clinicName: string;
  clinicPhone: string;
  clinicAddress: string;
  leadDoctorName?: string;
  receiptSerial: string;
  printedAtIso: string;
  patientName: string;
  patientPhone: string;
  patientAddress?: string;
  patientAgeSex?: string;
  procedures: ReceiptPdfProcedureRow[];
  payments: ReceiptPdfPaymentRow[];
  totalTreatment: number;
  totalDiscount: number;
  totalPaid: number;
  balance: number;
};

function fmtTeethLabel(teeth: string): string {
  const t = teeth.trim();
  if (/^gen$/i.test(t)) return "عام";
  return teeth;
}

function fmtMoneyAr(n: number): string {
  return `${LRM}${Math.round(n).toLocaleString("ar-EG")} ج.م`;
}

function fmtDateTimeAr(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString("ar-EG", {
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

// Translates terms like "29 yr • Male" to "29 سنة • ذكر"
function translateAgeSexAr(s: string): string {
  if (!s) return "";
  return s
    .replace(/years/gi, "سنة")
    .replace(/year/gi, "سنة")
    .replace(/yrs/gi, "سنة")
    .replace(/yr/gi, "سنة")
    .replace(/Male/gi, "ذكر")
    .replace(/Female/gi, "أنثى")
    .replace(/Boy/gi, "ولد")
    .replace(/Girl/gi, "بنت");
}

/** Arabic RTL dental ledger receipt — Fixes Arabic shaping & clipping bugs */
export function buildDentalReceiptSrcDoc(p: DentalReceiptPdfPayload): string {
  const procRows = p.procedures
    .map((row) => {
      const teethLine = row.teeth
        ? `<div style="margin-top:2px;font-size:10px;color:#6b7280;">الأسنان: <span style="color:#374151;font-weight:700;">${esc(fmtTeethLabel(row.teeth))}</span></div>`
        : "";
      const details = [row.pricingBreakdown, row.doctorLine].filter(Boolean).join(" · ");
      const detailsCell = details
        ? `<div style="font-size:10px;color:#6b7280;line-height:1.4;">${esc(details)}</div>`
        : `<span style="color:#d1d5db;">—</span>`;
      return `<tr>
        <td style="padding:10px 6px;border-bottom:1px solid #f3f4f6;font-size:11px;font-weight:600;color:#4b5563;white-space:nowrap;vertical-align:top;">${esc(row.date || "—")}</td>
        <td style="padding:10px 6px;border-bottom:1px solid #f3f4f6;font-size:12px;font-weight:700;color:#111827;line-height:1.4;vertical-align:top;">
          ${esc(row.procedureLine)}${teethLine}
        </td>
        <td style="padding:10px 6px;border-bottom:1px solid #f3f4f6;vertical-align:top;">${detailsCell}</td>
        <td style="padding:10px 6px;border-bottom:1px solid #f3f4f6;text-align:left;font-size:12px;font-weight:800;color:#111827;vertical-align:top;white-space:nowrap;">${fmtMoneyAr(row.amount)}</td>
      </tr>`;
    })
    .join("");

  const payRows = p.payments
    .map(
      (row) => `<tr>
      <td style="padding:8px 6px;border-bottom:1px solid #f3f4f6;font-size:11px;font-weight:600;color:#4b5563;">${esc(row.date || "—")}</td>
      <td style="padding:8px 6px;border-bottom:1px solid #f3f4f6;font-size:11px;color:#4b5563;">${esc(row.description || "—")}</td>
      <td style="padding:8px 6px;border-bottom:1px solid #f3f4f6;font-size:11px;font-weight:600;color:#374151;">${esc(row.method || "—")}</td>
      <td style="padding:8px 6px;border-bottom:1px solid #f3f4f6;text-align:left;font-size:12px;font-weight:800;color:#111827;white-space:nowrap;">${fmtMoneyAr(row.amount)}</td>
    </tr>`
    )
    .join("");

  // Replaced CSS Grid with a stable HTML Table for the patient info box
  // This prevents clipping and perfectly aligns items for PDF canvas generation.
  let patientAddressRow = "";
  if (p.patientAddress?.trim()) {
    patientAddressRow = `
      <tr>
        <td colspan="3" style="padding: 10px 16px 12px 16px; border-top: 1px dashed #e2e8f0;">
          <div style="color:#9ca3af;font-size:10px;font-weight:700;margin-bottom:4px;">العنوان</div>
          <div style="font-size:12px;font-weight:600;color:#4b5563;line-height:1.5;">${esc(p.patientAddress.trim())}</div>
        </td>
      </tr>
    `;
  }

  const patientBoxHtml = `
    <table style="width:100%; background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; margin-bottom:24px; border-collapse: collapse;">
      <tr>
        <td style="padding: 12px 16px; width: 33%; vertical-align: top;">
          <div style="color:#9ca3af;font-size:10px;font-weight:700;margin-bottom:4px;">اسم المريض</div>
          <div style="font-size:14px;font-weight:800;color:#111827;line-height:1.4;">${esc(p.patientName)}</div>
        </td>
        <td style="padding: 12px 16px; width: 33%; vertical-align: top;">
          <div style="color:#9ca3af;font-size:10px;font-weight:700;margin-bottom:4px;">الهاتف</div>
          <div style="font-size:13px;font-weight:700;color:#374151;direction:ltr;text-align:right;">${esc(p.patientPhone || "—")}</div>
        </td>
        <td style="padding: 12px 16px; width: 34%; vertical-align: top;">
          <div style="color:#9ca3af;font-size:10px;font-weight:700;margin-bottom:4px;">العمر / النوع</div>
          <div style="font-size:13px;font-weight:700;color:#374151;">${p.patientAgeSex ? esc(translateAgeSexAr(p.patientAgeSex.trim())) : "—"}</div>
        </td>
      </tr>
      ${patientAddressRow}
    </table>
  `;

  const sumDiscount =
    p.totalDiscount > 0
      ? `<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #f3f4f6;font-size:13px;">
          <span style="font-weight:600;color:#4b5563;">إجمالي الخصومات</span>
          <span style="font-weight:800;color:#111827;">${fmtMoneyAr(p.totalDiscount)}</span>
        </div>`
      : "";

  const paymentsSectionHtml =
    p.payments.length > 0
      ? `<div style="margin-top:24px;margin-bottom:12px;font-size:14px;font-weight:800;color:#111827;">سجل الدفعات</div>
  <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
    <thead>
      <tr>
        <th style="padding:8px 6px;text-align:right;font-size:10px;font-weight:700;color:#6b7280;border-bottom:2px solid #e5e7eb;">التاريخ</th>
        <th style="padding:8px 6px;text-align:right;font-size:10px;font-weight:700;color:#6b7280;border-bottom:2px solid #e5e7eb;">البيان</th>
        <th style="padding:8px 6px;text-align:right;font-size:10px;font-weight:700;color:#6b7280;border-bottom:2px solid #e5e7eb;">الطريقة</th>
        <th style="padding:8px 6px;text-align:left;font-size:10px;font-weight:700;color:#6b7280;border-bottom:2px solid #e5e7eb;width:100px;">المدفوع</th>
      </tr>
    </thead>
    <tbody>${payRows}</tbody>
  </table>`
      : "";

  const clinicContactLines = [
    p.clinicPhone ? `<span style="color:#4b5563;font-size:11px;font-weight:600;direction:ltr;display:inline-block;">${LRM}${esc(p.clinicPhone)}</span>` : "",
    p.clinicAddress?.trim() ? `<span style="color:#4b5563;font-size:11px;font-weight:500;">${esc(p.clinicAddress.trim())}</span>` : "",
    p.leadDoctorName?.trim() ? `<span style="color:#111827;font-size:11px;font-weight:700;">د. ${esc(p.leadDoctorName.replace(/^Dr\.?\s*/i, "").trim())}</span>` : "",
  ]
    .filter(Boolean)
    .join(" <span style='color:#d1d5db;margin:0 6px;'>•</span> ");

  const inner = `
<div id="dental-receipt-container" style="box-sizing:border-box;max-width:190mm;margin:0 auto;color:#111827;padding:10mm 15mm;">
  
  <div style="display:flex;justify-content:space-between;align-items:flex-end;padding-bottom:16px;margin-bottom:20px;border-bottom:2px solid #e5e7eb;">
    <div style="flex:1;">
      <div style="font-size:24px;font-weight:900;color:#111827;margin-bottom:8px;">${esc(p.clinicName)}</div>
      <div style="display:flex;flex-wrap:wrap;align-items:center;">
        ${clinicContactLines}
      </div>
    </div>
    
    <div style="text-align:left;padding-right:16px;">
      <div style="font-size:18px;font-weight:800;color:#374151;margin-bottom:6px;">إيصال مالي</div>
      
      <table style="width:100%;text-align:left;font-size:10px;margin-top:6px;">
        <tr>
          <td style="color:#9ca3af;font-weight:700;padding-bottom:4px;padding-left:12px;">الرقم</td>
          <td style="font-weight:700;padding-bottom:4px;font-family:ui-monospace,monospace;color:#4b5563;">${esc(p.receiptSerial)}</td>
        </tr>
        <tr>
          <td style="color:#9ca3af;font-weight:700;padding-left:12px;">التاريخ</td>
          <td style="font-weight:700;color:#4b5563;">${esc(fmtDateTimeAr(p.printedAtIso))}</td>
        </tr>
      </table>
    </div>
  </div>

  ${patientBoxHtml}

  <div style="font-size:15px;font-weight:800;color:#111827;margin-bottom:12px;">الخدمات العلاجية</div>
  <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
    <thead>
      <tr>
        <th style="padding:8px 6px;text-align:right;font-size:10px;font-weight:700;color:#6b7280;border-bottom:2px solid #e5e7eb;">التاريخ</th>
        <th style="padding:8px 6px;text-align:right;font-size:10px;font-weight:700;color:#6b7280;border-bottom:2px solid #e5e7eb;">الإجراء</th>
        <th style="padding:8px 6px;text-align:right;font-size:10px;font-weight:700;color:#6b7280;border-bottom:2px solid #e5e7eb;">التفاصيل</th>
        <th style="padding:8px 6px;text-align:left;font-size:10px;font-weight:700;color:#6b7280;border-bottom:2px solid #e5e7eb;width:100px;">المبلغ</th>
      </tr>
    </thead>
    <tbody>
      ${procRows || `<tr><td colspan="4" style="padding:24px;text-align:center;font-size:13px;color:#9ca3af;font-weight:500;">لا توجد إجراءات مسجّلة</td></tr>`}
    </tbody>
  </table>

  ${paymentsSectionHtml}

  <div class="totals-section" style="display:flex;justify-content:flex-end;margin-top:24px;">
    <div style="width:300px;">
      <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #f3f4f6;font-size:13px;">
        <span style="font-weight:600;color:#4b5563;">إجمالي العلاج</span>
        <span style="font-weight:800;color:#111827;">${fmtMoneyAr(p.totalTreatment)}</span>
      </div>
      ${sumDiscount}
      <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #e5e7eb;font-size:13px;">
        <span style="font-weight:600;color:#4b5563;">إجمالي المدفوع</span>
        <span style="font-weight:800;color:#111827;">${fmtMoneyAr(p.totalPaid)}</span>
      </div>
      
      <div style="display:flex;justify-content:space-between;align-items:center;padding:16px 20px;margin-top:12px;background:${p.balance > 0 ? '#fff1f2' : '#f0fdf4'};border-radius:8px;border:1px solid ${p.balance > 0 ? '#ffe4e6' : '#dcfce3'};">
        <span style="font-weight:800;font-size:14px;color:${p.balance > 0 ? '#be123c' : '#166534'};">${p.balance > 0 ? "الرصيد المستحق" : "الحالة"}</span>
        <span style="font-weight:900;font-size:16px;color:${p.balance > 0 ? '#be123c' : '#166534'};">${p.balance > 0 ? fmtMoneyAr(p.balance) : "مسدد بالكامل"}</span>
      </div>
    </div>
  </div>

  <div style="margin-top:40px;padding-top:16px;border-top:1px solid #f3f4f6;text-align:center;">
    <div style="font-size:10px;color:#9ca3af;font-weight:500;">وثيقة مُنشأة آلياً من نظام العيادة · لا تتطلب توقيع</div>
  </div>
</div>`;

  return `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Receipt - ${esc(p.patientName)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com"/>
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous"/>
  <link href="https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;600;700;800;900&amp;display=swap" rel="stylesheet"/>
  <style>
    @page { 
      size: A4 portrait; 
      margin: 0; 
    }
    
    body { 
      margin: 0; 
      padding: 0; 
      background: #ffffff; 
      -webkit-print-color-adjust: exact !important; 
      print-color-adjust: exact !important; 
    }
    
    * { 
      font-family: 'Tajawal', Tahoma, sans-serif !important; 
    }

    /* Print-specific rules */
    table { page-break-inside: auto; }
    tr { page-break-inside: avoid; break-inside: avoid; }
    thead { display: table-header-group; }
    tfoot { display: table-footer-group; }
    .totals-section { page-break-inside: avoid; break-inside: avoid; }
  </style>
</head>
<body>${inner}</body>
</html>`;
}

export async function receiptElementToPdfBlob(element: HTMLElement): Promise<Blob> {
  const html2pdfMod = await import("html2pdf.js");
  const html2pdf = html2pdfMod.default ?? html2pdfMod;
  const opt = {
    margin: [0, 0, 0, 0] as [number, number, number, number],
    filename: "receipt.pdf",
    image: { type: "jpeg" as const, quality: 1.0 },
    // Scale 4 creates a high-res canvas, preventing blur.
    // letterRendering prevents text squishing in certain canvas versions.
    html2canvas: { scale: 4, useCORS: true, logging: false, letterRendering: true },
    jsPDF: { unit: "mm" as const, format: "a4" as const, orientation: "portrait" as const },
  };
  return html2pdf().set(opt).from(element).outputPdf("blob") as Promise<Blob>;
}

export async function dentalReceiptSrcDocToPdfBlob(srcDoc: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const iframe = document.createElement("iframe");
    iframe.setAttribute("title", "dental-receipt-pdf");
    iframe.setAttribute("aria-hidden", "true");

    // We must give the iframe a physical width so the CSS grid and tables calculate correctly
    // before taking the snapshot. A4 width is 210mm.
    iframe.style.cssText =
      "position:fixed;left:-10000px;top:0;width:210mm;height:297mm;border:0;opacity:0;pointer-events:none;z-index:-1;";

    document.body.appendChild(iframe);

    iframe.onload = async () => {
      try {
        const doc = iframe.contentDocument || iframe.contentWindow?.document;
        if (!doc) throw new Error("Iframe document not found");

        // CRUCIAL: Force the iframe document to wait for the Tajawal font to fully load
        // before we even attempt to take a canvas snapshot. This fixes the broken Arabic.
        if (doc.fonts && doc.fonts.ready) {
          await doc.fonts.ready;
        }

        // Add a tiny buffer to allow the browser's paint engine to apply the RTL shaping
        await new Promise((r) => setTimeout(r, 600));

        const root = doc.getElementById("dental-receipt-container");
        if (!root) throw new Error("Receipt PDF root not found in iframe");

        // Generate the high-res Blob
        const blob = await receiptElementToPdfBlob(root);

        // Cleanup
        document.body.removeChild(iframe);
        resolve(blob);
      } catch (e) {
        document.body.removeChild(iframe);
        reject(e instanceof Error ? e : new Error("PDF generation failed"));
      }
    };

    iframe.onerror = () => {
      document.body.removeChild(iframe);
      reject(new Error("Failed to load receipt iframe"));
    };

    // Write the document to the iframe
    iframe.srcdoc = srcDoc;
  });
}

/** Uses the browser's Native Print Engine */
export function downloadDentalReceiptPdf(payload: DentalReceiptPdfPayload, filename?: string): void {
  const srcDoc = buildDentalReceiptSrcDoc(payload);
  
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

export function buildDentalReceiptPayloadFromLedger(options: {
  clinicName: string;
  clinicPhone: string;
  clinicAddress: string;
  leadDoctorName?: string;
  patientName: string;
  patientPhone: string;
  patientAddress?: string;
  patientAgeSex?: string;
  patientId: string;
  transactions: Array<{
    id: string;
    date: string;
    description: string;
    type: string;
    cost: number;
    paid: number;
    method?: string;
    doctorName?: string;
    discountAmount?: number;
    status?: string;
  }>;
  totals: { totalTreatment: number; totalPaid: number; balance: number };
}): DentalReceiptPdfPayload {
  const active = options.transactions.filter((t) => t.status !== "deleted" && t.status !== "cancelled");
  const chronological = [...active].sort((a, b) => {
    const da = a.date || "";
    const db = b.date || "";
    if (da !== db) return da.localeCompare(db);
    return a.id.localeCompare(b.id);
  });

  const procedures: ReceiptPdfProcedureRow[] = [];
  const payments: ReceiptPdfPaymentRow[] = [];
  let totalDiscount = 0;

  for (const item of chronological) {
    if (item.type === "procedure") {
      const parsed = parseLedgerProcedureDescription(item.description);
      totalDiscount += Number(item.discountAmount) || 0;
      let doctorLine: string | undefined;
      const dn = item.doctorName?.trim();
      if (dn) doctorLine = `الطبيب: ${dn.replace(/^Dr\.?\s*/i, "").trim()}`;
      procedures.push({
        date: item.date || "—",
        procedureLine: parsed.procedureLine,
        teeth: parsed.teeth,
        pricingBreakdown: parsed.pricingBreakdown,
        doctorLine,
        amount: Number(item.cost) || 0,
      });
    } else if (item.type === "payment") {
      payments.push({
        date: item.date || "—",
        description: item.description || "—",
        method: item.method || "نقدي",
        amount: Number(item.paid) || 0,
      });
    }
  }

  const serial = `${options.patientId.slice(-6)}-${Date.now().toString(36).toUpperCase()}`;
  const printedAtIso = new Date().toISOString();

  return {
    clinicName: options.clinicName,
    clinicPhone: options.clinicPhone,
    clinicAddress: options.clinicAddress,
    leadDoctorName: options.leadDoctorName,
    receiptSerial: serial,
    printedAtIso,
    patientName: options.patientName,
    patientPhone: options.patientPhone,
    patientAddress: options.patientAddress,
    patientAgeSex: options.patientAgeSex,
    procedures,
    payments,
    totalTreatment: options.totals.totalTreatment,
    totalDiscount,
    totalPaid: options.totals.totalPaid,
    balance: options.totals.balance,
  };
}