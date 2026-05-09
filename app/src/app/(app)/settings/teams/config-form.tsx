"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import {
  disableTeamsAction,
  saveTeamsConfigAction,
  type SaveTeamsConfigState,
} from "./actions";

export interface TeamsConfigFormValue {
  enabled: boolean;
  microsoftTenantId: string;
  microsoftAppId: string;
  hasPassword: boolean;
  teamsAppCatalogId: string;
  teamsAppManifestId: string;
  serviceUrl: string;
}

export function TeamsConfigForm({ value }: { value: TeamsConfigFormValue }) {
  const [saveState, saveAction] = useActionState<SaveTeamsConfigState, FormData>(
    saveTeamsConfigAction,
    null,
  );
  const [disableState, disableAction] = useActionState<
    SaveTeamsConfigState,
    FormData
  >(disableTeamsAction, null);

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
          Enable Microsoft Teams for this workspace
        </label>

        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="Microsoft tenant id"
            name="microsoftTenantId"
            defaultValue={value.microsoftTenantId}
            placeholder="00000000-0000-0000-0000-000000000000"
          />
          <TextField
            label="Microsoft app id"
            name="microsoftAppId"
            defaultValue={value.microsoftAppId}
            placeholder="Bot app/client id"
          />
          <TextField
            label="Microsoft app password"
            name="microsoftAppPassword"
            type="password"
            placeholder={
              value.hasPassword ? "Stored; leave blank to keep" : "Client secret"
            }
          />
          <TextField
            label="Teams app manifest id"
            name="teamsAppManifestId"
            defaultValue={value.teamsAppManifestId}
            placeholder="Manifest external id"
          />
          <TextField
            label="Teams app catalog id"
            name="teamsAppCatalogId"
            defaultValue={value.teamsAppCatalogId}
            placeholder="Graph catalog id (optional if manifest id works)"
          />
          <TextField
            label="Service URL override"
            name="serviceUrl"
            defaultValue={value.serviceUrl}
            placeholder="Optional"
          />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <SubmitButton label="Save Teams config" pendingLabel="Saving..." primary />
          <p className="text-[12.5px] text-[color:var(--color-muted)]">
            The app password is encrypted and never shown after save.
          </p>
        </div>
      </form>

      <form action={disableAction}>
        <SubmitButton label="Disable Teams" pendingLabel="Disabling..." />
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

function StateMessage({ state }: { state: SaveTeamsConfigState }) {
  if (!state) return null;
  return state.ok ? (
    <p className="text-[13px] text-[color:var(--color-grasp)]">
      {state.message}
    </p>
  ) : (
    <p className="text-[13px] text-red-700">{state.error}</p>
  );
}
