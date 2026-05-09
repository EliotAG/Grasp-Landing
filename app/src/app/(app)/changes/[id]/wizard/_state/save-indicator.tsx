"use client";

/**
 * Saved-indicator context.
 *
 * The wizard layout renders one `<SavedIndicator />` in the top-right.
 * Every step's autosave hook calls `notifySaved(date)` after a successful
 * server-action save; the indicator updates without a re-render of the
 * step content.
 *
 * The provider also ticks every 30s so "Saved 2:47 PM" can soften to
 * "Saved a few minutes ago" without each form having to know.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

type SaveStatus =
  | { state: "idle" }
  | { state: "saving" }
  | { state: "saved"; at: Date }
  | { state: "error"; message: string };

interface Ctx {
  status: SaveStatus;
  notifySaving: () => void;
  notifySaved: (at: Date) => void;
  notifyError: (message: string) => void;
}

const SaveCtx = createContext<Ctx | null>(null);

export function SaveProvider({
  children,
  initialSavedAt,
}: {
  children: React.ReactNode;
  initialSavedAt: Date | null;
}) {
  const [status, setStatus] = useState<SaveStatus>(
    initialSavedAt
      ? { state: "saved", at: initialSavedAt }
      : { state: "idle" },
  );

  const notifySaving = useCallback(() => setStatus({ state: "saving" }), []);
  const notifySaved = useCallback(
    (at: Date) => setStatus({ state: "saved", at }),
    [],
  );
  const notifyError = useCallback(
    (message: string) => setStatus({ state: "error", message }),
    [],
  );

  const value = useMemo(
    () => ({ status, notifySaving, notifySaved, notifyError }),
    [status, notifySaving, notifySaved, notifyError],
  );
  return <SaveCtx.Provider value={value}>{children}</SaveCtx.Provider>;
}

export function useSaveCtx(): Ctx {
  const ctx = useContext(SaveCtx);
  if (!ctx) throw new Error("useSaveCtx must be inside <SaveProvider>");
  return ctx;
}

export function SavedIndicator() {
  const { status } = useSaveCtx();
  // Tick every 30s so "Saved 2:47 PM" relative phrasing stays accurate.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick((n) => n + 1), 30_000);
    return () => window.clearInterval(id);
  }, []);

  let label = "";
  let tone = "text-[color:var(--color-muted-2)]";
  if (status.state === "saving") {
    label = "Saving…";
  } else if (status.state === "saved") {
    label = `Saved ${formatRelative(status.at)}`;
  } else if (status.state === "error") {
    label = `Save failed — ${status.message}`;
    tone = "text-red-700";
  }
  if (!label) return null;
  return (
    <span
      className={`text-[12px] ${tone}`}
      role="status"
      aria-live="polite"
    >
      {label}
    </span>
  );
}

function formatRelative(at: Date): string {
  const seconds = Math.max(0, (Date.now() - at.getTime()) / 1000);
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${Math.round(seconds)}s ago`;
  if (seconds < 3600) {
    const m = Math.round(seconds / 60);
    return `${m} min${m === 1 ? "" : "s"} ago`;
  }
  return `at ${at.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  })}`;
}
