"use client";

/**
 * Inline amendment composer on the change detail page.
 *
 * The leader writes the verbatim update to the change itself,
 * picks an audience (everyone vs. just the surfacers), and
 * optionally links the source concerns that motivated it. The
 * agent then fans the body out to each recipient with attribution
 * back to the linked concerns where applicable.
 */

import { useMemo, useState, useTransition } from "react";

import { publishAmendment } from "../actions";

interface SourceConcernOption {
  id: string;
  summary: string;
  dimension: string;
  employeeId: string;
  employeeName: string;
}

interface AmendmentFormProps {
  changePlanId: string;
  /// Concerns leadership has already responded to or that are open.
  /// We surface the full set so the leader can scope an amendment
  /// to e.g. "all the people who raised the same training concern".
  sourceConcernOptions: SourceConcernOption[];
  /// Total enrollments — drives the "this will reach N employees"
  /// summary above the Send button.
  totalEnrollments: number;
  defaultSourceConcernIds?: string[];
}

export function AmendmentForm({
  changePlanId,
  sourceConcernOptions,
  totalEnrollments,
  defaultSourceConcernIds = [],
}: AmendmentFormProps) {
  const [open, setOpen] = useState(false);
  const [summary, setSummary] = useState("");
  const [body, setBody] = useState("");
  const [audience, setAudience] = useState<"everyone" | "surfacers">("everyone");
  const [selectedConcernIds, setSelectedConcernIds] = useState<string[]>([]);
  const [pending, startTransition] = useTransition();
  const [statusNote, setStatusNote] = useState<string | null>(null);
  const [statusKind, setStatusKind] = useState<"ok" | "warn" | "err">("ok");

  // Surfacer audience scopes to the unique enrollments of selected
  // concerns. We compute the count locally for the inline preview;
  // the server validates again.
  const surfacerEnrollmentCount = useMemo(() => {
    const employeeIds = new Set<string>();
    for (const opt of sourceConcernOptions) {
      if (selectedConcernIds.includes(opt.id)) {
        employeeIds.add(opt.employeeId);
      }
    }
    return employeeIds.size;
  }, [sourceConcernOptions, selectedConcernIds]);

  const recipientPreview =
    audience === "everyone"
      ? `${totalEnrollments} ${totalEnrollments === 1 ? "employee" : "employees"}`
      : surfacerEnrollmentCount === 0
        ? "no one yet — pick at least one concern"
        : `${surfacerEnrollmentCount} ${surfacerEnrollmentCount === 1 ? "employee" : "employees"} who surfaced linked concerns`;

  const reset = () => {
    setSummary("");
    setBody("");
    setAudience("everyone");
    setSelectedConcernIds([]);
    setStatusNote(null);
  };

  const openComposer = (opts?: { useDefaultConcerns?: boolean }) => {
    setOpen(true);
    setStatusNote(null);
    if (opts?.useDefaultConcerns && defaultSourceConcernIds.length > 0) {
      setSelectedConcernIds(defaultSourceConcernIds);
      setAudience("everyone");
      if (!summary) setSummary("Sales portal follow-up");
      if (!body) {
        setBody(
          "We heard a clear concern from sales: the portal should reduce routine lookup work, not erase the small customer touchpoints that help reps maintain relationships, spot issues early, and create follow-up sales moments.\n\nWe are making two updates.\n\nFirst, the customer portal will show the assigned rep's face, name, and contact information on the order-status page so customers still know who owns the relationship.\n\nSecond, reps will get a notification when one of their assigned customers uses the portal for a delayed order, a back-order, or repeated status checks, so they can decide whether to follow up personally.\n\nThe behavior we still need is the same: use the portal for routine tracking, back-order, and estimated ship-date questions. But the rep relationship and the important follow-up moments stay intact.",
        );
      }
    }
  };

  const submit = () => {
    setStatusNote(null);
    startTransition(async () => {
      const result = await publishAmendment(changePlanId, {
        summary,
        body,
        audience,
        sourceConcernIds: selectedConcernIds,
      });
      if (!result.ok) {
        setStatusKind("err");
        setStatusNote(result.error ?? "Publish failed.");
        return;
      }
      const total = result.total ?? 0;
      const delivered = result.delivered ?? 0;
      const failed = result.failed ?? 0;
      const deferred = result.deferred ?? 0;
      const parts: string[] = [`Published to ${total} employee${total === 1 ? "" : "s"}.`];
      if (delivered > 0) parts.push(`${delivered} delivered now`);
      if (failed > 0) parts.push(`${failed} failed`);
      if (deferred > 0) parts.push(`${deferred} queued for the cron`);
      setStatusKind(failed > 0 ? "warn" : "ok");
      setStatusNote(parts.join(" · "));
      reset();
      setOpen(false);
    });
  };

  if (!open) {
    return (
      <div className="rounded-2xl border border-[color:var(--color-line)] bg-white/50 p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[14px] font-semibold">Publish a rollout update</p>
            <p className="mt-1 text-[12px] leading-[1.55] text-[color:var(--color-muted)]">
              Use one amendment to cover a pattern across multiple concerns.
              The agent delivers your words to everyone in scope and credits the
              people who surfaced the pattern.
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-2">
            {defaultSourceConcernIds.length > 0 ? (
              <button
                type="button"
                onClick={() => openComposer({ useDefaultConcerns: true })}
                className="rounded-full bg-[color:var(--color-grasp)] px-4 py-1.5 text-[12px] font-semibold text-white shadow-sm transition-[background-color,box-shadow] hover:bg-[#1f5f26] hover:text-white hover:shadow-md"
              >
                Draft amendment for open concerns
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => openComposer()}
              className="rounded-full border border-[color:var(--color-line)] bg-white/70 px-4 py-1.5 text-[12px] font-semibold text-ink transition-colors hover:bg-white"
            >
              New amendment
            </button>
          </div>
        </div>
        {statusNote ? (
          <p
            className={`mt-3 text-[11px] ${
              statusKind === "ok"
                ? "text-[color:var(--color-grasp)]"
                : statusKind === "warn"
                  ? "text-orange-700"
                  : "text-red-700"
            }`}
          >
            {statusNote}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between">
        <p className="text-[14px] font-semibold">New amendment</p>
        <button
          type="button"
          onClick={() => {
            reset();
            setOpen(false);
          }}
          className="rounded-full px-3 py-1 text-[12px] text-[color:var(--color-muted)] hover:text-ink"
          disabled={pending}
        >
          Cancel
        </button>
      </div>

      <div className="mt-4 space-y-4">
        <div>
          <label className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[color:var(--color-muted)]">
            Summary
          </label>
          <input
            type="text"
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            disabled={pending}
            placeholder='Short label, e.g. "Pushing the cutover by two weeks"'
            className="mt-2 w-full rounded-md border border-[color:var(--color-line)] bg-white/80 p-2.5 text-[14px] text-ink focus:border-[color:var(--color-grasp)] focus:outline-none disabled:opacity-60"
          />
        </div>

        <div>
          <label className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[color:var(--color-muted)]">
            Verbatim update
          </label>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            disabled={pending}
            rows={6}
            placeholder="What's actually changing about the rollout. Your wording reaches every recipient — the agent only frames around it."
            className="mt-2 w-full resize-y rounded-md border border-[color:var(--color-line)] bg-white/80 p-3 text-[14px] leading-[1.6] text-ink focus:border-[color:var(--color-grasp)] focus:outline-none disabled:opacity-60"
          />
        </div>

        <div>
          <label className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[color:var(--color-muted)]">
            Audience
          </label>
          <div className="mt-2 flex gap-3">
            <AudienceChoice
              checked={audience === "everyone"}
              onChange={() => setAudience("everyone")}
              disabled={pending}
              label="Everyone enrolled"
              caption={`${totalEnrollments} employees`}
            />
            <AudienceChoice
              checked={audience === "surfacers"}
              onChange={() => setAudience("surfacers")}
              disabled={pending || sourceConcernOptions.length === 0}
              label="Only surfacers"
              caption="Recipients limited to employees whose linked concerns motivated this"
            />
          </div>
        </div>

        {sourceConcernOptions.length > 0 ? (
          <div>
            <label className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[color:var(--color-muted)]">
              Source concerns ({selectedConcernIds.length} selected)
            </label>
            <p className="mt-1 text-[11px] text-[color:var(--color-muted-2)]">
              Linking concerns lets the agent credit the surfacing employee in
              their delivery turn. Required when audience is &ldquo;only
              surfacers&rdquo;; optional otherwise.
            </p>
            <ul className="mt-2 max-h-[180px] space-y-1.5 overflow-auto rounded-md border border-[color:var(--color-line)] bg-white/40 p-2">
              {sourceConcernOptions.map((opt) => {
                const checked = selectedConcernIds.includes(opt.id);
                return (
                  <li key={opt.id}>
                    <label className="flex cursor-pointer items-start gap-2 rounded p-1.5 text-[12px] leading-[1.45] hover:bg-white/60">
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={pending}
                        onChange={(e) => {
                          setSelectedConcernIds((ids) =>
                            e.target.checked
                              ? [...ids, opt.id]
                              : ids.filter((x) => x !== opt.id),
                          );
                        }}
                        className="mt-0.5"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="font-medium text-ink">{opt.employeeName}</span>{" "}
                        <span className="text-[color:var(--color-muted-2)]">
                          · {opt.dimension}
                        </span>
                        <br />
                        <span className="text-[color:var(--color-muted)]">{opt.summary}</span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}

        <div className="flex items-center justify-between gap-4 border-t border-[color:var(--color-line)] pt-4">
          <p className="text-[12px] text-[color:var(--color-muted)]">
            Will reach {recipientPreview}.
          </p>
          <button
            type="button"
            onClick={submit}
            disabled={
              pending ||
              summary.trim().length < 4 ||
              body.trim().length < 10 ||
              (audience === "surfacers" && selectedConcernIds.length === 0)
            }
            className="rounded-full bg-[color:var(--color-grasp)] px-5 py-2 text-[12px] font-semibold text-white shadow-sm transition-[background-color,box-shadow] hover:bg-[#1f5f26] hover:text-white hover:shadow-md disabled:opacity-50"
          >
            {pending ? "Publishing…" : "Publish & deliver"}
          </button>
        </div>

        {statusNote ? (
          <p
            className={`text-[11px] ${
              statusKind === "ok"
                ? "text-[color:var(--color-grasp)]"
                : statusKind === "warn"
                  ? "text-orange-700"
                  : "text-red-700"
            }`}
          >
            {statusNote}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function AudienceChoice({
  checked,
  onChange,
  disabled,
  label,
  caption,
}: {
  checked: boolean;
  onChange: () => void;
  disabled: boolean;
  label: string;
  caption: string;
}) {
  return (
    <button
      type="button"
      onClick={onChange}
      disabled={disabled}
      className={`flex-1 rounded-md border p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        checked
          ? "border-[color:var(--color-grasp)] bg-[color:var(--color-grasp-soft)]"
          : "border-[color:var(--color-line)] bg-white/40 hover:bg-white/60"
      }`}
    >
      <p className="text-[13px] font-semibold text-ink">{label}</p>
      <p className="mt-0.5 text-[11px] leading-[1.4] text-[color:var(--color-muted)]">
        {caption}
      </p>
    </button>
  );
}
