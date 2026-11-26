import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Pay Alone",
  description: "Speak it. Approve it. The AI is never allowed to move your money.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
