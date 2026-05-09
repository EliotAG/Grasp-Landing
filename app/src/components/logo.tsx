import Link from "next/link";

export function Logo({ href = "/dashboard" }: { href?: string }) {
  return (
    <Link
      href={href}
      className="flex items-center gap-2 no-underline"
      aria-label="Grasp"
    >
      <svg viewBox="0 0 64 64" fill="none" className="h-[26px] w-[26px]">
        <path
          d="M32 56C32 56 30 44 31 36C32 28 32 24 32 24"
          stroke="#2E7D32"
          strokeWidth="3.5"
          strokeLinecap="round"
          fill="none"
        />
        <path
          d="M32 28C34 22 40 12 54 6C52 14 46 26 32 28Z"
          fill="#4CAF50"
        />
        <path
          d="M32 28C36 20 44 12 54 6"
          stroke="#2E7D32"
          strokeWidth="1.2"
          fill="none"
          opacity="0.3"
        />
        <path
          d="M31 36C28 30 20 20 8 14C10 24 20 34 31 36Z"
          fill="#2E7D32"
        />
        <path
          d="M31 36C26 28 18 20 8 14"
          stroke="#2E7D32"
          strokeWidth="1.2"
          fill="none"
          opacity="0.2"
        />
      </svg>
      <span
        className="text-[26px] font-normal text-ink"
        style={{
          fontFamily: "var(--font-serif)",
          letterSpacing: "-0.03em",
          color: "#111",
        }}
      >
        grasp
      </span>
    </Link>
  );
}
