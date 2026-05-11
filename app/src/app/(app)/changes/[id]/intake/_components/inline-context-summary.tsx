/**
 * Chat-thread card showing the agent's readout of uploaded context, with a
 * single Apply that writes the inferred fields through the existing planner
 * services. Discard hides the card without saving anything.
 */
import type { PlannerContextSummary } from "@/lib/planner/context-summary";

export function InlineContextSummary({
  summary,
  applied,
  disabled,
  onApply,
  onDiscard,
}: {
  summary: PlannerContextSummary;
  applied: boolean;
  disabled: boolean;
  onApply: () => void;
  onDiscard: () => void;
}) {
  return (
    <div className="intake-bubble max-w-[88%] rounded-[18px] border border-[color:var(--color-grasp)]/20 bg-[color:var(--color-grasp-soft)] p-4">
      <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--color-grasp)]">
        Context readout
      </p>
      <h3 className="serif mt-1 text-[20px] leading-[1.2]">
        {summary.headline}
      </h3>
      <p className="mt-2 whitespace-pre-wrap text-[13.5px] leading-[1.65] text-[color:var(--color-ink-2)]">
        {summary.summary}
      </p>
      {summary.citations.length > 0 ? (
        <ul className="mt-3 grid gap-1.5 text-[12px] text-[color:var(--color-muted)]">
          {summary.citations.map((citation) => (
            <li key={`${citation.filename}-${citation.note}`}>
              <span className="font-semibold text-[color:var(--color-ink-2)]">
                {citation.filename}
              </span>
              {" — "}
              {citation.note}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[12px] text-[color:var(--color-muted)]">
          {applied
            ? "Applied to the plan."
            : "Apply to set name, summary, and key outcome."}
        </p>
        <div className="flex gap-2">
          {!applied ? (
            <>
              <button
                type="button"
                onClick={onDiscard}
                disabled={disabled}
                className="btn btn-ghost text-[12px]"
              >
                Discard
              </button>
              <button
                type="button"
                onClick={onApply}
                disabled={disabled}
                className="btn btn-primary text-[12px]"
              >
                Apply
              </button>
            </>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[color:var(--color-grasp)] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-white">
              <span className="h-1.5 w-1.5 rounded-full bg-white" /> Applied
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
