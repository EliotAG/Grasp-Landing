import type { ReactNode } from "react";
import { Logo } from "./logo";

export function MarketingNav({
  logoHref,
  right,
}: {
  logoHref: string;
  right?: ReactNode;
}) {
  return (
    <nav
      aria-label="Main navigation"
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        zIndex: 1000,
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "16px 48px",
        background: "transparent",
      }}
    >
      <Logo href={logoHref} />
      {right ?? <DefaultTextUs />}
    </nav>
  );
}

function DefaultTextUs() {
  return (
    <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-end",
          gap: 0,
        }}
      >
        <a
          href="sms:8325707361&body=Hey, I need help with Grasp, the problem is:"
          style={{
            fontFamily: "var(--font-sans)",
            fontSize: 15,
            fontWeight: 600,
            color: "#111",
            letterSpacing: "-0.01em",
            textDecoration: "none",
          }}
        >
          (832) 570-7361
        </a>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            marginTop: 2,
          }}
        >
          <span
            style={{
              fontFamily: "var(--font-sans)",
              fontSize: 11,
              fontWeight: 500,
              color: "#595959",
              letterSpacing: "0.02em",
            }}
          >
            Text us
          </span>
          <span
            style={{
              fontSize: 13,
              color: "#595959",
              lineHeight: 1,
              transform: "scaleX(0.7)",
              display: "inline-block",
            }}
          >
            ↑
          </span>
        </div>
      </div>
  );
}
