"use client";

import { useState, useTransition } from "react";
import { aiScoreAnnouncement, saveAnnouncement } from "../actions";
import { useAutosave } from "../_state/use-autosave";
import { StepNav } from "./step-nav";
import type { WizardPlan } from "./types";
import type { AnnouncementScores } from "@/lib/ai/scoring";

const SCORECARD: Record<
  keyof AnnouncementScores,
  { title: string; factors: Record<string, string> }
> = {
  deciRyan: {
    title: "Reason and agency",
    factors: {
      rationale: "Explains why",
      downside: "Names tradeoffs",
      choice: "Leaves room for judgment",
    },
  },
  bridges: {
    title: "Rollout clarity",
    factors: {
      purpose: "Clear purpose",
      picture: "Shows what will change",
      plan: "Gives the plan",
      partToPlay: "Names what people should do",
    },
  },
  lossAversion: {
    title: "Gains and losses",
    factors: {
      gainsConcrete: "Makes the upside concrete",
      lossesAcknowledged: "Acknowledges what feels hard",
    },
  },
};

const GAP_LABELS: Record<string, string> = {
  rationale: "Why",
  downside: "Tradeoffs",
  choice: "Judgment",
  purpose: "Purpose",
  picture: "What changes",
  plan: "Plan",
  partToPlay: "What people do",
  gainsConcrete: "Upside",
  lossesAcknowledged: "What feels hard",
};

export function AnnouncementStep({
  plan,
  showNav = true,
}: {
  plan: WizardPlan;
  showNav?: boolean;
}) {
  const [text, setText] = useState(plan.announcement ?? "");
  const [streaming, setStreaming] = useState(false);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [scores, setScores] = useState<AnnouncementScores | null>(
    (plan.announcementScores as AnnouncementScores | null) ?? null,
  );
  const [scorePending, startScore] = useTransition();
  const [scoreError, setScoreError] = useState<string | null>(null);
  // The scoring snapshot belongs to whatever the announcement said when we
  // ran it. Local edits invalidate the displayed scores until re-scored.
  const [lastScoredText, setLastScoredText] = useState(plan.announcement ?? "");
  const scoresStale = scores ? text !== lastScoredText : false;

  const { queue, flushNow } = useAutosave(
    (payload: { announcement: string }) =>
      saveAnnouncement(plan.id, payload),
  );

  async function streamDraft() {
    setStreamError(null);
    setStreaming(true);
    setText("");
    try {
      const res = await fetch("/api/wizard/announcement-stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ changePlanId: plan.id }),
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(payload.error ?? `HTTP ${res.status}`);
      }
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let streamDone = false;
      while (!streamDone) {
        const { done, value } = await reader.read();
        streamDone = done;
        if (!value) continue;
        buf += decoder.decode(value, { stream: true });
        setText(buf);
      }
      buf += decoder.decode();
      setText(buf);
      flushNow({ announcement: buf });
    } catch (err) {
      setStreamError(err instanceof Error ? err.message : "Stream failed");
    } finally {
      setStreaming(false);
    }
  }

  function runScore() {
    setScoreError(null);
    startScore(async () => {
      // Make sure the latest text is persisted before scoring against it.
      await flushNow({ announcement: text });
      const result = await aiScoreAnnouncement(plan.id);
      if (!result.ok) {
        setScoreError(result.error);
        return;
      }
      setScores(result.scores);
      setLastScoredText(text);
    });
  }

  return (
    <div className="space-y-6">
      <div className="card space-y-3 p-7">
        <div className="flex items-center justify-between gap-3">
          <p className="text-[12px] text-[color:var(--color-muted)]">
            AI drafts a first version from your plan; you own the words.
          </p>
          <button
            type="button"
            onClick={streamDraft}
            disabled={streaming}
            className="btn btn-secondary"
          >
            {streaming
              ? "Drafting…"
              : text
                ? "Re-draft"
                : "Draft with AI"}
          </button>
        </div>
        {streamError ? (
          <p className="text-[12px] text-red-700">{streamError}</p>
        ) : null}

        <textarea
          rows={14}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            queue({ announcement: e.target.value });
          }}
          onBlur={() => flushNow({ announcement: text })}
          placeholder="The body of the announcement to your team. 200–350 words. Plain language."
          className="input font-serif text-[15px] leading-[1.7]"
          disabled={streaming}
        />

        <div className="flex items-center justify-between gap-3 border-t border-[color:var(--color-line)] pt-4">
          <p className="text-[12px] text-[color:var(--color-muted)]">
            {scores
              ? scoresStale
                ? "Edits since last scoring pass — re-score to refresh."
                : "Last scoring pass shown below."
              : "Check whether the message explains the why, names the tradeoffs, and gives people a clear next step."}
          </p>
          <button
            type="button"
            onClick={runScore}
            disabled={scorePending || !text.trim()}
            className="btn btn-primary"
          >
            {scorePending ? "Scoring…" : "Score draft"}
          </button>
        </div>
        {scoreError ? (
          <p className="text-[12px] text-red-700">{scoreError}</p>
        ) : null}
      </div>

      {scores ? <ScorecardGrid scores={scores} stale={scoresStale} /> : null}

      {showNav ? (
        <StepNav
          changePlanId={plan.id}
          step="approve"
          continueDisabled={!text.trim()}
        />
      ) : null}
    </div>
  );
}

function ScorecardGrid({
  scores,
  stale,
}: {
  scores: AnnouncementScores;
  stale: boolean;
}) {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 lg:grid-cols-3">
        {(Object.keys(scores) as Array<keyof AnnouncementScores>).map(
          (key) => (
            <RubricCard
              key={key}
              title={SCORECARD[key].title}
              factors={SCORECARD[key].factors}
              data={scores[key]}
              stale={stale}
            />
          ),
        )}
      </div>
    </div>
  );
}

interface ScoredRubric {
  gaps: Array<{ field: string; finding: string }>;
  suggestion: string;
  [key: string]: unknown;
}

function RubricCard({
  title,
  factors,
  data,
  stale,
}: {
  title: string;
  factors: Record<string, string>;
  data: ScoredRubric;
  stale: boolean;
}) {
  const allPresent = Object.keys(factors).every(
    (f) => (data as Record<string, string | undefined>)[f] === "present",
  );
  const shouldShowGaps = data.gaps.length > 0 && !allPresent;
  const shouldShowSuggestion = Boolean(data.suggestion) && !allPresent;

  return (
    <div
      className={`card p-5 ${stale ? "opacity-60" : ""}`}
      title={stale ? "Outdated. Re-score to refresh." : undefined}
    >
      <h3 className="text-[13px] font-semibold">{title}</h3>
      <ul className="mt-3 space-y-1.5">
        {Object.entries(factors).map(([f, label]) => {
          const verdict = (data as Record<string, string | undefined>)[f];
          return (
            <li
              key={f}
              className="flex items-center justify-between text-[12px]"
            >
              <span className="text-[color:var(--color-muted)]">{label}</span>
              <Verdict value={verdict} />
            </li>
          );
        })}
      </ul>
      {shouldShowGaps ? (
        <details className="mt-3 border-t border-[color:var(--color-line)] pt-3 text-[12px]">
          <summary className="cursor-pointer text-[color:var(--color-muted)] hover:text-ink">
            What to improve ({data.gaps.length})
          </summary>
          <ul className="mt-2 space-y-1">
            {data.gaps.map((g, i) => (
              <li key={i}>
                <span className="font-medium">
                  {GAP_LABELS[g.field] ?? humanizeField(g.field)}:
                </span>{" "}
                <span className="text-[color:var(--color-ink-2)]">
                  {g.finding}
                </span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {shouldShowSuggestion ? (
        <details className="mt-3 text-[12px]">
          <summary className="cursor-pointer text-[color:var(--color-muted)] hover:text-ink">
            Suggested rewrite
          </summary>
          <p className="mt-2 whitespace-pre-wrap text-[color:var(--color-ink-2)]">
            {data.suggestion}
          </p>
        </details>
      ) : null}
    </div>
  );
}

function Verdict({ value }: { value: string | undefined }) {
  if (value === "present")
    return (
      <span className="rounded-full bg-[color:var(--color-grasp-soft)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[color:var(--color-grasp)]">
        yes
      </span>
    );
  if (value === "weak")
    return (
      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-800">
        partial
      </span>
    );
  if (value === "absent")
    return (
      <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-red-700">
        missing
      </span>
    );
  return null;
}

function humanizeField(value: string): string {
  return value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^./, (char) => char.toUpperCase());
}
