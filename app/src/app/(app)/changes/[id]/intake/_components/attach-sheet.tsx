/**
 * Attach sheet — slides in just above the composer when the leader hits the
 * paperclip. Two tabs (Upload / Paste). Upload supports drag + click; Paste
 * mirrors the old "save context" form. The parent owns the actual mutation
 * and decides whether to keep the sheet open after success.
 */
"use client";

import { useRef, useState } from "react";

export function AttachSheet({
  onUpload,
  onPaste,
  onClose,
  disabled,
}: {
  onUpload: (file: File) => Promise<void>;
  onPaste: (input: { title: string; text: string }) => Promise<void>;
  onClose: () => void;
  disabled: boolean;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [tab, setTab] = useState<"upload" | "paste">("upload");
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [dragOver, setDragOver] = useState(false);

  return (
    <div className="intake-bubble mb-3 rounded-[16px] border border-[color:var(--color-line)] bg-white/65 p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex gap-1 rounded-full bg-black/[0.04] p-0.5 text-[12px] font-medium">
          <button
            type="button"
            onClick={() => setTab("upload")}
            className={`rounded-full px-3 py-1 transition-colors ${
              tab === "upload"
                ? "bg-white text-ink shadow-sm"
                : "text-[color:var(--color-muted)] hover:text-ink"
            }`}
          >
            Upload
          </button>
          <button
            type="button"
            onClick={() => setTab("paste")}
            className={`rounded-full px-3 py-1 transition-colors ${
              tab === "paste"
                ? "bg-white text-ink shadow-sm"
                : "text-[color:var(--color-muted)] hover:text-ink"
            }`}
          >
            Paste
          </button>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-[12px] text-[color:var(--color-muted)] hover:text-ink"
        >
          Close
        </button>
      </div>

      {tab === "upload" ? (
        <div
          className={`flex flex-col items-center justify-center gap-2 rounded-[12px] border border-dashed p-6 text-center transition-colors ${
            dragOver
              ? "border-[color:var(--color-grasp)] bg-[color:var(--color-grasp-soft)]"
              : "border-[color:var(--color-line-strong)] bg-white/40"
          }`}
          onDragOver={(event) => {
            event.preventDefault();
            event.dataTransfer.dropEffect = "copy";
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragOver(false);
            const file = event.dataTransfer.files?.[0];
            if (file) void onUpload(file);
          }}
        >
          <p className="text-[13px] text-[color:var(--color-ink-2)]">
            PDF, DOCX, Markdown, or text. Drop one here or choose a file.
          </p>
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            accept="application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/markdown,text/x-markdown,text/plain,.pdf,.docx,.md,.markdown,.txt"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void onUpload(file);
              if (fileInputRef.current) fileInputRef.current.value = "";
            }}
          />
          <button
            type="button"
            className="btn btn-secondary text-[12px]"
            onClick={() => fileInputRef.current?.click()}
            disabled={disabled}
          >
            Choose file
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <input
            className="input"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Optional title"
          />
          <textarea
            className="input min-h-[120px]"
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="Paste meeting notes, rollout context, or a rough brief..."
          />
          <div className="flex justify-end">
            <button
              type="button"
              className="btn btn-primary text-[13px]"
              disabled={disabled || text.trim().length < 20}
              onClick={() => {
                void onPaste({ title, text }).then(() => {
                  setTitle("");
                  setText("");
                });
              }}
            >
              Save context
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
