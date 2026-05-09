"use client";

import { useRef, useState, useTransition } from "react";
import { deleteTrainingDoc, uploadTrainingDoc } from "../actions";
import { StepNav } from "./step-nav";
import type { WizardPlan } from "./types";

const ACCEPTED =
  "application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/markdown,text/x-markdown,text/plain,.pdf,.docx,.md,.markdown,.txt";

function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

export function MaterialsStep({
  plan,
  showNav = true,
}: {
  plan: WizardPlan;
  showNav?: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startUpload] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  function onFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setError(null);
    const file = files[0];
    const fd = new FormData();
    fd.append("file", file);
    startUpload(async () => {
      const result = await uploadTrainingDoc(plan.id, fd);
      if (!result.ok) setError(result.error ?? "Upload failed");
      if (inputRef.current) inputRef.current.value = "";
    });
  }

  return (
    <div className="space-y-6">
      <div
        className="card flex flex-col items-center justify-center gap-3 border-dashed p-10 text-center"
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
        }}
        onDrop={(e) => {
          e.preventDefault();
          onFiles(e.dataTransfer.files);
        }}
      >
        <p className="text-[15px]">
          Drop SOPs, FAQs, or policy docs here, or click to choose.
        </p>
        <p className="text-[12px] text-[color:var(--color-muted)]">
          PDF, DOCX, or Markdown. Max 25 MB. Stored only for this change.
        </p>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED}
          className="hidden"
          onChange={(e) => onFiles(e.target.files)}
        />
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => inputRef.current?.click()}
          disabled={pending}
        >
          {pending ? "Uploading…" : "Choose file"}
        </button>
        {error ? (
          <p className="text-[12px] text-red-700">{error}</p>
        ) : null}
      </div>

      {plan.trainingDocuments.length > 0 ? (
        <ul className="card divide-y divide-[color:var(--color-line)]">
          {plan.trainingDocuments.map((doc) => (
            <li
              key={doc.id}
              className="flex items-center justify-between gap-4 p-4"
            >
              <div className="min-w-0">
                <p className="truncate text-[14px] font-medium">
                  {doc.filename}
                </p>
                <p className="text-[11px] text-[color:var(--color-muted)]">
                  {formatBytes(doc.bytes)}
                  {doc.pageCount ? ` · ${doc.pageCount} pages` : ""} ·{" "}
                  <StatusPill status={doc.processingStatus} />
                  {doc.error ? ` · ${doc.error}` : ""}
                </p>
              </div>
              <DeleteButton planId={plan.id} docId={doc.id} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[12px] text-[color:var(--color-muted)]">
          No training docs yet. This step is optional. The agent will only
          answer Q&amp;A from documents you upload here, scoped to this
          change.
        </p>
      )}

      {showNav ? <StepNav changePlanId={plan.id} step="support" /> : null}
    </div>
  );
}

function StatusPill({
  status,
}: {
  status: WizardPlan["trainingDocuments"][number]["processingStatus"];
}) {
  if (status === "parsed")
    return (
      <span className="text-[color:var(--color-grasp)]">parsed</span>
    );
  if (status === "failed") return <span className="text-red-700">failed</span>;
  return <span className="text-amber-700">parsing…</span>;
}

function DeleteButton({ planId, docId }: { planId: string; docId: string }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      onClick={() =>
        start(async () => {
          await deleteTrainingDoc(planId, docId);
        })
      }
      disabled={pending}
      className="text-[12px] text-[color:var(--color-muted)] hover:text-red-700"
    >
      {pending ? "Removing…" : "Remove"}
    </button>
  );
}
