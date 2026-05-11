"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, useTransition } from "react";

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

type Message = {
  role: "assistant" | "user";
  text: string;
  status?: string;
};

type SuggestedUpdates = NonNullable<PlannerTurn["suggestedUpdates"]>;

function toInputDate(date: Date | null): string {
  return date ? date.toISOString().slice(0, 10) : "";
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  const [messagePending, startMessageTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [contextTitle, setContextTitle] = useState("");
  const [contextText, setContextText] = useState("");
  const [contextSummary, setContextSummary] =
    useState<PlannerContextSummary | null>(null);
  const [suggestions, setSuggestions] = useState<SuggestedUpdates | null>(null);
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      text:
        plan.trainingDocuments.length > 0
          ? "I can use the context you already added. Ask me what to draft, or I can summarize the docs first."
          : "Start by uploading docs or pasting rough notes. I will turn them into a draft plan, then ask only for what is missing.",
      status: "Ready",
    },
  ]);
  const [chatInput, setChatInput] = useState("");
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

  const hardBlocked = readinessIssues.some((issue) => issue.required);
  const documentCount = plan.trainingDocuments.length;
  const parsedCount = plan.trainingDocuments.filter(
    (doc) => doc.processingStatus === "parsed",
  ).length;
  const indexedCount = plan.trainingDocuments.filter(
    (doc) => doc.indexStatus === "indexed",
  ).length;

  const employeeByEmail = useMemo(() => {
    const map = new Map<string, EmployeePick>();
    for (const employee of employees) {
      map.set(employee.email.toLowerCase(), employee);
    }
    return map;
  }, [employees]);

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

  function addAssistant(text: string, status?: string) {
    setMessages((previous) => [...previous, { role: "assistant", text, status }]);
  }

  function pasteContext() {
    run(async () => {
      const result = await pastePlannerContextAction(plan.id, {
        title: contextTitle,
        text: contextText,
      });
      if (!result.ok) throw new Error(result.error);
      setContextTitle("");
      setContextText("");
      addAssistant("Got it. I saved that context and started indexing it.", "Context saved");
      router.refresh();
    });
  }

  function uploadFile(file: File | null | undefined) {
    if (!file) return;
    run(async () => {
      const formData = new FormData();
      formData.append("file", file);
      const result = await uploadPlannerContextAction(plan.id, formData);
      if (!result.ok) throw new Error(result.error);
      addAssistant(`I uploaded ${file.name} and started processing it.`, "Uploading");
      if (fileInputRef.current) fileInputRef.current.value = "";
      router.refresh();
    });
  }

  function summarizeContext() {
    run(async () => {
      const result = await summarizePlannerContextAction(plan.id);
      if (!result.ok) throw new Error(result.error);
      setContextSummary(result.data);
      setSuggestions({
        name: result.data.inferred.name,
        summary: result.data.inferred.changeSummary,
        coreMechanism: result.data.inferred.coreMechanism,
      });
      addAssistant(result.data.summary, "Context summarized");
    });
  }

  function applyContextSummary() {
    if (!contextSummary) return;
    run(async () => {
      const result = await applyContextSummaryAction(plan.id, {
        name: contextSummary.inferred.name,
        summary: contextSummary.inferred.changeSummary,
        coreMechanism: contextSummary.inferred.coreMechanism,
      });
      if (!result.ok) throw new Error(result.error);
      addAssistant("I applied the inferred brief. You can edit it in the plan panel.", "Saved");
      router.refresh();
    });
  }

  function generateSuggestions() {
    run(async () => {
      const result = await generatePlannerSuggestionsAction(plan.id);
      if (!result.ok) throw new Error(result.error);
      setSuggestions({
        stakeholderGroups: result.data.groups,
        coreMechanism: result.data.coreMechanism,
        announcement: result.data.announcement,
      });
      addAssistant(
        "I drafted stakeholder groups, the key outcome to protect, and a first announcement. Review before applying.",
        "Suggestions ready",
      );
    });
  }

  function applySuggestions() {
    if (!suggestions) return;
    run(async () => {
      const result = await applyPlannerSuggestionsAction(plan.id, suggestions);
      if (!result.ok) throw new Error(result.error);
      setSuggestions(null);
      addAssistant("Applied. The plan panel has the latest saved draft.", "Saved");
      router.refresh();
    });
  }

  function sendMessage() {
    const text = chatInput.trim();
    if (!text) return;
    setChatInput("");
    setMessages((previous) => [...previous, { role: "user", text }]);
    setError(null);
    startMessageTransition(async () => {
      const result = await sendPlannerMessageAction(plan.id, text);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setMessages((previous) => [
        ...previous,
        {
          role: "assistant",
          text: result.data.reply,
          status: result.data.status,
        },
      ]);
      setSuggestions(result.data.suggestedUpdates ?? null);
    });
  }

  function savePlanPanel() {
    run(async () => {
      const frame = await saveIntakeFrameAction(plan.id, { name, summary });
      if (!frame.ok) throw new Error(frame.error);
      const timeline = await saveIntakeTimelineAction(plan.id, {
        kickoffDate,
        targetDate,
      });
      if (!timeline.ok) throw new Error(timeline.error);
      const core = await saveIntakeCoreAction(plan.id, { coreMechanism });
      if (!core.ok) throw new Error(core.error);
      const support = await saveIntakeSupportAction(plan.id, {
        responseCadenceHours: cadence ? Number(cadence) : "",
        announcementSendOnBehalf: sendOnBehalf,
      });
      if (!support.ok) throw new Error(support.error);
      const announcementResult = await saveIntakeAnnouncementAction(plan.id, {
        announcement,
      });
      if (!announcementResult.ok) throw new Error(announcementResult.error);
      addAssistant("Saved the plan panel edits.", "Saved");
      router.refresh();
    });
  }

  function markReady() {
    run(async () => {
      const result = await markIntakeReadyAction(plan.id);
      if (!result.ok) throw new Error(result.error);
      window.location.assign(result.href);
    });
  }

  return (
    <div className="space-y-6">
      <header className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div>
          <p className="text-[12px] font-semibold uppercase tracking-[0.1em] text-[color:var(--color-muted)]">
            Agentic planning intake
          </p>
          <h1 className="serif mt-1 max-w-[740px] text-[44px] leading-[1.02]">
            Bring the docs. Grasp will shape the plan with you.
          </h1>
          <p className="mt-4 max-w-[700px] text-[15px] leading-[1.7] text-[color:var(--color-muted)]">
            Upload the context first, then work through the draft in a chat
            that stays connected to the actual rollout fields.
          </p>
        </div>
        <div className="card p-5">
          <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[color:var(--color-muted)]">
            Responsiveness
          </p>
          <div className="mt-3 grid grid-cols-3 gap-2 text-center">
            <Metric value={documentCount} label="docs" />
            <Metric value={parsedCount} label="parsed" />
            <Metric value={indexedCount} label="indexed" />
          </div>
          <Link
            href={`/changes/${plan.id}/wizard`}
            className="btn btn-secondary mt-4 w-full text-[12px]"
          >
            Open classic wizard
          </Link>
        </div>
      </header>

      {error ? (
        <div className="rounded-card border border-red-200 bg-red-50 p-4 text-[13px] text-red-800">
          {error}
        </div>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.05fr)_minmax(380px,0.95fr)]">
        <main className="space-y-5">
          <section className="card overflow-hidden">
            <div className="border-b border-[color:var(--color-line)] p-5">
              <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[color:var(--color-muted)]">
                Step 1
              </p>
              <h2 className="serif mt-1 text-[28px] leading-[1.15]">
                Add easy context
              </h2>
              <p className="mt-2 text-[13px] leading-[1.6] text-[color:var(--color-muted)]">
                SOPs, meeting notes, FAQs, or a messy brief are all useful.
                The upload returns immediately while parsing and indexing
                continue behind the scenes.
              </p>
            </div>

            <div className="grid gap-0 md:grid-cols-2">
              <div
                className="border-b border-[color:var(--color-line)] p-5 md:border-b-0 md:border-r"
                onDragOver={(event) => {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "copy";
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  uploadFile(event.dataTransfer.files?.[0]);
                }}
              >
                <p className="text-[13px] font-semibold">Upload docs</p>
                <p className="mt-1 text-[12px] leading-[1.55] text-[color:var(--color-muted)]">
                  PDF, DOCX, Markdown, or text. Drop one here or choose a file.
                </p>
                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  accept="application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/markdown,text/x-markdown,text/plain,.pdf,.docx,.md,.markdown,.txt"
                  onChange={(event) => uploadFile(event.target.files?.[0])}
                />
                <button
                  type="button"
                  className="btn btn-secondary mt-4"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={pending}
                >
                  Choose file
                </button>
              </div>

              <div className="space-y-3 p-5">
                <p className="text-[13px] font-semibold">Paste rough notes</p>
                <input
                  className="input"
                  value={contextTitle}
                  onChange={(event) => setContextTitle(event.target.value)}
                  placeholder="Optional title"
                />
                <textarea
                  className="input min-h-[130px]"
                  value={contextText}
                  onChange={(event) => setContextText(event.target.value)}
                  placeholder="Paste meeting notes, rollout background, or a rough brief..."
                />
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={pending || contextText.trim().length < 20}
                  onClick={pasteContext}
                >
                  Save pasted context
                </button>
              </div>
            </div>

            {plan.trainingDocuments.length > 0 ? (
              <div className="border-t border-[color:var(--color-line)] p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-[13px] font-semibold">Context on file</p>
                  <button
                    type="button"
                    className="btn btn-secondary text-[12px]"
                    disabled={pending}
                    onClick={summarizeContext}
                  >
                    {pending ? "Working..." : "Summarize docs"}
                  </button>
                </div>
                <ul className="mt-3 space-y-2">
                  {plan.trainingDocuments.map((doc) => (
                    <li
                      key={doc.id}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-[14px] border border-[color:var(--color-line)] bg-white/45 px-4 py-3"
                    >
                      <div>
                        <p className="text-[13px] font-medium">{doc.filename}</p>
                        <p className="text-[11px] text-[color:var(--color-muted)]">
                          {formatBytes(doc.bytes)} / {doc.processingStatus} /{" "}
                          {doc.indexStatus}
                        </p>
                      </div>
                      <button
                        type="button"
                        className="text-[12px] text-[color:var(--color-muted)] hover:text-red-700"
                        disabled={pending}
                        onClick={() =>
                          run(async () => {
                            const result = await deletePlannerContextAction(
                              plan.id,
                              doc.id,
                            );
                            if (!result.ok) throw new Error(result.error);
                            router.refresh();
                          })
                        }
                      >
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </section>

          {contextSummary ? (
            <section className="card p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[color:var(--color-muted)]">
                    Agent readout
                  </p>
                  <h2 className="serif mt-1 text-[28px] leading-[1.15]">
                    {contextSummary.headline}
                  </h2>
                </div>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={pending}
                  onClick={applyContextSummary}
                >
                  Apply inferred brief
                </button>
              </div>
              <p className="mt-4 whitespace-pre-wrap text-[14px] leading-[1.7] text-[color:var(--color-ink-2)]">
                {contextSummary.summary}
              </p>
              {contextSummary.citations.length > 0 ? (
                <div className="mt-4 grid gap-2 sm:grid-cols-2">
                  {contextSummary.citations.map((citation) => (
                    <div
                      key={`${citation.filename}-${citation.note}`}
                      className="rounded-[14px] border border-[color:var(--color-line)] bg-white/45 p-3"
                    >
                      <p className="text-[12px] font-semibold">
                        {citation.filename}
                      </p>
                      <p className="mt-1 text-[12px] leading-[1.5] text-[color:var(--color-muted)]">
                        {citation.note}
                      </p>
                    </div>
                  ))}
                </div>
              ) : null}
            </section>
          ) : null}

          <section className="card flex min-h-[520px] flex-col overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[color:var(--color-line)] p-5">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[color:var(--color-muted)]">
                  Step 2
                </p>
                <h2 className="serif mt-1 text-[28px] leading-[1.15]">
                  Talk through the draft
                </h2>
              </div>
              <button
                type="button"
                className="btn btn-secondary text-[12px]"
                disabled={pending || !summary.trim()}
                onClick={generateSuggestions}
              >
                Draft suggestions
              </button>
            </div>
            <div className="flex-1 space-y-3 overflow-y-auto p-5">
              {messages.map((message, index) => (
                <div
                  key={`${message.role}-${index}`}
                  className={`max-w-[82%] rounded-[18px] px-4 py-3 text-[14px] leading-[1.65] ${
                    message.role === "user"
                      ? "ml-auto bg-[color:var(--color-ink)] text-white"
                      : "bg-white/65 text-[color:var(--color-ink-2)]"
                  }`}
                >
                  {message.status ? (
                    <p
                      className={`mb-1 text-[10px] font-semibold uppercase tracking-[0.08em] ${
                        message.role === "user"
                          ? "text-white/70"
                          : "text-[color:var(--color-grasp)]"
                      }`}
                    >
                      {message.status}
                    </p>
                  ) : null}
                  <p className="whitespace-pre-wrap">{message.text}</p>
                </div>
              ))}
              {messagePending ? (
                <div className="max-w-[280px] rounded-[18px] bg-white/65 px-4 py-3 text-[13px] text-[color:var(--color-muted)]">
                  Thinking through the next useful step...
                </div>
              ) : null}
            </div>
            <div className="border-t border-[color:var(--color-line)] p-4">
              <div className="flex gap-2">
                <textarea
                  className="input min-h-[54px] flex-1 resize-none"
                  value={chatInput}
                  onChange={(event) => setChatInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      sendMessage();
                    }
                  }}
                  placeholder="Tell Grasp what is changing, ask for suggestions, or edit the plan in plain English..."
                />
                <button
                  type="button"
                  className="btn btn-primary self-end"
                  disabled={messagePending || !chatInput.trim()}
                  onClick={sendMessage}
                >
                  Send
                </button>
              </div>
            </div>
          </section>
        </main>

        <aside className="space-y-5 xl:sticky xl:top-5 xl:self-start">
          {suggestions ? (
            <SuggestionPanel
              suggestions={suggestions}
              employeeByEmail={employeeByEmail}
              onApply={applySuggestions}
              pending={pending}
            />
          ) : null}

          <section className="card p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[color:var(--color-muted)]">
                  Live plan
                </p>
                <h2 className="serif mt-1 text-[28px] leading-[1.15]">
                  Structured draft
                </h2>
              </div>
              <button
                type="button"
                className="btn btn-primary text-[12px]"
                disabled={pending}
                onClick={savePlanPanel}
              >
                Save
              </button>
            </div>

            <div className="mt-5 space-y-4">
              <div>
                <label className="label" htmlFor="intake-name">
                  Name
                </label>
                <input
                  id="intake-name"
                  className="input"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </div>
              <div>
                <label className="label" htmlFor="intake-summary">
                  Summary
                </label>
                <textarea
                  id="intake-summary"
                  className="input min-h-[110px]"
                  value={summary}
                  onChange={(event) => setSummary(event.target.value)}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label" htmlFor="intake-kickoff">
                    Kickoff
                  </label>
                  <input
                    id="intake-kickoff"
                    type="date"
                    className="input"
                    value={kickoffDate}
                    onChange={(event) => setKickoffDate(event.target.value)}
                  />
                </div>
                <div>
                  <label className="label" htmlFor="intake-target">
                    Target
                  </label>
                  <input
                    id="intake-target"
                    type="date"
                    className="input"
                    value={targetDate}
                    onChange={(event) => setTargetDate(event.target.value)}
                  />
                </div>
              </div>
              <div>
                <label className="label" htmlFor="intake-core">
                  Key outcome to protect
                </label>
                <textarea
                  id="intake-core"
                  className="input min-h-[120px]"
                  value={coreMechanism}
                  onChange={(event) => setCoreMechanism(event.target.value)}
                />
              </div>
              <div className="grid grid-cols-[1fr_auto] items-end gap-3">
                <div>
                  <label className="label" htmlFor="intake-cadence">
                    Response hours
                  </label>
                  <input
                    id="intake-cadence"
                    type="number"
                    min={1}
                    max={720}
                    className="input"
                    value={cadence}
                    onChange={(event) => setCadence(event.target.value)}
                  />
                </div>
                <label className="flex items-center gap-2 pb-3 text-[12px] text-[color:var(--color-muted)]">
                  <input
                    type="checkbox"
                    checked={sendOnBehalf}
                    onChange={(event) => setSendOnBehalf(event.target.checked)}
                  />
                  Agent sends
                </label>
              </div>
              <div>
                <label className="label" htmlFor="intake-announcement">
                  Announcement
                </label>
                <textarea
                  id="intake-announcement"
                  className="input min-h-[170px] font-serif leading-[1.65]"
                  value={announcement}
                  onChange={(event) => setAnnouncement(event.target.value)}
                />
              </div>
            </div>
          </section>

          <section className="card p-5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[color:var(--color-muted)]">
              Stakeholder groups
            </p>
            {plan.stakeholderGroups.length > 0 ? (
              <ul className="mt-3 space-y-3">
                {plan.stakeholderGroups.map((group) => (
                  <li
                    key={group.id}
                    className="rounded-[14px] border border-[color:var(--color-line)] bg-white/45 p-3"
                  >
                    <p className="text-[13px] font-semibold">{group.name}</p>
                    <p className="mt-1 text-[12px] text-[color:var(--color-muted)]">
                      {group.members.length} members
                      {group.behaviorSpec ? " / behavior specified" : " / needs behavior"}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-[13px] leading-[1.6] text-[color:var(--color-muted)]">
                No groups yet. Ask the agent to draft them or use the classic
                audience editor for precise membership.
              </p>
            )}
            <Link
              href={`/changes/${plan.id}/wizard/audience`}
              className="btn btn-secondary mt-4 w-full text-[12px]"
            >
              Edit people and groups
            </Link>
          </section>

          <section className="card p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[color:var(--color-muted)]">
                  Readiness
                </p>
                <h2 className="serif mt-1 text-[24px] leading-[1.15]">
                  {hardBlocked ? "Needs a little more" : "Ready to review"}
                </h2>
              </div>
              <button
                type="button"
                className="btn btn-primary text-[12px]"
                disabled={pending || hardBlocked}
                onClick={markReady}
              >
                Mark ready
              </button>
            </div>
            {readinessIssues.length > 0 ? (
              <ul className="mt-4 space-y-2">
                {readinessIssues.map((issue) => (
                  <li
                    key={issue.key}
                    className="flex gap-2 text-[13px] leading-[1.5] text-[color:var(--color-muted)]"
                  >
                    <span>{issue.required ? "Required:" : "Optional:"}</span>
                    <span>{issue.label}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-[13px] text-[color:var(--color-muted)]">
                The draft has the hard requirements. Final review still happens
                before activation.
              </p>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}

function Metric({ value, label }: { value: number; label: string }) {
  return (
    <div className="rounded-[14px] bg-white/50 p-3">
      <p className="serif text-[26px] leading-none">{value}</p>
      <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--color-muted)]">
        {label}
      </p>
    </div>
  );
}

function SuggestionPanel({
  suggestions,
  employeeByEmail,
  onApply,
  pending,
}: {
  suggestions: SuggestedUpdates;
  employeeByEmail: Map<string, EmployeePick>;
  onApply: () => void;
  pending: boolean;
}) {
  return (
    <section className="card border-[color:var(--color-grasp)]/20 bg-[color:var(--color-grasp-soft)] p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[color:var(--color-grasp)]">
            Suggested updates
          </p>
          <h2 className="serif mt-1 text-[26px] leading-[1.15]">
            Review before applying
          </h2>
        </div>
        <button
          type="button"
          className="btn btn-primary text-[12px]"
          disabled={pending}
          onClick={onApply}
        >
          Apply
        </button>
      </div>
      <div className="mt-4 space-y-3 text-[13px] leading-[1.55]">
        {suggestions.name ? <Suggestion label="Name" value={suggestions.name} /> : null}
        {suggestions.summary ? (
          <Suggestion label="Summary" value={suggestions.summary} />
        ) : null}
        {suggestions.coreMechanism ? (
          <Suggestion label="Core" value={suggestions.coreMechanism} />
        ) : null}
        {suggestions.announcement ? (
          <Suggestion label="Announcement" value={suggestions.announcement} />
        ) : null}
        {suggestions.stakeholderGroups?.length ? (
          <div className="rounded-[14px] bg-white/55 p-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[color:var(--color-muted)]">
              Groups
            </p>
            <ul className="mt-2 space-y-3">
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
                        .map((email) => employeeByEmail.get(email.toLowerCase())?.name ?? email)
                        .join(", ")}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function Suggestion({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[14px] bg-white/55 p-3">
      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[color:var(--color-muted)]">
        {label}
      </p>
      <p className="mt-1 whitespace-pre-wrap">{value}</p>
    </div>
  );
}
