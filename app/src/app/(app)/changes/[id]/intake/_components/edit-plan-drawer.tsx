/**
 * Edit-plan drawer — slides in from the right with the structured plan
 * fields. Saves through the same `onSave` callback the parent wires to the
 * existing planner services, so this component knows nothing about Prisma or
 * server actions.
 *
 * The form body is split into its own component (`DrawerForm`) and keyed on
 * an "open generation" counter that bumps every time the drawer transitions
 * from closed to open. That way, opening the drawer always remounts the
 * form with the latest plan props as initial state — no resync effect needed
 * — while the wrapper stays mounted so the slide-out transition still plays.
 */
"use client";

import { useState, useTransition } from "react";

import type { WizardPlan } from "../../wizard/_components/types";

function toInputDate(date: Date | null): string {
  return date ? date.toISOString().slice(0, 10) : "";
}

export type EditPlanPayload = {
  name: string;
  summary: string;
  coreMechanism: string;
  kickoffDate: string;
  targetDate: string;
  cadence: string;
  sendOnBehalf: boolean;
  announcement: string;
};

type SaveResult = { ok: true } | { ok: false; error: string };

export function EditPlanDrawer({
  open,
  onClose,
  plan,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  plan: WizardPlan;
  onSave: (payload: EditPlanPayload) => Promise<SaveResult>;
}) {
  // Track the last `open` value we rendered with so we can detect the
  // closed -> open transition and bump the form generation. Setting state
  // during render in response to a prop change is the React-recommended way
  // to do "reset on prop change" without a syncing effect.
  const [lastOpen, setLastOpen] = useState(open);
  const [formGeneration, setFormGeneration] = useState(0);
  if (open !== lastOpen) {
    setLastOpen(open);
    if (open) setFormGeneration((n) => n + 1);
  }

  return (
    <div
      aria-hidden={!open}
      className={`fixed inset-0 z-40 ${open ? "" : "pointer-events-none"}`}
    >
      <button
        type="button"
        aria-label="Close edit drawer"
        onClick={onClose}
        tabIndex={open ? 0 : -1}
        className={`absolute inset-0 bg-black/30 backdrop-blur-sm transition-opacity duration-200 ${
          open ? "opacity-100" : "opacity-0"
        }`}
      />
      <div
        data-open={open}
        role="dialog"
        aria-modal="true"
        aria-label="Edit plan fields"
        className="intake-drawer absolute right-0 top-0 flex h-full w-full max-w-[460px] flex-col border-l border-[color:var(--color-line)] bg-[color:var(--color-canvas)] p-6 shadow-2xl"
      >
        <DrawerForm
          key={formGeneration}
          plan={plan}
          onClose={onClose}
          onSave={onSave}
        />
      </div>
    </div>
  );
}

function DrawerForm({
  plan,
  onClose,
  onSave,
}: {
  plan: WizardPlan;
  onClose: () => void;
  onSave: (payload: EditPlanPayload) => Promise<SaveResult>;
}) {
  const [name, setName] = useState(plan.name ?? "");
  const [summary, setSummary] = useState(plan.summary ?? "");
  const [coreMechanism, setCoreMechanism] = useState(plan.coreMechanism ?? "");
  const [kickoffDate, setKickoffDate] = useState(toInputDate(plan.kickoffDate));
  const [targetDate, setTargetDate] = useState(toInputDate(plan.targetDate));
  const [cadence, setCadence] = useState(
    plan.responseCadenceHours ? String(plan.responseCadenceHours) : "",
  );
  const [sendOnBehalf, setSendOnBehalf] = useState(
    plan.announcementSendOnBehalf,
  );
  const [announcement, setAnnouncement] = useState(plan.announcement ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    setError(null);
    startTransition(async () => {
      const result = await onSave({
        name,
        summary,
        coreMechanism,
        kickoffDate,
        targetDate,
        cadence,
        sendOnBehalf,
        announcement,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onClose();
    });
  }

  return (
    <>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="serif text-[24px] leading-[1.15]">Edit plan fields</h2>
        <button
          type="button"
          onClick={onClose}
          className="text-[12px] text-[color:var(--color-muted)] hover:text-ink"
        >
          Close
        </button>
      </div>

      <div className="flex-1 overflow-y-auto pr-1">
        <div className="space-y-4">
          <Field label="Name">
            <input
              className="input"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          <Field label="Summary">
            <textarea
              className="input min-h-[100px]"
              value={summary}
              onChange={(event) => setSummary(event.target.value)}
            />
          </Field>
          <Field label="Key outcome to protect">
            <textarea
              className="input min-h-[100px]"
              value={coreMechanism}
              onChange={(event) => setCoreMechanism(event.target.value)}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Kickoff">
              <input
                type="date"
                className="input"
                value={kickoffDate}
                onChange={(event) => setKickoffDate(event.target.value)}
              />
            </Field>
            <Field label="Target">
              <input
                type="date"
                className="input"
                value={targetDate}
                onChange={(event) => setTargetDate(event.target.value)}
              />
            </Field>
          </div>
          <div className="grid grid-cols-[1fr_auto] items-end gap-3">
            <Field label="Response hours">
              <input
                type="number"
                min={1}
                max={720}
                className="input"
                value={cadence}
                onChange={(event) => setCadence(event.target.value)}
              />
            </Field>
            <label className="flex items-center gap-2 pb-3 text-[12px] text-[color:var(--color-muted)]">
              <input
                type="checkbox"
                checked={sendOnBehalf}
                onChange={(event) => setSendOnBehalf(event.target.checked)}
              />
              Agent sends
            </label>
          </div>
          <Field label="Announcement">
            <textarea
              className="input min-h-[160px] font-serif leading-[1.65]"
              value={announcement}
              onChange={(event) => setAnnouncement(event.target.value)}
            />
          </Field>
        </div>
      </div>

      {error ? (
        <p className="mt-3 text-[12px] text-red-700">{error}</p>
      ) : null}

      <div className="mt-4 flex justify-end gap-2 border-t border-[color:var(--color-line)] pt-4">
        <button
          type="button"
          onClick={onClose}
          className="btn btn-ghost text-[13px]"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={save}
          disabled={pending}
          className="btn btn-primary text-[13px]"
        >
          {pending ? "Saving…" : "Save changes"}
        </button>
      </div>
    </>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="label">{label}</label>
      {children}
    </div>
  );
}
