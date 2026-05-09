/**
 * Two pill tabs that flip the `view` search param between "tree" and
 * "teams". Server-rendered Links — no client JS, the page re-renders
 * on click via the App Router.
 */

import Link from "next/link";

export type OrgChartView = "tree" | "teams";

export function ViewToggle({ view }: { view: OrgChartView }) {
  return (
    <div
      role="tablist"
      aria-label="Org chart view"
      className="inline-flex items-center gap-1 rounded-full border border-[color:var(--color-line)] bg-white/60 p-1 backdrop-blur"
    >
      <Tab href="/org-chart?view=tree" active={view === "tree"} label="Tree" />
      <Tab
        href="/org-chart?view=teams"
        active={view === "teams"}
        label="By team"
      />
    </div>
  );
}

function Tab({
  href,
  active,
  label,
}: {
  href: string;
  active: boolean;
  label: string;
}) {
  return (
    <Link
      role="tab"
      aria-selected={active}
      href={href}
      scroll={false}
      className={
        active
          ? "rounded-full bg-ink px-3.5 py-1.5 text-[12.5px] font-semibold text-[color:var(--color-canvas)]"
          : "rounded-full px-3.5 py-1.5 text-[12.5px] font-medium text-[color:var(--color-muted)] transition-colors hover:text-ink"
      }
    >
      {label}
    </Link>
  );
}
