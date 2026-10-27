import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { cookies } from "next/headers";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", axes: ["opsz"], display: "swap" });

export const metadata: Metadata = {
  title: { default: "8gency", template: "%s · 8gency" },
  description: "The operating system for advertising and marketing agencies.",
};

// viewport-fit=cover lets the page run under the notch and home indicator; the env(safe-area-inset-*) padding in globals.css keeps anything tappable clear of them.
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const theme = (await cookies()).get("8g_theme")?.value;
  return (
    <html lang="en" className={inter.variable} data-theme={theme === "light" || theme === "dark" ? theme : undefined}>
      <body className="min-h-screen font-sans">{children}</body>
    </html>
  );
}
