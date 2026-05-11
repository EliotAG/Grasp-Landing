/**
 * Inline doc-progress chip rendered inside the chat thread.
 *
 * The chip is born without a `documentId` (we render it the moment the leader
 * picks a file) and then "hydrates" once the upload action returns. After
 * that, status is read straight off the live `TrainingDocument` row passed
 * down by the parent — so the parent's polling loop is the only place we
 * fetch updates, and the chip simply re-renders.
 */
import type { TrainingDocument } from "@prisma/client";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function DocProgressChip({
  filename,
  doc,
  disabled,
  onRemove,
}: {
  filename: string;
  doc: TrainingDocument | null;
  disabled: boolean;
  onRemove?: () => void;
}) {
  const status = doc?.processingStatus ?? "pending";
  const indexStatus = doc?.indexStatus ?? "pending";
  const live = status === "pending" || indexStatus === "pending";
  const failed = status === "failed" || indexStatus === "failed";

  let label: string;
  if (failed) {
    label = doc?.error || doc?.indexError || "Failed";
  } else if (status === "pending") {
    label = "Parsing…";
  } else if (indexStatus === "pending") {
    label = "Indexing…";
  } else {
    label = "Ready";
  }

  return (
    <div className="intake-bubble mx-auto flex w-full max-w-[640px] items-center gap-3 rounded-full border border-[color:var(--color-line)] bg-white/55 px-4 py-2 text-[12px]">
      <DocIcon />
      <span className="min-w-0 truncate font-medium text-[color:var(--color-ink-2)]">
        {filename}
      </span>
      {doc ? (
        <span className="shrink-0 text-[color:var(--color-muted)]">
          {formatBytes(doc.bytes)}
        </span>
      ) : null}
      <span
        className={`ml-auto inline-flex shrink-0 items-center gap-1.5 ${
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
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          disabled={disabled}
          className="text-[14px] leading-none text-[color:var(--color-muted)] hover:text-red-700"
          aria-label="Remove attachment"
        >
          ×
        </button>
      ) : null}
    </div>
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
