/**
 * Composer — sticky textarea + send + paperclip + two quick-action chips
 * (Summarize docs, Draft groups + announcement). The chips are intentionally
 * subordinate to the chat; they only light up when their precondition holds
 * (parsed docs available / a written summary exists).
 */
"use client";

import { useState } from "react";

import { AttachSheet } from "./attach-sheet";

export function Composer({
  onSend,
  onUpload,
  onPaste,
  onSummarize,
  onSuggest,
  canSummarize,
  canSuggest,
  disabled,
}: {
  onSend: (text: string) => void | Promise<void>;
  onUpload: (file: File) => Promise<void>;
  onPaste: (input: { title: string; text: string }) => Promise<void>;
  onSummarize: () => void;
  onSuggest: () => void;
  canSummarize: boolean;
  canSuggest: boolean;
  disabled: boolean;
}) {
  const [text, setText] = useState("");
  const [attachOpen, setAttachOpen] = useState(false);

  function send() {
    const trimmed = text.trim();
    if (!trimmed) return;
    setText("");
    void onSend(trimmed);
  }

  return (
    <div className="mt-3 card p-3">
      {attachOpen ? (
        <AttachSheet
          disabled={disabled}
          onClose={() => setAttachOpen(false)}
          onUpload={async (file) => {
            await onUpload(file);
            setAttachOpen(false);
          }}
          onPaste={async (input) => {
            await onPaste(input);
            setAttachOpen(false);
          }}
        />
      ) : null}

      <div className="flex items-end gap-2">
        <button
          type="button"
          aria-label={attachOpen ? "Close attach panel" : "Attach context"}
          aria-expanded={attachOpen}
          onClick={() => setAttachOpen((open) => !open)}
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[color:var(--color-muted)] transition-colors hover:bg-black/[0.05] hover:text-ink ${
            attachOpen ? "bg-black/[0.06] text-ink" : ""
          }`}
        >
          <PaperclipIcon />
        </button>
        <textarea
          rows={1}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              send();
            }
          }}
          placeholder="Tell Grasp what's changing, ask for a draft, or refine a suggestion."
          className="input min-h-[44px] flex-1 resize-none py-2.5"
          disabled={disabled}
        />
        <button
          type="button"
          onClick={send}
          disabled={disabled || !text.trim()}
          className="btn btn-primary self-stretch px-5 text-[13px]"
        >
          Send
        </button>
      </div>

      <div className="mt-2 flex flex-wrap gap-2 px-1 text-[12px]">
        <button
          type="button"
          onClick={onSummarize}
          disabled={disabled || !canSummarize}
          title={
            canSummarize
              ? undefined
              : "Add a doc or paste context to enable a summary."
          }
          className="rounded-full border border-[color:var(--color-line-strong)] bg-white/55 px-3 py-1 text-[color:var(--color-muted)] transition-colors hover:bg-white/85 hover:text-ink disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-white/55 disabled:hover:text-[color:var(--color-muted)]"
        >
          Summarize attached docs
        </button>
        <button
          type="button"
          onClick={onSuggest}
          disabled={disabled || !canSuggest}
          title={
            canSuggest
              ? undefined
              : "Apply a summary first so I have something to build on."
          }
          className="rounded-full border border-[color:var(--color-line-strong)] bg-white/55 px-3 py-1 text-[color:var(--color-muted)] transition-colors hover:bg-white/85 hover:text-ink disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-white/55 disabled:hover:text-[color:var(--color-muted)]"
        >
          Draft groups + announcement
        </button>
      </div>
    </div>
  );
}

function PaperclipIcon() {
  return (
    <svg
      viewBox="0 0 18 18"
      className="h-[18px] w-[18px]"
      fill="none"
      aria-hidden
    >
      <path
        d="M12.5 7.5 7 13a3 3 0 0 1-4.2-4.2l6-6a2 2 0 0 1 2.8 2.8l-5.4 5.4a1 1 0 0 1-1.4-1.4L9.5 5"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
