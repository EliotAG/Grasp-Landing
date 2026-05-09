import type { ReactNode } from "react";
import { MarketingNav } from "@/components/marketing-nav";

const marketingUrl =
  process.env.NEXT_PUBLIC_MARKETING_URL ??
  (process.env.NODE_ENV === "development"
    ? "http://localhost:5173"
    : "https://www.withgrasp.com");

export default function LegalLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <MarketingNav logoHref={marketingUrl} />
      <main className="mx-auto max-w-[720px] px-6 pt-[120px] pb-24">
        {children}
      </main>
    </>
  );
}
