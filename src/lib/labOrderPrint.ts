/**
 * Driving the printer for a lab order.
 *
 * The sheet itself is built by `labOrderHtml.ts`, which is Firebase-free so the layout can be
 * tested and rendered without a browser. This module is the part that touches the world: it
 * reads the clinic header, resolves the logo, encodes the QR, and gets a print dialog open.
 *
 * **An iframe, and `document.write`.** Both deliberate, both for reasons this codebase has
 * already paid for: `globals.css` sets a GLOBAL `@media print { @page { size: A5 } }` with a
 * mint-green body, so anything printed from a live page comes out A5 and coloured — the
 * generated document never loads that stylesheet. And `srcdoc` + onload has a blank-frame race
 * on slower machines that `document.write` does not.
 */

import { getDoc } from "firebase/firestore";
import QRCode from "qrcode";
import { getClinicDoc } from "@/lib/db-utils";
import { clinicLogoImgHtml, getClinicLogo, NO_CLINIC_LOGO, type ClinicLogoAsset } from "@/lib/clinicLogo";
import { buildLabOrderSrcDoc, isCompactPaper, type LabOrderClinic } from "@/lib/labOrderHtml";
import { buildLabStatementSrcDoc, type LabStatementPayload } from "@/lib/labStatementHtml";
import type { LabCase, LabOrderPaper } from "@/lib/labCases";

export type { LabOrderClinic } from "@/lib/labOrderHtml";
export { buildLabOrderSrcDoc } from "@/lib/labOrderHtml";

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
 * The clinic header.
 *
 * `settings/clinic_info` and not `settings/clinicProfile` — there are two clinic settings
 * documents holding different fields, and every print header in this app reads the first. The
 * profile document is only consulted for the logo, which `getClinicLogo()` does itself.
 */
export async function loadLabOrderClinic(branchName: string): Promise<LabOrderClinic> {
  try {
    const snap = await getDoc(getClinicDoc("settings", "clinic_info"));
    const d = snap.exists() ? (snap.data() as Record<string, unknown>) : {};
    return {
      name: String(d.name || d.clinicName || "").trim(),
      phone: String(d.phone || "").trim(),
      address: String(d.address || "").trim(),
      branchName,
    };
  } catch {
    return { name: "", phone: "", address: "", branchName };
  }
}

// ---------------------------------------------------------------------------
// Pieces of the page
// ---------------------------------------------------------------------------

/**
 * Open a built document in a hidden iframe and fire the print dialog.
 *
 * Extracted from `printLabOrder` when statements arrived, because every guard in here was paid for
 * by a bug: the readyState check (document.write can finish before a load listener is attached, and
 * the dialog then never opens), the image wait, the font settle without which Arabic prints
 * disconnected, and firing print() off the await chain so the caller's toast appears as the dialog
 * opens rather than after the user dismisses it.
 */
async function printSrcDoc(srcDoc: string): Promise<void> {
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

  if (doc.readyState !== "complete") {
    await waitFor((done) => win.addEventListener("load", done, { once: true }), 8000);
  }
  await waitForImages(doc);
  await delay(500);

  window.setTimeout(() => {
    try {
      win.focus();
      win.print();
    } catch (err) {
      console.error("Lab print failed", err);
    } finally {
      window.setTimeout(() => iframe.remove(), 2000);
    }
  }, 0);
}

/** The statement a clinic settles a lab against. */
export async function printLabStatement(payload: LabStatementPayload): Promise<void> {
  await printSrcDoc(buildLabStatementSrcDoc(payload));
}

export async function printLabOrder(options: {
  labCase: LabCase;
  clinic: LabOrderClinic;
  language: "en" | "ar";
  paper: LabOrderPaper;
  logo?: ClinicLogoAsset;
}): Promise<void> {
  const { labCase, clinic, language, paper } = options;

  const [qrDataUrl, logo] = await Promise.all([
    QRCode.toDataURL(labCase.code, { width: 240, margin: 0, color: { dark: "#14171A", light: "#FFFFFF" } }).catch(
      // A missing QR is a smaller failure than a missing order: the code is still printed as
      // text beside it, and text is what anyone actually types into the search box.
      () => ""
    ),
    options.logo ? Promise.resolve(options.logo) : getClinicLogo().catch(() => NO_CLINIC_LOGO),
  ]);

  // `allow: "any"` because this is the native-print path, where a remote Storage URL loads fine.
  // The inline-only default exists for the html2canvas generators, and using it here would drop
  // the logo from every clinic whose upload was too large to inline.
  const compact = isCompactPaper(paper);
  const logoHtml = clinicLogoImgHtml(logo, {
    maxHeight: compact ? 26 : 34,
    maxWidth: 110,
    allow: "any",
  });

  const srcDoc = buildLabOrderSrcDoc(labCase, clinic, qrDataUrl, logoHtml, language, paper);
  await printSrcDoc(srcDoc);
}
