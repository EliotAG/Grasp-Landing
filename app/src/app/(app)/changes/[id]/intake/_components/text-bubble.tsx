/**
 * Plain text chat bubble. Three roles: assistant, user, system.
 * System rows render as a thin centered pill so transcript noise (uploads,
 * applied confirmations) does not compete with conversational turns.
 */

export function TextBubble({
  role,
  text,
  status,
}: {
  role: "assistant" | "user" | "system";
  text: string;
  status?: string;
}) {
  if (role === "system") {
    return (
      <div className="intake-bubble mx-auto rounded-full border border-[color:var(--color-line)] bg-white/40 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.08em] text-[color:var(--color-muted)]">
        {text}
      </div>
    );
  }

  const isUser = role === "user";
  return (
    <div
      className={
        isUser
          ? "intake-bubble ml-auto max-w-[78%] rounded-[18px] bg-[color:var(--color-ink)] px-4 py-3 text-[14px] leading-[1.6] text-white"
          : "intake-bubble max-w-[78%] rounded-[18px] bg-white/65 px-4 py-3 text-[14px] leading-[1.65] text-[color:var(--color-ink-2)]"
      }
    >
      {status ? (
        <p
          className={`mb-1 text-[10px] font-semibold uppercase tracking-[0.08em] ${
            isUser ? "text-white/70" : "text-[color:var(--color-grasp)]"
          }`}
        >
          {status}
        </p>
      ) : null}
      <p className="whitespace-pre-wrap">{text}</p>
    </div>
  );
}
