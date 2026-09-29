/**
 * Getting a built HTML document (a receipt, a statement) to the printer.
 *
 * Two roads, chosen by device:
 *
 * DESKTOP — write the document into a hidden iframe and call print() on that frame. Fast, keeps
 * the app on screen, and the print dialog shows the document alone.
 *
 * PHONES AND TABLETS — Android Chrome and iOS Safari ignore print() on a hidden frame and print
 * the TOP page instead: "Print a test" on a tablet produced a screenshot of the settings screen
 * (2026-09-27). So the document opens in a tab of its own, as a blob URL, with a one-line script
 * that opens the print dialog once it has loaded. The tab is opened after the caller's awaits
 * (settings, logo), which is fine: mobile browsers keep the tap's activation for a few seconds.
 * If the browser still refuses the tab, the document takes over the current one — Back returns.
 */

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
 * Phones and tablets, where a hidden frame cannot be printed.
 *
 * Decided by what the device IS, not what it calls itself: a Huawei tablet in "desktop site"
 * mode sends a desktop user agent and was printing the settings page (2026-09-27). A screen
 * whose primary pointer is a finger and that cannot hover is a touch device whatever the UA
 * says. iPadOS calls itself a Macintosh, hence the touch-point check.
 */
export function printsFromOwnTab(): boolean {
  if (typeof navigator === "undefined" || typeof window === "undefined") return false;
  const ua = navigator.userAgent || "";
  if (/Android|iPhone|iPad|iPod|Mobile|HarmonyOS|Tablet/i.test(ua)) return true;
  const touchPoints = navigator.maxTouchPoints || 0;
  if (/Macintosh/.test(ua) && touchPoints > 1) return true;
  try {
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    const noHover = window.matchMedia("(hover: none)").matches;
    if (coarse && noHover) return true;
    if (touchPoints > 1 && !window.matchMedia("(hover: hover)").matches) return true;
  } catch {
    // matchMedia missing: an old engine, and old engines are desktops.
  }
  return false;
}

/**
 * What the document's own tab gets on top of the document: a bar with a Print button, and a
 * script that tries to open the print dialog by itself once fonts and images are in.
 *
 * The button is not decoration. Several mobile browsers ignore a print() that no tap caused,
 * and the person is then looking at a receipt with no way to print it. The bar is hidden from
 * the printout itself. Arabic or English follows the document's own lang attribute.
 */
function ownTabChrome(arabic: boolean): string {
  const print = arabic ? "طباعة / حفظ PDF" : "Print / Save as PDF";
  const close = arabic ? "إغلاق" : "Close";
  const hint = arabic ? "لو لم تفتح نافذة الطباعة وحدها، اضغط هنا." : "If the print dialog did not open by itself, press here.";
  return `<div id="__print_bar" dir="${arabic ? "rtl" : "ltr"}" style="position:sticky;top:0;z-index:2147483647;display:flex;align-items:center;gap:12px;padding:10px 14px;background:#111827;color:#fff;font:600 14px/1.3 system-ui,sans-serif;box-shadow:0 2px 12px rgba(0,0,0,.25);">
  <button type="button" onclick="window.print()" style="appearance:none;border:0;border-radius:10px;padding:10px 16px;background:#facc15;color:#111827;font:800 14px system-ui,sans-serif;cursor:pointer;">${print}</button>
  <span style="flex:1;font-weight:500;font-size:12px;opacity:.85;">${hint}</span>
  <button type="button" onclick="window.close()" style="appearance:none;border:1px solid rgba(255,255,255,.35);border-radius:10px;padding:9px 14px;background:transparent;color:#fff;font:700 13px system-ui,sans-serif;cursor:pointer;">${close}</button>
</div>
<style>@media print { #__print_bar { display: none !important; } }</style>
<script>
(function(){
  function go(){ setTimeout(function(){ try { window.focus(); window.print(); } catch (e) {} }, 700); }
  if (document.readyState === "complete") go(); else window.addEventListener("load", go, { once: true });
})();
</script>`;
}

/** Exported for the tests. */
export function withOwnTabChrome(srcDoc: string): string {
  const arabic = /<html[^>]*\slang="ar"/i.test(srcDoc);
  const chrome = ownTabChrome(arabic);
  // The bar goes first in <body> so it sits above the document; the script at the end.
  const bar = chrome.slice(0, chrome.indexOf("<script>"));
  const script = chrome.slice(chrome.indexOf("<script>"));
  let out = srcDoc;
  out = out.includes("<body>") ? out.replace("<body>", `<body>${bar}`) : bar + out;
  out = out.includes("</body>") ? out.replace("</body>", `${script}</body>`) : out + script;
  return out;
}

async function printInHiddenFrame(srcDoc: string, label: string): Promise<void> {
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
  // get control back as the dialog opens — they show an "opening to print" toast, which would
  // otherwise only appear once the user had already finished printing.
  window.setTimeout(() => {
    try {
      win.focus();
      win.print();
    } catch (err) {
      console.error(`${label} print failed`, err);
    } finally {
      window.setTimeout(() => iframe.remove(), 2000);
    }
  }, 0);
}

function printInOwnTab(srcDoc: string): void {
  const url = URL.createObjectURL(new Blob([withOwnTabChrome(srcDoc)], { type: "text/html" }));
  const opened = window.open(url, "_blank");
  if (!opened) {
    // Blocked. The document is more important than staying on this screen.
    window.location.assign(url);
    return;
  }
  // The tab has the document by now; the URL only needs to live long enough to be opened.
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/**
 * Print a self-contained HTML document the right way for this device.
 *
 * @param label  Names the document in console errors ("Receipt", "Lab order").
 */
export async function printSrcDoc(srcDoc: string, label = "Document"): Promise<void> {
  if (printsFromOwnTab()) {
    printInOwnTab(srcDoc);
    return;
  }
  await printInHiddenFrame(srcDoc, label);
}
