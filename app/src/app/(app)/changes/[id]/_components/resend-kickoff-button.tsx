"use client";

import { useState, useTransition } from "react";

import { resendKickoff } from "../actions";

export function ResendKickoffButton({
  changePlanId,
  enrollmentId,
}: {
  changePlanId: string;
  enrollmentId: string;
}) {
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState<string | null>(null);

  const onClick = () => {
    setNote(null);
    startTransition(async () => {
      const result = await resendKickoff(changePlanId, enrollmentId);
      if (!result.ok) {
        setNote(result.error ?? "Resend failed.");
      } else if (result.status === "skipped_no_bot") {
        setNote("Still no bot reference for this user.");
      } else if (result.status === "failed") {
        setNote("Send failed — see error column.");
      }
    });
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        className="rounded-full border border-[color:var(--color-line-strong)] bg-white/60 px-3 py-1 text-[12px] font-medium text-ink-2 transition-colors hover:bg-white disabled:opacity-60"
      >
        {pending ? "Sending…" : "Resend"}
      </button>
      {note ? (
        <span className="text-[11px] text-[color:var(--color-muted-2)]">
          {note}
        </span>
      ) : null}
    </div>
  );
}
