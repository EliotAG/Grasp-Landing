import type { ReactNode } from "react";
import { MarketingNav } from "@/components/marketing-nav";

const marketingUrl =
  process.env.NEXT_PUBLIC_MARKETING_URL ??
  (process.env.NODE_ENV === "development"
    ? "http://localhost:5173"
    : "https://www.withgrasp.com");

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <MarketingNav logoHref={marketingUrl} />
      {children}
    </>
  );
}
