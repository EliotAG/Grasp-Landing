/**
 * Chat-thread card showing the agent's bundled suggestions (groups, core
 * mechanism, announcement) so the leader can review before any of it touches
 * the live plan. Apply fans out to the existing planner services; Discard
 * just hides the card.
 */
import type { EmployeePick } from "../../wizard/_components/types";
import type { SuggestedUpdates } from "./types";

export function InlineSuggestionCard({
  suggestions,
  applied,
  disabled,
  employeeByEmail,
  onApply,
  onDiscard,
}: {
  suggestions: SuggestedUpdates;
  applied: boolean;
  disabled: boolean;
  employeeByEmail: Map<string, EmployeePick>;
  onApply: () => void;
  onDiscard: () => void;
}) {
  return (
    <div className="intake-bubble max-w-[88%] rounded-[18px] border border-[color:var(--color-grasp)]/20 bg-[color:var(--color-grasp-soft)] p-4">
      <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--color-grasp)]">
        Suggested updates
      </p>
      <h3 className="serif mt-1 text-[20px] leading-[1.2]">
        Review before applying
      </h3>

      <div className="mt-3 grid gap-2 text-[13px] leading-[1.55]">
        {suggestions.name ? (
          <Block label="Name" text={suggestions.name} />
        ) : null}
        {suggestions.summary ? (
          <Block label="Summary" text={suggestions.summary} />
        ) : null}
        {suggestions.coreMechanism ? (
          <Block label="Key outcome" text={suggestions.coreMechanism} />
        ) : null}
        {suggestions.announcement ? (
          <Block label="Announcement" text={suggestions.announcement} />
        ) : null}
        {suggestions.stakeholderGroups?.length ? (
          <div className="rounded-[12px] bg-white/55 p-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--color-muted)]">
              Stakeholder groups
            </p>
            <ul className="mt-2 space-y-2">
              {suggestions.stakeholderGroups.map((group) => (
                <li key={group.name}>
                  <p className="font-semibold">{group.name}</p>
                  {group.description ? (
                    <p className="text-[color:var(--color-muted)]">
                      {group.description}
                    </p>
                  ) : null}
                  {group.behaviorSpec ? (
                    <p className="mt-1 text-[color:var(--color-muted)]">
                      {group.behaviorSpec}
                    </p>
                  ) : null}
                  {group.suggestedEmployeeEmails.length > 0 ? (
                    <p className="mt-1 text-[11px] text-[color:var(--color-muted)]">
                      {group.suggestedEmployeeEmails
                        .map(
                          (email) =>
                            employeeByEmail.get(email.toLowerCase())?.name ??
                            email,
                        )
                        .join(", ")}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>

      <div className="mt-3 flex justify-end gap-2">
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
  );
}

function Block({ label, text }: { label: string; text: string }) {
  return (
    <div className="rounded-[12px] bg-white/55 p-3">
      <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--color-muted)]">
        {label}
      </p>
      <p className="mt-1 whitespace-pre-wrap">{text}</p>
    </div>
  );
}
