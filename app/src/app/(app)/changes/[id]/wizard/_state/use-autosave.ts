"use client";

/**
 * Generic autosave hook for wizard fields.
 *
 * - Debounces text inputs by `debounceMs` (default 700 ms).
 * - Always saves immediately on blur regardless of debounce timer.
 * - Cancels pending saves on unmount or value change.
 * - Surfaces save state through the SaveProvider so the layout indicator
 *   updates without prop drilling.
 *
 * Intentionally minimal: each step builds its save payload itself and just
 * calls `request(payload)`. The hook owns the debounce + saving/saved/error
 * lifecycle.
 */

import { useCallback, useEffect, useRef } from "react";
import { useSaveCtx } from "./save-indicator";

type SaveResult =
  | { ok: true; savedAt: string }
  | { ok: false; error: string };

export function useAutosave<TPayload>(
  action: (payload: TPayload) => Promise<SaveResult>,
  opts: { debounceMs?: number } = {},
) {
  const { notifySaving, notifySaved, notifyError } = useSaveCtx();
  const debounceMs = opts.debounceMs ?? 700;
  const timer = useRef<number | null>(null);
  const inflight = useRef(0);
  const pending = useRef<TPayload | null>(null);

  const flush = useCallback(
    async (payload: TPayload) => {
      const seq = ++inflight.current;
      notifySaving();
      try {
        const result = await action(payload);
        // Drop stale responses if a newer save started.
        if (seq !== inflight.current) return;
        if (result.ok) {
          notifySaved(new Date(result.savedAt));
        } else {
          notifyError(result.error);
        }
      } catch (err) {
        if (seq !== inflight.current) return;
        notifyError(err instanceof Error ? err.message : "Save failed");
      }
    },
    [action, notifySaving, notifySaved, notifyError],
  );

  const queue = useCallback(
    (payload: TPayload) => {
      pending.current = payload;
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        timer.current = null;
        if (pending.current !== null) {
          const p = pending.current;
          pending.current = null;
          void flush(p);
        }
      }, debounceMs);
    },
    [debounceMs, flush],
  );

  const flushNow = useCallback(
    (payload?: TPayload) => {
      if (timer.current !== null) {
        window.clearTimeout(timer.current);
        timer.current = null;
      }
      const p = payload ?? pending.current;
      pending.current = null;
      if (p !== null) return flush(p);
      return Promise.resolve();
    },
    [flush],
  );

  useEffect(() => {
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, []);

  return { queue, flushNow };
}
