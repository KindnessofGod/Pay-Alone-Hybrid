import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], weight: ["400", "500", "600", "700", "800"], display: "swap", variable: "--font-inter" });

export const metadata: Metadata = {
  title: "Pay Alone",
  description: "Speak it. Approve it. The AI is never allowed to move your money.",
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#0A0E1A" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body>{children}</body>
    </html>
  );
}
