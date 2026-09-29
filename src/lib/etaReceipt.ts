/**
 * Egyptian Tax Authority "Receipt v1.2" document, built from a payment.
 *
 * This is the JSON the ETA e-receipt API takes (sdk.invoicing.eta.gov.eg/documents/receipt-v1-2).
 * Phase 1 uses it in two ways: the printed receipt's tax block is laid out from the same numbers,
 * and the tests pin the arithmetic the ETA validates (netAmount, totalAmount, tax totals). Phase 2
 * — signing the UUID against the previous receipt on the device and POSTing it — needs the
 * clinic's ETA client id, secret and a registered POS serial, so it stops at this object.
 *
 * Nothing here is rounded away from what the clinic charged: `totalAmount` is the money received,
 * and when VAT is "standard" the tax is carved OUT of that figure rather than added on top, because
 * a patient who paid 500 paid 500 — the receipt cannot claim 570.
 */

import { etaPaymentMethodCode, type ReceiptSettings } from "@/lib/receiptSettings";

export type EtaReceiptLine = {
  /** The clinic's own id for the service, e.g. the ledger row id. */
  internalCode: string;
  description: string;
  quantity: number;
  /** Unit price BEFORE discount. */
  unitPrice: number;
  discount: number;
};

export type EtaReceiptInput = {
  receiptNumber: string;
  /** ISO timestamp of issuance; emitted in UTC as the ETA requires. */
  issuedAtIso: string;
  clinicName: string;
  buyer: { name: string; mobile?: string };
  lines: EtaReceiptLine[];
  paymentMethod: string | null | undefined;
  currency?: string;
};

export type EtaReceiptDocument = {
  header: {
    dateTimeIssued: string;
    receiptNumber: string;
    uuid: string;
    previousUUID: string;
    currency: string;
    exchangeRate?: number;
  };
  documentType: { receiptType: "S"; typeVersion: "1.2" };
  seller: {
    rin: string;
    companyTradeName: string;
    branchCode: string;
    branchAddress: {
      country: "EG";
      governate: string;
      regionCity: string;
      street: string;
      buildingNumber: string;
      postalCode?: string;
    };
    deviceSerialNumber: string;
    syndicateLicenseNumber?: string;
    activityCode: string;
  };
  buyer: { type: "P"; name?: string; mobileNumber?: string };
  itemData: Array<{
    internalCode: string;
    description: string;
    itemType: "EGS";
    itemCode: string;
    unitType: "EA";
    quantity: number;
    unitPrice: number;
    netSale: number;
    totalSale: number;
    total: number;
    commercialDiscountData?: Array<{ amount: number; description: string }>;
    taxableItems: Array<{ taxType: "T1"; amount: number; subType: string; rate: number }>;
  }>;
  totalSales: number;
  totalCommercialDiscount: number;
  netAmount: number;
  feesAmount: 0;
  totalAmount: number;
  taxTotals: Array<{ taxType: "T1"; amount: number }>;
  paymentMethod: "C" | "V" | "O";
};

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

/** VAT subtype codes from the ETA tax-types table: V003 exempt, V001 general sales (standard rate). */
export const ETA_VAT_EXEMPT_SUBTYPE = "V003";
export const ETA_VAT_STANDARD_SUBTYPE = "V001";

/**
 * The EGS item code the ETA expects: `EG-{rin}-{internal code}`. A clinic has to have each code
 * approved on the ETA portal before Phase 2 can submit; the printed receipt shows it either way
 * so the codes on paper match what will be registered.
 */
export function etaItemCode(rin: string, internalCode: string): string {
  const safe = String(internalCode || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40) || "SERVICE";
  return `EG-${String(rin || "").trim() || "000000000"}-${safe}`;
}

export function buildEtaReceiptDocument(settings: ReceiptSettings, input: EtaReceiptInput): EtaReceiptDocument {
  const e = settings.eta;
  const standard = e.vat === "standard" && e.vatRate > 0;
  const rate = standard ? e.vatRate : 0;
  const subType = standard ? ETA_VAT_STANDARD_SUBTYPE : ETA_VAT_EXEMPT_SUBTYPE;

  let totalSales = 0;
  let totalDiscount = 0;
  let netAmount = 0;
  let totalAmount = 0;
  let taxTotal = 0;

  const itemData = input.lines.map((line) => {
    const qty = Math.max(1, Number(line.quantity) || 1);
    const gross = round2(qty * (Number(line.unitPrice) || 0));
    const discount = Math.min(gross, Math.max(0, round2(line.discount)));
    // What the patient actually paid for this line, tax included.
    const paid = round2(gross - discount);
    // Tax is inside the paid figure: net = paid / (1 + rate), tax = paid - net.
    const net = standard ? round2(paid / (1 + rate / 100)) : paid;
    const tax = round2(paid - net);

    totalSales = round2(totalSales + gross);
    totalDiscount = round2(totalDiscount + discount);
    netAmount = round2(netAmount + net);
    totalAmount = round2(totalAmount + paid);
    taxTotal = round2(taxTotal + tax);

    return {
      internalCode: line.internalCode,
      description: String(line.description || "").slice(0, 500),
      itemType: "EGS" as const,
      itemCode: etaItemCode(e.rin, line.internalCode),
      unitType: "EA" as const,
      quantity: qty,
      unitPrice: round2(line.unitPrice),
      netSale: net,
      totalSale: gross,
      total: paid,
      ...(discount > 0 ? { commercialDiscountData: [{ amount: discount, description: "Discount" }] } : {}),
      taxableItems: [{ taxType: "T1" as const, amount: tax, subType, rate }],
    };
  });

  const issued = new Date(input.issuedAtIso);
  const dateTimeIssued = (Number.isNaN(issued.getTime()) ? new Date() : issued).toISOString().replace(/\.\d{3}Z$/, "Z");
  const currency = (input.currency || "EGP").toUpperCase().slice(0, 3);

  return {
    header: {
      dateTimeIssued,
      receiptNumber: input.receiptNumber,
      // Phase 2: SHA-256 of the canonical document chained to the previous receipt on this device.
      uuid: "",
      previousUUID: "",
      currency,
      ...(currency !== "EGP" ? { exchangeRate: 1 } : {}),
    },
    documentType: { receiptType: "S", typeVersion: "1.2" },
    seller: {
      rin: e.rin,
      companyTradeName: e.companyTradeName.trim() || input.clinicName,
      branchCode: e.branchCode,
      branchAddress: {
        country: "EG",
        governate: e.address.governate,
        regionCity: e.address.regionCity,
        street: e.address.street,
        buildingNumber: e.address.buildingNumber,
        ...(e.address.postalCode ? { postalCode: e.address.postalCode } : {}),
      },
      deviceSerialNumber: e.deviceSerialNumber,
      ...(e.syndicateLicenseNumber ? { syndicateLicenseNumber: e.syndicateLicenseNumber } : {}),
      activityCode: e.activityCode,
    },
    buyer: {
      type: "P",
      ...(input.buyer.name ? { name: input.buyer.name.slice(0, 100) } : {}),
      ...(input.buyer.mobile ? { mobileNumber: input.buyer.mobile.slice(0, 30) } : {}),
    },
    itemData,
    totalSales,
    totalCommercialDiscount: totalDiscount,
    netAmount,
    feesAmount: 0,
    totalAmount,
    taxTotals: [{ taxType: "T1", amount: taxTotal }],
    paymentMethod: etaPaymentMethodCode(input.paymentMethod),
  };
}
