/**
 * Voice step — phase 2 of the intake.
 *
 * Mounts an `IntakeRealtimeClient` once the user has clicked through to it
 * and a Realtime session token has been fetched from the server. Live
 * transcript on the left, captured-so-far feed on the right, mic + status
 * up top, end-button at the bottom. On `done` (model-driven) or on the
 * end-button (user-driven) we close the session and route to `/review`.
 */
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import {
  IntakeRealtimeClient,
  type IntakeRealtimeStatus,
} from "@/lib/voice/intake-realtime-client";

interface SessionInfo {
  clientSecret: string;
  handshakeUrl: string;
  model: string;
  voice: string;
  sessionId: string;
}

interface TranscriptTurn {
  id: string;
  role: "assistant" | "user";
  text: string;
  status: "streaming" | "final";
}

interface CapturedEvent {
  id: string;
  label: string;
  detail?: string;
  ok: boolean;
}

const POST_DONE_DELAY_MS = 2000;

let turnCounter = 0;
let captureCounter = 0;

const STATUS_COPY: Record<IntakeRealtimeStatus, string> = {
  idle: "Idle",
  "requesting-mic": "Asking for microphone access…",
  connecting: "Connecting to Grasp…",
  live: "Live",
  ending: "Wrapping up…",
  ended: "Ended",
  error: "Something went wrong",
};

export function VoiceStep({
  planId,
  reviewHref,
  onBack,
}: {
  planId: string;
  reviewHref: string;
  onBack: () => void;
}) {
  const router = useRouter();
  const clientRef = useRef<IntakeRealtimeClient | null>(null);
  const startedRef = useRef(false);
  const transcriptScrollRef = useRef<HTMLDivElement>(null);

  const [status, setStatus] = useState<IntakeRealtimeStatus>("idle");
  const [statusDetail, setStatusDetail] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<TranscriptTurn[]>([]);
  const [captured, setCaptured] = useState<CapturedEvent[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Bridge tool calls to our /api/intake/[id]/tool route.
  const executeTool = useCallback(
    async (name: string, args: unknown) => {
      const response = await fetch(`/api/intake/${planId}/tool`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, arguments: args }),
      });
      if (!response.ok) {
        const text = await response.text().catch(() => "");
        return {
          ok: false,
          error: `Tool route ${response.status}${text ? `: ${text.slice(0, 200)}` : ""}`,
        };
      }
      return response.json();
    },
    [planId],
  );

  // ---------------------------------------------------------------------
  // One-shot start. Idempotent via startedRef so React 19 strict double
  // mount doesn't end up with two peer connections.
  // ---------------------------------------------------------------------
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    let cancelled = false;

    void (async () => {
      try {
        const sessionResponse = await fetch(
          `/api/intake/${planId}/realtime-session`,
          { method: "POST" },
        );
        if (!sessionResponse.ok) {
          const body = await sessionResponse.json().catch(() => null);
          throw new Error(
            body?.error || `Session route ${sessionResponse.status}`,
          );
        }
        const session = (await sessionResponse.json()) as SessionInfo;
        if (cancelled) return;

        const client = new IntakeRealtimeClient({
          onStatus: (s, detail) => {
            setStatus(s);
            setStatusDetail(detail ?? null);
          },
          onAssistantTranscriptDelta: (delta) => {
            setTranscript((prev) => mergeAssistantDelta(prev, delta));
          },
          onAssistantTranscript: (text) => {
            setTranscript((prev) => finalizeAssistantTurn(prev, text));
          },
          onUserTranscript: (text) => {
            setTranscript((prev) => [
              ...prev,
              {
                id: nextTurnId("user"),
                role: "user",
                text,
                status: "final",
              },
            ]);
          },
          executeTool,
          onToolCall: (name, args, result) => {
            const event = describeToolCall(name, args, result);
            if (event) setCaptured((prev) => [...prev, event]);
          },
          onDone: () => {
            // Let the agent's closing words land before navigating.
            setTimeout(() => {
              client.stop();
              router.push(reviewHref);
            }, POST_DONE_DELAY_MS);
          },
          onError: (err) => setError(err.message),
        });
        clientRef.current = client;
        await client.start({
          clientSecret: session.clientSecret,
          handshakeUrl: session.handshakeUrl,
          model: session.model,
          voice: session.voice,
          sessionId: session.sessionId,
        });
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Voice intake failed");
      }
    })();

    return () => {
      cancelled = true;
      clientRef.current?.stop();
      clientRef.current = null;
    };
  }, [planId, executeTool, router, reviewHref]);

  // Keep the transcript scrolled to the bottom as new turns arrive.
  useEffect(() => {
    const node = transcriptScrollRef.current;
    if (!node) return;
    node.scrollTo({ top: node.scrollHeight, behavior: "smooth" });
  }, [transcript]);

  function endNow() {
    clientRef.current?.stop();
    router.push(reviewHref);
  }

  const isLive = status === "live";
  const isEnding = status === "ending";
  const showRetry = status === "error";

  return (
    <div className="flex h-[calc(100vh-180px)] min-h-[600px] flex-col">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[color:var(--color-muted)]">
            Step 2 — Voice intake
          </p>
          <h1 className="serif mt-1 text-[28px] leading-[1.1]">
            Talk it through with Grasp
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="btn btn-ghost text-[12px]"
            onClick={() => {
              clientRef.current?.stop();
              onBack();
            }}
            disabled={isEnding}
          >
            ← Back to docs
          </button>
          <button
            type="button"
            className="btn btn-primary text-[13px]"
            disabled={isEnding || status === "idle"}
            onClick={endNow}
          >
            End & review
          </button>
        </div>
      </header>

      {error ? (
        <div
          role="alert"
          className="mb-3 rounded-card border border-red-200 bg-red-50 p-3 text-[13px] text-red-800"
        >
          <p className="font-medium">{error}</p>
          {showRetry ? (
            <button
              type="button"
              className="mt-2 text-[12px] underline"
              onClick={() => router.refresh()}
            >
              Try again
            </button>
          ) : null}
        </div>
      ) : null}

      <section className="card flex flex-col items-center justify-center gap-3 px-6 py-5 text-center">
        <MicIndicator status={status} />
        <p className="text-[14px] font-medium text-[color:var(--color-ink-2)]">
          {STATUS_COPY[status] ?? "Ready"}
        </p>
        {statusDetail && status === "error" ? (
          <p className="text-[12px] text-[color:var(--color-muted)]">
            {statusDetail}
          </p>
        ) : (
          <p className="max-w-[480px] text-[12px] leading-[1.55] text-[color:var(--color-muted)]">
            {isLive
              ? "Talk naturally — I'll save fields as we agree on them. End any time and I'll take you to review."
              : "Setting up your microphone and connecting to OpenAI."}
          </p>
        )}
      </section>

      <div className="mt-4 grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(280px,1fr)]">
        <div
          ref={transcriptScrollRef}
          className="card flex-1 min-h-0 overflow-y-auto p-5"
        >
          <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--color-muted)]">
            Transcript
          </p>
          {transcript.length === 0 ? (
            <p className="mt-4 text-[13px] text-[color:var(--color-muted)]">
              The conversation will appear here as you speak.
            </p>
          ) : (
            <div className="mt-3 flex flex-col gap-2">
              {transcript.map((turn) => (
                <TranscriptBubble key={turn.id} turn={turn} />
              ))}
            </div>
          )}
        </div>

        <aside className="card flex flex-col p-5">
          <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--color-muted)]">
            Captured so far
          </p>
          {captured.length === 0 ? (
            <p className="mt-3 text-[13px] text-[color:var(--color-muted)]">
              Saved fields will land here as you and Grasp agree on them.
            </p>
          ) : (
            <ul className="mt-3 flex flex-1 flex-col gap-2 overflow-y-auto">
              {captured.map((event) => (
                <li
                  key={event.id}
                  className={`intake-bubble rounded-[12px] border px-3 py-2 text-[12px] ${
                    event.ok
                      ? "border-[color:var(--color-grasp)]/20 bg-[color:var(--color-grasp-soft)] text-[color:var(--color-ink-2)]"
                      : "border-amber-200 bg-amber-50 text-amber-900"
                  }`}
                >
                  <p className="font-medium">{event.label}</p>
                  {event.detail ? (
                    <p className="mt-0.5 text-[color:var(--color-muted)]">
                      {event.detail}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>
    </div>
  );
}

function MicIndicator({ status }: { status: IntakeRealtimeStatus }) {
  const live = status === "live";
  const error = status === "error";
  return (
    <div
      className={`relative flex h-16 w-16 items-center justify-center rounded-full ${
        live
          ? "bg-[color:var(--color-grasp)] text-white"
          : error
            ? "bg-red-100 text-red-700"
            : "bg-black/[0.06] text-[color:var(--color-ink-2)]"
      }`}
    >
      {live ? (
        <span
          aria-hidden
          className="absolute inset-0 animate-ping rounded-full bg-[color:var(--color-grasp)] opacity-30"
        />
      ) : null}
      <svg
        viewBox="0 0 24 24"
        className="relative h-7 w-7"
        fill="none"
        aria-hidden
      >
        <path
          d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3z"
          stroke="currentColor"
          strokeWidth="1.6"
        />
        <path
          d="M5 12a7 7 0 0 0 14 0M12 19v3"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
      </svg>
    </div>
  );
}

function TranscriptBubble({ turn }: { turn: TranscriptTurn }) {
  if (turn.role === "user") {
    return (
      <div className="intake-bubble ml-auto max-w-[78%] rounded-[16px] bg-[color:var(--color-ink)] px-3 py-2 text-[13.5px] leading-[1.55] text-white">
        {turn.text}
      </div>
    );
  }
  return (
    <div className="intake-bubble max-w-[82%] rounded-[16px] bg-white/65 px-3 py-2 text-[13.5px] leading-[1.6] text-[color:var(--color-ink-2)]">
      {turn.text || "…"}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Transcript merging — assistant deltas land into the latest streaming
// assistant bubble (creating one if needed); the final transcript replaces
// the streaming text and locks the bubble.
// ---------------------------------------------------------------------------

function mergeAssistantDelta(
  prev: TranscriptTurn[],
  delta: string,
): TranscriptTurn[] {
  const last = prev[prev.length - 1];
  if (last && last.role === "assistant" && last.status === "streaming") {
    const next = prev.slice(0, -1);
    next.push({ ...last, text: last.text + delta });
    return next;
  }
  return [
    ...prev,
    {
      id: nextTurnId("assistant"),
      role: "assistant",
      text: delta,
      status: "streaming",
    },
  ];
}

function finalizeAssistantTurn(
  prev: TranscriptTurn[],
  text: string,
): TranscriptTurn[] {
  const last = prev[prev.length - 1];
  if (last && last.role === "assistant" && last.status === "streaming") {
    const next = prev.slice(0, -1);
    next.push({ ...last, text, status: "final" });
    return next;
  }
  return [
    ...prev,
    {
      id: nextTurnId("assistant"),
      role: "assistant",
      text,
      status: "final",
    },
  ];
}

function nextTurnId(prefix: string): string {
  turnCounter += 1;
  return `${prefix}-${turnCounter}`;
}

// ---------------------------------------------------------------------------
// Tool-call → user-friendly captured-feed item.
// Returning `null` filters the call out of the feed (e.g. read_plan_state).
// ---------------------------------------------------------------------------

interface ToolCallResult {
  ok?: boolean;
  data?: unknown;
  error?: string;
}

function describeToolCall(
  name: string,
  rawArgs: unknown,
  rawResult: unknown,
): CapturedEvent | null {
  const args = (rawArgs ?? {}) as Record<string, unknown>;
  const result = (rawResult ?? {}) as ToolCallResult;
  const ok = result.ok !== false;
  const data = (result.data ?? {}) as Record<string, unknown>;
  const fail = result.error ? ` — ${result.error}` : "";

  function event(label: string, detail?: string): CapturedEvent {
    return { id: nextCaptureId(), label: ok ? label : `${label}${fail}`, detail, ok };
  }

  switch (name) {
    case "read_plan_state":
      // Pure read — don't pollute the feed.
      return null;
    case "set_brief": {
      const fields: string[] = [];
      if (typeof args.name === "string") fields.push("name");
      if (typeof args.summary === "string") fields.push("summary");
      if (typeof args.coreMechanism === "string") fields.push("key outcome");
      const detail =
        fields.length > 0 ? `Updated: ${fields.join(", ")}` : undefined;
      return event("Brief saved", detail);
    }
    case "upsert_group": {
      const groupName = typeof args.name === "string" ? args.name : "Group";
      const memberCount =
        typeof data.memberCount === "number" ? data.memberCount : null;
      const created = data.created === true;
      const verb = created ? "Created group" : "Updated group";
      const detail =
        memberCount !== null
          ? `${groupName} — ${memberCount} member${memberCount === 1 ? "" : "s"}`
          : groupName;
      const missing = Array.isArray(data.missingEmails)
        ? (data.missingEmails as string[])
        : [];
      const detailWithMissing = missing.length
        ? `${detail} (${missing.length} email${missing.length === 1 ? "" : "s"} not found)`
        : detail;
      return { id: nextCaptureId(), label: verb, detail: detailWithMissing, ok };
    }
    case "set_timing": {
      const k = typeof args.kickoffDate === "string" ? args.kickoffDate : null;
      const t = typeof args.targetDate === "string" ? args.targetDate : null;
      const detail = `Kickoff ${k ?? "—"} · Target ${t ?? "—"}`;
      return event("Timing saved", detail);
    }
    case "set_support": {
      const cadence =
        typeof args.responseCadenceHours === "number"
          ? `${args.responseCadenceHours}h cadence`
          : null;
      const sender = typeof args.sendOnBehalf === "boolean"
        ? args.sendOnBehalf
          ? "Grasp sends"
          : "Leader sends"
        : null;
      const detail = [cadence, sender].filter(Boolean).join(" · ");
      return event("Support saved", detail || undefined);
    }
    case "set_announcement":
      return event("Announcement drafted");
    case "search_employees": {
      const q = typeof args.query === "string" ? args.query : "";
      const employees = Array.isArray(data.employees)
        ? (data.employees as unknown[])
        : [];
      return event(`Searched roster for "${q}"`, `${employees.length} match${employees.length === 1 ? "" : "es"}`);
    }
    case "search_docs": {
      const q = typeof args.query === "string" ? args.query : "";
      const chunks = Array.isArray(data.chunks)
        ? (data.chunks as unknown[])
        : [];
      return event(`Searched docs for "${q}"`, `${chunks.length} excerpt${chunks.length === 1 ? "" : "s"}`);
    }
    case "done":
      return event("Marked intake complete");
    default:
      return event(name);
  }
}

function nextCaptureId(): string {
  captureCounter += 1;
  return `cap-${captureCounter}`;
}
