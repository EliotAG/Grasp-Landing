"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import {
  sendSlackTestMessageAction,
  type SendSlackTestState,
} from "./actions";

type Recipient = {
  id: string;
  label: string;
  sub: string;
};

export function SlackSendForm({ recipients }: { recipients: Recipient[] }) {
  const [state, formAction] = useActionState<SendSlackTestState, FormData>(
    sendSlackTestMessageAction,
    null,
  );

  return (
    <form
      action={formAction}
      className="space-y-5"
      key={state?.ok ? "reset" : "form"}
    >
      <div>
        <label className="label" htmlFor="slack-recipient">
          Recipient
        </label>
        <div className="mt-1.5">
          <select
            id="slack-recipient"
            name="contactId"
            className="input"
            required
            defaultValue=""
          >
            <option value="" disabled>
              Choose a bootstrapped Slack user...
            </option>
            {recipients.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label} - {r.sub}
              </option>
            ))}
          </select>
        </div>
        <p className="mt-1.5 text-[12px] text-[color:var(--color-muted)]">
          People appear here after Slack bootstrap resolves their org-chart
          email and opens a bot DM channel.
        </p>
      </div>

      <div>
        <label className="label" htmlFor="slack-text">
          Message
        </label>
        <div className="mt-1.5">
          <textarea
            id="slack-text"
            name="text"
            rows={4}
            placeholder="Hi - sending a test from Grasp."
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
      {pending ? "Sending..." : "Send test message"}
    </button>
  );
}
