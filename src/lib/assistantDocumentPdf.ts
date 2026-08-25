// src/lib/assistantDocumentPdf.ts
import { modelTextToHtml } from "./modelTextHtml";

/**
 * The web end of the assistant's `trigger_pdf_generation` tool.
 *
 * The server has always been able to answer a chat turn with `triggerPdf`, and on the web nothing
 * consumed it — so "Generating PDF for: Treatment Plan" appeared in the bubble and no file ever
 * arrived. That is the same failure the Android client already guards against by refusing the tool
 * outright (see AppViewModel.askAiTurn): a sentence describing work that was never done. The
 * browser genuinely can produce the document, so here it does, rather than apologising for it.
 *
 * The body is model-written text that may quote free text a patient typed, so it goes through
 * modelTextToHtml — which escapes before it converts, and therefore emits only tags this codebase
 * created. See the note at the top of that file; the ordering is the whole safety argument.
 *
 * Print rather than download: the print dialog offers "Save as PDF" everywhere, needs no library,
 * and unlike a blob download it cannot be silently swallowed by a popup blocker without the user
 * seeing anything at all.
 */
export function printAssistantDocument(opts: {
  title: string;
  content: string;
  ar?: boolean;
  clinicName?: string;
}): void {
  if (typeof document === "undefined") return;

  const ar = opts.ar === true;
  const title = String(opts.title || "").trim() || (ar ? "مستند" : "Document");
  const body = modelTextToHtml(String(opts.content || ""), { ar });
  if (!body) return;

  // Escaped independently of the body: these land in <title> and the letterhead, which
  // modelTextToHtml never sees.
  const esc = (s: string) =>
    String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");

  const printedOn = new Date().toLocaleDateString(ar ? "ar-EG" : "en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  const srcDoc = `<!DOCTYPE html>
<html lang="${ar ? "ar" : "en"}" dir="${ar ? "rtl" : "ltr"}">
<head>
<meta charset="utf-8" />
<title>${esc(title)}</title>
<style>
  @page { size: A4; margin: 18mm 16mm; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: ${ar ? "'Segoe UI', Tahoma, Arial, sans-serif" : "Georgia, 'Times New Roman', serif"};
    color: #0f172a;
    font-size: 13px;
    line-height: 1.65;
  }
  header {
    border-bottom: 2px solid #0f172a;
    padding-bottom: 10px;
    margin-bottom: 18px;
  }
  .clinic { font-size: 11px; letter-spacing: .12em; text-transform: uppercase; color: #64748b; }
  h1 { font-size: 20px; margin: 6px 0 0 0; font-weight: 700; }
  .meta { font-size: 10px; color: #94a3b8; margin-top: 4px; }
  footer {
    margin-top: 26px; padding-top: 8px; border-top: 1px solid #e2e8f0;
    font-size: 9px; color: #94a3b8;
  }
</style>
</head>
<body>
  <header>
    ${opts.clinicName ? `<div class="clinic">${esc(opts.clinicName)}</div>` : ""}
    <h1>${esc(title)}</h1>
    <div class="meta">${esc(printedOn)}</div>
  </header>
  ${body}
  <footer>${ar ? "أُنشئ بواسطة مساعد ألفا — راجع المحتوى قبل مشاركته." : "Prepared by the Alpha assistant — review before sharing."}</footer>
</body>
</html>`;

  const iframe = document.createElement("iframe");
  iframe.style.cssText = "position:absolute;width:0;height:0;border:none;visibility:hidden;";
  document.body.appendChild(iframe);

  const doc = iframe.contentWindow?.document;
  if (!doc) {
    iframe.remove();
    return;
  }

  doc.open();
  doc.write(srcDoc);
  doc.close();

  // Same shape as printBriefing: a beat for fonts, then print, then clean up. Without the delay
  // the document prints in the fallback face.
  iframe.contentWindow?.addEventListener("load", () => {
    setTimeout(() => {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
      setTimeout(() => {
        if (iframe.parentNode) document.body.removeChild(iframe);
      }, 2000);
    }, 400);
  });
}
