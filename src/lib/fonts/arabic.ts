import { Cairo } from "next/font/google";

/**
 * The app's Arabic face, declared once so every place that needs it shares one font file.
 *
 * The dashboard layout sets it on its wrapper. Anything portalled to <body> — the booking popup —
 * sits outside that wrapper and never inherited it, so its Arabic fell back to whatever system
 * face the machine had. Those places use `variable` (the `--font-arabic` custom property) and set
 * it themselves.
 */
export const cairo = Cairo({ subsets: ["arabic"], variable: "--font-arabic" });
