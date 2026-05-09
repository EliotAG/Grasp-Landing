"use client";

import Link from "next/link";
import { useState, useTransition } from "react";

import { activatePlan } from "../actions";

export function ActivateButton({ changePlanId }: { changePlanId: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const activate = () => {
    setError(null);
    startTransition(async () => {
      const result = await activatePlan(changePlanId);
      if (!result.ok) setError(result.error ?? "Could not activate.");
      if (result.ok) setConfirmOpen(false);
      // Success: server action revalidates this page, the panel re-renders
      // in active state.
    });
  };

  // Most precondition errors point at one of the wizard steps. We surface
  // a "Fix in wizard" link inline so the leader doesn't have to hunt for
  // the right step in the rail.
  const fixLink = error ? wizardFixLink(changePlanId, error) : null;

  return (
    <div className="flex flex-col items-end gap-2">
      <button
        type="button"
        onClick={() => {
          setError(null);
          setConfirmOpen(true);
        }}
        disabled={pending}
        className="btn btn-primary"
        aria-busy={pending}
      >
        {pending ? "Activating…" : "Activate rollout"}
      </button>
      {error ? (
        <div className="max-w-[360px] rounded-lg border border-red-200 bg-red-50/70 px-3 py-2 text-right text-[12px] leading-[1.45] text-red-800">
          <p>{error}</p>
          {fixLink ? (
            <p className="mt-1.5">
              <Link
                href={fixLink.href}
                className="font-medium text-red-900 underline underline-offset-2 hover:text-red-700"
              >
                {fixLink.label} →
              </Link>
            </p>
          ) : null}
        </div>
      ) : null}
      {confirmOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="activate-rollout-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4"
          onClick={() => {
            if (!pending) setConfirmOpen(false);
          }}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-[color:var(--color-line)] bg-white p-6 text-left shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[color:var(--color-muted)]">
              Activate rollout
            </p>
            <h2
              id="activate-rollout-title"
              className="mt-2 text-[20px] font-semibold tracking-[-0.02em] text-ink"
            >
              Send this to your team?
            </h2>
            <p className="mt-3 text-[14px] leading-[1.6] text-[color:var(--color-ink-2)]">
              Every affected employee will get a Teams DM with the announcement
              and a personal survey card.
            </p>
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmOpen(false)}
                disabled={pending}
                className="btn btn-secondary"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={activate}
                disabled={pending}
                className="btn btn-primary"
                aria-busy={pending}
              >
                {pending ? "Activating…" : "Activate rollout"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function wizardFixLink(
  changePlanId: string,
  message: string,
): { href: string; label: string } | null {
  const m = message.toLowerCase();
  if (m.includes("stakeholder")) {
    return {
      href: `/changes/${changePlanId}/wizard/audience`,
      label: "Open audience step",
    };
  }
  if (m.includes("announcement")) {
    return {
      href: `/changes/${changePlanId}/wizard/approve`,
      label: "Open approval step",
    };
  }
  if (m.includes("wizard")) {
    return {
      href: `/changes/${changePlanId}/wizard`,
      label: "Open planning wizard",
    };
  }
  return null;
}
