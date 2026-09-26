import { parseLedgerProcedureDescription } from "@/lib/ledgerProcedureParse";
import type { ClinicLogoAsset } from "@/lib/clinicLogo";
import {
  DEFAULT_RECEIPT_SETTINGS,
  etaBlockReady,
  etaPaymentMethodCode,
  type ReceiptSettings,
} from "@/lib/receiptSettings";

/**
 * The printed receipt.
 *
 * Two documents come out of here, from one layout and one settings object:
 *
 *   - a PAYMENT receipt — one payment, its number, what it settles, how it was paid; and
 *   - a STATEMENT — every charge and payment on the patient's account, with the balance.
 *
 * Everything about how they look (template, accent, font, paper, language, logo size, which
 * lines print, the footer) comes from `settings/receipt` — see src/lib/receiptSettings.ts. The
 * tax block that the Egyptian e-receipt system expects on paper (registration number, branch,
 * unit prices, VAT line, payment-method code) is switched on there too.
 *
 * The HTML uses inline styles and a single <style> block on purpose: it is written into a hidden
 * iframe and printed by the browser's own engine, and it is also shown in the settings screen's
 * live preview, so it has to be self-contained.
 */

/**
 * The logo as an <img>, or "" when there is none. A copy of clinicLogo.ts's helper without its
 * Firebase imports, so this module (and its test) can run in plain Node.
 */
function logoImgHtml(logo: ClinicLogoAsset | undefined, maxHeight: number, maxWidth: number): string {
  if (!logo) return "";
  const src = logo.dataUrl || logo.url;
  if (!src) return "";
  const attr = String(src).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  const base = "display:block;border:0;object-fit:contain;flex-shrink:0;";
  if (logo.width > 0 && logo.height > 0) {
    const scale = Math.min(maxHeight / logo.height, maxWidth / logo.width);
    const w = Math.max(1, Math.round(logo.width * scale));
    const h = Math.max(1, Math.round(logo.height * scale));
    return `<img src="${attr}" alt="" width="${w}" height="${h}" style="width:${w}px;height:${h}px;${base}" />`;
  }
  return `<img src="${attr}" alt="" style="height:${maxHeight}px;width:auto;max-width:${maxWidth}px;${base}" />`;
}

function esc(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const LRM = "‎";

export type ReceiptPdfProcedureRow = {
  date: string;
  procedureLine: string;
  teeth?: string;
  pricingBreakdown?: string;
  doctorLine?: string;
  /** What the treatment charged before any discount. Shown only when a discount was given. */
  listPrice?: number;
  discountAmount?: number;
  amount: number;
};

export type ReceiptPdfPaymentRow = {
  date: string;
  description: string;
  method: string;
  amount: number;
};

/** The one payment a payment receipt is for. */
export type ReceiptPdfSinglePayment = {
  ledgerId: string;
  amount: number;
  method: string;
  description: string;
  /** YYYY-MM-DD. */
  date: string;
  collectedBy?: string;
  /** The charge this payment settles; absent for a payment on account. */
  charge?: {
    description: string;
    teeth?: string;
    doctorLine?: string;
    cost: number;
    listPrice?: number;
    discountAmount?: number;
    /** Paid against this charge BEFORE this payment. */
    paidBefore: number;
    /** Still owed on this charge AFTER this payment. */
    remainingAfter: number;
  };
};

export type DentalReceiptPdfPayload = {
  /** "statement" (default, the whole account) or "payment" (one receipt). */
  kind?: "statement" | "payment";
  clinicName: string;
  clinicPhone: string;
  clinicAddress: string;
  clinicEmail?: string;
  leadDoctorName?: string;
  receiptSerial: string;
  printedAtIso: string;
  patientName: string;
  patientPhone: string;
  patientAddress?: string;
  patientAgeSex?: string;
  patientFileNumber?: string;
  procedures: ReceiptPdfProcedureRow[];
  payments: ReceiptPdfPaymentRow[];
  totalTreatment: number;
  totalDiscount: number;
  totalPaid: number;
  balance: number;
  currency?: string;
  payment?: ReceiptPdfSinglePayment;
  /** Phase 2: the UUID the ETA returned for this receipt. Printed when present. */
  etaUuid?: string;
  /** Optional clinic branding; `downloadDentalReceiptPdf` resolves it when left unset. */
  logo?: ClinicLogoAsset;
};

// ---------------------------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------------------------

const LABELS = {
  titlePayment: { ar: "إيصال استلام نقدية", en: "Payment receipt" },
  titleStatement: { ar: "كشف حساب", en: "Account statement" },
  number: { ar: "رقم الإيصال", en: "Receipt no." },
  date: { ar: "التاريخ", en: "Date" },
  patient: { ar: "اسم المريض", en: "Patient" },
  phone: { ar: "الهاتف", en: "Phone" },
  ageSex: { ar: "العمر / النوع", en: "Age / sex" },
  address: { ar: "العنوان", en: "Address" },
  file: { ar: "رقم الملف", en: "File no." },
  services: { ar: "الخدمات العلاجية", en: "Treatments" },
  procedure: { ar: "الإجراء", en: "Procedure" },
  details: { ar: "التفاصيل", en: "Details" },
  amount: { ar: "المبلغ", en: "Amount" },
  qty: { ar: "الكمية", en: "Qty" },
  unitPrice: { ar: "سعر الوحدة", en: "Unit price" },
  discount: { ar: "الخصم", en: "Discount" },
  lineTotal: { ar: "الإجمالي", en: "Total" },
  teeth: { ar: "الأسنان", en: "Teeth" },
  doctor: { ar: "الطبيب", en: "Dentist" },
  paymentsLog: { ar: "سجل الدفعات", en: "Payments" },
  description: { ar: "البيان", en: "Description" },
  method: { ar: "طريقة الدفع", en: "Method" },
  paid: { ar: "المدفوع", en: "Paid" },
  totalTreatment: { ar: "إجمالي العلاج", en: "Total treatment" },
  totalDiscount: { ar: "إجمالي الخصومات", en: "Total discounts" },
  totalPaid: { ar: "إجمالي المدفوع", en: "Total paid" },
  balanceDue: { ar: "الرصيد المستحق", en: "Balance due" },
  credit: { ar: "رصيد للمريض", en: "Patient credit" },
  status: { ar: "الحالة", en: "Status" },
  settled: { ar: "مسدد بالكامل", en: "Paid in full" },
  received: { ar: "المبلغ المستلم", en: "Amount received" },
  forCharge: { ar: "سداداً عن", en: "Toward" },
  onAccount: { ar: "دفعة تحت الحساب", en: "Payment on account" },
  chargeCost: { ar: "قيمة العلاج", en: "Treatment cost" },
  paidBefore: { ar: "مدفوع سابقاً", en: "Paid before" },
  remaining: { ar: "المتبقي على العلاج", en: "Remaining on treatment" },
  accountBalance: { ar: "رصيد الحساب بعد الدفعة", en: "Account balance after this payment" },
  collectedBy: { ar: "المحصّل", en: "Collected by" },
  signature: { ar: "التوقيع", en: "Signature" },
  footerDefault: { ar: "وثيقة مُنشأة آلياً من نظام العيادة · لا تتطلب توقيع", en: "Generated by the clinic system · no signature required" },
  noProcedures: { ar: "لا توجد إجراءات مسجّلة", en: "No treatments on file" },
  taxBlock: { ar: "بيانات الإيصال الضريبي", en: "Tax receipt details" },
  rin: { ar: "رقم التسجيل الضريبي", en: "Tax registration no." },
  tradeName: { ar: "الاسم المسجّل", en: "Registered name" },
  branch: { ar: "كود الفرع", en: "Branch code" },
  device: { ar: "رقم جهاز نقطة البيع", en: "POS serial" },
  activity: { ar: "كود النشاط", en: "Activity code" },
  syndicate: { ar: "رقم القيد بالنقابة", en: "Syndicate no." },
  issuedUtc: { ar: "وقت الإصدار (UTC)", en: "Issued (UTC)" },
  uuid: { ar: "المعرّف الإلكتروني (UUID)", en: "UUID" },
  vat: { ar: "ضريبة القيمة المضافة", en: "VAT" },
  vatExempt: { ar: "معفى — خدمات طبية (T1 / V003)", en: "Exempt — medical services (T1 / V003)" },
  net: { ar: "الصافي قبل الضريبة", en: "Net before tax" },
  total: { ar: "الإجمالي", en: "Total" },
  methodCode: { ar: "كود طريقة الدفع", en: "Payment method code" },
  buyerType: { ar: "نوع المشتري", en: "Buyer type" },
  buyerPerson: { ar: "شخص طبيعي (P)", en: "Natural person (P)" },
  pendingEta: { ar: "لم يُرسل بعد إلى منظومة الإيصال الإلكتروني", en: "Not yet submitted to the ETA e-receipt system" },
} as const;

type LabelKey = keyof typeof LABELS;

function makeLabel(language: ReceiptSettings["language"]) {
  return (key: LabelKey): string => {
    const pair = LABELS[key];
    if (language === "en") return pair.en;
    if (language === "both") return `${pair.ar} · ${pair.en}`;
    return pair.ar;
  };
}

function fmtTeethLabel(teeth: string, en: boolean): string {
  const t = teeth.trim();
  if (/^gen$/i.test(t)) return en ? "General" : "عام";
  return teeth;
}

function makeMoney(language: ReceiptSettings["language"], currency: string) {
  const cur = (currency || "EGP").trim().toUpperCase();
  const arUnit = cur === "EGP" ? "ج.م" : cur === "SAR" ? "ر.س" : cur;
  return (n: number): string => {
    const v = Math.round((Number(n) || 0) * 100) / 100;
    if (language === "en") return `${cur} ${v.toLocaleString("en-EG")}`;
    return `${LRM}${v.toLocaleString("ar-EG")} ${arUnit}`;
  };
}

function fmtDateTime(iso: string, language: ReceiptSettings["language"]): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString(language === "en" ? "en-GB" : "ar-EG", {
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return iso;
  }
}

function fmtUtc(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toISOString().replace(/\.\d{3}Z$/, "Z");
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

// ---------------------------------------------------------------------------------------------
// Style
// ---------------------------------------------------------------------------------------------

const FONT_FAMILIES: Record<ReceiptSettings["font"], { css: string; google: string }> = {
  tajawal: { css: "'Tajawal', Tahoma, sans-serif", google: "Tajawal:wght@400;500;700;800;900" },
  cairo: { css: "'Cairo', Tahoma, sans-serif", google: "Cairo:wght@400;600;700;800;900" },
  "noto-naskh": { css: "'Noto Naskh Arabic', 'Times New Roman', serif", google: "Noto+Naskh+Arabic:wght@400;500;600;700" },
  "ibm-plex": { css: "'IBM Plex Sans Arabic', Tahoma, sans-serif", google: "IBM+Plex+Sans+Arabic:wght@400;500;600;700" },
};

const LOGO_PX: Record<ReceiptSettings["logoSize"], { h: number; w: number }> = {
  none: { h: 0, w: 0 },
  small: { h: 36, w: 90 },
  medium: { h: 52, w: 130 },
  large: { h: 80, w: 200 },
};

/** Lighten a hex colour towards white — the tint behind totals and the patient box. */
function tint(hexColor: string, amount: number): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hexColor);
  if (!m) return "#f3f4f6";
  const ch = (h: string) => Math.round(parseInt(h, 16) + (255 - parseInt(h, 16)) * amount);
  return `rgb(${ch(m[1])},${ch(m[2])},${ch(m[3])})`;
}

function buildCss(s: ReceiptSettings): string {
  const font = FONT_FAMILIES[s.font].css;
  const thermal = s.template === "thermal" || s.paper === "thermal80";
  const pageSize = thermal ? "80mm auto" : s.paper === "a5" ? "A5 portrait" : "A4 portrait";
  const accent = s.accent;
  const soft = tint(accent, 0.92);
  const softer = tint(accent, 0.96);

  const base = `
    @page { size: ${pageSize}; margin: 0; }
    html, body { margin: 0; padding: 0; background: #fff; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
    * { font-family: ${font} !important; box-sizing: border-box; }
    .r { color: #111827; margin: 0 auto; }
    table { border-collapse: collapse; width: 100%; page-break-inside: auto; }
    tr { page-break-inside: avoid; break-inside: avoid; }
    thead { display: table-header-group; }
    .tt, .eta, .pay { page-break-inside: avoid; break-inside: avoid; }
    .muted { color: #6b7280; }
    .faint { color: #9ca3af; }
    .strong { color: #111827; font-weight: 800; }
    .ltr { direction: ltr; unicode-bidi: isolate; display: inline-block; }
    .mono { font-family: ui-monospace, 'Courier New', monospace !important; direction: ltr; unicode-bidi: isolate; white-space: nowrap; }
    .num { text-align: left; white-space: nowrap; }
    [dir="ltr"] .num { text-align: right; }
    .lbl { font-size: 10px; font-weight: 700; letter-spacing: .02em; }
    .sig { margin-top: 28px; display: flex; justify-content: flex-end; }
    .sig div { width: 220px; border-top: 1px solid #9ca3af; padding-top: 6px; font-size: 10px; text-align: center; color: #6b7280; }
    .strike { text-decoration: line-through; color: #9ca3af; font-weight: 600; font-size: 10px; }
    .off { color: #b45309; font-weight: 700; font-size: 10px; }
  `;

  if (thermal) {
    return `${base}
      .r { width: 72mm; padding: 4mm 3mm; font-size: 11px; }
      .hd { text-align: center; border-bottom: 1px dashed #9ca3af; padding-bottom: 8px; margin-bottom: 8px; }
      .hd .logo { display: flex; justify-content: center; margin-bottom: 6px; }
      .hd .name { font-size: 15px; font-weight: 900; }
      .hd .contact { font-size: 10px; color: #4b5563; margin-top: 2px; }
      .hd .title { font-size: 13px; font-weight: 800; margin-top: 8px; }
      .meta { font-size: 10px; margin-top: 4px; }
      .pb { border-bottom: 1px dashed #9ca3af; padding-bottom: 8px; margin-bottom: 8px; font-size: 11px; }
      .pb .lbl { display: inline; color: #6b7280; }
      .pb div { margin: 2px 0; }
      h4 { font-size: 11px; margin: 8px 0 4px; font-weight: 800; }
      th { font-size: 9px; color: #6b7280; text-align: right; padding: 4px 2px; border-bottom: 1px solid #9ca3af; }
      [dir="ltr"] th { text-align: left; }
      td { font-size: 10.5px; padding: 5px 2px; border-bottom: 1px dotted #d1d5db; vertical-align: top; }
      .tt { margin-top: 8px; border-top: 1px dashed #9ca3af; padding-top: 6px; }
      .tt .row { display: flex; justify-content: space-between; padding: 3px 0; font-size: 11px; }
      .tt .grand { font-weight: 900; font-size: 14px; border-top: 1px solid #111827; margin-top: 4px; padding-top: 6px; }
      .pay { margin: 8px 0; padding: 8px; border: 1px solid #111827; text-align: center; }
      .pay .big { font-size: 20px; font-weight: 900; }
      .eta { margin-top: 8px; border-top: 1px dashed #9ca3af; padding-top: 6px; font-size: 9.5px; }
      .eta .row { display: flex; justify-content: space-between; gap: 6px; padding: 1px 0; }
      .ft { margin-top: 10px; border-top: 1px dashed #9ca3af; padding-top: 6px; text-align: center; font-size: 9px; color: #6b7280; }
      .sig div { width: 100%; }
    `;
  }

  const width = s.paper === "a5" ? "138mm" : "190mm";
  const pad = s.paper === "a5" ? "8mm 10mm" : "10mm 15mm";

  if (s.template === "modern") {
    return `${base}
      .r { max-width: ${width}; padding: ${pad}; }
      .hd { display: flex; justify-content: space-between; align-items: center; background: ${accent}; color: #fff; padding: 18px 22px; border-radius: 14px; margin-bottom: 22px; }
      .hd .left { display: flex; align-items: center; gap: 14px; min-width: 0; }
      .hd .logo img { background: #fff; border-radius: 10px; padding: 4px; }
      .hd .name { font-size: 22px; font-weight: 900; color: #fff; }
      .hd .contact { font-size: 10.5px; color: rgba(255,255,255,.85); margin-top: 4px; }
      .hd .title { font-size: 16px; font-weight: 800; color: #fff; text-align: left; }
      [dir="ltr"] .hd .title { text-align: right; }
      .meta { font-size: 10px; color: rgba(255,255,255,.85); margin-top: 4px; }
      .meta .mono { color: #fff; }
      .note { text-align: center; font-size: 12px; color: #4b5563; margin: -10px 0 18px; }
      .pb { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px 16px; padding: 14px 18px; background: ${softer}; border-radius: 12px; margin-bottom: 22px; }
      .pb .lbl { color: #6b7280; margin-bottom: 3px; }
      .pb .val { font-size: 13px; font-weight: 700; }
      .pb .span { grid-column: 1 / -1; }
      h4 { font-size: 13px; font-weight: 800; margin: 0 0 8px; color: ${accent}; }
      th { padding: 9px 8px; text-align: right; font-size: 10px; font-weight: 700; color: #fff; background: ${accent}; }
      th:first-child { border-radius: 0 8px 8px 0; } th:last-child { border-radius: 8px 0 0 8px; }
      [dir="ltr"] th { text-align: left; } [dir="ltr"] th:first-child { border-radius: 8px 0 0 8px; } [dir="ltr"] th:last-child { border-radius: 0 8px 8px 0; }
      td { padding: 10px 8px; border-bottom: 1px solid #f3f4f6; font-size: 11.5px; vertical-align: top; }
      tbody tr:nth-child(even) td { background: ${softer}; }
      .tt { display: flex; justify-content: flex-end; margin-top: 18px; }
      .tt .box { width: 300px; }
      .tt .row { display: flex; justify-content: space-between; padding: 7px 0; border-bottom: 1px solid #f3f4f6; font-size: 12.5px; }
      .tt .grand { background: ${accent}; color: #fff; border-radius: 10px; padding: 12px 16px; margin-top: 10px; font-size: 14px; font-weight: 900; border: 0; }
      .tt .grand.due { background: #be123c; }
      .pay { display: flex; justify-content: space-between; align-items: center; padding: 18px 22px; border-radius: 14px; background: ${soft}; margin-bottom: 20px; }
      .pay .big { font-size: 28px; font-weight: 900; color: ${accent}; }
      .eta { margin-top: 22px; padding: 14px 18px; border: 1px dashed ${accent}; border-radius: 12px; font-size: 10.5px; }
      .eta .grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px 24px; }
      .eta .row { display: flex; justify-content: space-between; gap: 12px; align-items: baseline; }
      .eta .row span:last-child { text-align: left; } [dir="ltr"] .eta .row span:last-child { text-align: right; }
      .ft { margin-top: 30px; padding-top: 12px; border-top: 1px solid #e5e7eb; text-align: center; font-size: 10px; color: #9ca3af; }
    `;
  }

  if (s.template === "minimal") {
    return `${base}
      .r { max-width: ${width}; padding: ${pad}; }
      .hd { display: flex; justify-content: space-between; align-items: flex-end; padding-bottom: 14px; margin-bottom: 26px; border-bottom: 1px solid #111827; }
      .hd .left { display: flex; align-items: center; gap: 14px; min-width: 0; }
      .hd .name { font-size: 20px; font-weight: 700; letter-spacing: .01em; }
      .hd .contact { font-size: 10.5px; color: #6b7280; margin-top: 4px; }
      .hd .title { font-size: 11px; font-weight: 700; letter-spacing: .18em; text-transform: uppercase; color: #6b7280; text-align: left; }
      [dir="ltr"] .hd .title { text-align: right; }
      .meta { font-size: 10.5px; margin-top: 6px; color: #374151; }
      .note { font-size: 12px; color: #6b7280; margin: -14px 0 20px; }
      .pb { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px 16px; margin-bottom: 26px; }
      .pb .lbl { color: #9ca3af; letter-spacing: .12em; text-transform: uppercase; font-size: 9px; margin-bottom: 4px; }
      .pb .val { font-size: 13px; font-weight: 600; }
      .pb .span { grid-column: 1 / -1; }
      h4 { font-size: 9.5px; font-weight: 700; letter-spacing: .18em; text-transform: uppercase; color: #6b7280; margin: 0 0 8px; }
      th { padding: 8px 4px; text-align: right; font-size: 9px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; color: #9ca3af; border-bottom: 1px solid #111827; }
      [dir="ltr"] th { text-align: left; }
      td { padding: 10px 4px; border-bottom: 1px solid #e5e7eb; font-size: 11.5px; vertical-align: top; }
      .tt { display: flex; justify-content: flex-end; margin-top: 18px; }
      .tt .box { width: 300px; }
      .tt .row { display: flex; justify-content: space-between; padding: 6px 0; font-size: 12px; color: #374151; }
      .tt .grand { border-top: 1px solid #111827; margin-top: 8px; padding-top: 10px; font-size: 15px; font-weight: 700; color: ${accent}; }
      .tt .grand.due { color: #be123c; }
      .pay { display: flex; justify-content: space-between; align-items: baseline; padding: 6px 0 18px; border-bottom: 1px solid #111827; margin-bottom: 22px; }
      .pay .big { font-size: 30px; font-weight: 700; color: ${accent}; }
      .eta { margin-top: 26px; padding-top: 12px; border-top: 1px solid #e5e7eb; font-size: 10px; color: #374151; }
      .eta .grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 4px 24px; }
      .eta .row { display: flex; justify-content: space-between; gap: 12px; align-items: baseline; }
      .eta .row span:last-child { text-align: left; } [dir="ltr"] .eta .row span:last-child { text-align: right; }
      .ft { margin-top: 36px; text-align: center; font-size: 9.5px; color: #9ca3af; letter-spacing: .04em; }
    `;
  }

  // classic
  return `${base}
    .r { max-width: ${width}; padding: ${pad}; }
    .hd { display: flex; justify-content: space-between; align-items: flex-end; padding-bottom: 16px; margin-bottom: 20px; border-bottom: 2px solid ${accent}; }
    .hd .left { display: flex; align-items: flex-start; gap: 14px; min-width: 0; }
    .hd .name { font-size: 24px; font-weight: 900; margin-bottom: 6px; }
    .hd .contact { font-size: 11px; color: #4b5563; display: flex; flex-wrap: wrap; gap: 4px 6px; }
    .hd .title { font-size: 18px; font-weight: 800; color: ${accent}; text-align: left; margin-bottom: 6px; }
    [dir="ltr"] .hd .title { text-align: right; }
    .meta { font-size: 10px; color: #4b5563; margin-top: 3px; }
    .note { font-size: 12px; color: #4b5563; margin: -8px 0 18px; }
    .pb { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px 16px; background: ${softer}; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px 16px; margin-bottom: 24px; }
    .pb .lbl { color: #9ca3af; margin-bottom: 4px; }
    .pb .val { font-size: 13px; font-weight: 700; }
    .pb .span { grid-column: 1 / -1; border-top: 1px dashed #e2e8f0; padding-top: 8px; }
    h4 { font-size: 15px; font-weight: 800; margin: 0 0 12px; }
    th { padding: 8px 6px; text-align: right; font-size: 10px; font-weight: 700; color: #6b7280; border-bottom: 2px solid #e5e7eb; }
    [dir="ltr"] th { text-align: left; }
    td { padding: 10px 6px; border-bottom: 1px solid #f3f4f6; font-size: 12px; vertical-align: top; }
    .tt { display: flex; justify-content: flex-end; margin-top: 24px; }
    .tt .box { width: 300px; }
    .tt .row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #f3f4f6; font-size: 13px; }
    .tt .grand { display: flex; justify-content: space-between; align-items: center; padding: 16px 20px; margin-top: 12px; background: #f0fdf4; border: 1px solid #dcfce3; border-radius: 8px; color: #166534; font-size: 15px; font-weight: 900; }
    .tt .grand.due { background: #fff1f2; border-color: #ffe4e6; color: #be123c; }
    .pay { display: flex; justify-content: space-between; align-items: center; padding: 18px 20px; border: 2px solid ${accent}; border-radius: 10px; margin-bottom: 22px; background: ${softer}; }
    .pay .big { font-size: 28px; font-weight: 900; color: ${accent}; }
    .eta { margin-top: 24px; padding: 12px 16px; border: 1px solid #e5e7eb; border-radius: 8px; background: #fafafa; font-size: 10.5px; }
    .eta .grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px 24px; }
    .eta .row { display: flex; justify-content: space-between; gap: 12px; align-items: baseline; }
    .eta .row span:last-child { text-align: left; } [dir="ltr"] .eta .row span:last-child { text-align: right; }
    .ft { margin-top: 40px; padding-top: 16px; border-top: 1px solid #f3f4f6; text-align: center; font-size: 10px; color: #9ca3af; }
  `;
}

// ---------------------------------------------------------------------------------------------
// Document
// ---------------------------------------------------------------------------------------------

export function buildDentalReceiptSrcDoc(
  p: DentalReceiptPdfPayload,
  settings: ReceiptSettings = DEFAULT_RECEIPT_SETTINGS
): string {
  const s = settings;
  const kind = p.kind ?? "statement";
  const en = s.language === "en";
  const L = makeLabel(s.language);
  const money = makeMoney(s.language, p.currency || "EGP");
  const thermal = s.template === "thermal" || s.paper === "thermal80";
  const eta = etaBlockReady(s);
  const show = s.show;

  const doctorLabel = (line: string) =>
    en ? line.replace(/^الطبيب:\s*/, `${LABELS.doctor.en}: `) : line;

  // --- header -------------------------------------------------------------------------------
  const logoBox = LOGO_PX[s.logoSize];
  const logoImg =
    s.logoSize === "none"
      ? ""
      : logoImgHtml(p.logo, logoBox.h, logoBox.w);

  const contact: string[] = [];
  if (show.clinicPhone && p.clinicPhone) contact.push(`<span class="ltr">${LRM}${esc(p.clinicPhone)}</span>`);
  if (show.clinicAddress && p.clinicAddress?.trim()) contact.push(`<span>${esc(p.clinicAddress.trim())}</span>`);
  if (show.clinicEmail && p.clinicEmail?.trim()) contact.push(`<span class="ltr">${esc(p.clinicEmail.trim())}</span>`);
  if (show.leadDoctor && p.leadDoctorName?.trim()) {
    const dn = p.leadDoctorName.replace(/^Dr\.?\s*/i, "").replace(/^د\.?\s*/, "").trim();
    contact.push(`<span class="strong" style="font-weight:700;">${en ? "Dr. " : "د. "}${esc(dn)}</span>`);
  }
  const contactHtml = contact.join(thermal ? "<br/>" : ` <span class="faint">•</span> `);

  const title = kind === "payment" ? L("titlePayment") : L("titleStatement");
  const metaHtml = `
    <div class="meta">${L("number")}: <span class="mono strong">${esc(p.receiptSerial)}</span></div>
    <div class="meta">${L("date")}: <span>${esc(fmtDateTime(p.printedAtIso, s.language))}</span></div>`;

  const headerHtml = thermal
    ? `<div class="hd">
        ${logoImg ? `<div class="logo">${logoImg}</div>` : ""}
        <div class="name">${esc(p.clinicName)}</div>
        <div class="contact">${contactHtml}</div>
        <div class="title">${title}</div>
        ${metaHtml}
      </div>`
    : `<div class="hd">
        <div class="left">
          ${logoImg ? `<div class="logo">${logoImg}</div>` : ""}
          <div style="min-width:0;">
            <div class="name">${esc(p.clinicName)}</div>
            <div class="contact">${contactHtml}</div>
          </div>
        </div>
        <div>
          <div class="title">${title}</div>
          ${metaHtml}
        </div>
      </div>`;

  const noteHtml = s.headerNote.trim() ? `<div class="note">${esc(s.headerNote.trim())}</div>` : "";

  // --- patient ------------------------------------------------------------------------------
  const cells: string[] = [];
  const cell = (label: string, value: string, span = false) =>
    thermal
      ? `<div><span class="lbl">${label}:</span> <span class="val strong" style="font-weight:700;">${value}</span></div>`
      : `<div class="${span ? "span" : ""}"><div class="lbl">${label}</div><div class="val">${value}</div></div>`;
  cells.push(cell(L("patient"), esc(p.patientName)));
  if (show.patientPhone) cells.push(cell(L("phone"), `<span class="ltr">${esc(p.patientPhone || "—")}</span>`));
  if (show.patientAgeSex && p.patientAgeSex?.trim())
    cells.push(cell(L("ageSex"), esc(en ? p.patientAgeSex.trim() : translateAgeSexAr(p.patientAgeSex.trim()))));
  if (show.patientFileNumber && p.patientFileNumber?.trim()) cells.push(cell(L("file"), `<span class="mono">${esc(p.patientFileNumber.trim())}</span>`));
  if (show.patientAddress && p.patientAddress?.trim()) cells.push(cell(L("address"), esc(p.patientAddress.trim()), true));
  const patientHtml = `<div class="pb">${cells.join("")}</div>`;

  // --- items ---------------------------------------------------------------------------------
  const detailsOf = (row: ReceiptPdfProcedureRow) => {
    const bits: string[] = [];
    if (show.teeth && row.teeth) bits.push(`${L("teeth")}: ${esc(fmtTeethLabel(row.teeth, en))}`);
    if (show.pricingBreakdown && row.pricingBreakdown) bits.push(esc(row.pricingBreakdown));
    if (show.doctorPerItem && row.doctorLine) bits.push(esc(doctorLabel(row.doctorLine)));
    return bits.join(" · ");
  };

  const amountCell = (row: { amount: number; listPrice?: number; discountAmount?: number }) => {
    const discount = Number(row.discountAmount) || 0;
    const listed = Number(row.listPrice) || 0;
    // A discount is shown as struck-through list price above the charged amount, so the patient
    // can see what they were given rather than only a number that happens to be lower.
    return show.discounts && discount > 0 && listed > row.amount
      ? `<div class="strike">${money(listed)}</div><div class="off">-${money(discount)}</div><div class="strong">${money(row.amount)}</div>`
      : `<span class="strong">${money(row.amount)}</span>`;
  };

  let itemsHtml = "";
  if (kind === "statement") {
    const rows = p.procedures
      .map((row) => {
        const details = detailsOf(row);
        if (eta) {
          const unit = Number(row.listPrice) > 0 ? Number(row.listPrice) : row.amount;
          const disc = show.discounts ? Number(row.discountAmount) || 0 : 0;
          return `<tr>
            <td class="muted" style="white-space:nowrap;font-size:10.5px;">${esc(row.date || "—")}</td>
            <td><div class="strong">${esc(row.procedureLine)}</div>${details ? `<div class="muted" style="font-size:10px;margin-top:2px;">${details}</div>` : ""}</td>
            <td class="num">1</td>
            <td class="num">${money(unit)}</td>
            <td class="num">${disc > 0 ? money(disc) : "—"}</td>
            <td class="num strong">${money(row.amount)}</td>
          </tr>`;
        }
        return `<tr>
          <td class="muted" style="white-space:nowrap;font-size:10.5px;">${esc(row.date || "—")}</td>
          <td><div class="strong">${esc(row.procedureLine)}</div>${show.teeth && row.teeth ? `<div class="muted" style="font-size:10px;margin-top:2px;">${L("teeth")}: <b>${esc(fmtTeethLabel(row.teeth, en))}</b></div>` : ""}</td>
          <td class="muted" style="font-size:10px;">${[show.pricingBreakdown && row.pricingBreakdown ? esc(row.pricingBreakdown) : "", show.doctorPerItem && row.doctorLine ? esc(doctorLabel(row.doctorLine)) : ""].filter(Boolean).join(" · ") || "—"}</td>
          <td class="num">${amountCell(row)}</td>
        </tr>`;
      })
      .join("");
    const head = eta
      ? `<th>${L("date")}</th><th>${L("procedure")}</th><th class="num">${L("qty")}</th><th class="num">${L("unitPrice")}</th><th class="num">${L("discount")}</th><th class="num">${L("lineTotal")}</th>`
      : `<th>${L("date")}</th><th>${L("procedure")}</th><th>${L("details")}</th><th class="num" style="width:100px;">${L("amount")}</th>`;
    itemsHtml = `<h4>${L("services")}</h4>
      <table><thead><tr>${head}</tr></thead>
      <tbody>${rows || `<tr><td colspan="${eta ? 6 : 4}" class="faint" style="text-align:center;padding:20px;">${L("noProcedures")}</td></tr>`}</tbody></table>`;

    if (show.paymentsHistory && p.payments.length > 0) {
      const payRows = p.payments
        .map(
          (row) => `<tr>
            <td class="muted" style="white-space:nowrap;font-size:10.5px;">${esc(row.date || "—")}</td>
            <td class="muted">${esc(row.description || "—")}</td>
            ${show.paymentMethod ? `<td class="muted">${esc(row.method || "—")}</td>` : ""}
            <td class="num strong">${money(row.amount)}</td>
          </tr>`
        )
        .join("");
      itemsHtml += `<h4 style="margin-top:22px;">${L("paymentsLog")}</h4>
        <table><thead><tr><th>${L("date")}</th><th>${L("description")}</th>${show.paymentMethod ? `<th>${L("method")}</th>` : ""}<th class="num" style="width:100px;">${L("paid")}</th></tr></thead>
        <tbody>${payRows}</tbody></table>`;
    }
  } else if (p.payment) {
    const pay = p.payment;
    const charge = pay.charge;
    const lineDesc = charge ? esc(charge.description) : L("onAccount");
    const partial = !!charge && charge.remainingAfter > 0.005;
    const subBits: string[] = [];
    if (charge && show.teeth && charge.teeth) subBits.push(`${L("teeth")}: ${esc(fmtTeethLabel(charge.teeth, en))}`);
    if (charge && show.doctorPerItem && charge.doctorLine) subBits.push(esc(doctorLabel(charge.doctorLine)));
    if (partial) subBits.push(en ? "Partial payment" : "دفعة جزئية");

    // The big line: how much was received. This is what the patient looks at.
    const payHtml = `<div class="pay">
      <div>
        <div class="lbl muted">${L("received")}</div>
        <div class="strong" style="font-size:13px;margin-top:4px;">${L("forCharge")}: ${lineDesc}</div>
        ${subBits.length ? `<div class="muted" style="font-size:10.5px;margin-top:2px;">${subBits.join(" · ")}</div>` : ""}
      </div>
      <div class="big">${money(pay.amount)}</div>
    </div>`;

    const rows: string[] = [];
    if (eta) {
      rows.push(`<tr>
        <td>${lineDesc}${subBits.length ? `<div class="muted" style="font-size:10px;margin-top:2px;">${subBits.join(" · ")}</div>` : ""}</td>
        <td class="num">1</td>
        <td class="num">${money(pay.amount)}</td>
        <td class="num">—</td>
        <td class="num strong">${money(pay.amount)}</td>
      </tr>`);
    }
    const detailRows: string[] = [];
    if (show.paymentMethod) detailRows.push(`<div class="row"><span class="muted">${L("method")}</span><span class="strong">${esc(pay.method || (en ? "Cash" : "نقدي"))}</span></div>`);
    if (show.collectedBy && pay.collectedBy) detailRows.push(`<div class="row"><span class="muted">${L("collectedBy")}</span><span class="strong">${esc(pay.collectedBy)}</span></div>`);
    if (charge && show.chargeProgress) {
      detailRows.push(`<div class="row"><span class="muted">${L("chargeCost")}</span><span>${show.discounts && (Number(charge.discountAmount) || 0) > 0 && Number(charge.listPrice) > charge.cost ? `<span class="strike">${money(Number(charge.listPrice))}</span> ` : ""}<b>${money(charge.cost)}</b></span></div>`);
      if (charge.paidBefore > 0.005) detailRows.push(`<div class="row"><span class="muted">${L("paidBefore")}</span><span>${money(charge.paidBefore)}</span></div>`);
      detailRows.push(`<div class="row"><span class="muted">${L("remaining")}</span><span class="strong">${charge.remainingAfter > 0.005 ? money(charge.remainingAfter) : L("settled")}</span></div>`);
    }
    if (show.accountBalance) {
      const due = p.balance > 0.005;
      const credit = p.balance < -0.005;
      detailRows.push(`<div class="row grand ${due ? "due" : ""}"><span>${credit ? L("credit") : L("accountBalance")}</span><span>${due ? money(p.balance) : credit ? money(-p.balance) : L("settled")}</span></div>`);
    }

    itemsHtml = `${payHtml}
      ${eta ? `<table><thead><tr><th>${L("description")}</th><th class="num">${L("qty")}</th><th class="num">${L("unitPrice")}</th><th class="num">${L("discount")}</th><th class="num">${L("lineTotal")}</th></tr></thead><tbody>${rows.join("")}</tbody></table>` : ""}
      <div class="tt"><div class="box">${detailRows.join("")}</div></div>`;
  }

  // --- totals (statement) --------------------------------------------------------------------
  let totalsHtml = "";
  if (kind === "statement") {
    const due = p.balance > 0.005;
    const credit = p.balance < -0.005;
    totalsHtml = `<div class="tt"><div class="box">
      <div class="row"><span class="muted">${L("totalTreatment")}</span><span class="strong">${money(p.totalTreatment)}</span></div>
      ${show.discounts && p.totalDiscount > 0 ? `<div class="row"><span class="muted">${L("totalDiscount")}</span><span class="strong">${money(p.totalDiscount)}</span></div>` : ""}
      <div class="row"><span class="muted">${L("totalPaid")}</span><span class="strong">${money(p.totalPaid)}</span></div>
      <div class="row grand ${due ? "due" : ""}"><span>${due ? L("balanceDue") : credit ? L("credit") : L("status")}</span><span>${due ? money(p.balance) : credit ? money(-p.balance) : L("settled")}</span></div>
    </div></div>`;
  }

  // --- tax block -----------------------------------------------------------------------------
  let etaHtml = "";
  if (eta) {
    const e = s.eta;
    const gross = kind === "payment" && p.payment ? p.payment.amount : p.totalTreatment;
    const standard = e.vat === "standard" && e.vatRate > 0;
    const net = standard ? Math.round((gross / (1 + e.vatRate / 100)) * 100) / 100 : gross;
    const vat = Math.round((gross - net) * 100) / 100;
    const method = kind === "payment" && p.payment ? p.payment.method : "";
    const rowsLeft = [
      [L("rin"), `<span class="mono">${esc(e.rin)}</span>`],
      e.companyTradeName.trim() ? [L("tradeName"), esc(e.companyTradeName.trim())] : null,
      [L("branch"), `<span class="mono">${esc(e.branchCode)}</span>`],
      e.deviceSerialNumber ? [L("device"), `<span class="mono">${esc(e.deviceSerialNumber)}</span>`] : null,
      [L("activity"), `<span class="mono">${esc(e.activityCode)}</span>`],
      e.syndicateLicenseNumber ? [L("syndicate"), `<span class="mono">${esc(e.syndicateLicenseNumber)}</span>`] : null,
      [L("issuedUtc"), `<span class="mono">${esc(fmtUtc(p.printedAtIso))}</span>`],
      [L("buyerType"), L("buyerPerson")],
      kind === "payment" ? [L("methodCode"), `<span class="mono">${etaPaymentMethodCode(method)}</span>`] : null,
      standard ? [L("net"), money(net)] : null,
      [L("vat"), standard ? `${e.vatRate}% — ${money(vat)}` : L("vatExempt")],
      [L("total"), `<b>${money(gross)}</b>`],
      [L("uuid"), p.etaUuid ? `<span class="mono" style="font-size:9px;word-break:break-all;">${esc(p.etaUuid)}</span>` : `<span class="faint">${L("pendingEta")}</span>`],
    ].filter(Boolean) as [string, string][];
    const addr = [e.address.buildingNumber, e.address.street, e.address.regionCity, e.address.governate].filter((x) => x.trim()).join("، ");
    etaHtml = `<div class="eta">
      <div class="lbl strong" style="margin-bottom:6px;">${L("taxBlock")}</div>
      ${addr ? `<div class="muted" style="margin-bottom:6px;">${esc(addr)}</div>` : ""}
      <div class="${thermal ? "" : "grid"}">${rowsLeft.map(([k, v]) => `<div class="row"><span class="muted">${k}</span><span>${v}</span></div>`).join("")}</div>
    </div>`;
  }

  // --- footer --------------------------------------------------------------------------------
  const sigHtml = show.signatureLine ? `<div class="sig"><div>${L("signature")}</div></div>` : "";
  const footerHtml = show.footer
    ? `<div class="ft">${esc(s.footerText.trim() || L("footerDefault"))}</div>`
    : "";

  const dir = en ? "ltr" : "rtl";
  const lang = en ? "en" : "ar";
  const fontLink = `https://fonts.googleapis.com/css2?family=${FONT_FAMILIES[s.font].google}&amp;display=swap`;

  return `<!DOCTYPE html>
<html dir="${dir}" lang="${lang}">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>${esc(title)} - ${esc(p.patientName)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com"/>
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous"/>
  <link href="${fontLink}" rel="stylesheet"/>
  <style>${buildCss(s)}</style>
</head>
<body><div id="dental-receipt-container" class="r">
  ${headerHtml}
  ${noteHtml}
  ${patientHtml}
  ${itemsHtml}
  ${totalsHtml}
  ${etaHtml}
  ${sigHtml}
  ${footerHtml}
</div></body>
</html>`;
}

export type ReceiptLedgerTransaction = {
  id: string;
  date: string;
  description: string;
  type: string;
  cost: number;
  paid: number;
  method?: string;
  doctorName?: string;
  /** Charge before any discount, so the receipt can show what the patient was given. */
  listPrice?: number;
  discountAmount?: number;
  status?: string;
  procedureId?: string | null;
  receiptNumber?: string | null;
  addedBy?: string | null;
};

export function buildDentalReceiptPayloadFromLedger(options: {
  clinicName: string;
  clinicPhone: string;
  clinicAddress: string;
  clinicEmail?: string;
  leadDoctorName?: string;
  patientName: string;
  patientPhone: string;
  patientAddress?: string;
  patientAgeSex?: string;
  patientFileNumber?: string;
  patientId: string;
  currency?: string;
  transactions: ReceiptLedgerTransaction[];
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
        // The patient sees what came off. A discount that shows only as a smaller number is a
        // discount the clinic gets no credit for having given.
        listPrice: Number(item.listPrice) || undefined,
        discountAmount: Number(item.discountAmount) || undefined,
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

  // A statement is not a numbered receipt: it is printed on demand and carries a stamp of when.
  const serial = `ST-${options.patientId.slice(-6).toUpperCase()}-${Date.now().toString(36).toUpperCase()}`;
  const printedAtIso = new Date().toISOString();

  return {
    kind: "statement",
    clinicName: options.clinicName,
    clinicPhone: options.clinicPhone,
    clinicAddress: options.clinicAddress,
    clinicEmail: options.clinicEmail,
    leadDoctorName: options.leadDoctorName,
    receiptSerial: serial,
    printedAtIso,
    patientName: options.patientName,
    patientPhone: options.patientPhone,
    patientAddress: options.patientAddress,
    patientAgeSex: options.patientAgeSex,
    patientFileNumber: options.patientFileNumber,
    currency: options.currency,
    procedures,
    payments,
    totalTreatment: options.totals.totalTreatment,
    totalDiscount,
    totalPaid: options.totals.totalPaid,
    balance: options.totals.balance,
  };
}

/**
 * The receipt for ONE payment, from the patient's ledger.
 *
 * `paymentId` must be a payment row in `transactions`. The charge it settles, what was paid on
 * that charge before it, and the account balance are all worked out from the same rows, so the
 * receipt agrees with the finance screen it was printed from.
 */
export function buildPaymentReceiptPayload(options: {
  clinicName: string;
  clinicPhone: string;
  clinicAddress: string;
  clinicEmail?: string;
  leadDoctorName?: string;
  patientName: string;
  patientPhone: string;
  patientAddress?: string;
  patientAgeSex?: string;
  patientFileNumber?: string;
  patientId: string;
  currency?: string;
  paymentId: string;
  transactions: ReceiptLedgerTransaction[];
  /** When the payment row has no stored number (rows older than numbering), what to print instead. */
  fallbackSerial?: string;
}): DentalReceiptPdfPayload | null {
  const active = options.transactions.filter((t) => t.status !== "deleted" && t.status !== "cancelled");
  const payment = active.find((t) => t.id === options.paymentId && t.type === "payment");
  if (!payment) return null;

  const charge = payment.procedureId ? active.find((t) => t.id === payment.procedureId && t.type === "procedure") : undefined;

  let chargeBlock: ReceiptPdfSinglePayment["charge"];
  if (charge) {
    const parsed = parseLedgerProcedureDescription(charge.description);
    // "Before" means every other payment on this charge dated on or before this one — the same
    // order the statement lists them in, so the two documents never disagree about who was first.
    const paidBefore = active
      .filter((t) => t.type === "payment" && t.procedureId === charge.id && t.id !== payment.id)
      .filter((t) => (t.date || "") < (payment.date || "") || ((t.date || "") === (payment.date || "") && t.id < payment.id))
      .reduce((s, t) => s + (Number(t.paid) || 0), 0);
    const cost = Number(charge.cost) || 0;
    const dn = charge.doctorName?.trim();
    chargeBlock = {
      description: parsed.procedureLine,
      teeth: parsed.teeth,
      doctorLine: dn ? `الطبيب: ${dn.replace(/^Dr\.?\s*/i, "").trim()}` : undefined,
      cost,
      listPrice: Number(charge.listPrice) || undefined,
      discountAmount: Number(charge.discountAmount) || undefined,
      paidBefore,
      remainingAfter: Math.max(0, cost - paidBefore - (Number(payment.paid) || 0)),
    };
  }

  // The account balance AFTER this payment: every charge, minus every payment up to and
  // including this one. Later payments do not belong on a receipt dated before them.
  const upToHere = active.filter(
    (t) =>
      t.type === "procedure" ||
      (t.type === "payment" &&
        ((t.date || "") < (payment.date || "") || ((t.date || "") === (payment.date || "") && t.id <= payment.id)))
  );
  const totalTreatment = upToHere.reduce((s, t) => s + (t.type === "procedure" ? Number(t.cost) || 0 : 0), 0);
  const totalPaid = upToHere.reduce((s, t) => s + (t.type === "payment" ? Number(t.paid) || 0 : 0), 0);

  return {
    kind: "payment",
    clinicName: options.clinicName,
    clinicPhone: options.clinicPhone,
    clinicAddress: options.clinicAddress,
    clinicEmail: options.clinicEmail,
    leadDoctorName: options.leadDoctorName,
    receiptSerial: payment.receiptNumber?.trim() || options.fallbackSerial || `P-${payment.id.slice(-8).toUpperCase()}`,
    printedAtIso: new Date().toISOString(),
    patientName: options.patientName,
    patientPhone: options.patientPhone,
    patientAddress: options.patientAddress,
    patientAgeSex: options.patientAgeSex,
    patientFileNumber: options.patientFileNumber,
    currency: options.currency,
    procedures: [],
    payments: [],
    totalTreatment,
    totalDiscount: 0,
    totalPaid,
    balance: totalTreatment - totalPaid,
    payment: {
      ledgerId: payment.id,
      amount: Number(payment.paid) || 0,
      method: payment.method || "",
      description: payment.description || "",
      date: payment.date || "",
      collectedBy: payment.addedBy?.trim() || undefined,
      charge: chargeBlock,
    },
  };
}

/** Sample data for the settings screen's live preview. Never printed for a real patient. */
export function sampleReceiptPayload(kind: "payment" | "statement", clinic: {
  clinicName: string;
  clinicPhone: string;
  clinicAddress: string;
  clinicEmail?: string;
  leadDoctorName?: string;
  currency?: string;
  logo?: ClinicLogoAsset;
}): DentalReceiptPdfPayload {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const lastWeek = new Date(now.getTime() - 7 * 86400000).toISOString().slice(0, 10);
  const transactions: ReceiptLedgerTransaction[] = [
    { id: "p1", date: lastWeek, description: "Root canal treatment (T: 36)", type: "procedure", cost: 2500, paid: 0, doctorName: "Dr. Sara Ahmed", listPrice: 3000, discountAmount: 500 },
    { id: "p2", date: today, description: "Composite filling (T: 14)", type: "procedure", cost: 800, paid: 0, doctorName: "Dr. Sara Ahmed" },
    { id: "y1", date: lastWeek, description: "Payment for root canal", type: "payment", cost: 0, paid: 1500, method: "Cash", procedureId: "p1", addedBy: "Mona", receiptNumber: "R-2026-0041" },
    { id: "y2", date: today, description: "Payment for root canal", type: "payment", cost: 0, paid: 1000, method: "Visa", procedureId: "p1", addedBy: "Mona", receiptNumber: "R-2026-0042" },
  ];
  const base = {
    ...clinic,
    patientName: "Ahmed Mahmoud",
    patientPhone: "+20 100 123 4567",
    patientAddress: "12 El Nozha St., Heliopolis",
    patientAgeSex: "34 yr · Male",
    patientFileNumber: "PT-1042",
    patientId: "sample",
    transactions,
  };
  if (kind === "payment") {
    return { ...buildPaymentReceiptPayload({ ...base, paymentId: "y2" })!, logo: clinic.logo };
  }
  const totalTreatment = 3300;
  const totalPaid = 2500;
  return {
    ...buildDentalReceiptPayloadFromLedger({ ...base, totals: { totalTreatment, totalPaid, balance: totalTreatment - totalPaid } }),
    receiptSerial: "ST-SAMPLE",
    logo: clinic.logo,
  };
}
