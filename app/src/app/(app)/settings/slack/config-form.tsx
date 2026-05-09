"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import {
  disableSlackAction,
  saveSlackConfigAction,
  type SaveSlackConfigState,
} from "./actions";

export interface SlackConfigFormValue {
  enabled: boolean;
  slackTeamId: string;
  slackTeamName: string;
  slackAppId: string;
  slackBotUserId: string;
  hasBotToken: boolean;
  hasSigningSecret: boolean;
}

export function SlackConfigForm({ value }: { value: SlackConfigFormValue }) {
  const [saveState, saveAction] = useActionState<SaveSlackConfigState, FormData>(
    saveSlackConfigAction,
    null,
  );
  const [disableState, disableAction] = useActionState<
    SaveSlackConfigState,
    FormData
  >(disableSlackAction, null);

  return (
    <div className="space-y-5">
      <form action={saveAction} className="space-y-5">
        <label className="flex items-center gap-3 text-[14px] font-medium text-ink">
          <input
            type="checkbox"
            name="enabled"
            defaultChecked={value.enabled}
            className="h-4 w-4 rounded border-[color:var(--color-line-strong)]"
          />
          Enable Slack for this workspace
        </label>

        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="Slack team id"
            name="slackTeamId"
            defaultValue={value.slackTeamId}
            placeholder="T0123456789"
          />
          <TextField
            label="Slack team name"
            name="slackTeamName"
            defaultValue={value.slackTeamName}
            placeholder="Optional display name"
          />
          <TextField
            label="Slack app id"
            name="slackAppId"
            defaultValue={value.slackAppId}
            placeholder="A0123456789"
          />
          <TextField
            label="Bot user id"
            name="slackBotUserId"
            defaultValue={value.slackBotUserId}
            placeholder="U0123456789"
          />
          <TextField
            label="Bot token"
            name="slackBotToken"
            type="password"
            placeholder={value.hasBotToken ? "Stored; leave blank to keep" : "xoxb-..."}
          />
          <TextField
            label="Signing secret"
            name="slackSigningSecret"
            type="password"
            placeholder={
              value.hasSigningSecret ? "Stored; leave blank to keep" : "Slack signing secret"
            }
          />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <SubmitButton label="Save Slack config" pendingLabel="Saving..." primary />
          <p className="text-[12.5px] text-[color:var(--color-muted)]">
            Bot token and signing secret are encrypted and never shown after save.
          </p>
        </div>
      </form>

      <form action={disableAction}>
        <SubmitButton label="Disable Slack" pendingLabel="Disabling..." />
      </form>

      <StateMessage state={saveState} />
      <StateMessage state={disableState} />
    </div>
  );
}

function TextField({
  label,
  name,
  defaultValue,
  placeholder,
  type = "text",
}: {
  label: string;
  name: string;
  defaultValue?: string;
  placeholder?: string;
  type?: string;
}) {
  return (
    <label className="block">
      <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[color:var(--color-muted)]">
        {label}
      </span>
      <input
        type={type}
        name={name}
        defaultValue={defaultValue}
        placeholder={placeholder}
        className="mt-2 w-full rounded-xl border border-[color:var(--color-line-strong)] bg-white px-3 py-2 text-[14px] text-ink outline-none focus:border-[color:var(--color-grasp)]"
      />
    </label>
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

function StateMessage({ state }: { state: SaveSlackConfigState }) {
  if (!state) return null;
  return state.ok ? (
    <p className="text-[13px] text-[color:var(--color-grasp)]">
      {state.message}
    </p>
  ) : (
    <p className="text-[13px] text-red-700">{state.error}</p>
  );
}
