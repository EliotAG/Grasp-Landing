import Link from "next/link";
import { ORG_CHART_CSV_TEMPLATE } from "@/lib/csv";
import { uploadOrgChart } from "./actions";
import { UploadForm } from "./form";

export const metadata = { title: "Upload org chart" };

export default function UploadOrgChart() {
  const templateDataUri =
    "data:text/csv;charset=utf-8," + encodeURIComponent(ORG_CHART_CSV_TEMPLATE);

  return (
    <div className="mx-auto max-w-[640px] space-y-8">
      <div className="flex items-center gap-3">
        <Link
          href="/org-chart"
          className="text-[13px] text-[color:var(--color-muted)] hover:text-ink"
        >
          ← Back to org chart
        </Link>
      </div>

      <div>
        <p className="text-[12px] font-semibold uppercase tracking-[0.1em] text-[color:var(--color-muted)]">
          One-time onboarding · Step 1
        </p>
        <h1 className="serif mt-1 text-[40px] leading-[1.05]">
          Upload your <span className="italic font-normal">org chart</span>.
        </h1>
        <p className="mt-3 text-[15px] leading-[1.65] text-[color:var(--color-muted)]">
          The org chart is ground truth for the agent: who reports to whom,
          how to reach each person on Teams or Zoom, and how to draw
          stakeholder groups for a rollout. Replacing the file replaces all
          existing employees.
        </p>
      </div>

      <div className="card p-7">
        <h2 className="text-[14px] font-semibold mb-2">Required format</h2>
        <p className="text-[13px] text-[color:var(--color-muted)] mb-4 leading-[1.65]">
          UTF-8 CSV with a header row. Required columns:{" "}
          <code className="font-mono text-[12px] bg-black/5 px-1.5 py-0.5 rounded">
            name
          </code>{" "}
          and{" "}
          <code className="font-mono text-[12px] bg-black/5 px-1.5 py-0.5 rounded">
            email
          </code>
          . Optional:{" "}
          <code className="font-mono text-[12px] bg-black/5 px-1.5 py-0.5 rounded">
            title
          </code>
          ,{" "}
          <code className="font-mono text-[12px] bg-black/5 px-1.5 py-0.5 rounded">
            team
          </code>
          ,{" "}
          <code className="font-mono text-[12px] bg-black/5 px-1.5 py-0.5 rounded">
            manager_email
          </code>
          .
        </p>
        <a
          href={templateDataUri}
          download="grasp-org-chart-template.csv"
          className="text-[13px] font-semibold text-[color:var(--color-grasp)] hover:underline"
        >
          Download CSV template
        </a>
      </div>

      <UploadForm action={uploadOrgChart} />
    </div>
  );
}
