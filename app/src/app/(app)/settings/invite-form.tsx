"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { inviteMemberAction, type InviteMemberState } from "./actions";

export type OrgChartInviteSuggestion = {
  id: string;
  name: string;
  email: string;
  title: string | null;
  team: string | null;
};

export function InviteMemberForm({
  canInvite,
  suggestions,
}: {
  canInvite: boolean;
  suggestions: OrgChartInviteSuggestion[];
}) {
  const [state, formAction] = useActionState<InviteMemberState, FormData>(
    inviteMemberAction,
    null,
  );

  return (
    <div className="space-y-6">
      <form action={formAction} className="grid gap-4 sm:grid-cols-[1fr_160px_auto]">
        <label className="block">
          <span className="label">Email</span>
          <input
            type="email"
            name="email"
            required
            disabled={!canInvite}
            placeholder="teammate@company.com"
            className="input mt-1.5"
          />
        </label>
        <label className="block">
          <span className="label">Role</span>
          <select
            name="role"
            defaultValue="admin"
            disabled={!canInvite}
            className="input mt-1.5"
          >
            <option value="admin">Admin</option>
            <option value="member">User</option>
          </select>
        </label>
        <div className="flex items-end">
          <SubmitButton disabled={!canInvite} />
        </div>
      </form>

      {state ? (
        <p
          className={
            state.ok
              ? "text-[13px] text-[color:var(--color-grasp)]"
              : "text-[13px] text-red-700"
          }
        >
          {state.ok ? state.message : state.error}
        </p>
      ) : null}

      {canInvite && suggestions.length > 0 ? (
        <div>
          <p className="text-[12px] font-semibold uppercase tracking-[0.1em] text-[color:var(--color-muted)]">
            From org chart
          </p>
          <ul className="mt-3 divide-y divide-[color:var(--color-line)] rounded-xl border border-[color:var(--color-line-strong)] bg-white/70">
            {suggestions.slice(0, 8).map((person) => (
              <li
                key={person.id}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-[14px] font-medium text-ink">
                    {person.name}
                  </p>
                  <p className="truncate text-[12.5px] text-[color:var(--color-muted)]">
                    {person.title ? `${person.title} · ` : ""}
                    {person.team ? `${person.team} · ` : ""}
                    {person.email}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <QuickInviteForm
                    action={formAction}
                    email={person.email}
                    role="admin"
                    label="Invite admin"
                  />
                  <QuickInviteForm
                    action={formAction}
                    email={person.email}
                    role="member"
                    label="Invite user"
                  />
                </div>
              </li>
            ))}
          </ul>
          {suggestions.length > 8 ? (
            <p className="mt-2 text-[12.5px] text-[color:var(--color-muted)]">
              Showing 8 of {suggestions.length} people without workspace access.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function QuickInviteForm({
  action,
  email,
  role,
  label,
}: {
  action: (payload: FormData) => void;
  email: string;
  role: "admin" | "member";
  label: string;
}) {
  return (
    <form action={action}>
      <input type="hidden" name="email" value={email} />
      <input type="hidden" name="role" value={role} />
      <SmallSubmitButton label={label} />
    </form>
  );
}

function SubmitButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className="btn btn-primary w-full sm:w-auto"
      disabled={disabled || pending}
    >
      {pending ? "Inviting..." : "Send invite"}
    </button>
  );
}

function SmallSubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn btn-secondary text-[12px]" disabled={pending}>
      {pending ? "Sending..." : label}
    </button>
  );
}
