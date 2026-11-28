import type { Metadata, Viewport } from "next";
import { Inter, Instrument_Serif } from "next/font/google";
import "./globals.css";
import EmbedBridge from "./EmbedBridge";

const sans = Inter({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
const serif = Instrument_Serif({ subsets: ["latin"], weight: "400", style: ["normal", "italic"], variable: "--font-serif", display: "swap" });

export const metadata: Metadata = {
  title: "Pay Alone",
  description: "Speak it. Approve it. The AI is never allowed to move your money.",
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#f6f3ec" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${serif.variable}`}>
      <body>
        <EmbedBridge />
        {children}
      </body>
    </html>
  );
}
