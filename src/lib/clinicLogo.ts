import { db } from "@/lib/firebase";
import { getClinicProfile } from "@/lib/clinicProfile";
import { getGlobalClinicId } from "@/lib/db-utils";

/**
 * The clinic logo (`settings/clinicProfile.logoUrl`) resolved into every form the app needs it in.
 *
 * `dataUrl` is the one the PDF generators must use. They render through html2canvas, which draws
 * every <img> onto a canvas: a remote Storage URL there has to survive a CORS load, and when it
 * doesn't html2canvas sits out its 15s `imageTimeout` before giving up and rasterising the page
 * without the logo — a long stall for nothing. A data: URI can't taint the canvas and never
 * touches the network, so the PDF path is fast and deterministic.
 *
 * `url` is the raw Storage URL, kept for plain <img> display (the sidebar, the native print
 * iframe) where CORS never applies. It is the fallback when inlining failed.
 *
 * Every field is "" / 0 when no logo has been uploaded — which is the common case. Callers must
 * render nothing at all then, not an empty box.
 */
export type ClinicLogoAsset = {
  url: string;
  dataUrl: string;
  /** Natural pixels of whatever `dataUrl` holds; 0 when unknown (e.g. a dimensionless SVG). */
  width: number;
  height: number;
};

export const NO_CLINIC_LOGO: ClinicLogoAsset = { url: "", dataUrl: "", width: 0, height: 0 };

/**
 * Above this, the upload gets re-encoded smaller before being inlined: a 4 MB logo becomes
 * ~5.5 MB of base64 embedded in the markup of every single receipt and prescription.
 */
const INLINE_BYTES_LIMIT = 200 * 1024;
const MAX_INLINE_EDGE = 320;

function escAttr(s: string): string {
  return String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Could not read the logo file"));
    reader.readAsDataURL(blob);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not decode the logo image"));
    img.src = src;
  });
}

/** Fetches the logo and turns it into a data: URI, shrinking oversized uploads on the way. */
async function toInlineAsset(url: string): Promise<ClinicLogoAsset> {
  const res = await fetch(url, { mode: "cors", credentials: "omit" });
  if (!res.ok) throw new Error(`Logo fetch failed (${res.status})`);
  const blob = await res.blob();

  // A blob: URL is same-origin, so drawing it to a canvas never taints it — which is exactly
  // what would happen if we handed the remote Storage URL straight to drawImage().
  const objectUrl = URL.createObjectURL(blob);
  try {
    const img = await loadImage(objectUrl);
    const width = img.naturalWidth;
    const height = img.naturalHeight;

    const isSvg = blob.type.includes("svg");
    const oversized = blob.size > INLINE_BYTES_LIMIT && Math.max(width, height) > MAX_INLINE_EDGE;
    if (!oversized || isSvg || !width || !height) {
      return { url, dataUrl: await blobToDataUrl(blob), width, height };
    }

    const scale = MAX_INLINE_EDGE / Math.max(width, height);
    const w = Math.max(1, Math.round(width * scale));
    const h = Math.max(1, Math.round(height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return { url, dataUrl: await blobToDataUrl(blob), width, height };
    ctx.drawImage(img, 0, 0, w, h);
    // PNG, not JPEG: most clinic logos are transparent, and JPEG would flatten that to black.
    return { url, dataUrl: canvas.toDataURL("image/png"), width: w, height: h };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

// Keyed by clinic id, because a super-admin switching clinics must not print the previous
// clinic's logo. Only settled-successfully results land here; failures stay uncached so the
// next print retries instead of being permanently logo-less after one network blip.
const cache = new Map<string, ClinicLogoAsset>();
const inFlight = new Map<string, Promise<ClinicLogoAsset>>();

/**
 * Resolves the current clinic's logo, once per clinic per session.
 * Never throws and never blocks a print: any failure resolves to a blank/partial asset.
 */
export async function getClinicLogo(): Promise<ClinicLogoAsset> {
  if (typeof window === "undefined") return NO_CLINIC_LOGO;

  let clinicId: string;
  try {
    clinicId = getGlobalClinicId();
  } catch {
    return NO_CLINIC_LOGO; // No clinic selected yet — nothing to brand.
  }

  const cached = cache.get(clinicId);
  if (cached) return cached;
  const pending = inFlight.get(clinicId);
  if (pending) return pending;

  const request = (async (): Promise<{ asset: ClinicLogoAsset; cacheable: boolean }> => {
    const profile = await getClinicProfile(db);
    const url = profile?.logoUrl?.trim() ?? "";
    if (!url) return { asset: NO_CLINIC_LOGO, cacheable: true };
    try {
      return { asset: await toInlineAsset(url), cacheable: true };
    } catch (err) {
      // Hand back the raw URL anyway: plain <img> rendering needs no CORS, so the sidebar and
      // the natively-printed receipt can still show it. Only the html2canvas path loses out.
      console.warn("Could not inline the clinic logo; PDFs will print without it.", err);
      return { asset: { url, dataUrl: "", width: 0, height: 0 }, cacheable: false };
    }
  })()
    .then(({ asset, cacheable }) => {
      if (cacheable) cache.set(clinicId, asset);
      return asset;
    })
    .catch((err) => {
      console.warn("Could not load the clinic logo.", err);
      return NO_CLINIC_LOGO;
    })
    .finally(() => {
      inFlight.delete(clinicId);
    });

  inFlight.set(clinicId, request);
  return request;
}

/** Call after the logo is re-uploaded so the new one is picked up without a page reload. */
export function clearClinicLogoCache(clinicId?: string): void {
  if (clinicId) cache.delete(clinicId);
  else cache.clear();
}

export type ClinicLogoImgOptions = {
  /** Box the logo is fitted into, in CSS px. */
  maxHeight: number;
  maxWidth: number;
  /**
   * "inline" (default) emits nothing unless the logo could be turned into a data: URI — the
   * only safe input for the html2canvas/jsPDF generators. "any" also accepts the remote URL,
   * for plain <img> rendering where CORS is irrelevant.
   */
  allow?: "inline" | "any";
  extraStyle?: string;
};

/**
 * Renders the logo as an <img> for the print/PDF templates, or "" when there is no logo — so
 * every layout that uses this collapses back to exactly what it looked like before.
 *
 * Emits explicit width/height attributes whenever the natural size is known: html2canvas lays
 * images out far more predictably when it doesn't have to infer the box itself.
 */
export function clinicLogoImgHtml(logo: ClinicLogoAsset | undefined, opts: ClinicLogoImgOptions): string {
  if (!logo) return "";
  const src = opts.allow === "any" ? logo.dataUrl || logo.url : logo.dataUrl;
  if (!src) return "";

  const extra = opts.extraStyle ?? "";
  const base = `display:block;border:0;object-fit:contain;flex-shrink:0;${extra}`;

  if (logo.width > 0 && logo.height > 0) {
    const scale = Math.min(opts.maxHeight / logo.height, opts.maxWidth / logo.width);
    const w = Math.max(1, Math.round(logo.width * scale));
    const h = Math.max(1, Math.round(logo.height * scale));
    return `<img src="${escAttr(src)}" alt="" width="${w}" height="${h}" style="width:${w}px;height:${h}px;${base}" />`;
  }

  return `<img src="${escAttr(src)}" alt="" style="height:${opts.maxHeight}px;width:auto;max-width:${opts.maxWidth}px;${base}" />`;
}
