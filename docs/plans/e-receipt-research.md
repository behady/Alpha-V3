# Egyptian e-receipt (ETA) research — 2026-09-26

## What the law actually requires

- The Egyptian Tax Authority (ETA) runs the **Electronic Receipt System (ERS)** for B2C sales. It is separate from e-invoicing (B2B).
- An e-receipt is a **JSON document submitted to the ETA platform** from a *registered POS/ERP*. A PDF, image or paper slip on its own is **not** a valid e-receipt. Submission must happen within **24 hours** of issuance; later submissions are rejected.
- Rollout is by decision + annex of named taxpayers (e.g. Decision 38/2024 health sector Greater Cairo + Alexandria from 2025-03-15; Decision 281/2025 from 2025-09-15; Decision 361/2025 from 2025-11-15). Doctors examining patients in their own clinic are in scope once their tax file is named. A clinic checks whether it is obliged at **eta.gov.eg/ar/ereceipt-inquiry** with its tax registration number.
- Private clinics dealing only with individuals were exempt from *e-invoicing* (syndicate statement, 2023); that exemption does not cover *e-receipts* once the clinic is in a mandated phase.
- Medical services are **VAT-exempt** (Law 67/2016). On the receipt this is tax type `T1`, subtype `V003` (exempted good or service), amount 0.
- Penalty for non-compliance: up to EGP 50,000 per violation.

## What the clinic must have before submitting anything

1. Tax registration number (RIN) and a tax card.
2. Registration on the ETA e-receipt portal: authorized representative, POS/ERP registration, **device serial number**, branch code.
3. Client ID + client secret for the POS (issued by ETA), used to obtain an access token.
4. Item codes: every service coded as `EGS` (Egyptian coding) or `GS1`, approved for the taxpayer.
5. Activity code from the approved list.

## Receipt v1.2 document (fields that matter for a dental clinic)

Header: `dateTimeIssued` (UTC), `receiptNumber` (unique per branch), `uuid` (SHA256 of the canonical document), `previousUUID` (chain per device; empty only for the first), `currency` EGP.
DocumentType: `receiptType` "S" (sale) / "R" (return), `typeVersion` "1.2".
Seller: `rin`, `companyTradeName`, `branchCode`, `branchAddress` {country EG, governate, regionCity, street, buildingNumber}, `deviceSerialNumber`, `syndicateLicenseNumber` (optional), `activityCode`.
Buyer: `type` P (person) / B (business) / F (foreigner); `id` + `name` mandatory for B, or for P when total >= 150,000 EGP; `mobileNumber` optional.
ItemData[]: `internalCode`, `description`, `itemType` EGS/GS1, `itemCode`, `unitType` (EA), `quantity`, `unitPrice`, `netSale`, `totalSale`, `total`, discounts, `taxableItems[]` {taxType T1, subType V003, amount 0, rate 0}.
Totals: `totalSales`, `totalCommercialDiscount`, `netAmount`, `totalAmount`, `taxTotals[]`.
`paymentMethod`: C cash, V visa/card, CC cash with contractor, VC visa with contractor, VO voucher, PR promotion, GC gift card, P points, O other.

## What must be on the printed / shared copy

- QR code (content: ETA receipt URL + `#Total:{total},IssuerRIN:{rin}`), the UUID, receipt number, date and time to the second, seller name + RIN + address, items with quantity and unit price, discounts, tax line (VAT exempt), total, payment method, buyer name/mobile if given.

## Decision for the product

Phase 1 (now): a receipt that carries every printed field above so the paper copy is already in ETA layout, with a dedicated settings page (style + which blocks to show + tax identity fields). Receipt numbers become sequential per clinic.
Phase 2 (when a clinic has ETA credentials): submit the JSON to the ETA API from the server, store the returned UUID, render the real QR. Needs preprod credentials to test; cannot be built blind.

Sources: sdk.invoicing.eta.gov.eg (Receipt v1.2, payment methods, tax types, receipt FAQ), eta.gov.eg news, youm7 2023-04-14 and 2025-09-25, alborsaanews 2025-03-13, comarch.com on Resolution 281/2025, wafeq.com, daftra.com, pioneers-solutions.com.
