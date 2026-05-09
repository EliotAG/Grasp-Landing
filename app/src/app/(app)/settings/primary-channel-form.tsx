"use client";

import { OrganizationTextChannel } from "@prisma/client";
import { useActionState } from "react";

import {
  savePrimaryTextChannelAction,
  type SavePrimaryChannelState,
} from "./actions";

export function PrimaryChannelForm({
  value,
  disabled,
}: {
  value: OrganizationTextChannel;
  disabled: boolean;
}) {
  const [state, action, pending] = useActionState<
    SavePrimaryChannelState,
    FormData
  >(savePrimaryTextChannelAction, null);

  return (
    <form action={action} className="space-y-4">
      <fieldset
        disabled={disabled || pending}
        className="grid gap-3 sm:grid-cols-2"
      >
        <ChannelOption
          value="teams"
          title="Microsoft Teams"
          description="Use the Teams bot for kickoff DMs, check-ins, amendments, and leadership responses."
          defaultChecked={value === "teams"}
        />
        <ChannelOption
          value="slack"
          title="Slack"
          description="Use the Slack app for kickoff DMs, check-ins, amendments, and leadership responses."
          defaultChecked={value === "slack"}
        />
      </fieldset>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={disabled || pending}
          className="btn btn-primary"
        >
          {pending ? "Saving..." : "Save primary channel"}
        </button>
        {disabled ? (
          <p className="text-[12.5px] text-amber-800">
            Channel selection unlocks once this workspace is approved.
          </p>
        ) : null}
      </div>

      {state ? (
        <p
          className={`rounded-xl px-4 py-3 text-[13px] ${
            state.ok
              ? "border border-green-200 bg-green-50 text-green-800"
              : "border border-red-200 bg-red-50 text-red-800"
          }`}
        >
          {state.ok ? state.message : state.error}
        </p>
      ) : null}
    </form>
  );
}

function ChannelOption({
  value,
  title,
  description,
  defaultChecked,
}: {
  value: OrganizationTextChannel;
  title: string;
  description: string;
  defaultChecked: boolean;
}) {
  return (
    <label className="block cursor-pointer rounded-2xl border border-[color:var(--color-line-strong)] bg-white/70 p-4 transition-colors hover:bg-white has-[:checked]:border-[color:var(--color-grasp)] has-[:checked]:bg-[color:var(--color-grasp-soft)]">
      <span className="flex items-start gap-3">
        <input
          type="radio"
          name="primaryTextChannel"
          value={value}
          defaultChecked={defaultChecked}
          className="mt-1"
        />
        <span>
          <span className="block text-[14px] font-semibold text-ink">
            {title}
          </span>
          <span className="mt-1 block text-[12.5px] leading-[1.55] text-[color:var(--color-muted)]">
            {description}
          </span>
        </span>
      </span>
    </label>
  );
}
