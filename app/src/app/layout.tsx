import type { Metadata, Viewport } from "next";
import { MarketingBackground } from "@/components/marketing-background";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Grasp",
    template: "%s · Grasp",
  },
  description:
    "Grasp helps leadership roll out process changes that actually land.",
  icons: { icon: "/favicon.svg" },
};

export const viewport: Viewport = {
  themeColor: "#FAF9F6",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <MarketingBackground />
        {children}
      </body>
    </html>
  );
}
