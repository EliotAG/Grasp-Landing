"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import {
  inviteMemberAction,
  type InviteMemberState,
} from "../../settings/actions";

export function PersonInviteActions({
  email,
  sourcePath,
}: {
  email: string;
  sourcePath: string;
}) {
  const [state, formAction] = useActionState<InviteMemberState, FormData>(
    inviteMemberAction,
    null,
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <InviteButton
          action={formAction}
          email={email}
          role="admin"
          sourcePath={sourcePath}
          label="Invite as admin"
          primary
        />
        <InviteButton
          action={formAction}
          email={email}
          role="member"
          sourcePath={sourcePath}
          label="Invite as user"
        />
      </div>
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
    </div>
  );
}

function InviteButton({
  action,
  email,
  role,
  sourcePath,
  label,
  primary = false,
}: {
  action: (payload: FormData) => void;
  email: string;
  role: "admin" | "member";
  sourcePath: string;
  label: string;
  primary?: boolean;
}) {
  return (
    <form action={action}>
      <input type="hidden" name="email" value={email} />
      <input type="hidden" name="role" value={role} />
      <input type="hidden" name="sourcePath" value={sourcePath} />
      <SubmitButton label={label} primary={primary} />
    </form>
  );
}

function SubmitButton({
  label,
  primary,
}: {
  label: string;
  primary: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className={primary ? "btn btn-primary" : "btn btn-secondary"}
      disabled={pending}
    >
      {pending ? "Sending..." : label}
    </button>
  );
}
