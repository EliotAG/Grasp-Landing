"use client";

import { useFormStatus } from "react-dom";
import { useRef, useState } from "react";

type UploadResult = {
  ok: boolean;
  inserted?: number;
  errors?: { row: number; message: string }[];
  message?: string;
};

export function UploadForm({
  action,
}: {
  action: (formData: FormData) => Promise<UploadResult>;
}) {
  const [result, setResult] = useState<UploadResult | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <form
      action={async (formData) => {
        const res = await action(formData);
        setResult(res);
      }}
      className="card p-7 space-y-5"
    >
      <div>
        <label className="label" htmlFor="file">
          CSV file
        </label>
        <label
          htmlFor="file"
          className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-[color:var(--color-line-strong)] bg-white/40 px-6 py-10 text-center transition-colors hover:border-[color:var(--color-grasp)] hover:bg-white/60"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            className="h-8 w-8 text-[color:var(--color-muted)]"
          >
            <path
              d="M12 16V4m0 0l-4 4m4-4l4 4M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <p className="text-[14px] font-medium text-ink">
            {fileName ?? "Click to choose a CSV file"}
          </p>
          <p className="text-[12px] text-[color:var(--color-muted)]">
            Up to ~10,000 employees · UTF-8 with header row
          </p>
          <input
            ref={inputRef}
            id="file"
            name="file"
            type="file"
            accept=".csv,text/csv"
            required
            className="hidden"
            onChange={(e) => {
              setFileName(e.target.files?.[0]?.name ?? null);
              setResult(null);
            }}
          />
        </label>
      </div>

      {result && !result.ok ? (
        <div className="rounded-xl border border-red-200/70 bg-red-50/70 px-4 py-3 text-[13px] text-red-700">
          <p className="font-semibold">Upload failed</p>
          <p>{result.message ?? "Please check the file format."}</p>
        </div>
      ) : null}

      {result?.ok && (result.errors?.length ?? 0) > 0 ? (
        <div className="rounded-xl border border-amber-200/70 bg-amber-50/70 px-4 py-3 text-[13px] text-amber-800">
          <p className="font-semibold">
            Imported {result.inserted} {result.inserted === 1 ? "row" : "rows"}{" "}
            with {result.errors!.length}{" "}
            {result.errors!.length === 1 ? "issue" : "issues"}
          </p>
          <ul className="mt-1 list-disc pl-5">
            {result.errors!.slice(0, 6).map((e, i) => (
              <li key={i}>
                Row {e.row}: {e.message}
              </li>
            ))}
            {result.errors!.length > 6 ? (
              <li>… and {result.errors!.length - 6} more</li>
            ) : null}
          </ul>
        </div>
      ) : null}

      {result?.ok && (result.errors?.length ?? 0) === 0 ? (
        <div className="rounded-xl border border-emerald-200/70 bg-emerald-50/70 px-4 py-3 text-[13px] text-emerald-800">
          Imported {result.inserted}{" "}
          {result.inserted === 1 ? "person" : "people"}.
        </div>
      ) : null}

      <Submit />
    </form>
  );
}

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="btn btn-primary w-full">
      {pending ? "Uploading…" : "Upload org chart"}
    </button>
  );
}
