import { after } from "next/server";
import { notFound } from "next/navigation";
import Link from "next/link";

import { prisma } from "@/lib/db";
import { Logo } from "@/components/logo";
import { BaselineSurveyForm } from "./form";
import { markSurveyOpened } from "./actions";

export const metadata = {
  title: "Baseline survey",
  robots: { index: false, follow: false },
};

export default async function BaselineSurveyPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const enrollment = await prisma.changeEnrollment.findUnique({
    where: { surveyToken: token },
    include: {
      employee: { select: { name: true, email: true } },
      changePlan: {
        select: { name: true, organization: { select: { name: true } } },
      },
    },
  });

  if (!enrollment) notFound();

  // Move the row from not_started -> in_progress on first GET so the
  // leadership status panel reflects "they opened it" without waiting
  // for the submit. Run AFTER the response is sent so the survey
  // renders instantly and Next 16's "no cache mutations during render"
  // rule isn't violated by the underlying DB write. Idempotent, the
  // function bails out if the status isn't `not_started`.
  after(() => {
    markSurveyOpened(token).catch((err) => {
      console.error("[survey] markSurveyOpened failed:", err);
    });
  });

  if (enrollment.surveyStatus === "completed") {
    return (
      <div className="mx-auto max-w-[640px] px-6 py-16">
        <Logo href="/" />
        <div className="card mt-10 p-10 text-center">
          <h1 className="serif text-[32px] leading-[1.1]">Thanks{enrollment.employee.name ? `, ${enrollment.employee.name.split(" ")[0]}` : ""}.</h1>
          <p className="mt-4 text-[15px] leading-[1.7] text-[color:var(--color-muted)]">
            Your answers are in. They stay between you and the agent. They
            shape how I check in with you over the rollout, and never go to
            leadership as individual data.
          </p>
          <p className="mt-6 text-[14px] text-[color:var(--color-muted-2)]">
            You can close this tab. I&rsquo;ll be in touch in Teams.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[640px] px-6 pt-12 pb-24">
      <Logo href="/" />

      <header className="mt-10">
        <p className="text-[12px] font-semibold uppercase tracking-[0.1em] text-[color:var(--color-muted)]">
          {enrollment.changePlan.organization.name} ·{" "}
          {enrollment.changePlan.name}
        </p>
        <h1 className="serif mt-2 text-[40px] leading-[1.05]">
          A quick baseline.
        </h1>
        <p className="mt-4 text-[15px] leading-[1.7] text-[color:var(--color-muted)]">
          About three minutes. Your answers help me tailor how I check in with
          you over the next month.{" "}
          <strong className="font-semibold text-ink">
            What you say here stays between you and me.
          </strong>{" "}
          Leadership sees aggregate patterns, not your individual answers.
        </p>
      </header>

      <div className="mt-10">
        <BaselineSurveyForm token={token} />
      </div>

      <p className="mt-12 text-center text-[12px] text-[color:var(--color-muted-2)]">
        <Link href="/privacy" className="underline-offset-2 hover:underline">
          How we handle this data
        </Link>
      </p>
    </div>
  );
}
