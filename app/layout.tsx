import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Parry Grove · Co-op Roguelike",
  description: "A colorful melee roguelike for 1–4 players. Master the parry, clear the grove, and defeat the Brass Warden.",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
