import QRCode from "qrcode";
import { printSrcDoc } from "@/lib/printSrcDoc";
import type { StockDrawer, StockItem, StockLine, StockSnapshot } from "@/lib/stock/types";

/**
 * The printed drawer label: big code, both names, what lives inside, and a QR that opens the
 * weekly count at exactly that drawer. A4, six per page, meant to be laminated once.
 */
export async function printDrawerLabels(snap: StockSnapshot, drawers: StockDrawer[], origin: string): Promise<void> {
  const itemsById = new Map(snap.items.map((i) => [i.id, i]));
  const cards = await Promise.all(
    drawers.map(async (d) => {
      const url = `${origin}/inventory?tab=count&drawer=${encodeURIComponent(d.code)}`;
      const qr = await QRCode.toDataURL(url, { width: 220, margin: 0, color: { dark: "#111318", light: "#FFFFFF" } }).catch(() => "");
      const names = uniqueItemNames(snap.lines.filter((l) => l.drawerId === d.id), itemsById);
      return `
        <div class="label">
          <div class="code">${esc(d.cabinetLetter)}${d.number}</div>
          <div class="mid">
            <b>${esc(d.nameEn)}</b>
            <span class="ar">${esc(d.nameAr)}</span>
            <small>${esc(d.roomEn)} · ${esc(d.code)}${names.length ? " · " + names.map(esc).join(" · ") : ""}</small>
          </div>
          ${qr ? `<img class="qr" src="${qr}" alt="">` : ""}
        </div>`;
    })
  );
  const doc = `<!doctype html><html><head><meta charset="utf-8"><title>Drawer labels</title>
  <style>
    @page { size: A4; margin: 12mm; }
    body { font-family: "Open Sans", "Cairo", Tahoma, sans-serif; color:#111318; margin:0; }
    .sheet { display:grid; grid-template-columns: 1fr 1fr; gap: 8mm; }
    .label { border: 1px solid #C9CED6; border-radius: 10px; padding: 10px 12px; display:grid; grid-template-columns:auto 1fr auto; gap: 12px; align-items:center; break-inside: avoid; min-height: 34mm; }
    .code { font-family: "Montserrat", "Segoe UI", sans-serif; font-weight: 800; font-size: 34px; line-height:1; letter-spacing:-.03em; background:#FACC15; color:#1A1206; border-radius: 8px; padding: 6px 9px; }
    .mid b { display:block; font-family:"Montserrat","Segoe UI",sans-serif; font-weight:700; font-size:14px; }
    .mid .ar { display:block; font-size:13px; color:#334155; direction:rtl; text-align:left; }
    .mid small { display:block; font-size:10.5px; color:#64748B; margin-top:3px; line-height:1.35; }
    .qr { width: 22mm; height: 22mm; }
  </style></head><body><div class="sheet">${cards.join("")}</div></body></html>`;
  await printSrcDoc(doc, "Drawer labels");
}

function uniqueItemNames(lines: StockLine[], items: Map<string, StockItem>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const l of lines) {
    const it = items.get(l.itemId);
    if (!it || seen.has(it.id)) continue;
    seen.add(it.id);
    out.push(it.nameEn);
  }
  return out.slice(0, 12);
}

function esc(s: string): string {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);
}
