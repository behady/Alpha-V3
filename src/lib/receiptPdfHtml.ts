import { getClinicLogo } from "@/lib/clinicLogo";
import { DEFAULT_RECEIPT_SETTINGS, type ReceiptSettings } from "@/lib/receiptSettings";
import { buildDentalReceiptSrcDoc, type DentalReceiptPdfPayload } from "@/lib/receiptRender";

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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function waitFor(signal: (done: () => void) => void, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      resolve();
    };
    const timer = window.setTimeout(done, timeoutMs);
    signal(done);
  });
}

/**
 * The print dialog snapshots the page as it stands, so anything still loading is simply missing
 * from the printout. The clinic logo is the one image here, and it is the whole point of the
 * header — so wait for it (or give up after a moment) rather than printing a blank corner.
 */
function waitForImages(doc: Document, timeoutMs = 5000): Promise<void> {
  const pending = Array.from(doc.images).filter((img) => !img.complete);
  if (pending.length === 0) return Promise.resolve();
  return waitFor((done) => {
    let left = pending.length;
    const tick = () => {
      left -= 1;
      if (left <= 0) done();
    };
    for (const img of pending) {
      img.addEventListener("load", tick, { once: true });
      img.addEventListener("error", tick, { once: true });
    }
  }, timeoutMs);
}

/**
 * Opens the browser's print dialog on the receipt.
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

  const iframe = document.createElement("iframe");
  iframe.style.cssText = "position:absolute;width:0;height:0;border:none;visibility:hidden;";
  document.body.appendChild(iframe);

  const win = iframe.contentWindow;
  const doc = win?.document;
  if (!win || !doc) {
    iframe.remove();
    return;
  }

  doc.open();
  doc.write(srcDoc);
  doc.close();

  // readyState guard: document.write can complete before the listener is attached, and a missed
  // load event used to mean the print dialog never opened at all.
  if (doc.readyState !== "complete") {
    await waitFor((done) => win.addEventListener("load", done, { once: true }), 8000);
  }
  await waitForImages(doc);
  // Settle time for the webfont — Arabic shaping is wrong without it.
  await delay(500);

  // print() blocks until the user dismisses the dialog. Fire it off the await chain so callers
  // get control back as the dialog opens — they show an "opening receipt to print" toast, which
  // would otherwise only appear once the user had already finished printing.
  window.setTimeout(() => {
    try {
      win.focus();
      win.print();
    } catch (err) {
      console.error("Receipt print failed", err);
    } finally {
      window.setTimeout(() => iframe.remove(), 2000);
    }
  }, 0);
}

