"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import {
  sendTestMessageAction,
  type SendTestMessageState,
} from "./actions";

type Recipient = {
  id: string;
  label: string;
  sub: string;
};

export function SendForm({ recipients }: { recipients: Recipient[] }) {
  const [state, formAction] = useActionState<SendTestMessageState, FormData>(
    sendTestMessageAction,
    null,
  );

  return (
    <form
      action={formAction}
      className="space-y-5"
      key={state?.ok ? "reset" : "form"}
    >
      <div>
        <label className="label" htmlFor="teams-recipient">
          Recipient
        </label>
        <div className="mt-1.5">
          <select
            id="teams-recipient"
            name="referenceId"
            className="input"
            required
            defaultValue=""
          >
            <option value="" disabled>
              Choose a captured Teams user…
            </option>
            {recipients.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label} — {r.sub}
              </option>
            ))}
          </select>
        </div>
        <p className="mt-1.5 text-[12px] text-[color:var(--color-muted)]">
          Only people with a captured bot conversation reference appear here.
          Use bootstrap on the Teams settings page to install Grasp for users
          without asking them to message the bot first.
        </p>
      </div>

      <div>
        <label className="label" htmlFor="teams-text">
          Message
        </label>
        <div className="mt-1.5">
          <textarea
            id="teams-text"
            name="text"
            rows={4}
            placeholder="Hi — sending a test from Grasp."
            className="input min-h-[110px] resize-y"
            required
            maxLength={4000}
          />
        </div>
      </div>

      <div className="flex items-center gap-3">
        <SubmitButton />
        {state?.ok === true ? (
          <span className="text-[13px] text-[color:var(--color-grasp)]">
            {state.message}
          </span>
        ) : null}
        {state?.ok === false ? (
          <span className="text-[13px] text-red-700">{state.error}</span>
        ) : null}
      </div>
    </form>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn btn-primary" disabled={pending}>
      {pending ? "Sending…" : "Send test message"}
    </button>
  );
}
