/**
 * Scrolling chat thread.
 *
 * Owns three responsibilities:
 *  - dispatch each `IntakeMessage` to the right child component,
 *  - keep the latest message in view via a smooth auto-scroll,
 *  - render the agent's "thinking" indicator while a turn is in flight.
 *
 * Doc-progress chips look up their live status off the `trainingDocs`
 * snapshot the parent passes in; the polling loop in the parent is the only
 * place we re-fetch.
 */
"use client";

import { useEffect, useMemo, useRef } from "react";
import type { TrainingDocument } from "@prisma/client";

import type { PlannerContextSummary } from "@/lib/planner/context-summary";
import type { EmployeePick } from "../../wizard/_components/types";

import { DocProgressChip } from "./doc-progress-chip";
import { InlineContextSummary } from "./inline-context-summary";
import { InlineSuggestionCard } from "./inline-suggestion-card";
import { TextBubble } from "./text-bubble";
import type { IntakeMessage, SuggestedUpdates } from "./types";

export function ChatCanvas({
  messages,
  thinking,
  trainingDocs,
  employeeByEmail,
  pending,
  onApplyContextSummary,
  onDiscardCard,
  onApplySuggestions,
  onRemoveDoc,
}: {
  messages: IntakeMessage[];
  thinking: boolean;
  trainingDocs: TrainingDocument[];
  employeeByEmail: Map<string, EmployeePick>;
  pending: boolean;
  onApplyContextSummary: (id: string, summary: PlannerContextSummary) => void;
  onDiscardCard: (id: string) => void;
  onApplySuggestions: (id: string, suggestions: SuggestedUpdates) => void;
  onRemoveDoc: (documentId: string) => void;
}) {
  const scrollerRef = useRef<HTMLDivElement>(null);

  const docById = useMemo(() => {
    const map = new Map<string, TrainingDocument>();
    for (const doc of trainingDocs) map.set(doc.id, doc);
    return map;
  }, [trainingDocs]);

  useEffect(() => {
    const node = scrollerRef.current;
    if (!node) return;
    node.scrollTo({ top: node.scrollHeight, behavior: "smooth" });
  }, [messages, thinking]);

  return (
    <div
      ref={scrollerRef}
      className="card flex-1 min-h-0 overflow-y-auto p-6"
    >
      <div className="mx-auto flex max-w-[760px] flex-col gap-3">
        {messages.map((message) => {
          if (message.kind === "text") {
            return (
              <TextBubble
                key={message.id}
                role={message.role}
                text={message.text}
                status={message.status}
              />
            );
          }
          if (message.kind === "context-summary") {
            if (message.dismissed) return null;
            return (
              <InlineContextSummary
                key={message.id}
                summary={message.summary}
                applied={message.applied}
                disabled={pending}
                onApply={() =>
                  onApplyContextSummary(message.id, message.summary)
                }
                onDiscard={() => onDiscardCard(message.id)}
              />
            );
          }
          if (message.kind === "suggestions") {
            if (message.dismissed) return null;
            return (
              <InlineSuggestionCard
                key={message.id}
                suggestions={message.suggestions}
                applied={message.applied}
                disabled={pending}
                employeeByEmail={employeeByEmail}
                onApply={() =>
                  onApplySuggestions(message.id, message.suggestions)
                }
                onDiscard={() => onDiscardCard(message.id)}
              />
            );
          }
          if (message.kind === "doc-progress") {
            const doc = message.documentId
              ? docById.get(message.documentId) ?? null
              : null;
            return (
              <DocProgressChip
                key={message.id}
                filename={message.filename}
                doc={doc}
                disabled={pending}
                onRemove={doc ? () => onRemoveDoc(doc.id) : undefined}
              />
            );
          }
          return null;
        })}

        {thinking ? (
          <div className="intake-bubble inline-flex w-fit items-center gap-1.5 rounded-[18px] bg-white/65 px-4 py-3">
            <span className="intake-thinking-dot inline-block h-1.5 w-1.5 rounded-full bg-[color:var(--color-muted)]" />
            <span
              className="intake-thinking-dot inline-block h-1.5 w-1.5 rounded-full bg-[color:var(--color-muted)]"
              style={{ animationDelay: "120ms" }}
            />
            <span
              className="intake-thinking-dot inline-block h-1.5 w-1.5 rounded-full bg-[color:var(--color-muted)]"
              style={{ animationDelay: "240ms" }}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
