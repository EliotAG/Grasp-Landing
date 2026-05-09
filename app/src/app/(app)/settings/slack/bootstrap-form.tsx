"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import {
  bootstrapSlackRecipientsAction,
  checkSlackEndpointAction,
  testSlackAuthAction,
  type BootstrapSlackState,
  type CheckSlackEndpointState,
} from "./actions";

type Readiness = {
  employees: number;
  linkedUsers: number;
  dmChannels: number;
  readyRecipients: number;
  lastError: string | null;
};

export function SlackBootstrapForm({ readiness }: { readiness: Readiness }) {
  const [endpointState, endpointAction] =
    useActionState<CheckSlackEndpointState, FormData>(
      checkSlackEndpointAction,
      null,
    );
  const [authState, authAction] =
    useActionState<BootstrapSlackState, FormData>(testSlackAuthAction, null);
  const [bootstrapState, bootstrapAction] =
    useActionState<BootstrapSlackState, FormData>(
      bootstrapSlackRecipientsAction,
      null,
    );

  return (
    <div className="space-y-5">
      <dl className="grid gap-3 sm:grid-cols-4">
        <Metric label="Employees" value={readiness.employees} />
        <Metric label="Slack users" value={readiness.linkedUsers} />
        <Metric label="DM channels" value={readiness.dmChannels} />
        <Metric label="Ready" value={readiness.readyRecipients} />
      </dl>

      {readiness.lastError ? (
        <p className="rounded-xl border border-red-200/70 bg-red-50 px-4 py-3 text-[13px] text-red-800">
          Last bootstrap issue: {readiness.lastError}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <form action={endpointAction}>
          <SubmitButton label="Test events endpoint" pendingLabel="Testing..." />
        </form>
        <form action={authAction}>
          <SubmitButton label="Test Slack auth" pendingLabel="Testing..." />
        </form>
        <form action={bootstrapAction}>
          <SubmitButton
            label="Bootstrap Slack recipients"
            pendingLabel="Bootstrapping..."
            primary
          />
        </form>
      </div>

      <StateMessage state={endpointState} />
      <StateMessage state={authState} />
      <StateMessage state={bootstrapState} />
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-[color:var(--color-line)] bg-white/70 px-4 py-3">
      <dt className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[color:var(--color-muted)]">
        {label}
      </dt>
      <dd className="mt-1 text-[22px] font-semibold text-ink">{value}</dd>
    </div>
  );
}

function SubmitButton({
  label,
  pendingLabel,
  primary = false,
}: {
  label: string;
  pendingLabel: string;
  primary?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className={primary ? "btn btn-primary" : "btn btn-secondary"}
      disabled={pending}
    >
      {pending ? pendingLabel : label}
    </button>
  );
}

function StateMessage({ state }: { state: BootstrapSlackState }) {
  if (!state) return null;
  return state.ok ? (
    <p className="text-[13px] text-[color:var(--color-grasp)]">
      {state.message}
    </p>
  ) : (
    <p className="text-[13px] text-red-700">{state.error}</p>
  );
}
