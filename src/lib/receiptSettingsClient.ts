import { getDoc } from "firebase/firestore";
import { getClinicDoc } from "@/lib/db-utils";
import {
  RECEIPT_SETTINGS_DOC,
  normalizeReceiptSettings,
  type ReceiptSettings,
} from "@/lib/receiptSettings";

/**
 * The clinic's receipt settings, read once per print.
 *
 * Not cached: a receptionist who has just watched the admin change the template expects the next
 * receipt to come out in it, and a print is rare enough that one small read is nothing. Never
 * throws — a clinic that has not opened the settings screen, or a read that fails, prints the
 * default classic receipt rather than nothing.
 */
export async function loadReceiptSettings(): Promise<ReceiptSettings> {
  try {
    const snap = await getDoc(getClinicDoc("settings", RECEIPT_SETTINGS_DOC));
    return normalizeReceiptSettings(snap.exists() ? snap.data() : null);
  } catch (err) {
    console.warn("Receipt settings could not be read; printing with defaults.", err);
    return normalizeReceiptSettings(null);
  }
}
