"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { Logo } from "./logo";
import { signOutAction } from "@/app/(app)/_actions";

type NavItem = {
  href: string;
  label: string;
  icon: ReactNode;
};

const NAV: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: <DashboardIcon /> },
  { href: "/org-chart", label: "Org chart", icon: <OrgChartIcon /> },
  { href: "/changes", label: "Changes", icon: <ChangesIcon /> },
  { href: "/settings", label: "Settings", icon: <SettingsIcon /> },
];

const ADMIN_NAV_ITEM: NavItem = {
  href: "/admin",
  label: "Admin",
  icon: <AdminIcon />,
};

const STORAGE_KEY = "grasp:sidebar-collapsed";

export function AppShell({
  orgName,
  userLabel,
  userInitial,
  orgApproved,
  showAdminNav,
  children,
}: {
  orgName: string;
  userLabel: string;
  userInitial: string;
  /// When false the workspace is in closed-pilot mode: planning works,
  /// but activation, amendments, and integrations are gated. Renders a
  /// slim banner above the main content so the gate is never a surprise.
  orgApproved: boolean;
  showAdminNav?: boolean;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const navItems = showAdminNav ? [...NAV, ADMIN_NAV_ITEM] : NAV;

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored === "1") setCollapsed(true);
    } catch {}
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, collapsed ? "1" : "0");
    } catch {}
  }, [collapsed, hydrated]);

  // ⌘\ / Ctrl+\ to toggle (matches Linear, Notion, shadcn).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "\\") {
        e.preventDefault();
        setCollapsed((c) => !c);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Suppress transitions until after hydration so the saved state doesn't
  // animate in from the default (expanded) on first paint.
  const transitionClass = hydrated
    ? "transition-[width,padding-left] duration-200 ease-out"
    : "";

  return (
    <div
      className={`min-h-screen ${
        collapsed ? "md:pl-[68px]" : "md:pl-[240px]"
      } ${transitionClass}`}
    >
      <aside
        aria-label="Sidebar"
        className={`fixed inset-y-0 left-0 z-30 hidden flex-col border-r border-[color:var(--color-line)] bg-[rgba(250,249,246,0.85)] backdrop-blur-xl md:flex ${
          collapsed ? "w-[68px]" : "w-[240px]"
        } ${transitionClass}`}
      >
        <div
          className={`flex items-center pt-5 pb-4 ${
            collapsed ? "justify-center px-3" : "px-5"
          }`}
        >
          {collapsed ? (
            <Link
              href="/dashboard"
              className="flex items-center justify-center"
              aria-label={`Grasp · ${orgName}`}
            >
              <GraspMark />
            </Link>
          ) : (
            <Logo />
          )}
        </div>

        {!collapsed ? (
          <p
            className="mb-3 truncate px-5 text-[11px] font-semibold uppercase tracking-[0.12em] text-[color:var(--color-muted)]"
            title={orgName}
          >
            {orgName}
          </p>
        ) : null}

        <div className={collapsed ? "px-2" : "px-3"}>
          <nav aria-label="Primary" className="flex flex-col gap-1">
            {navItems.map((item) => {
              // Treat parent routes as active too, e.g. /changes/[id] keeps
              // the Changes item highlighted.
              const active =
                pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <span key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    title={collapsed ? item.label : undefined}
                    className={`group relative flex items-center rounded-lg text-[14px] font-medium no-underline transition-colors ${
                      collapsed
                        ? "h-10 justify-center px-0"
                        : "gap-3 px-3 py-2"
                    } ${
                      active
                        ? "bg-black/[0.045] text-ink"
                        : "text-[color:var(--color-ink-2)] hover:bg-black/[0.025] hover:text-ink"
                    }`}
                  >
                    <span
                      aria-hidden
                      className={`inline-flex h-[18px] w-[18px] items-center justify-center transition-colors ${
                        active
                          ? "text-[color:var(--color-grasp)]"
                          : "text-[color:var(--color-muted)] group-hover:text-ink"
                      }`}
                    >
                      {item.icon}
                    </span>
                    {!collapsed ? (
                      <span className="flex-1 leading-none">{item.label}</span>
                    ) : null}
                    {active ? (
                      <span
                        aria-hidden
                        className="absolute left-0 top-1/2 h-5 w-[2px] -translate-y-1/2 rounded-r-full bg-[color:var(--color-grasp)]"
                      />
                    ) : null}
                  </Link>
                </span>
              );
            })}
          </nav>
        </div>

        <div
          className={`mt-auto border-t border-[color:var(--color-line)] py-3 ${
            collapsed ? "px-2" : "px-3"
          }`}
        >
          <div
            className={`flex items-center py-2 ${
              collapsed ? "justify-center px-0" : "gap-3 px-2"
            }`}
            title={collapsed ? userLabel : undefined}
          >
            <span
              aria-hidden
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[color:var(--color-grasp-soft)] text-[12px] font-semibold text-[color:var(--color-grasp)]"
            >
              {userInitial}
            </span>
            {!collapsed ? (
              <span
                className="truncate text-[12.5px] text-[color:var(--color-ink-2)]"
                title={userLabel}
              >
                {userLabel}
              </span>
            ) : null}
          </div>

          <form action={signOutAction}>
            <button
              type="submit"
              title={collapsed ? "Sign out" : undefined}
              className={`flex w-full items-center rounded-lg text-[13px] text-[color:var(--color-muted)] transition-colors hover:bg-black/[0.025] hover:text-ink ${
                collapsed
                  ? "h-9 justify-center px-0"
                  : "gap-3 px-3 py-2 text-left"
              }`}
            >
              <span
                aria-hidden
                className="inline-flex h-[18px] w-[18px] items-center justify-center"
              >
                <SignOutIcon />
              </span>
              {!collapsed ? <span>Sign out</span> : null}
            </button>
          </form>
        </div>
      </aside>

      {/*
        Floating panel-toggle button. Placed in the top-left of the main
        content area (outside the sidebar), matching Linear / Vercel /
        Notion / shadcn. Position transitions with the sidebar width so it
        always sits just inside the content edge.
      */}
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        title={`${collapsed ? "Expand" : "Collapse"} sidebar  ⌘\\`}
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        aria-pressed={collapsed}
        className={`fixed top-3.5 z-40 hidden h-9 w-9 items-center justify-center rounded-lg text-[color:var(--color-muted)] hover:bg-black/[0.045] hover:text-ink md:flex ${transitionClass}`}
        style={{ left: collapsed ? 76 : 248 }}
      >
        <PanelToggleIcon collapsed={collapsed} />
      </button>

      {/* Mobile top bar — sidebar hides below md */}
      <div className="sticky top-0 z-30 flex items-center justify-between border-b border-[color:var(--color-line)] bg-[rgba(250,249,246,0.85)] px-5 py-3 backdrop-blur-xl md:hidden">
        <Logo />
        <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[color:var(--color-muted)]">
          {orgName}
        </span>
      </div>
      <div className="flex gap-1 overflow-x-auto border-b border-[color:var(--color-line)] bg-[rgba(250,249,246,0.85)] px-3 py-2 backdrop-blur-xl md:hidden">
        {navItems.map((item) => {
          const active =
            pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={`flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-[13px] font-medium no-underline transition-colors ${
                active
                  ? "bg-black/[0.045] text-ink"
                  : "text-[color:var(--color-ink-2)] hover:bg-black/[0.025] hover:text-ink"
              }`}
            >
              <span
                aria-hidden
                className={`inline-flex h-[16px] w-[16px] items-center justify-center ${
                  active
                    ? "text-[color:var(--color-grasp)]"
                    : "text-[color:var(--color-muted)]"
                }`}
              >
                {item.icon}
              </span>
              {item.label}
            </Link>
          );
        })}
      </div>

      {!orgApproved ? <ClosedPilotBanner /> : null}

      <main className="mx-auto max-w-[1180px] px-6 pt-16 pb-12">{children}</main>
    </div>
  );
}

function ClosedPilotBanner() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="sticky top-0 z-20 border-b border-amber-200/70 bg-amber-50/85 backdrop-blur-xl"
    >
      <div className="mx-auto flex max-w-[1180px] flex-wrap items-center gap-x-3 gap-y-1.5 px-6 py-2.5 text-[12.5px] leading-[1.45] text-amber-900">
        <span className="inline-flex items-center gap-1.5 font-semibold">
          <span
            aria-hidden
            className="inline-block h-1.5 w-1.5 rounded-full bg-amber-600"
          />
          Closed pilot
        </span>
        <span className="text-amber-900/85">
          You can plan freely — activating a rollout and connecting Teams
          unlock once a Grasp founder approves your workspace.
        </span>
        <a
          href="sms:8325707361&body=Hi, please approve my Grasp workspace."
          className="ml-auto font-medium text-amber-950 underline decoration-amber-400 underline-offset-2 hover:decoration-amber-700"
        >
          Text us to approve
        </a>
      </div>
    </div>
  );
}

function GraspMark() {
  return (
    <svg viewBox="0 0 64 64" fill="none" className="h-[26px] w-[26px]">
      <path
        d="M32 56C32 56 30 44 31 36C32 28 32 24 32 24"
        stroke="#2E7D32"
        strokeWidth="3.5"
        strokeLinecap="round"
        fill="none"
      />
      <path d="M32 28C34 22 40 12 54 6C52 14 46 26 32 28Z" fill="#4CAF50" />
      <path d="M31 36C28 30 20 20 8 14C10 24 20 34 31 36Z" fill="#2E7D32" />
    </svg>
  );
}

function DashboardIcon() {
  return (
    <svg viewBox="0 0 18 18" fill="none" className="h-full w-full">
      <rect x="2" y="2" width="6.5" height="6.5" rx="1.4" stroke="currentColor" strokeWidth="1.4" />
      <rect x="9.5" y="2" width="6.5" height="6.5" rx="1.4" stroke="currentColor" strokeWidth="1.4" />
      <rect x="2" y="9.5" width="6.5" height="6.5" rx="1.4" stroke="currentColor" strokeWidth="1.4" />
      <rect x="9.5" y="9.5" width="6.5" height="6.5" rx="1.4" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

function OrgChartIcon() {
  return (
    <svg viewBox="0 0 18 18" fill="none" className="h-full w-full">
      <circle cx="9" cy="3.5" r="1.6" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="3.5" cy="14.5" r="1.6" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="9" cy="14.5" r="1.6" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="14.5" cy="14.5" r="1.6" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="M9 5.1V8.5M3.5 12.9V10.5H14.5V12.9M9 8.5V12.9"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ChangesIcon() {
  // Cyclic refresh — two arcs with arrowheads, signaling rollout/iteration.
  return (
    <svg viewBox="0 0 18 18" fill="none" className="h-full w-full">
      <path
        d="M14.7 5.3A6 6 0 0 0 3.6 7.5"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      <path
        d="M15 2.2v3.3h-3.3"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M3.3 12.7a6 6 0 0 0 11.1-2.2"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      <path
        d="M3 15.8v-3.3h3.3"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg viewBox="0 0 18 18" fill="none" className="h-full w-full">
      <path d="M3 5h6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M12 5h3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="10.5" cy="5" r="1.6" stroke="currentColor" strokeWidth="1.4" />
      <path d="M3 13h3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M9 13h6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="7.5" cy="13" r="1.6" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

function AdminIcon() {
  return (
    <svg viewBox="0 0 18 18" fill="none" className="h-full w-full">
      <path
        d="M9 2.5 14 4.4v4.1c0 3.2-1.9 5.5-5 7-3.1-1.5-5-3.8-5-7V4.4l5-1.9Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path
        d="M6.8 9.1 8.3 10.6 11.4 7.4"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SignOutIcon() {
  return (
    <svg viewBox="0 0 18 18" fill="none" className="h-full w-full">
      <path
        d="M11 13v1.5a1.5 1.5 0 0 1-1.5 1.5h-5A1.5 1.5 0 0 1 3 14.5v-11A1.5 1.5 0 0 1 4.5 2h5A1.5 1.5 0 0 1 11 3.5V5"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      <path
        d="M15.5 9H7m0 0 2.5-2.5M7 9l2.5 2.5"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PanelToggleIcon({ collapsed }: { collapsed: boolean }) {
  // Window/panel icon: outer rectangle with a left "rail" indicating where
  // the sidebar lives. The rail tints when the sidebar is open and clears
  // when collapsed — same shape, different fill, matches shadcn/Linear.
  return (
    <svg viewBox="0 0 18 18" fill="none" className="h-[18px] w-[18px]">
      <rect
        x="2"
        y="3.25"
        width="14"
        height="11.5"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.4"
      />
      <rect
        x="2"
        y="3.25"
        width="4.5"
        height="11.5"
        rx="2"
        fill={collapsed ? "transparent" : "currentColor"}
        opacity={collapsed ? 0 : 0.18}
      />
      <line
        x1="6.5"
        y1="3.25"
        x2="6.5"
        y2="14.75"
        stroke="currentColor"
        strokeWidth="1.4"
      />
    </svg>
  );
}
