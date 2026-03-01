import type { Metadata } from "next";
import { Cormorant_Garamond, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const kniffelSerif = Cormorant_Garamond({
  variable: "--font-kniffel-serif",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const jetBrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Kniffel Multiplayer",
  description: "Mehrspieler-Kniffel mit Next.js und Socket.io",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="de">
      <body className={`${kniffelSerif.variable} ${jetBrainsMono.variable} antialiased`}>{children}</body>
    </html>
  );
}
