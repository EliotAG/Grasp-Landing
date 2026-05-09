"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import {
  bootstrapTeamsRecipientsAction,
  checkTeamsEndpointAction,
  testTeamsGraphAction,
  type BootstrapTeamsState,
  type CheckTeamsEndpointState,
} from "./actions";

type Readiness = {
  employees: number;
  resolvedUsers: number;
  installedUsers: number;
  capturedReferences: number;
  readyRecipients: number;
  lastError: string | null;
};

export function BootstrapForm({ readiness }: { readiness: Readiness }) {
  const [endpointState, endpointAction] =
    useActionState<CheckTeamsEndpointState, FormData>(
      checkTeamsEndpointAction,
      null,
    );
  const [graphState, graphAction] =
    useActionState<BootstrapTeamsState, FormData>(testTeamsGraphAction, null);
  const [bootstrapState, bootstrapAction] =
    useActionState<BootstrapTeamsState, FormData>(
      bootstrapTeamsRecipientsAction,
      null,
    );

  return (
    <div className="space-y-5">
      <dl className="grid gap-3 sm:grid-cols-5">
        <Metric label="Employees" value={readiness.employees} />
        <Metric label="Entra users" value={readiness.resolvedUsers} />
        <Metric label="App installed" value={readiness.installedUsers} />
        <Metric label="References" value={readiness.capturedReferences} />
        <Metric label="Ready" value={readiness.readyRecipients} />
      </dl>

      {readiness.lastError ? (
        <p className="rounded-xl border border-red-200/70 bg-red-50 px-4 py-3 text-[13px] text-red-800">
          Last bootstrap issue: {readiness.lastError}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <form action={endpointAction}>
          <SubmitButton label="Test bot endpoint" pendingLabel="Testing…" />
        </form>
        <form action={graphAction}>
          <SubmitButton
            label="Test Graph permissions"
            pendingLabel="Testing…"
          />
        </form>
        <form action={bootstrapAction}>
          <SubmitButton
            label="Bootstrap Teams recipients"
            pendingLabel="Bootstrapping…"
            primary
          />
        </form>
      </div>

      <StateMessage state={endpointState} />
      <StateMessage state={graphState} />
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

function StateMessage({ state }: { state: BootstrapTeamsState }) {
  if (!state) return null;
  return state.ok ? (
    <p className="text-[13px] text-[color:var(--color-grasp)]">
      {state.message}
    </p>
  ) : (
    <p className="text-[13px] text-red-700">{state.error}</p>
  );
}
