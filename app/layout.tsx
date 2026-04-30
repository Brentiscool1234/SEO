import type { Metadata } from "next";
import "./globals.css";
import { ThemeProvider } from "@/components/ThemeProvider";

export const metadata: Metadata = {
  title: "SEO Audit Tool",
  description: "Automated SEO audits powered by Firecrawl, DataForSEO & Claude",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen bg-base text-main antialiased">
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
