/**
 * The clinic's receipt settings — `clinics/{id}/settings/receipt`.
 *
 * Pure data and pure functions, shared by the browser (the settings screen, the print path), the
 * ledger API route (which stamps every payment with its receipt number) and the tests. Nothing in
 * here touches Firestore or the DOM.
 *
 * ## Why a receipt has settings at all
 *
 * The receipt used to be one hard-coded Arabic statement: every clinic printed the same layout,
 * with the same wording, in the same colours, and a receipt number that was invented on the spot
 * and never stored. Two things forced a rethink:
 *
 * 1. Clinics want their paper to look like theirs — a logo size, an accent, a font, which lines
 *    are shown, what the footer says.
 * 2. The Egyptian Tax Authority's e-receipt system (docs/plans/e-receipt-research.md) expects a
 *    receipt to carry a sequential number, the clinic's tax registration number and branch
 *    address, one line per item with quantity and unit price, a tax line (medical services are
 *    VAT-exempt: T1/V003) and the payment method — none of which the old receipt had. Phase 1 puts
 *    every one of those fields on the paper; Phase 2 (sending the JSON to the ETA and printing the
 *    real QR) needs the clinic's ETA credentials and is not built here.
 *
 * ## Numbering
 *
 * `settings/receipt_counter` holds the last sequence used. It is bumped inside the same server
 * transaction that creates the payment, so a number can never be skipped or reused, and it is on
 * the restore DENY list for the same reason `settings/counters` is: rewinding it would stamp new
 * payments with numbers already on paper in patients' hands.
 */

export const RECEIPT_SETTINGS_DOC = "receipt";
export const RECEIPT_COUNTER_DOC = "receipt_counter";

export type ReceiptTemplate = "classic" | "modern" | "minimal" | "thermal";
export type ReceiptFont = "tajawal" | "cairo" | "noto-naskh" | "ibm-plex";
export type ReceiptPaper = "a4" | "a5" | "thermal80";
export type ReceiptLanguage = "ar" | "en" | "both";
export type ReceiptLogoSize = "none" | "small" | "medium" | "large";

/** Which blocks and lines the receipt prints. Every switch defaults to on except the two that add noise. */
export type ReceiptShowFlags = {
  clinicPhone: boolean;
  clinicAddress: boolean;
  clinicEmail: boolean;
  leadDoctor: boolean;
  patientPhone: boolean;
  patientAddress: boolean;
  patientAgeSex: boolean;
  patientFileNumber: boolean;
  teeth: boolean;
  pricingBreakdown: boolean;
  doctorPerItem: boolean;
  discounts: boolean;
  paymentMethod: boolean;
  collectedBy: boolean;
  /** On a single-payment receipt: the running position of the charge it settles (paid so far / remaining). */
  chargeProgress: boolean;
  /** On a single-payment receipt: the patient's overall balance after this payment. */
  accountBalance: boolean;
  /** On a statement: the payments table. */
  paymentsHistory: boolean;
  /** A line under the totals for a handwritten signature. Off by default — the footer says no signature is needed. */
  signatureLine: boolean;
  footer: boolean;
};

export type ReceiptEtaSettings = {
  /** Print the tax block (registration number, branch, item table with unit prices, VAT line). */
  enabled: boolean;
  /** Tax registration number — `seller.rin`. */
  rin: string;
  /** Registered trade name if it differs from the clinic name on the letterhead — `seller.companyTradeName`. */
  companyTradeName: string;
  /** `seller.branchCode`, as registered on the ETA portal. */
  branchCode: string;
  /** `seller.deviceSerialNumber` of the registered POS. */
  deviceSerialNumber: string;
  /** `seller.activityCode` from the ETA activity list. */
  activityCode: string;
  /** `seller.syndicateLicenseNumber` — the dentist's syndicate number. Optional in the schema. */
  syndicateLicenseNumber: string;
  /** Medical services are VAT-exempt (T1/V003). "standard" charges `vatRate`. */
  vat: "exempt" | "standard";
  vatRate: number;
  /** `seller.branchAddress`, structured as the ETA wants it. */
  address: {
    governate: string;
    regionCity: string;
    street: string;
    buildingNumber: string;
    postalCode: string;
  };
};

export type ReceiptSettings = {
  template: ReceiptTemplate;
  /** Hex colour for headings, rules and the total band. */
  accent: string;
  font: ReceiptFont;
  paper: ReceiptPaper;
  language: ReceiptLanguage;
  logoSize: ReceiptLogoSize;
  /** A line under the title, e.g. "Thank you for visiting". Blank prints nothing. */
  headerNote: string;
  /** Replaces the default "generated automatically, no signature required" line. Blank keeps the default. */
  footerText: string;
  /** Receipt-number prefix. `R-` and sequence 12 in 2026 print as R-2026-0012 when `numberIncludesYear` is on. */
  numberPrefix: string;
  numberIncludesYear: boolean;
  /** Open the print dialog for the receipt as soon as a payment is saved. */
  autoPrintAfterPayment: boolean;
  show: ReceiptShowFlags;
  eta: ReceiptEtaSettings;
  updatedAt?: string;
};

export const DEFAULT_RECEIPT_SHOW: ReceiptShowFlags = {
  clinicPhone: true,
  clinicAddress: true,
  clinicEmail: false,
  leadDoctor: true,
  patientPhone: true,
  patientAddress: false,
  patientAgeSex: true,
  patientFileNumber: true,
  teeth: true,
  pricingBreakdown: true,
  doctorPerItem: true,
  discounts: true,
  paymentMethod: true,
  collectedBy: true,
  chargeProgress: true,
  accountBalance: true,
  paymentsHistory: true,
  signatureLine: false,
  footer: true,
};

export const DEFAULT_RECEIPT_ETA: ReceiptEtaSettings = {
  enabled: false,
  rin: "",
  companyTradeName: "",
  branchCode: "0",
  deviceSerialNumber: "",
  activityCode: "8620", // ISIC: medical and dental practice activities
  syndicateLicenseNumber: "",
  vat: "exempt",
  vatRate: 14,
  address: { governate: "", regionCity: "", street: "", buildingNumber: "", postalCode: "" },
};

export const DEFAULT_RECEIPT_SETTINGS: ReceiptSettings = {
  template: "classic",
  accent: "#111827",
  font: "tajawal",
  paper: "a4",
  language: "ar",
  logoSize: "medium",
  headerNote: "",
  footerText: "",
  numberPrefix: "R-",
  numberIncludesYear: true,
  autoPrintAfterPayment: false,
  show: DEFAULT_RECEIPT_SHOW,
  eta: DEFAULT_RECEIPT_ETA,
};

const TEMPLATES: ReceiptTemplate[] = ["classic", "modern", "minimal", "thermal"];
const FONTS: ReceiptFont[] = ["tajawal", "cairo", "noto-naskh", "ibm-plex"];
const PAPERS: ReceiptPaper[] = ["a4", "a5", "thermal80"];
const LANGUAGES: ReceiptLanguage[] = ["ar", "en", "both"];
const LOGO_SIZES: ReceiptLogoSize[] = ["none", "small", "medium", "large"];

function pick<T extends string>(value: unknown, allowed: T[], fallback: T): T {
  return typeof value === "string" && (allowed as string[]).includes(value) ? (value as T) : fallback;
}

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function hex(value: unknown, fallback: string): string {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value) ? value.toLowerCase() : fallback;
}

/**
 * Whatever is stored, or nothing at all, into a complete settings object. Every field has a
 * default, so a clinic that never opened the screen prints exactly what it printed before this
 * screen existed — the classic Arabic A4 receipt.
 */
export function normalizeReceiptSettings(raw: unknown): ReceiptSettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const show = (r.show && typeof r.show === "object" ? r.show : {}) as Record<string, unknown>;
  const eta = (r.eta && typeof r.eta === "object" ? r.eta : {}) as Record<string, unknown>;
  const addr = (eta.address && typeof eta.address === "object" ? eta.address : {}) as Record<string, unknown>;

  const showOut = {} as ReceiptShowFlags;
  for (const key of Object.keys(DEFAULT_RECEIPT_SHOW) as (keyof ReceiptShowFlags)[]) {
    showOut[key] = bool(show[key], DEFAULT_RECEIPT_SHOW[key]);
  }

  const vatRate = Number(eta.vatRate);

  return {
    template: pick(r.template, TEMPLATES, DEFAULT_RECEIPT_SETTINGS.template),
    accent: hex(r.accent, DEFAULT_RECEIPT_SETTINGS.accent),
    font: pick(r.font, FONTS, DEFAULT_RECEIPT_SETTINGS.font),
    paper: pick(r.paper, PAPERS, DEFAULT_RECEIPT_SETTINGS.paper),
    language: pick(r.language, LANGUAGES, DEFAULT_RECEIPT_SETTINGS.language),
    logoSize: pick(r.logoSize, LOGO_SIZES, DEFAULT_RECEIPT_SETTINGS.logoSize),
    headerNote: str(r.headerNote).slice(0, 200),
    footerText: str(r.footerText).slice(0, 300),
    numberPrefix: str(r.numberPrefix, DEFAULT_RECEIPT_SETTINGS.numberPrefix).slice(0, 12),
    numberIncludesYear: bool(r.numberIncludesYear, DEFAULT_RECEIPT_SETTINGS.numberIncludesYear),
    autoPrintAfterPayment: bool(r.autoPrintAfterPayment, false),
    show: showOut,
    eta: {
      enabled: bool(eta.enabled, false),
      rin: str(eta.rin).trim().slice(0, 30),
      companyTradeName: str(eta.companyTradeName).trim().slice(0, 200),
      branchCode: str(eta.branchCode, DEFAULT_RECEIPT_ETA.branchCode).trim().slice(0, 50) || "0",
      deviceSerialNumber: str(eta.deviceSerialNumber).trim().slice(0, 100),
      activityCode: str(eta.activityCode, DEFAULT_RECEIPT_ETA.activityCode).trim().slice(0, 10),
      syndicateLicenseNumber: str(eta.syndicateLicenseNumber).trim().slice(0, 30),
      vat: eta.vat === "standard" ? "standard" : "exempt",
      vatRate: Number.isFinite(vatRate) && vatRate >= 0 && vatRate <= 100 ? vatRate : DEFAULT_RECEIPT_ETA.vatRate,
      address: {
        governate: str(addr.governate).trim().slice(0, 100),
        regionCity: str(addr.regionCity).trim().slice(0, 100),
        street: str(addr.street).trim().slice(0, 200),
        buildingNumber: str(addr.buildingNumber).trim().slice(0, 100),
        postalCode: str(addr.postalCode).trim().slice(0, 30),
      },
    },
    ...(typeof r.updatedAt === "string" ? { updatedAt: r.updatedAt } : {}),
  };
}

/**
 * The printed receipt number for a sequence value.
 *
 *   R-2026-0012   prefix "R-", year on, sequence 12
 *   R-0012        prefix "R-", year off
 *   0012          no prefix
 *
 * Four digits minimum so numbers sort as text the way they sort as numbers, until a clinic passes
 * 9,999 receipts in a year — after which they simply get longer.
 */
export function formatReceiptNumber(
  settings: Pick<ReceiptSettings, "numberPrefix" | "numberIncludesYear">,
  seq: number,
  date: Date | string = new Date()
): string {
  const n = Math.max(1, Math.floor(Number(seq) || 1));
  const d = typeof date === "string" ? new Date(date) : date;
  const year = Number.isNaN(d.getTime()) ? new Date().getFullYear() : d.getFullYear();
  const digits = String(n).padStart(4, "0");
  return `${settings.numberPrefix}${settings.numberIncludesYear ? `${year}-` : ""}${digits}`;
}

/**
 * The ETA payment-method code for what the clinic records on the payment row.
 *
 * The ETA list: C cash, V visa/card, CC cash with contractor, VC visa with contractor, VO voucher,
 * PR promotion, GC gift card, P points, O other. Bank transfers and wallets have no code of their
 * own and go under "O". Matching is by keyword, in English or Arabic, because the method field is
 * free text that different screens filled in differently.
 */
export function etaPaymentMethodCode(method: string | null | undefined): "C" | "V" | "O" {
  const m = String(method || "").trim().toLowerCase();
  if (!m || /cash|نقد|كاش/.test(m)) return "C";
  if (/visa|card|كارت|بطاقة|فيزا|master|credit|debit|pos/.test(m)) return "V";
  return "O";
}

/** Everything the ETA block needs to be worth printing: the switch is on and a registration number exists. */
export function etaBlockReady(settings: ReceiptSettings): boolean {
  return settings.eta.enabled && settings.eta.rin.trim().length > 0;
}

/** Are the mandatory seller fields of Receipt v1.2 all filled in? What a clinic still owes before Phase 2. */
export function etaMissingFields(settings: ReceiptSettings): string[] {
  const e = settings.eta;
  const missing: string[] = [];
  if (!e.rin.trim()) missing.push("rin");
  if (!e.branchCode.trim()) missing.push("branchCode");
  if (!e.deviceSerialNumber.trim()) missing.push("deviceSerialNumber");
  if (!e.activityCode.trim()) missing.push("activityCode");
  if (!e.address.governate.trim()) missing.push("address.governate");
  if (!e.address.regionCity.trim()) missing.push("address.regionCity");
  if (!e.address.street.trim()) missing.push("address.street");
  if (!e.address.buildingNumber.trim()) missing.push("address.buildingNumber");
  return missing;
}
