// The barcode reader iPhones and desktops fall back to (ZXing) must be installed and must
// actually read: an EAN-13 drawn bar by bar, and a QR. This is the library, not the camera —
// the camera can only be tried on a real phone.
import assert from "node:assert/strict";
import QRCode from "qrcode";
import { BarcodeFormat, BinaryBitmap, DecodeHintType, HybridBinarizer, MultiFormatReader, RGBLuminanceSource } from "@zxing/library";

function decode(pixels: Uint8ClampedArray, width: number, height: number): string {
  const hints = new Map();
  hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.EAN_13, BarcodeFormat.QR_CODE, BarcodeFormat.DATA_MATRIX, BarcodeFormat.CODE_128]);
  hints.set(DecodeHintType.TRY_HARDER, true);
  const reader = new MultiFormatReader();
  reader.setHints(hints);
  return reader.decode(new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(pixels, width, height)))).getText();
}

/** Luminance image (one byte per pixel) from rows of dark/light modules. */
function render(modules: boolean[][], scale: number, quiet: number): { px: Uint8ClampedArray; w: number; h: number } {
  const w = (modules[0].length + quiet * 2) * scale;
  const h = (modules.length + quiet * 2) * scale;
  const px = new Uint8ClampedArray(w * h).fill(255);
  modules.forEach((row, y) =>
    row.forEach((dark, x) => {
      if (!dark) return;
      for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) px[((y + quiet) * scale + dy) * w + (x + quiet) * scale + dx] = 0;
    })
  );
  return { px, w, h };
}

// --- EAN-13, encoded by the book --------------------------------------------------------------
const L = ["0001101", "0011001", "0010011", "0111101", "0100011", "0110001", "0101111", "0111011", "0110111", "0001011"];
const G = ["0100111", "0110011", "0011011", "0100001", "0011101", "0111001", "0000101", "0010001", "0001001", "0010111"];
const R = ["1110010", "1100110", "1101100", "1000010", "1011100", "1001110", "1010000", "1000100", "1001000", "1110100"];
const PARITY = ["LLLLLL", "LLGLGG", "LLGGLG", "LLGGGL", "LGLLGG", "LGGLLG", "LGGGLL", "LGLGLG", "LGLGGL", "LGGLGL"];
function ean13(code: string): boolean[][] {
  const d = [...code].map(Number);
  let bits = "101";
  for (let i = 1; i <= 6; i++) bits += (PARITY[d[0]][i - 1] === "L" ? L : G)[d[i]];
  bits += "01010";
  for (let i = 7; i <= 12; i++) bits += R[d[i]];
  bits += "101";
  const row = [...bits].map((b) => b === "1");
  return Array.from({ length: 40 }, () => row);
}

const EAN = "4046719000036";
const bars = render(ean13(EAN), 3, 12);
assert.equal(decode(bars.px, bars.w, bars.h), EAN);

// --- QR, from the same generator the drawer labels use -----------------------------------------
const qr = QRCode.create("https://stock.example/inventory?tab=count&drawer=C1-A2", { errorCorrectionLevel: "M" });
const size = qr.modules.size;
const grid = Array.from({ length: size }, (_, y) => Array.from({ length: size }, (_, x) => Boolean(qr.modules.get(y, x))));
const q = render(grid, 4, 4);
assert.equal(decode(q.px, q.w, q.h), "https://stock.example/inventory?tab=count&drawer=C1-A2");

console.log("stockScanner: ZXing read an EAN-13 and a drawer-label QR");
