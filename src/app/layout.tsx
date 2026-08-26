import type { Metadata } from "next";
import { Montserrat, Open_Sans } from "next/font/google";
import "./globals.css";
import { UIProvider } from "@/context/UIContext";
import { LanguageProvider } from "@/context/LanguageContext";
import { ThemeProvider } from "@/context/ThemeContext"; 
import { AuthProvider } from "@/context/AuthContext"; 
import { ClinicProvider } from "@/context/ClinicContext";

/** The brand kit's secondary face: everything that is read as prose. */
const body = Open_Sans({
  subsets: ["latin"],
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
const figures = Montserrat({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-figures",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Dental Clinic System",
  description: "Advanced Dental Management",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      {/* FIX: Added suppressHydrationWarning to ignore Grammarly/Extension attributes */}
      <body className={`${body.className} ${body.variable} ${figures.variable}`} suppressHydrationWarning={true}>
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