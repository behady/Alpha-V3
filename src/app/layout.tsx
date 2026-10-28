import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { UIProvider } from "@/context/UIContext";
import { LanguageProvider } from "@/context/LanguageContext";
import { ThemeProvider } from "@/context/ThemeContext";
import { THEME_BOOT_SCRIPT } from "@/lib/theme/bootScript"; 
import { AuthProvider } from "@/context/AuthContext"; 
import { ClinicProvider } from "@/context/ClinicContext";

/*
 * Every face is a file committed under src/fonts, never next/font/google: that one fetches from
 * Google during the build, and a slow fetch failed two production deploys on 2026-10-28.
 * The files are Google's own latin subsets (via fontsource), variable, with the weight range
 * clamped to what the old Google call loaded so text renders exactly as before.
 */

/** The brand kit's secondary face: everything that is read as prose. */
const body = localFont({
  src: "../fonts/open-sans-latin-wght.woff2",
  weight: "300 800",
  variable: "--font-body",
  display: "swap",
});

/**
 * The brand kit's primary face, used for figures — money, counts, hours — and headings.
 *
 * Numbers set in the body face read as data in a form. The same numbers in the display face,
 * heavier and with tabular numerals, read as a stated figure someone stands behind. This was a
 * serif until the brand kit arrived naming Montserrat and Open Sans; the distinction is now
 * carried by weight and width rather than by a third typeface the brand does not have.
 */
const figures = localFont({
  src: "../fonts/montserrat-latin-wght.woff2",
  weight: "500 700",
  variable: "--font-figures",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Dental Clinic System",
  description: "Advanced Dental Management",
  // The name under the icon and the full-screen launch when an iPhone adds the site to its home
  // screen. The icon itself is app/apple-icon.png; Android reads app/manifest.ts instead.
  appleWebApp: {
    capable: true,
    title: "Alpha Dental",
    statusBarStyle: "default",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // suppressHydrationWarning on <html> because the boot script below sets inline
    // custom properties on this element before React hydrates. The existing one on
    // <body> does not cover it: the attribute is single-level.
    <html lang="en" suppressHydrationWarning>
      {/* FIX: Added suppressHydrationWarning to ignore Grammarly/Extension attributes */}
      <body className={`${body.className} ${body.variable} ${figures.variable}`} suppressHydrationWarning={true}>
        {/*
          Paints the clinic's cached theme before the first frame.

          Must be the first child of <body>, not placed before it: React 19 does not hoist a
          classic inline script, so one emitted outside <body> is relocated into <head> by the
          parser, leaving <html> with children React never rendered.
        */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
        <AuthProvider>
          <ClinicProvider>
            <ThemeProvider>
              <LanguageProvider>
                <UIProvider>
                    {children}
                </UIProvider>
              </LanguageProvider>
            </ThemeProvider>
          </ClinicProvider>
        </AuthProvider>
      </body>
    </html>
  );
}