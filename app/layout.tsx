import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "EUMETSAT Calendar Guide",
  description: "Standalone reference implementation for the EUMETSAT training events API.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
