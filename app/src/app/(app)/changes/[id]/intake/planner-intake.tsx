/**
 * PlannerIntake — chat-first shell for shaping a draft change plan.
 *
 * The shell owns all of the cross-component state (messages, suggestions,
 * drawer/rail open state, error string) and wires the existing planner
 * server actions to focused child components. Children stay presentational:
 *
 *   - ChatCanvas         scrollable thread + inline cards + thinking dots
 *   - Composer           sticky textarea, attach button, two quick chips
 *   - PlanRail           read-only snapshot + readiness, opens the drawer
 *   - EditPlanDrawer     focused structured fields, slides from the right
 *
 * One small live-loop here: while at least one uploaded doc is still being
 * parsed or indexed we call `router.refresh()` every few seconds so the
 * doc-progress chip and rail counts hydrate themselves without anything
 * fancier.
 */
"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";

import type { PlannerContextSummary } from "@/lib/planner/context-summary";
import type { PlannerTurn } from "@/lib/planner/agent";
import type { PlannerReadinessIssue } from "@/lib/planner/services";
import type { EmployeePick, WizardPlan } from "../wizard/_components/types";

import {
  applyContextSummaryAction,
  applyPlannerSuggestionsAction,
  deletePlannerContextAction,
  generatePlannerSuggestionsAction,
  markIntakeReadyAction,
  pastePlannerContextAction,
  saveIntakeAnnouncementAction,
  saveIntakeCoreAction,
  saveIntakeFrameAction,
  saveIntakeSupportAction,
  saveIntakeTimelineAction,
  sendPlannerMessageAction,
  summarizePlannerContextAction,
  uploadPlannerContextAction,
} from "./actions";
import { ChatCanvas } from "./_components/chat-canvas";
import { Composer } from "./_components/composer";
import {
  EditPlanDrawer,
  type EditPlanPayload,
} from "./_components/edit-plan-drawer";
import { PlanRail } from "./_components/plan-rail";
import type { IntakeMessage, SuggestedUpdates } from "./_components/types";

let messageCounter = 0;
function newMessageId(prefix: string) {
  messageCounter += 1;
  return `${prefix}-${messageCounter}-${Date.now().toString(36)}`;
}

const POLL_INTERVAL_MS = 2500;

export function PlannerIntake({
  plan,
  employees,
  readinessIssues,
}: {
  plan: WizardPlan;
  employees: EmployeePick[];
  readinessIssues: PlannerReadinessIssue[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [thinking, setThinking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [railOpen, setRailOpen] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [messages, setMessages] = useState<IntakeMessage[]>(() => [
    {
      id: newMessageId("msg"),
      kind: "text",
      role: "assistant",
      text:
        plan.trainingDocuments.length > 0
          ? "I can already see your context. Want me to summarize it, or shall we start drafting from what you know?"
          : "Drop in a few docs or paste any rough notes you have. I'll synthesize it into a draft and only ask for what's missing.",
      status: "Ready",
    },
  ]);

  const employeeByEmail = useMemo(() => {
    const map = new Map<string, EmployeePick>();
    for (const employee of employees) {
      map.set(employee.email.toLowerCase(), employee);
    }
    return map;
  }, [employees]);

  const hardBlocked = readinessIssues.some((issue) => issue.required);
  const canSummarize = plan.trainingDocuments.some(
    (doc) => doc.processingStatus === "parsed",
  );
  const canSuggest = Boolean(plan.summary?.trim());

  // Live doc-status polling. We re-evaluate each render: if anything is still
  // pending we keep an interval running, and once everything is parsed/failed
  // the next render's effect cleans up and we stop. The dependency on the
  // `trainingDocuments` array ref means each refresh restarts the timer with
  // a fresh look at the latest statuses.
  useEffect(() => {
    const hasPending = plan.trainingDocuments.some(
      (doc) =>
        doc.processingStatus === "pending" || doc.indexStatus === "pending",
    );
    if (!hasPending) return;
    const handle = setInterval(() => {
      router.refresh();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(handle);
  }, [plan.trainingDocuments, router]);

  // Stable counter we can read inside the various transition closures without
  // double-firing thinking transitions when callbacks overlap.
  const inflight = useRef(0);
  function startThinking() {
    inflight.current += 1;
    setThinking(true);
  }
  function endThinking() {
    inflight.current = Math.max(0, inflight.current - 1);
    if (inflight.current === 0) setThinking(false);
  }

  // ---------------- message helpers ----------------
  function pushMessage(message: IntakeMessage) {
    setMessages((prev) => [...prev, message]);
  }
  function pushAssistant(text: string, status?: string) {
    pushMessage({
      id: newMessageId("msg"),
      kind: "text",
      role: "assistant",
      text,
      status,
    });
  }
  function pushUser(text: string) {
    pushMessage({
      id: newMessageId("msg"),
      kind: "text",
      role: "user",
      text,
    });
  }
  function markCardApplied(id: string) {
    setMessages((prev) =>
      prev.map((m) =>
        m.id === id &&
        (m.kind === "context-summary" || m.kind === "suggestions")
          ? { ...m, applied: true, dismissed: false }
          : m,
      ),
    );
  }
  function markCardDismissed(id: string) {
    setMessages((prev) =>
      prev.map((m) =>
        m.id === id &&
        (m.kind === "context-summary" || m.kind === "suggestions")
          ? { ...m, dismissed: true }
          : m,
      ),
    );
  }

  function run(action: () => Promise<void>) {
    setError(null);
    startTransition(async () => {
      try {
        await action();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong");
      }
    });
  }

  // ---------------- context (upload / paste / remove) ----------------
  async function handleUpload(file: File) {
    setError(null);
    const docMessageId = newMessageId("doc");
    pushMessage({
      id: docMessageId,
      kind: "doc-progress",
      role: "system",
      filename: file.name,
      documentId: null,
    });
    try {
      const formData = new FormData();
      formData.append("file", file);
      const result = await uploadPlannerContextAction(plan.id, formData);
      if (!result.ok) throw new Error(result.error);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === docMessageId && m.kind === "doc-progress"
            ? { ...m, documentId: result.documentId }
            : m,
        ),
      );
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
      setMessages((prev) => prev.filter((m) => m.id !== docMessageId));
    }
  }

  async function handlePaste(input: { title: string; text: string }) {
    setError(null);
    const docMessageId = newMessageId("doc");
    const filename = input.title.trim() || "Pasted rollout context";
    pushMessage({
      id: docMessageId,
      kind: "doc-progress",
      role: "system",
      filename,
      documentId: null,
    });
    try {
      const result = await pastePlannerContextAction(plan.id, input);
      if (!result.ok) throw new Error(result.error);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === docMessageId && m.kind === "doc-progress"
            ? { ...m, documentId: result.documentId }
            : m,
        ),
      );
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
      setMessages((prev) => prev.filter((m) => m.id !== docMessageId));
    }
  }

  function handleRemoveDoc(documentId: string) {
    run(async () => {
      const result = await deletePlannerContextAction(plan.id, documentId);
      if (!result.ok) throw new Error(result.error);
      setMessages((prev) =>
        prev.filter(
          (m) => !(m.kind === "doc-progress" && m.documentId === documentId),
        ),
      );
      router.refresh();
    });
  }

  // ---------------- AI cards ----------------
  function summarizeContext() {
    setError(null);
    startThinking();
    startTransition(async () => {
      try {
        const result = await summarizePlannerContextAction(plan.id);
        if (!result.ok) {
          setError(result.error);
          return;
        }
        pushMessage({
          id: newMessageId("ctx"),
          kind: "context-summary",
          role: "assistant",
          summary: result.data,
          applied: false,
          dismissed: false,
        });
      } finally {
        endThinking();
      }
    });
  }

  function handleApplyContextSummary(
    messageId: string,
    summary: PlannerContextSummary,
  ) {
    run(async () => {
      const result = await applyContextSummaryAction(plan.id, {
        name: summary.inferred.name,
        summary: summary.inferred.changeSummary,
        coreMechanism: summary.inferred.coreMechanism,
      });
      if (!result.ok) throw new Error(result.error);
      markCardApplied(messageId);
      pushAssistant(
        "I applied the inferred brief. Want me to draft stakeholder groups and an announcement next?",
        "Applied",
      );
      router.refresh();
    });
  }

  function generateSuggestions() {
    setError(null);
    startThinking();
    startTransition(async () => {
      try {
        const result = await generatePlannerSuggestionsAction(plan.id);
        if (!result.ok) {
          setError(result.error);
          return;
        }
        pushMessage({
          id: newMessageId("sug"),
          kind: "suggestions",
          role: "assistant",
          suggestions: {
            stakeholderGroups: result.data.groups,
            coreMechanism: result.data.coreMechanism,
            announcement: result.data.announcement,
          } as SuggestedUpdates,
          applied: false,
          dismissed: false,
        });
      } finally {
        endThinking();
      }
    });
  }

  function handleApplySuggestions(
    messageId: string,
    suggestions: SuggestedUpdates,
  ) {
    run(async () => {
      const result = await applyPlannerSuggestionsAction(plan.id, suggestions);
      if (!result.ok) throw new Error(result.error);
      markCardApplied(messageId);
      pushAssistant(
        "Applied. The plan rail has the updated draft — let me know what to refine.",
        "Applied",
      );
      router.refresh();
    });
  }

  // ---------------- chat ----------------
  async function handleSendMessage(text: string) {
    pushUser(text);
    setError(null);
    startThinking();
    try {
      const result = await sendPlannerMessageAction(plan.id, text);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      pushAssistant(result.data.reply, result.data.status);
      if (result.data.suggestedUpdates) {
        pushMessage({
          id: newMessageId("sug"),
          kind: "suggestions",
          role: "assistant",
          suggestions: result.data.suggestedUpdates as SuggestedUpdates,
          applied: false,
          dismissed: false,
        });
      }
    } finally {
      endThinking();
    }
  }

  // ---------------- structured edits (drawer) ----------------
  async function handleSavePlan(
    payload: EditPlanPayload,
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    const frame = await saveIntakeFrameAction(plan.id, {
      name: payload.name,
      summary: payload.summary,
    });
    if (!frame.ok) return frame;
    const timeline = await saveIntakeTimelineAction(plan.id, {
      kickoffDate: payload.kickoffDate,
      targetDate: payload.targetDate,
    });
    if (!timeline.ok) return timeline;
    const core = await saveIntakeCoreAction(plan.id, {
      coreMechanism: payload.coreMechanism,
    });
    if (!core.ok) return core;
    const support = await saveIntakeSupportAction(plan.id, {
      responseCadenceHours: payload.cadence ? Number(payload.cadence) : "",
      announcementSendOnBehalf: payload.sendOnBehalf,
    });
    if (!support.ok) return support;
    const announcement = await saveIntakeAnnouncementAction(plan.id, {
      announcement: payload.announcement,
    });
    if (!announcement.ok) return announcement;
    pushAssistant("Saved the plan edits.", "Saved");
    router.refresh();
    return { ok: true };
  }

  // ---------------- ready ----------------
  function markReady() {
    run(async () => {
      const result = await markIntakeReadyAction(plan.id);
      if (!result.ok) throw new Error(result.error);
      window.location.assign(result.href);
    });
  }

  return (
    <div className="flex h-[calc(100vh-180px)] min-h-[600px] flex-col">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[color:var(--color-muted)]">
            Planning intake
          </p>
          <h1 className="serif mt-1 truncate text-[26px] leading-[1.1]">
            {plan.name?.trim() || "Untitled change plan"}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.06em] ${
              hardBlocked
                ? "bg-amber-100 text-amber-800"
                : "bg-[color:var(--color-grasp)] text-white"
            }`}
          >
            <span
              aria-hidden
              className={`h-1.5 w-1.5 rounded-full ${
                hardBlocked ? "bg-amber-600" : "bg-white"
              }`}
            />
            {hardBlocked
              ? `${readinessIssues.filter((issue) => issue.required).length} required left`
              : "Ready to review"}
          </span>
          <button
            type="button"
            className="btn btn-primary text-[13px]"
            disabled={pending || hardBlocked}
            onClick={markReady}
          >
            Mark ready
          </button>
        </div>
      </header>

      {error ? (
        <div
          role="alert"
          className="mb-3 rounded-card border border-red-200 bg-red-50 p-3 text-[13px] text-red-800"
        >
          {error}
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1 gap-4">
        <div className="flex min-h-0 flex-1 flex-col">
          <ChatCanvas
            messages={messages}
            thinking={thinking}
            trainingDocs={plan.trainingDocuments}
            employeeByEmail={employeeByEmail}
            pending={pending}
            onApplyContextSummary={handleApplyContextSummary}
            onDiscardCard={markCardDismissed}
            onApplySuggestions={handleApplySuggestions}
            onRemoveDoc={handleRemoveDoc}
          />
          <Composer
            onSend={handleSendMessage}
            onUpload={handleUpload}
            onPaste={handlePaste}
            onSummarize={summarizeContext}
            onSuggest={generateSuggestions}
            canSummarize={canSummarize}
            canSuggest={canSuggest}
            disabled={pending || thinking}
          />
        </div>
        <div className="hidden lg:block">
          <PlanRail
            plan={plan}
            readinessIssues={readinessIssues}
            open={railOpen}
            onToggle={() => setRailOpen((open) => !open)}
            onEditPlan={() => setDrawerOpen(true)}
            onMarkReady={markReady}
            markBlocked={hardBlocked || pending}
          />
        </div>
      </div>

      <EditPlanDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        plan={plan}
        onSave={handleSavePlan}
      />
    </div>
  );
}
