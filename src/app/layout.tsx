import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Annotation Platform",
  description: "Multi-tenant video annotation platform",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
