"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  aiProposeStakeholderGroups,
  deleteStakeholderGroup,
  saveStakeholderGroup,
} from "../actions";
import { StepNav } from "./step-nav";
import type { EmployeePick, WizardPlan } from "./types";

interface DraftGroup {
  /** Server-side id; absent for groups not yet persisted. */
  id?: string;
  name: string;
  description: string;
  behaviorSpec: string;
  memberEmployeeIds: string[];
  rationale?: string;
  /** Local key for React lists; never sent to the server. */
  key: string;
}

function toDraft(group: WizardPlan["stakeholderGroups"][number]): DraftGroup {
  return {
    id: group.id,
    name: group.name,
    description: group.description ?? "",
    behaviorSpec: group.behaviorSpec ?? "",
    memberEmployeeIds: group.members.map((m) => m.employee.id),
    key: group.id,
  };
}

export function StakeholdersStep({
  plan,
  employees,
  showNav = true,
  onValidityChange,
}: {
  plan: WizardPlan;
  employees: EmployeePick[];
  showNav?: boolean;
  onValidityChange?: (valid: boolean) => void;
}) {
  const [groups, setGroups] = useState<DraftGroup[]>(() =>
    plan.stakeholderGroups.map(toDraft),
  );
  const [aiPending, startAi] = useTransition();
  const [aiError, setAiError] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);

  // Per-group save queue. Server actions for one group must be applied
  // in click order — otherwise tick A then tick B can race and the
  // server ends up with [A] (stale save 1 lands after fresh save 2).
  // Keying by group.key (stable across renders) gives a simple
  // promise chain per row.
  const saveChainRef = useRef<Map<string, Promise<void>>>(new Map());

  // Mirror of `groups` for use inside async save callbacks. Ref so it
  // always reflects the latest state regardless of when the queued save
  // actually runs (it might be 100s of ms after the click that queued
  // it). Critical for picking up the server-issued id on a new group's
  // SECOND save, which would otherwise upsert id:undefined again.
  const groupsRef = useRef<DraftGroup[]>(groups);

  useEffect(() => {
    groupsRef.current = groups;
  }, [groups]);

  function updateGroups(updater: (previous: DraftGroup[]) => DraftGroup[]) {
    setGroups((previous) => {
      const next = updater(previous);
      groupsRef.current = next;
      return next;
    });
  }

  const employeeIndex = useMemo(() => {
    const map = new Map<string, EmployeePick>();
    for (const e of employees) map.set(e.id, e);
    return map;
  }, [employees]);

  // A "valid" stakeholder step has at least one group, every group has a
  // non-trivial name, and every group has at least one member. Empty groups
  // would silently activate to zero kickoff DMs — we caught one in pilot
  // (a "Purchasing Team" group with 0 employees) so the gate now blocks it.
  const groupsMissingMembers = groups.filter(
    (g) => g.memberEmployeeIds.length === 0,
  );
  const valid =
    groups.length > 0 &&
    groups.every((g) => g.name.trim().length >= 2) &&
    groupsMissingMembers.length === 0;

  useEffect(() => {
    onValidityChange?.(valid);
  }, [onValidityChange, valid]);

  function addEmpty() {
    updateGroups((prev) => [
      ...prev,
      {
        name: "",
        description: "",
        behaviorSpec: "",
        memberEmployeeIds: [],
        key: `new-${Date.now()}-${prev.length}`,
      },
    ]);
  }

  /**
   * Update local draft AND queue a server save with the merged value.
   *
   * Critical: the save sees `merged`, not the parent's `group` prop
   * via closure. Bug fixed here was that the checkbox handler called
   * `onChange(patch)` then `onSave()` in the same tick — `onSave`'s
   * closure pinned the OLD `group`, so the persisted state was always
   * one click stale, and people would "disappear from the group" on
   * navigation when the page refetched the stale server state.
   */
  function commitGroup(key: string, patch: Partial<DraftGroup>) {
    // Compute merged outside the setState updater (React StrictMode
    // double-invokes updaters in dev, which would double-queue saves).
    // Reading from groupsRef gives us the current value pre-update; the
    // setGroups call below is the one source of truth for state.
    const current = groupsRef.current.find((g) => g.key === key);
    if (!current) return;
    const merged = { ...current, ...patch };
    updateGroups((prev) =>
      prev.map((g) => (g.key === key ? { ...g, ...patch } : g)),
    );
    // Don't bother queuing a save until the group has a name — the
    // server schema requires min(2) so it'd just fail with a noisy
    // error every keystroke.
    if (merged.name.trim().length >= 2) {
      queueSave(merged);
    }
  }

  function queueSave(merged: DraftGroup) {
    const prior = saveChainRef.current.get(merged.key) ?? Promise.resolve();
    const next = prior.then(async () => {
      // Read the freshest snapshot of this group at the moment the save
      // actually runs (the prior save in the chain may have just patched
      // in a server-issued id we need to use here).
      const latest =
        groupsRef.current.find((g) => g.key === merged.key) ?? merged;
      setSavingKey(merged.key);
      try {
        const result = await saveStakeholderGroup(plan.id, {
          id: latest.id,
          name: latest.name.trim(),
          description: latest.description.trim() || undefined,
          behaviorSpec: latest.behaviorSpec.trim() || undefined,
          memberEmployeeIds: latest.memberEmployeeIds,
        });
        if (!result.ok) {
          console.error("[stakeholders] save failed:", result.error);
          return;
        }
        if (!latest.id) {
          updateGroups((prev) =>
            prev.map((g) =>
              g.key === merged.key ? { ...g, id: result.groupId } : g,
            ),
          );
        }
      } finally {
        setSavingKey((k) => (k === merged.key ? null : k));
      }
    });
    saveChainRef.current.set(merged.key, next);
  }

  async function removeGroup(group: DraftGroup) {
    // Wait for any pending save on this group before deleting, otherwise
    // a late-arriving create-or-update could resurrect the row.
    const inFlight = saveChainRef.current.get(group.key);
    if (inFlight) await inFlight.catch(() => {});
    saveChainRef.current.delete(group.key);
    if (group.id) await deleteStakeholderGroup(plan.id, group.id);
    updateGroups((prev) => prev.filter((g) => g.key !== group.key));
  }

  function runAi() {
    setAiError(null);
    startAi(async () => {
      const result = await aiProposeStakeholderGroups(plan.id);
      if (!result.ok) {
        setAiError(result.error);
        return;
      }
      const newDrafts: DraftGroup[] = result.groups.map((g, i) => ({
        name: g.name,
        description: g.description,
        behaviorSpec: "",
        memberEmployeeIds: g.suggestedEmployeeIds.filter((id) =>
          employeeIndex.has(id),
        ),
        rationale: g.rationale,
        key: `ai-${Date.now()}-${i}`,
      }));
      // Append rather than replace so existing edits survive.
      updateGroups((prev) => [...prev, ...newDrafts]);
      // Persist AI suggestions immediately. Without this the groups only
      // live in client state, so a user who accepts the suggestions as-is
      // and clicks Continue arrives with zero groups in the database.
      // groups in the database. queueSave's `?? merged` fallback handles
      // the case where groupsRef hasn't yet picked up the new entries.
      for (const draft of newDrafts) {
        if (draft.name.trim().length >= 2) queueSave(draft);
      }
    });
  }

  const aiAvailable = Boolean(plan.summary?.trim()) && employees.length > 0;

  return (
    <div className="space-y-6">
      <div className="card flex flex-wrap items-center justify-between gap-3 p-5">
        <div>
          <p className="text-[13px] font-semibold">Need a starting point?</p>
          <p className="text-[12px] text-[color:var(--color-muted)]">
            {aiAvailable
              ? "Grasp will read your summary and the org chart and propose distinct groups."
              : plan.summary?.trim()
                ? "Upload an org chart on the Org Chart page to enable this."
                : "Add a summary in the first step to enable this."}
          </p>
        </div>
        <button
          type="button"
          onClick={runAi}
          disabled={!aiAvailable || aiPending}
          className="btn btn-secondary"
        >
          {aiPending ? "Thinking…" : "Suggest groups"}
        </button>
      </div>
      {aiError ? (
        <div className="text-[13px] text-red-700">{aiError}</div>
      ) : null}

      {groups.length === 0 ? (
        <div className="card p-7 text-[14px] leading-[1.7] text-[color:var(--color-muted)]">
          No groups yet. Add one manually or use Suggest groups above. Groups
          help Grasp tailor the rollout to people who are affected in different
          ways.
        </div>
      ) : (
        <ul className="space-y-3">
          {groups.map((group) => (
            <li key={group.key} className="card p-6">
              <GroupCard
                group={group}
                employees={employees}
                isSaving={savingKey === group.key}
                onCommit={(patch) => commitGroup(group.key, patch)}
                onRemove={() => removeGroup(group)}
              />
            </li>
          ))}
        </ul>
      )}

      <button type="button" onClick={addEmpty} className="btn btn-ghost">
        + Add stakeholder group
      </button>

      {groups.length > 0 && groupsMissingMembers.length > 0 ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50/70 px-4 py-3 text-[12.5px] text-amber-900">
          <span className="font-semibold">
            {groupsMissingMembers.length === 1
              ? `"${groupsMissingMembers[0].name || "Untitled group"}" has no members.`
              : `${groupsMissingMembers.length} groups have no members.`}
          </span>{" "}
          Add at least one employee to each group — only members get the
          kickoff DM and survey when you activate.
        </div>
      ) : null}

      {showNav ? (
        <StepNav
          changePlanId={plan.id}
          step="audience"
          continueDisabled={!valid}
        />
      ) : null}
    </div>
  );
}

function GroupCard({
  group,
  employees,
  isSaving,
  onCommit,
  onRemove,
}: {
  group: DraftGroup;
  employees: EmployeePick[];
  isSaving: boolean;
  /**
   * Update the parent draft AND queue a server save with the merged
   * value in one call. Callers must pass the patch (not call any
   * separate save fn) so the save sees the just-applied change.
   */
  onCommit: (patch: Partial<DraftGroup>) => void;
  onRemove: () => void;
}) {
  const [memberQuery, setMemberQuery] = useState("");
  const [behaviorItems, setBehaviorItems] = useState<string[]>(() =>
    parseBulletList(group.behaviorSpec),
  );
  const groupNameId = `group-name-${group.key}`;
  const groupDescriptionId = `group-description-${group.key}`;
  const groupBehaviorId = `group-behavior-${group.key}`;
  const selected = useMemo(
    () => new Set(group.memberEmployeeIds),
    [group.memberEmployeeIds],
  );

  // Default list = just the people who are members of this group (sorted
  // by name for predictability). Once the user starts typing, we widen
  // to the whole org so they can find anyone — selected or not — and
  // keep checked members visible inline so they can also untick from
  // search results.
  const isSearching = memberQuery.trim().length > 0;
  const visible = useMemo(() => {
    if (!isSearching) {
      return employees
        .filter((e) => selected.has(e.id))
        .sort((a, b) => a.name.localeCompare(b.name));
    }
    const q = memberQuery.trim().toLowerCase();
    return employees
      .filter(
        (e) =>
          e.name.toLowerCase().includes(q) ||
          e.email.toLowerCase().includes(q) ||
          (e.team?.toLowerCase().includes(q) ?? false) ||
          (e.title?.toLowerCase().includes(q) ?? false),
      )
      .slice(0, 50);
  }, [employees, isSearching, memberQuery, selected]);

  function commitBehaviorItems(nextItems: string[]) {
    const normalized = normalizeBehaviorItems(nextItems);
    const displayItems = normalized.length > 0 ? normalized : [""];
    const behaviorSpec = formatBehaviorItems(displayItems);
    setBehaviorItems(displayItems);
    if (behaviorSpec !== group.behaviorSpec) {
      onCommit({ behaviorSpec });
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
        <div>
          <label htmlFor={groupNameId} className="label">
            Group name
          </label>
          <input
            id={groupNameId}
            // Local-controlled: we only commit on blur so we don't fire a
            // server save on every keystroke. While typing, the parent
            // doesn't even know the value — that's fine because nothing
            // depends on it mid-edit.
            defaultValue={group.name}
            key={`name-${group.key}-${group.id ?? ""}`}
            onBlur={(e) => {
              const value = e.target.value;
              if (value !== group.name) onCommit({ name: value });
            }}
            placeholder="e.g. Sales reps"
            className="input"
          />
        </div>
        <button
          type="button"
          onClick={onRemove}
          className="self-end pb-3 text-[12px] text-[color:var(--color-muted)] hover:text-red-700"
        >
          Remove
        </button>
      </div>
      <div>
        <label htmlFor={groupDescriptionId} className="label">
          Description
        </label>
        <textarea
          id={groupDescriptionId}
          rows={2}
          defaultValue={group.description}
          key={`desc-${group.key}-${group.id ?? ""}`}
          ref={(node) => {
            if (node) resizeTextareaToFit(node);
          }}
          onInput={(e) => resizeTextareaToFit(e.currentTarget)}
          onBlur={(e) => {
            const value = e.target.value;
            if (value !== group.description) onCommit({ description: value });
          }}
          placeholder="Why are they affected? What's their role in the change?"
          className="input overflow-hidden resize-none"
        />
      </div>
      {group.rationale ? (
        <p className="text-[12px] italic text-[color:var(--color-muted)]">
          AI rationale: {group.rationale}
        </p>
      ) : null}

      <div>
        <p id={groupBehaviorId} className="label">
          Things they need to do
        </p>
        <ul
          aria-labelledby={groupBehaviorId}
          className="space-y-2"
        >
          {behaviorItems.map((item, index) => (
            <li key={index} className="flex items-center gap-2">
              <input
                value={item}
                onChange={(e) => {
                  const next = [...behaviorItems];
                  next[index] = e.target.value;
                  setBehaviorItems(next);
                }}
                onBlur={() => commitBehaviorItems(behaviorItems)}
                placeholder={
                  index === 0
                    ? "Send customers the portal link for routine tracking questions"
                    : "Use the rep relationship for exceptions and upset customers"
                }
                className="input"
              />
              <button
                type="button"
                onClick={() => {
                  const next = behaviorItems.filter((_, i) => i !== index);
                  commitBehaviorItems(next);
                }}
                className="text-[12px] text-[color:var(--color-muted)] hover:text-red-700"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
        <button
          type="button"
          onClick={() => setBehaviorItems((prev) => [...prev, ""])}
          className="mt-2 text-[12px] font-medium text-[color:var(--color-grasp)] hover:underline"
        >
          + Add another thing
        </button>
        <p className="mt-1.5 text-[12px] text-[color:var(--color-muted)]">
          Add each expected action as its own item.
        </p>
      </div>

      <div>
        <div className="mb-1.5 flex items-baseline justify-between gap-3">
          <p className="label !mb-0">
            Members ({group.memberEmployeeIds.length})
          </p>
          {isSearching ? (
            <button
              type="button"
              onClick={() => setMemberQuery("")}
              className="text-[11px] text-[color:var(--color-muted)] hover:text-ink"
            >
              Clear search
            </button>
          ) : null}
        </div>
        <input
          value={memberQuery}
          onChange={(e) => setMemberQuery(e.target.value)}
          placeholder="Search to add people by name, email, team, or title"
          className="input"
        />
        <ul className="mt-2 max-h-56 overflow-auto rounded-md border border-[color:var(--color-line)] divide-y divide-[color:var(--color-line)]">
          {visible.map((e) => {
            const checked = selected.has(e.id);
            return (
              <li key={e.id}>
                <label className="flex cursor-pointer items-center gap-2 px-3 py-1.5 hover:bg-black/[0.02]">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(ev) => {
                      const next = new Set(group.memberEmployeeIds);
                      if (ev.target.checked) next.add(e.id);
                      else next.delete(e.id);
                      onCommit({ memberEmployeeIds: Array.from(next) });
                    }}
                  />
                  <span className="text-[13px]">{e.name}</span>
                  <span className="text-[11px] text-[color:var(--color-muted)]">
                    {e.team ? `· ${e.team}` : ""} {e.title ? `· ${e.title}` : ""}
                  </span>
                </label>
              </li>
            );
          })}
          {visible.length === 0 ? (
            <li className="px-3 py-3 text-[12px] text-[color:var(--color-muted)]">
              {isSearching
                ? "No matches."
                : "No members yet — search above to add people."}
            </li>
          ) : null}
        </ul>
      </div>

      {isSaving ? (
        <p className="text-[11px] text-[color:var(--color-muted-2)]">Saving…</p>
      ) : null}
    </div>
  );
}

function resizeTextareaToFit(node: HTMLTextAreaElement) {
  node.style.height = "auto";
  node.style.height = `${node.scrollHeight}px`;
}

function parseBulletList(value: string): string[] {
  const items = normalizeBehaviorItems(value.split("\n"));
  return items.length > 0 ? items : [""];
}

function normalizeBehaviorItems(items: string[]): string[] {
  return items
    .map((line) =>
      line
        .trim()
        .replace(/^[-*]\s+/, "")
        .replace(/^\d+[.)]\s+/, ""),
    )
    .filter(Boolean);
}

function formatBehaviorItems(items: string[]): string {
  return normalizeBehaviorItems(items)
    .map((line) => `- ${line}`)
    .join("\n");
}
