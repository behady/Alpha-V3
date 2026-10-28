import localFont from "next/font/local";
import styles from "./arabic.module.css";

/**
 * The app's Arabic face, declared once so every place that needs it shares one font file.
 *
 * The dashboard layout sets it on its wrapper. Anything portalled to <body> — the booking popup —
 * sits outside that wrapper and never inherited it, so its Arabic fell back to whatever system
 * face the machine had. Those places use `variable` (the `--font-arabic` custom property) and set
 * it themselves.
 *
 * Local files, not next/font/google — see the note in src/app/layout.tsx. Cairo comes as two
 * files, Arabic letters and Latin letters, stacked so a character missing from the first falls
 * through to the second. The Arabic face carries no metric fallback, or Arial would sit between
 * the two and catch every Latin letter and digit. `className` and `variable` keep the shape the
 * next/font object had, so the places using it did not change.
 */
const cairoArabic = localFont({
  src: "../../fonts/cairo-arabic-wght.woff2",
  weight: "200 1000",
  adjustFontFallback: false,
  variable: "--font-cairo-arabic",
});
const cairoLatin = localFont({
  src: "../../fonts/cairo-latin-wght.woff2",
  weight: "200 1000",
  variable: "--font-cairo-latin",
});

const faces = `${cairoArabic.variable} ${cairoLatin.variable}`;

export const cairo = {
  /** Sets the face on the element. */
  className: `${faces} ${styles.face}`,
  /** Defines `--font-arabic` on the element without setting the face. */
  variable: `${faces} ${styles.variable}`,
};
