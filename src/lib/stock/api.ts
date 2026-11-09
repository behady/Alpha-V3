"use client";

import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { auth, storage } from "@/lib/firebase";
import { currentClinicId } from "@/lib/db-utils";
import { stockPhotoPath } from "@/lib/storagePaths";
import type { LibraryProduct, StockSnapshot, StockVariant } from "./types";

/**
 * The browser side of /api/stock. Every call carries the clinic on screen, because the route's
 * fallback (the user's default clinic) is the wrong clinic for anyone who works at two.
 */
export class StockApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function post<T extends Record<string, unknown>>(action: string, body: Record<string, unknown> = {}): Promise<T> {
  const user = auth.currentUser;
  if (!user) throw new StockApiError("You are signed out. Sign in and try again.", 401);
  const token = await user.getIdToken();
  const clinicId = body.clinicId ?? currentClinicId();
  const res = await fetch("/api/stock", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ action, ...body, clinicId }),
  });
  let payload: Record<string, unknown> = {};
  try {
    payload = await res.json();
  } catch {
    /* no body */
  }
  if (!res.ok || payload.ok === false) {
    throw new StockApiError(typeof payload.error === "string" ? payload.error : "Something went wrong. Nothing was changed.", res.status);
  }
  return payload as T;
}

type WithSnapshot = { snapshot: StockSnapshot };

export const stockApi = {
  snapshot: () => post<WithSnapshot>("snapshot").then((r) => r.snapshot),
  setup: (chairs: number, itemKeys: string[]) => post<WithSnapshot & { createdDrawers: number }>("setup", { chairs, itemKeys }),
  saveDrawer: (drawer: Record<string, unknown>) => post<WithSnapshot>("save-drawer", drawer).then((r) => r.snapshot),
  setPhoto: (kind: "drawer" | "item" | "variant", id: string, photoUrl: string) => post<WithSnapshot>("set-photo", { kind, id, photoUrl }).then((r) => r.snapshot),
  addItem: (args: Record<string, unknown>) => post<WithSnapshot & { itemId: string }>("add-item", args),
  updateItem: (id: string, patch: Record<string, unknown>) => post<WithSnapshot>("update-item", { id, ...patch }).then((r) => r.snapshot),
  addVariant: (args: Record<string, unknown>) => post<WithSnapshot & { variantId: string }>("add-variant", args),
  addLine: (variantId: string, drawerId: string) => post<WithSnapshot>("add-line", { variantId, drawerId }).then((r) => r.snapshot),
  removeLine: (lineId: string) => post<WithSnapshot>("remove-line", { lineId }).then((r) => r.snapshot),
  saveCount: (date: string, values: Record<string, number>) => post<WithSnapshot & { changed: number }>("save-count", { date, values }),
  lookupBarcode: (barcode: string) => post<{ variant: StockVariant | null; library: LibraryProduct | null }>("lookup-barcode", { barcode }),
  receiveDelivery: (args: Record<string, unknown>) => post<WithSnapshot & { total: number; ledgerId: string | null }>("receive-delivery", args),
  useOnPatient: (args: Record<string, unknown>) => post<WithSnapshot>("use-on-patient", args).then((r) => r.snapshot),
};

/**
 * Upload a photo and return its URL. Resizes on the way: a phone camera produces 3–5 MB files,
 * and a thumbnail on a count screen does not need them.
 */
export async function uploadStockPhoto(kind: "drawer" | "item" | "variant" | "invoice", id: string, file: File): Promise<string> {
  const clinicId = currentClinicId();
  const blob = await shrink(file, kind === "invoice" ? 1600 : 1024);
  const path = stockPhotoPath(clinicId, kind, id, "jpg");
  const r = ref(storage, path);
  await uploadBytes(r, blob, { contentType: "image/jpeg" });
  return getDownloadURL(r);
}

async function shrink(file: File, max: number): Promise<Blob> {
  if (!file.type.startsWith("image/")) return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const w = Math.round(bmp.width * scale);
    const h = Math.round(bmp.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bmp, 0, 0, w, h);
    return await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b || file), "image/jpeg", 0.85));
  } catch {
    return file;
  }
}
