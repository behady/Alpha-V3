import { getClinicLogo } from "@/lib/clinicLogo";
import { DEFAULT_RECEIPT_SETTINGS, type ReceiptSettings } from "@/lib/receiptSettings";
import { buildDentalReceiptSrcDoc, type DentalReceiptPdfPayload } from "@/lib/receiptRender";
import { printSrcDoc } from "@/lib/printSrcDoc";

/**
 * The browser side of the receipt: everything that needs a DOM or Firebase.
 *
 * The receipt itself — its types, its HTML, the payload builders and the sample data — lives in
 * src/lib/receiptRender.ts, which imports nothing that cannot run in plain Node, so the tests can
 * render it. Every existing import from this module still works: it re-exports the lot.
 */
export * from "@/lib/receiptRender";

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

/**
 * Opens the print dialog on the receipt — in a hidden frame on desktop, in a tab of its own on a
 * phone or tablet (see src/lib/printSrcDoc.ts for why).
 *
 * Async because it resolves the clinic logo first; callers should await (or `void`) it. The
 * second argument used to be a filename that nothing read — the browser names the PDF itself —
 * and is now the settings to print with. A string is still accepted and ignored so older call
 * sites keep compiling.
 */
export async function downloadDentalReceiptPdf(
  payload: DentalReceiptPdfPayload,
  settingsOrFilename?: ReceiptSettings | string
): Promise<void> {
  const settings =
    settingsOrFilename && typeof settingsOrFilename === "object" ? settingsOrFilename : DEFAULT_RECEIPT_SETTINGS;
  const logo = payload.logo ?? (await getClinicLogo());
  const srcDoc = buildDentalReceiptSrcDoc({ ...payload, logo }, settings);
  await printSrcDoc(srcDoc, "Receipt");
}
