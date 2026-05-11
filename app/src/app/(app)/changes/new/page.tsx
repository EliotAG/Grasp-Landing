import Link from "next/link";
import { createChangePlan } from "../actions";

export const metadata = { title: "New change plan" };

export default function NewChangePlan() {
  return (
    <div className="mx-auto max-w-[640px] space-y-8">
      <Link
        href="/changes"
        className="text-[13px] text-[color:var(--color-muted)] hover:text-ink"
      >
        ← Back to change plans
      </Link>

      <div className="pt-3">
        <p className="text-[12px] font-semibold uppercase tracking-[0.1em] text-[color:var(--color-muted)]">
          New plan
        </p>
        <h1 className="serif mt-1 text-[40px] leading-[1.05]">
          What are you <span className="italic font-normal">rolling out</span>?
        </h1>
        <p className="mt-3 text-[15px] leading-[1.65] text-[color:var(--color-muted)]">
          Just enough to start. The wizard will help you specify behaviors per
          stakeholder group, score the announcement, and produce a complete
          change plan. Drafts save automatically and you can come back any
          time.
        </p>
      </div>

      <form action={createChangePlan} className="card space-y-5 p-7">
        <div>
          <label htmlFor="name" className="label">
            Working title
          </label>
          <input
            id="name"
            name="name"
            autoFocus
            placeholder="e.g. Salesforce CRM rollout"
            className="input"
          />
        </div>

        <div>
          <label htmlFor="summary" className="label">
            Plain-language summary
          </label>
          <textarea
            id="summary"
            name="summary"
            rows={4}
            placeholder="In a few sentences, what's actually changing for the team? You'll be able to refine this on the next screen."
            className="input"
          />
          <p className="mt-1.5 text-[12px] text-[color:var(--color-muted)]">
            Optional. Helps Grasp suggest stakeholder groups and behaviors on
            the next steps.
          </p>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-[color:var(--color-line)] pt-5">
          <p className="text-[12px] text-[color:var(--color-muted)]">
            Saved as a draft. You can leave at any time and resume.
          </p>
          <button type="submit" className="btn btn-primary">
            Start wizard →
          </button>
        </div>
      </form>
    </div>
  );
}
