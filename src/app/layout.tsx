import type { Metadata } from "next";
import { Inter, Newsreader } from "next/font/google";
import "./globals.css";
import { UIProvider } from "@/context/UIContext";
import { LanguageProvider } from "@/context/LanguageContext";
import { ThemeProvider } from "@/context/ThemeContext"; 
import { AuthProvider } from "@/context/AuthContext"; 
import { ClinicProvider } from "@/context/ClinicContext";

const inter = Inter({ subsets: ["latin"] });

/**
 * The serif used for figures — money, counts, hours — not for prose.
 *
 * Numbers set in the interface sans read as data in a form. The same numbers in a serif read as a
 * statement someone stands behind, which is the whole point of a briefing. Exposed as a CSS
 * variable and applied through the `.font-figure` utility rather than a font class, so it can be
 * reached from anywhere without importing it again.
 */
const figures = Newsreader({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
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
      <body className={`${inter.className} ${figures.variable}`} suppressHydrationWarning={true}>
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