import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { UIProvider } from "@/context/UIContext";
import { LanguageProvider } from "@/context/LanguageContext";
import { ThemeProvider } from "@/context/ThemeContext"; 
import { AuthProvider } from "@/context/AuthContext"; 
import { ClinicProvider } from "@/context/ClinicContext";

const inter = Inter({ subsets: ["latin"] });

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
      <body className={inter.className} suppressHydrationWarning={true}>
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