/**
 * The unit printed beside a money figure on screen.
 *
 * A clinic stores its currency as a code ("EGP", "SAR"), and that code is what goes into PDFs,
 * receipts and anything sent to a server. On screen in Arabic, though, a bare "EGP" next to an
 * Arabic label reads as an untranslated leftover — the rest of the app writes "ج.م". This maps
 * the codes the app knows to their Arabic abbreviation and leaves anything else as the clinic
 * typed it. Display only: never write the result back.
 */
export function currencyUnit(currency: string | null | undefined, isAr: boolean): string {
  const cur = String(currency || "").trim() || "EGP";
  if (!isAr) return cur;
  const code = cur.toUpperCase();
  if (code === "EGP" || code === "LE") return "ج.م";
  if (code === "SAR") return "ر.س";
  return cur;
}
