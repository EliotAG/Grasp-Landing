"use client";

/**
 * Inline response form on each concern in the change detail page.
 *
 * Two modes:
 *   - Concern is `open` and unresponded → textarea + Send button.
 *   - Concern is `responded` → read-only quote of leadership's reply
 *     plus a small "Edit reply" affordance (rare path; mainly for
 *     dev iteration). The agent will redeliver if edited.
 *
 * The Send action runs the proactive turn server-side (synthesizes a
 * delivery message, pushes via Teams + simulator, marks deliveredAt).
 * We surface per-channel outcomes back to the leader so they know
 * whether the reply actually landed.
 */

import { useState, useTransition } from "react";

import { respondToConcern } from "../actions";

interface ConcernResponseFormProps {
  changePlanId: string;
  concernId: string;
  initialBody: string | null;
  responderName: string | null;
  respondedAt: Date | null;
  deliveredAt: Date | null;
  deliveryError: string | null;
}

export function ConcernResponseForm({
  changePlanId,
  concernId,
  initialBody,
  responderName,
  respondedAt,
  deliveredAt,
  deliveryError,
}: ConcernResponseFormProps) {
  const [editing, setEditing] = useState(initialBody === null);
  const [body, setBody] = useState(initialBody ?? "");
  const [pending, startTransition] = useTransition();
  const [statusNote, setStatusNote] = useState<string | null>(null);
  const [statusKind, setStatusKind] = useState<"ok" | "warn" | "err">("ok");

  const submit = () => {
    setStatusNote(null);
    startTransition(async () => {
      const result = await respondToConcern(changePlanId, concernId, body);
      if (!result.ok) {
        setStatusKind("err");
        setStatusNote(result.error ?? "Save failed.");
        return;
      }
      setEditing(false);
      const channels = result.channels;
      if (result.delivered) {
        setStatusKind("ok");
        const parts: string[] = [];
        if (channels?.teams === "sent") parts.push("Teams");
        if (channels?.simulator === "sent") parts.push("simulator");
        setStatusNote(
          parts.length > 0
            ? `Delivered via ${parts.join(" + ")}.`
            : "Delivered.",
        );
      } else {
        setStatusKind("warn");
        setStatusNote(
          result.error ??
            "Saved your reply but no channel accepted delivery. The agent will retry on the employee's next message.",
        );
      }
    });
  };

  if (!editing && initialBody) {
    return (
      <div className="mt-4 rounded-lg border border-[color:var(--color-line)] bg-white/40 p-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[color:var(--color-muted)]">
            Leadership reply
          </p>
          <DeliveryBadge
            deliveredAt={deliveredAt}
            deliveryError={deliveryError}
          />
        </div>
        <p className="mt-2 whitespace-pre-wrap text-[14px] leading-[1.65]">
          {initialBody}
        </p>
        <div className="mt-3 flex items-center justify-between gap-3 text-[11px] text-[color:var(--color-muted-2)]">
          <span>
            {responderName ?? "Leadership"}
            {respondedAt
              ? ` · ${respondedAt.toLocaleString(undefined, {
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}`
              : ""}
          </span>
          <button
            type="button"
            onClick={() => {
              setBody(initialBody);
              setEditing(true);
              setStatusNote(null);
            }}
            className="text-[color:var(--color-muted)] underline-offset-2 hover:text-ink hover:underline"
          >
            Edit & resend
          </button>
        </div>
        {statusNote ? (
          <p
            className={`mt-2 text-[11px] ${
              statusKind === "ok"
                ? "text-[color:var(--color-grasp)]"
                : statusKind === "warn"
                  ? "text-orange-700"
                  : "text-red-700"
            }`}
          >
            {statusNote}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="mt-4 rounded-lg border border-dashed border-[color:var(--color-line-strong)] bg-white/30 p-4">
      <label className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[color:var(--color-muted)]">
        Reply to this concern
      </label>
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        disabled={pending}
        rows={4}
        placeholder="Write the response you want the agent to deliver. The substance reaches the employee verbatim — the agent only contextualizes."
        className="mt-2 w-full resize-y rounded-md border border-[color:var(--color-line)] bg-white/80 p-3 text-[14px] leading-[1.6] text-ink focus:border-[color:var(--color-grasp)] focus:outline-none disabled:opacity-60"
      />
      <div className="mt-3 flex items-center justify-between gap-3">
        <p className="text-[11px] text-[color:var(--color-muted-2)]">
          The agent delivers via Teams + simulator immediately on send. Your
          words reach the employee — the agent only frames.
        </p>
        <div className="flex items-center gap-2">
          {initialBody ? (
            <button
              type="button"
              onClick={() => {
                setBody(initialBody);
                setEditing(false);
                setStatusNote(null);
              }}
              disabled={pending}
              className="rounded-full px-3 py-1 text-[12px] text-[color:var(--color-muted)] hover:text-ink"
            >
              Cancel
            </button>
          ) : null}
          <button
            type="button"
            onClick={submit}
            disabled={pending || body.trim().length < 4}
            className="rounded-full bg-[color:var(--color-grasp)] px-4 py-1.5 text-[12px] font-semibold text-white transition-colors hover:bg-[color:var(--color-grasp-strong)] disabled:opacity-50"
          >
            {pending ? "Delivering…" : initialBody ? "Resend" : "Send to employee"}
          </button>
        </div>
      </div>
      {statusNote ? (
        <p
          className={`mt-2 text-[11px] ${
            statusKind === "ok"
              ? "text-[color:var(--color-grasp)]"
              : statusKind === "warn"
                ? "text-orange-700"
                : "text-red-700"
          }`}
        >
          {statusNote}
        </p>
      ) : null}
    </div>
  );
}

function DeliveryBadge({
  deliveredAt,
  deliveryError,
}: {
  deliveredAt: Date | null;
  deliveryError: string | null;
}) {
  if (deliveredAt) {
    return (
      <span
        className="rounded-full bg-[color:var(--color-grasp-soft)] px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--color-grasp)]"
        title={`Delivered ${deliveredAt.toLocaleString()}`}
      >
        delivered
      </span>
    );
  }
  if (deliveryError) {
    return (
      <span
        className="rounded-full bg-red-100/70 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-red-800"
        title={deliveryError}
      >
        delivery failed
      </span>
    );
  }
  return (
    <span className="rounded-full bg-amber-100/70 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-amber-800">
      queued
    </span>
  );
}
