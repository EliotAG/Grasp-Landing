import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Grasp Simulator",
  description:
    "A standalone testing surface that the Grasp agent integrates with as if it were Microsoft Teams.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
