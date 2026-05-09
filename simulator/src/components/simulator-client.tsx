"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";

export interface ThreadRow {
  email: string;
  name: string;
  title: string | null;
  photoUrl: string | null;
  lastMessage: {
    text: string;
    from: "bot" | "user";
    kind: "message" | "kickoff" | "system";
    createdAt: string;
  } | null;
}

export interface Message {
  id: string;
  from: "bot" | "user";
  kind: "message" | "kickoff" | "system";
  text: string;
  createdAt: string;
}

interface ActiveUser {
  email: string;
  name: string;
  title: string | null;
  photoUrl: string | null;
}

export function SimulatorClient({
  initialRows,
  activeEmail,
  activeUser,
  initialMessages,
}: {
  initialRows: ThreadRow[];
  activeEmail: string | null;
  activeUser: ActiveUser | null;
  initialMessages: Message[];
}) {
  const [rows, setRows] = useState(initialRows);
  const [active, setActive] = useState<ActiveUser | null>(activeUser);
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [draft, setDraft] = useState("");
  const [search, setSearch] = useState("");
  const [showAddUser, setShowAddUser] = useState(false);
  const [deliveryHint, setDeliveryHint] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const scrollerRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);

  // Poll for new bot messages every 2s while a thread is open. The bot
  // (Grasp) replies asynchronously via POST /api/messages, so the UI
  // wouldn't otherwise see those without a refresh.
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const [threadsRes, msgsRes] = await Promise.all([
          fetch("/api/threads", { cache: "no-store" }),
          fetch(`/api/threads/${encodeURIComponent(active.email)}`, {
            cache: "no-store",
          }),
        ]);
        if (cancelled) return;
        if (threadsRes.ok) {
          const data = (await threadsRes.json()) as { users: ThreadRow[] };
          setRows(sortRows(data.users));
        }
        if (msgsRes.ok) {
          const data = (await msgsRes.json()) as { messages: Message[] };
          setMessages(data.messages);
        }
      } catch {}
    };
    const id = setInterval(tick, 2000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [active]);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [active?.email, messages.length]);

  useEffect(() => {
    composerRef.current?.focus();
  }, [active?.email]);

  const filteredRows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter(
      (r) =>
        r.email.includes(needle) ||
        r.name.toLowerCase().includes(needle) ||
        (r.title?.toLowerCase().includes(needle) ?? false),
    );
  }, [rows, search]);

  async function selectUser(email: string) {
    const row = rows.find((r) => r.email === email);
    if (!row) return;
    setActive({
      email: row.email,
      name: row.name,
      title: row.title,
      photoUrl: row.photoUrl,
    });
    setMessages([]);
    setDeliveryHint(null);
    history.replaceState(
      null,
      "",
      `/?as=${encodeURIComponent(email)}`,
    );
    try {
      const res = await fetch(`/api/threads/${encodeURIComponent(email)}`, {
        cache: "no-store",
      });
      if (res.ok) {
        const data = (await res.json()) as { messages: Message[] };
        setMessages(data.messages);
      }
    } catch {}
  }

  async function send() {
    const text = draft.trim();
    if (!text || !active || isPending) return;
    setDraft("");
    setDeliveryHint(null);

    // Optimistic insertion so the bubble appears immediately.
    const optimistic: Message = {
      id: `optimistic-${Date.now()}`,
      from: "user",
      kind: "message",
      text,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimistic]);

    startTransition(async () => {
      try {
        const res = await fetch(
          `/api/threads/${encodeURIComponent(active.email)}/reply`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ text }),
          },
        );
        const data = (await res.json()) as {
          message: Message;
          delivery: { ok: boolean; status?: number; error?: string };
        };
        // Swap optimistic for the canonical row from the server.
        setMessages((prev) =>
          prev.map((m) => (m.id === optimistic.id ? data.message : m)),
        );
        if (!data.delivery.ok) {
          setDeliveryHint(
            data.delivery.error ??
              "Grasp webhook didn't accept this message — agent won't reply.",
          );
        }
      } catch (err) {
        setDeliveryHint(
          err instanceof Error ? err.message : "Failed to reach simulator API",
        );
      }
    });
  }

  async function clearThread() {
    if (!active) return;
    if (!confirm(`Clear the thread with ${active.name}?`)) return;
    await fetch(`/api/threads/${encodeURIComponent(active.email)}/clear`, {
      method: "POST",
    });
    setMessages([]);
  }

  async function addUser(input: {
    email: string;
    name: string;
    title: string;
  }) {
    const res = await fetch("/api/users", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: input.email,
        name: input.name,
        title: input.title || null,
        photoUrl: null,
      }),
    });
    if (!res.ok) {
      alert((await res.text()) || "Failed to add user");
      return;
    }
    setShowAddUser(false);
    const refreshed = await fetch("/api/threads", { cache: "no-store" });
    if (refreshed.ok) {
      const data = (await refreshed.json()) as { users: ThreadRow[] };
      setRows(sortRows(data.users));
    }
    selectUser(input.email.toLowerCase());
  }

  return (
    <div className="flex h-screen flex-col">
      <Topbar onAddUser={() => setShowAddUser(true)} />
      <div className="grid flex-1 grid-cols-1 overflow-hidden md:grid-cols-[300px_1fr]">
        <Sidebar
          rows={filteredRows}
          activeEmail={active?.email ?? activeEmail ?? null}
          search={search}
          onSearch={setSearch}
          onSelect={selectUser}
        />
        {active ? (
          <ChatPane
            user={active}
            messages={messages}
            draft={draft}
            onDraft={setDraft}
            onSend={send}
            onClear={clearThread}
            isSending={isPending}
            deliveryHint={deliveryHint}
            scrollerRef={scrollerRef}
            composerRef={composerRef}
          />
        ) : (
          <EmptyMain onAddUser={() => setShowAddUser(true)} />
        )}
      </div>
      {showAddUser ? (
        <AddUserModal
          onCancel={() => setShowAddUser(false)}
          onSubmit={addUser}
        />
      ) : null}
    </div>
  );
}

function sortRows(rows: ThreadRow[]): ThreadRow[] {
  return rows.slice().sort((a, b) => {
    const ta = a.lastMessage?.createdAt ?? "";
    const tb = b.lastMessage?.createdAt ?? "";
    if (ta && tb) return tb.localeCompare(ta);
    if (ta) return -1;
    if (tb) return 1;
    return a.name.localeCompare(b.name);
  });
}

function Avatar({
  name,
  email,
  photoUrl,
  className,
}: {
  name: string;
  email: string;
  photoUrl?: string | null;
  className?: string;
}) {
  const fallbackUrl = officeAvatarUrl(name || email);

  return (
    <span
      aria-hidden
      className={`relative flex shrink-0 overflow-hidden rounded-full bg-[color:var(--color-teams-soft)] ring-1 ring-black/10 ${className ?? ""}`}
    >
      <img
        src={fallbackUrl}
        alt=""
        className="absolute inset-0 h-full w-full object-cover"
      />
      {photoUrl ? (
        <img
          src={photoUrl}
          alt=""
          className="relative h-full w-full object-cover"
          onError={(event) => {
            event.currentTarget.style.display = "none";
          }}
        />
      ) : null}
    </span>
  );
}

function officeAvatarUrl(seed: string): string {
  const encoded = encodeURIComponent(`dunder-mifflin-${seed}`);
  return `https://api.dicebear.com/9.x/notionists/svg?seed=${encoded}&radius=50&backgroundColor=f1f4f9,dde7f0,f8e7d1,e6f0dc`;
}

function GraspLogo() {
  return (
    <div
      className="flex items-center gap-2"
      aria-label="Grasp"
    >
      <svg viewBox="0 0 64 64" fill="none" className="h-8 w-8">
        <path
          d="M32 56C32 56 30 44 31 36C32 28 32 24 32 24"
          stroke="#2E7D32"
          strokeWidth="3.5"
          strokeLinecap="round"
          fill="none"
        />
        <path
          d="M32 28C34 22 40 12 54 6C52 14 46 26 32 28Z"
          fill="#4CAF50"
        />
        <path
          d="M32 28C36 20 44 12 54 6"
          stroke="#2E7D32"
          strokeWidth="1.2"
          fill="none"
          opacity="0.3"
        />
        <path
          d="M31 36C28 30 20 20 8 14C10 24 20 34 31 36Z"
          fill="#2E7D32"
        />
        <path
          d="M31 36C26 28 18 20 8 14"
          stroke="#2E7D32"
          strokeWidth="1.2"
          fill="none"
          opacity="0.2"
        />
      </svg>
      <span
        className="text-[22px] font-normal leading-none text-[color:var(--color-ink)]"
        style={{ fontFamily: 'Georgia, "Times New Roman", serif' }}
      >
        grasp
      </span>
    </div>
  );
}

function Topbar({ onAddUser }: { onAddUser: () => void }) {
  return (
    <header className="flex shrink-0 items-center justify-between border-b border-[color:var(--color-line)] bg-white px-5 py-3">
      <div className="flex items-center gap-3">
        <GraspLogo />
        <div className="leading-tight">
          <p className="text-[14px] font-semibold text-[color:var(--color-ink)]">
            Grasp Simulator
          </p>
          <p className="text-[10.5px] uppercase tracking-[0.1em] text-[color:var(--color-muted-2)]">
            Standalone test harness
          </p>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onAddUser}
          className="rounded-full bg-[color:var(--color-teams)] px-3.5 py-1.5 text-[12px] font-medium text-white transition-colors hover:bg-[color:var(--color-teams-hover)]"
        >
          + Add user
        </button>
      </div>
    </header>
  );
}

function Sidebar({
  rows,
  activeEmail,
  search,
  onSearch,
  onSelect,
}: {
  rows: ThreadRow[];
  activeEmail: string | null;
  search: string;
  onSearch: (s: string) => void;
  onSelect: (email: string) => void;
}) {
  return (
    <aside
      aria-label="Conversations"
      className="flex min-h-0 flex-col overflow-hidden border-r border-[color:var(--color-line)] bg-white"
    >
      <div className="shrink-0 border-b border-[color:var(--color-line)] px-3 py-3">
        <input
          type="search"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Search people"
          className="w-full rounded-full border border-[color:var(--color-line)] bg-[color:var(--color-canvas)] px-3.5 py-2 text-[13px] text-[color:var(--color-ink)] placeholder:text-[color:var(--color-muted-2)] focus:border-[color:var(--color-line-strong)] focus:outline-none"
        />
      </div>
      <ul className="flex-1 overflow-y-auto p-1.5">
        {rows.length === 0 ? (
          <li className="px-3 py-10 text-center text-[13px] text-[color:var(--color-muted)]">
            <p className="font-medium text-[color:var(--color-ink)]">
              No users yet
            </p>
            <p className="mt-1.5 text-[12.5px]">
              Grasp will register users automatically when it sends a DM, or
              add one with the button up top.
            </p>
          </li>
        ) : (
          rows.map((r) => {
            const isActive = r.email === activeEmail;
            return (
              <li key={r.email}>
                <button
                  type="button"
                  onClick={() => onSelect(r.email)}
                  aria-current={isActive ? "true" : undefined}
                  className={`group flex w-full items-start gap-3 rounded-xl px-2.5 py-2.5 text-left transition-colors ${
                    isActive
                      ? "bg-[color:var(--color-teams-soft)]"
                      : "hover:bg-black/[0.025]"
                  }`}
                >
                  <Avatar
                    name={r.name}
                    email={r.email}
                    photoUrl={r.photoUrl}
                    className="mt-0.5 h-9 w-9"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-[13.5px] font-medium text-[color:var(--color-ink)]">
                        {r.name || r.email}
                      </span>
                      {r.lastMessage ? (
                        <span className="shrink-0 text-[11px] text-[color:var(--color-muted-2)]">
                          {formatRelative(r.lastMessage.createdAt)}
                        </span>
                      ) : null}
                    </span>
                    <span className="mt-0.5 block truncate text-[12.5px] text-[color:var(--color-muted)]">
                      {r.lastMessage ? (
                        <>
                          {r.lastMessage.from === "bot" ? (
                            <span className="text-[color:var(--color-muted-2)]">
                              Grasp:{" "}
                            </span>
                          ) : null}
                          {previewMessage(r.lastMessage)}
                        </>
                      ) : (
                        <span className="italic text-[color:var(--color-muted-2)]">
                          {r.title ?? "No messages yet"}
                        </span>
                      )}
                    </span>
                  </span>
                </button>
              </li>
            );
          })
        )}
      </ul>
    </aside>
  );
}

function ChatPane({
  user,
  messages,
  draft,
  onDraft,
  onSend,
  onClear,
  isSending,
  deliveryHint,
  scrollerRef,
  composerRef,
}: {
  user: ActiveUser;
  messages: Message[];
  draft: string;
  onDraft: (s: string) => void;
  onSend: () => void;
  onClear: () => void;
  isSending: boolean;
  deliveryHint: string | null;
  scrollerRef: React.RefObject<HTMLDivElement | null>;
  composerRef: React.RefObject<HTMLTextAreaElement | null>;
}) {
  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden bg-white">
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-[color:var(--color-line)] px-6 py-3">
        <div className="flex items-center gap-3">
          <Avatar
            name={user.name}
            email={user.email}
            photoUrl={user.photoUrl}
            className="h-9 w-9"
          />
          <div className="min-w-0">
            <p className="truncate text-[14.5px] font-semibold text-[color:var(--color-ink)]">
              {user.name || user.email}
            </p>
            <p className="truncate text-[12px] text-[color:var(--color-muted)]">
              {user.title ? `${user.title} · ` : ""}
              {user.email}
            </p>
          </div>
        </div>
        {messages.length > 0 ? (
          <button
            type="button"
            onClick={onClear}
            className="rounded-full px-2.5 py-1 text-[11.5px] text-[color:var(--color-muted)] hover:bg-black/[0.045] hover:text-[color:var(--color-ink)]"
          >
            Clear
          </button>
        ) : null}
      </header>

      <div
        ref={scrollerRef}
        className="flex-1 overflow-y-auto bg-[color:var(--color-canvas)] px-6 py-6"
        role="log"
        aria-live="polite"
        aria-relevant="additions"
      >
        {messages.length === 0 ? (
          <div className="flex h-full items-center justify-center text-center text-[13.5px] text-[color:var(--color-muted)]">
            <div className="max-w-sm">
              <p className="text-[16px] font-medium text-[color:var(--color-ink)]">
                No messages yet
              </p>
              <p className="mt-2">
                Type below to send as {user.name?.split(" ")[0] || "this user"},
                or have Grasp send to{" "}
                <span className="font-mono text-[12px]">{user.email}</span>.
              </p>
            </div>
          </div>
        ) : (
          <ol className="mx-auto max-w-3xl space-y-2">
            {messages.map((m, i) => {
              const prev = messages[i - 1];
              const showStamp =
                !prev ||
                new Date(m.createdAt).getTime() -
                  new Date(prev.createdAt).getTime() >
                  10 * 60 * 1000;
              return (
                <li key={m.id} className="space-y-1">
                  {showStamp ? (
                    <div className="my-3 text-center text-[11px] text-[color:var(--color-muted-2)]">
                      {formatStamp(m.createdAt)}
                    </div>
                  ) : null}
                  <Bubble message={m} />
                </li>
              );
            })}
          </ol>
        )}
      </div>

      {deliveryHint ? (
        <div
          className="shrink-0 border-t border-amber-200 bg-amber-50 px-6 py-2 text-[12px] text-amber-800"
          role="status"
        >
          ⚠ {deliveryHint}
        </div>
      ) : null}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSend();
        }}
        className="shrink-0 border-t border-[color:var(--color-line)] bg-white px-4 py-3"
      >
        <div className="mx-auto max-w-3xl">
          <div className="flex items-end gap-2 rounded-2xl border border-[color:var(--color-line)] bg-white px-3 py-2 focus-within:border-[color:var(--color-line-strong)]">
            <textarea
              ref={composerRef}
              value={draft}
              onChange={(e) => onDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  onSend();
                }
              }}
              rows={1}
              placeholder={`Message as ${user.name?.split(" ")[0] || "this user"}…`}
              className="max-h-40 min-h-[24px] flex-1 resize-none bg-transparent text-[14px] text-[color:var(--color-ink)] placeholder:text-[color:var(--color-muted-2)] focus:outline-none"
            />
            <button
              type="submit"
              disabled={isSending || !draft.trim()}
              aria-label="Send"
              className="flex h-8 w-8 items-center justify-center rounded-full bg-[color:var(--color-teams)] text-white transition-opacity hover:opacity-90 disabled:opacity-30"
            >
              <SendIcon />
            </button>
          </div>
          <p className="mt-1.5 px-1 text-[11px] text-[color:var(--color-muted-2)]">
            Sending as {user.name || user.email} · Shift+Enter for newline
          </p>
        </div>
      </form>
    </section>
  );
}

function Bubble({ message }: { message: Message }) {
  const fromBot = message.from === "bot";
  const isKickoff = message.kind === "kickoff";
  const surveyCta =
    fromBot && isKickoff ? extractSurveyCta(message.text) : null;
  const bodyText = surveyCta?.bodyText ?? message.text;
  return (
    <div className={`flex ${fromBot ? "justify-start" : "justify-end"}`}>
      <div
        className={`max-w-[78%] rounded-2xl px-3.5 py-2.5 text-[14px] leading-[1.45] shadow-sm ${
          fromBot
            ? "rounded-bl-md bg-white text-[color:var(--color-ink)] ring-1 ring-[color:var(--color-line)]"
            : "rounded-br-md bg-[color:var(--color-teams)] text-white"
        }`}
      >
        {isKickoff && fromBot ? (
          <div className="mb-1.5 inline-flex items-center gap-1.5 rounded-full bg-amber-100/70 px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-amber-800">
            Kickoff DM
          </div>
        ) : null}
        {bodyText ? <BodyWithLinks text={bodyText} fromBot={fromBot} /> : null}
        {surveyCta ? <SurveyCtaCard url={surveyCta.url} /> : null}
      </div>
    </div>
  );
}

function previewMessage(message: ThreadRow["lastMessage"]): string {
  if (!message) return "";
  const surveyCta =
    message.from === "bot" && message.kind === "kickoff"
      ? extractSurveyCta(message.text)
      : null;
  if (!surveyCta) return message.text.replace(/\s+/g, " ");
  const prefix = surveyCta.bodyText.replace(/\s+/g, " ").trim();
  return `${prefix}${prefix ? " " : ""}[Baseline survey card]`;
}

function extractSurveyCta(
  text: string,
): { bodyText: string; url: string } | null {
  const lines = text.split("\n");
  const surveyLineIndex = lines.findIndex((line) => {
    const trimmed = line.trim();
    return /^https?:\/\/[^\s)]+$/.test(trimmed) && isSurveyUrl(trimmed);
  });
  if (surveyLineIndex === -1) return null;

  const bodyLines = lines.filter((_, index) => index !== surveyLineIndex);
  while (bodyLines.length > 0 && bodyLines[bodyLines.length - 1].trim() === "") {
    bodyLines.pop();
  }

  return {
    bodyText: bodyLines.join("\n"),
    url: lines[surveyLineIndex].trim(),
  };
}

function isSurveyUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return /^\/s\/[^/]+\/?$/.test(url.pathname);
  } catch {
    return false;
  }
}

function SurveyCtaCard({ url }: { url: string }) {
  return (
    <div className="mt-3 overflow-hidden rounded-xl border border-[color:var(--color-line)] bg-white shadow-sm">
      <div className="border-l-4 border-[color:var(--color-teams)] px-4 py-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[color:var(--color-muted-2)]">
          Grasp survey
        </p>
        <h3 className="mt-1 text-[14px] font-semibold text-[color:var(--color-ink)]">
          Baseline survey
        </h3>
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-[color:var(--color-muted)]">
          Help Grasp tailor future check-ins to how you work. It takes about 3
          minutes.
        </p>
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="mt-3 inline-flex items-center rounded-md bg-[color:var(--color-teams)] px-3 py-1.5 text-[12.5px] font-semibold text-white shadow-sm transition-opacity hover:opacity-90"
        >
          Open survey
        </a>
      </div>
    </div>
  );
}

function BodyWithLinks({
  text,
  fromBot,
}: {
  text: string;
  fromBot: boolean;
}) {
  const lines = text.split("\n");
  return (
    <div className="whitespace-pre-wrap break-words">
      {lines.map((line, i) => (
        <div key={i}>{linkify(line, fromBot)}</div>
      ))}
    </div>
  );
}

function linkify(line: string, fromBot: boolean) {
  const re = /(https?:\/\/[^\s)]+)/g;
  const parts: Array<string | { url: string }> = [];
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(line))) {
    if (match.index > last) parts.push(line.slice(last, match.index));
    parts.push({ url: match[1] });
    last = match.index + match[1].length;
  }
  if (last < line.length) parts.push(line.slice(last));
  if (parts.length === 0) return line || "\u00A0";
  return parts.map((p, i) =>
    typeof p === "string" ? (
      <span key={i}>{p}</span>
    ) : (
      <a
        key={i}
        href={p.url}
        target="_blank"
        rel="noreferrer"
        className={`underline underline-offset-2 ${
          fromBot ? "text-[color:var(--color-teams)]" : "text-white"
        }`}
      >
        {p.url}
      </a>
    ),
  );
}

function EmptyMain({ onAddUser }: { onAddUser: () => void }) {
  return (
    <div className="flex flex-1 items-center justify-center bg-[color:var(--color-canvas)] px-6">
      <div className="max-w-md rounded-2xl border border-[color:var(--color-line)] bg-white p-8 text-center shadow-sm">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-[color:var(--color-teams-soft)] text-[color:var(--color-teams)]">
          <ChatIcon />
        </div>
        <h2 className="text-[18px] font-semibold text-[color:var(--color-ink)]">
          No conversations yet
        </h2>
        <p className="mt-2 text-[13.5px] text-[color:var(--color-muted)]">
          Activate a change plan in Grasp to start receiving kickoff DMs here,
          or add a test user to manually send the first inbound message.
        </p>
        <button
          type="button"
          onClick={onAddUser}
          className="mt-5 inline-flex items-center rounded-full bg-[color:var(--color-teams)] px-4 py-2 text-[13px] font-medium text-white"
        >
          + Add a user
        </button>
      </div>
    </div>
  );
}

function AddUserModal({
  onCancel,
  onSubmit,
}: {
  onCancel: () => void;
  onSubmit: (input: { email: string; name: string; title: string }) => void;
}) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  return (
    <div
      role="dialog"
      aria-modal
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-[16px] font-semibold text-[color:var(--color-ink)]">
          Add a simulated user
        </h2>
        <p className="mt-1.5 text-[12.5px] text-[color:var(--color-muted)]">
          Use the same email Grasp has for this person — that's how the agent
          matches inbound messages back to an employee record.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!email.trim() || !name.trim()) return;
            onSubmit({
              email: email.trim().toLowerCase(),
              name: name.trim(),
              title: title.trim(),
            });
          }}
          className="mt-5 space-y-3"
        >
          <Field label="Email">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoFocus
              required
              placeholder="alice@acme.com"
              className="w-full rounded-lg border border-[color:var(--color-line)] bg-white px-3 py-2 text-[13.5px] focus:border-[color:var(--color-line-strong)] focus:outline-none"
            />
          </Field>
          <Field label="Name">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              placeholder="Alice Chen"
              className="w-full rounded-lg border border-[color:var(--color-line)] bg-white px-3 py-2 text-[13.5px] focus:border-[color:var(--color-line-strong)] focus:outline-none"
            />
          </Field>
          <Field label="Title (optional)">
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="VP Engineering"
              className="w-full rounded-lg border border-[color:var(--color-line)] bg-white px-3 py-2 text-[13.5px] focus:border-[color:var(--color-line-strong)] focus:outline-none"
            />
          </Field>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onCancel}
              className="rounded-full px-3.5 py-1.5 text-[12.5px] text-[color:var(--color-muted)] hover:bg-black/[0.045]"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="rounded-full bg-[color:var(--color-teams)] px-3.5 py-1.5 text-[12.5px] font-medium text-white hover:bg-[color:var(--color-teams-hover)]"
            >
              Add user
            </button>
          </div>
        </form>
      </div>
    </div>
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
    <label className="block">
      <span className="mb-1 block text-[11.5px] font-semibold uppercase tracking-[0.08em] text-[color:var(--color-muted-2)]">
        {label}
      </span>
      {children}
    </label>
  );
}

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

function formatRelative(input: string): string {
  const date = new Date(input);
  const diff = Date.now() - date.getTime();
  if (diff < MIN) return "now";
  if (diff < HOUR) return `${Math.floor(diff / MIN)}m`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)}h`;
  if (diff < 7 * DAY) {
    return date.toLocaleDateString(undefined, { weekday: "short" });
  }
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatStamp(input: string): string {
  const date = new Date(input);
  const diff = Date.now() - date.getTime();
  if (diff < DAY) {
    return date.toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    });
  }
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function SendIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" className="h-4 w-4">
      <path
        d="M2.5 8h11M9 3.5 13.5 8 9 12.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ChatIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-6 w-6">
      <path
        d="M5 5h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-9l-5 4v-4H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
    </svg>
  );
}
