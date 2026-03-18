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
  description: "Klassisches Kniffel online spielen – 2 bis 6 Spieler, Echtzeit-Würfel, Gewinnkarte im Papier-Look. Kostenlos, kein Login nötig.",
  keywords: ["Kniffel", "Yahtzee", "Multiplayer", "Online", "Würfelspiel", "Brettspiel", "Kostenlos"],
  authors: [{ name: "Logge" }],
  openGraph: {
    title: "🎲 Kniffel Multiplayer",
    description: "Klassisches Kniffel online mit Freunden spielen – Echtzeit-Würfel, animierte Gewinnkarte, 2-6 Spieler. Kostenlos & ohne Login!",
    url: "https://kniffel.logge.top",
    siteName: "Kniffel Multiplayer",
    locale: "de_DE",
    type: "website",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "Kniffel Multiplayer – Würfelspiel online mit Freunden",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "🎲 Kniffel Multiplayer",
    description: "Klassisches Kniffel online mit Freunden – Echtzeit, kostenlos, kein Login!",
    images: ["/og-image.png"],
  },
  metadataBase: new URL("https://kniffel.logge.top"),
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
