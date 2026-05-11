/**
 * Upload step — phase 1 of the intake.
 *
 * The leader drops in any context they have (PDF / DOCX / Markdown / a
 * pasted brief) and then hits "Start voice intake" to move on. Parsing
 * happens on upload; we poll while at least one doc is still pending so the
 * status chips update without the leader having to refresh.
 */
"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { TrainingDocument } from "@prisma/client";

import {
  deletePlannerContextAction,
  pastePlannerContextAction,
  uploadPlannerContextAction,
} from "../actions";

const POLL_INTERVAL_MS = 2500;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function UploadStep({
  planId,
  trainingDocuments,
  onContinue,
}: {
  planId: string;
  trainingDocuments: TrainingDocument[];
  onContinue: () => void;
}) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [pasteText, setPasteText] = useState("");
  const [pasteTitle, setPasteTitle] = useState("");
  const [dragOver, setDragOver] = useState(false);

  // Live status: poll only while something is still being processed.
  useEffect(() => {
    const hasPending = trainingDocuments.some(
      (doc) =>
        doc.processingStatus === "pending" || doc.indexStatus === "pending",
    );
    if (!hasPending) return;
    const handle = setInterval(() => router.refresh(), POLL_INTERVAL_MS);
    return () => clearInterval(handle);
  }, [trainingDocuments, router]);

  function handleUpload(file: File | undefined | null) {
    if (!file) return;
    setError(null);
    startTransition(async () => {
      const formData = new FormData();
      formData.append("file", file);
      const result = await uploadPlannerContextAction(planId, formData);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      if (fileInputRef.current) fileInputRef.current.value = "";
      router.refresh();
    });
  }

  function handlePaste() {
    const text = pasteText.trim();
    if (text.length < 20) return;
    setError(null);
    startTransition(async () => {
      const result = await pastePlannerContextAction(planId, {
        title: pasteTitle.trim() || undefined,
        text,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setPasteText("");
      setPasteTitle("");
      router.refresh();
    });
  }

  function handleDelete(documentId: string) {
    setError(null);
    startTransition(async () => {
      const result = await deletePlannerContextAction(planId, documentId);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  const hasParsedContext = trainingDocuments.some(
    (doc) => doc.processingStatus === "parsed",
  );
  const allReady = trainingDocuments.every(
    (doc) =>
      doc.processingStatus !== "pending" && doc.indexStatus !== "pending",
  );
  const continueLabel = trainingDocuments.length === 0
    ? "Start voice intake without docs"
    : allReady
      ? "Start voice intake"
      : "Start voice intake (parsing will continue)";

  return (
    <div className="space-y-6">
      <header>
        <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[color:var(--color-muted)]">
          Step 1 — Drop in context
        </p>
        <h1 className="serif mt-1 max-w-[640px] text-[36px] leading-[1.05]">
          Bring whatever you&rsquo;ve already got. I&rsquo;ll read it before we
          talk.
        </h1>
        <p className="mt-3 max-w-[640px] text-[14px] leading-[1.6] text-[color:var(--color-muted)]">
          Drop in SOPs, briefs, meeting notes, or paste in a quick description.
          You&rsquo;ll move into a short voice conversation next where
          I&rsquo;ll ask only about what&rsquo;s still missing.
        </p>
      </header>

      {error ? (
        <div
          role="alert"
          className="rounded-card border border-red-200 bg-red-50 p-3 text-[13px] text-red-800"
        >
          {error}
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <div
          className={`card flex min-h-[220px] flex-col items-center justify-center gap-3 border-dashed p-6 text-center transition-colors ${
            dragOver
              ? "border-[color:var(--color-grasp)] bg-[color:var(--color-grasp-soft)]"
              : ""
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
            handleUpload(event.dataTransfer.files?.[0]);
          }}
        >
          <p className="text-[13px] text-[color:var(--color-ink-2)]">
            Drag & drop a file here.
          </p>
          <p className="text-[12px] text-[color:var(--color-muted)]">
            PDF, DOCX, Markdown, or text. 25 MB max.
          </p>
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            accept="application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/markdown,text/x-markdown,text/plain,.pdf,.docx,.md,.markdown,.txt"
            onChange={(event) => handleUpload(event.target.files?.[0])}
          />
          <button
            type="button"
            className="btn btn-secondary text-[12px]"
            disabled={pending}
            onClick={() => fileInputRef.current?.click()}
          >
            Choose file
          </button>
        </div>

        <div className="card flex flex-col gap-2 p-4">
          <p className="text-[13px] font-semibold">Paste a brief or notes</p>
          <input
            className="input"
            placeholder="Optional title"
            value={pasteTitle}
            onChange={(event) => setPasteTitle(event.target.value)}
          />
          <textarea
            className="input min-h-[140px] flex-1"
            placeholder="What's changing? Who needs to do something differently? Any context already written down…"
            value={pasteText}
            onChange={(event) => setPasteText(event.target.value)}
          />
          <div className="flex justify-end">
            <button
              type="button"
              className="btn btn-primary text-[13px]"
              disabled={pending || pasteText.trim().length < 20}
              onClick={handlePaste}
            >
              Save context
            </button>
          </div>
        </div>
      </div>

      {trainingDocuments.length > 0 ? (
        <section className="card p-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[color:var(--color-muted)]">
            Context on file
          </p>
          <ul className="mt-3 space-y-2">
            {trainingDocuments.map((doc) => (
              <DocRow
                key={doc.id}
                doc={doc}
                disabled={pending}
                onDelete={() => handleDelete(doc.id)}
              />
            ))}
          </ul>
        </section>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[color:var(--color-line)] pt-5">
        <p className="text-[12px] text-[color:var(--color-muted)]">
          {trainingDocuments.length === 0
            ? "No docs yet — that's okay. The voice agent can still walk you through it from a blank slate."
            : hasParsedContext
              ? "I'll skim what's parsed and bring it into the voice conversation."
              : "I'll wait for parsing in the background."}
        </p>
        <button
          type="button"
          className="btn btn-primary"
          disabled={pending}
          onClick={onContinue}
        >
          {continueLabel}
        </button>
      </div>
    </div>
  );
}

function DocRow({
  doc,
  disabled,
  onDelete,
}: {
  doc: TrainingDocument;
  disabled: boolean;
  onDelete: () => void;
}) {
  const live =
    doc.processingStatus === "pending" || doc.indexStatus === "pending";
  const failed =
    doc.processingStatus === "failed" || doc.indexStatus === "failed";

  let label: string;
  if (failed) {
    label = doc.error || doc.indexError || "Failed";
  } else if (doc.processingStatus === "pending") {
    label = "Parsing…";
  } else if (doc.indexStatus === "pending") {
    label = "Indexing…";
  } else {
    label = "Ready";
  }

  return (
    <li className="flex items-center gap-3 rounded-[12px] border border-[color:var(--color-line)] bg-white/45 px-3 py-2 text-[13px]">
      <DocIcon />
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-[color:var(--color-ink-2)]">
          {doc.filename}
        </p>
        <p className="text-[11px] text-[color:var(--color-muted)]">
          {formatBytes(doc.bytes)}
        </p>
      </div>
      <span
        className={`inline-flex items-center gap-1.5 text-[11px] font-medium ${
          failed
            ? "text-red-700"
            : live
              ? "text-[color:var(--color-muted)]"
              : "text-[color:var(--color-grasp)]"
        }`}
      >
        {live ? (
          <span className="intake-thinking-dot inline-block h-1.5 w-1.5 rounded-full bg-current" />
        ) : null}
        {label}
      </span>
      <button
        type="button"
        onClick={onDelete}
        disabled={disabled}
        className="text-[14px] leading-none text-[color:var(--color-muted)] hover:text-red-700"
        aria-label="Remove"
      >
        ×
      </button>
    </li>
  );
}

function DocIcon() {
  return (
    <svg
      viewBox="0 0 18 18"
      className="h-[14px] w-[14px] shrink-0 text-[color:var(--color-muted)]"
      fill="none"
      aria-hidden
    >
      <path
        d="M4 2.5h6.5L14 6v9.5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-12a1 1 0 0 1 1-1Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path
        d="M10 2.5V6h4"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}
