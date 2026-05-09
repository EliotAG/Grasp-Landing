import { redirect } from "next/navigation";
import { MarketingNav } from "@/components/marketing-nav";
import { auth, signOut } from "@/lib/auth";
import { createOrganization } from "./actions";

export const metadata = { title: "Set up your workspace" };

const marketingUrl =
  process.env.NEXT_PUBLIC_MARKETING_URL ??
  (process.env.NODE_ENV === "development"
    ? "http://localhost:5173"
    : "https://www.withgrasp.com");

export default async function Onboarding() {
  const session = await auth();
  if (!session?.user) redirect("/sign-in");
  if (session.user.organizationId) redirect("/dashboard");

  return (
    <>
      <MarketingNav
        logoHref={marketingUrl}
        right={
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/sign-in" });
            }}
          >
            <button
              type="submit"
              style={{
                fontFamily: "var(--font-sans)",
                fontSize: 13,
                fontWeight: 500,
                color: "#111",
                letterSpacing: "-0.005em",
                background: "transparent",
                border: "none",
                cursor: "pointer",
                padding: "6px 2px",
              }}
            >
              Sign out
            </button>
          </form>
        }
      />

      <main className="mx-auto flex min-h-screen max-w-[520px] flex-col px-6 pt-[104px] pb-12">
        <div className="flex flex-1 flex-col justify-center">
          <span className="pill mb-5 self-start">
            <span className="pill-dot" />
            Step 1 of 1
          </span>
          <h1 className="serif text-[40px] leading-[1.05]">
            Name your <span className="italic font-normal">workspace</span>.
          </h1>
          <p className="mt-3 text-[15px] leading-[1.65] text-[color:var(--color-muted)]">
            You&rsquo;ll be the owner and can invite others later. The workspace
            is where you&rsquo;ll upload the org chart, draft change plans,
            review what employees are telling Grasp, and watch rollouts happen.
          </p>

          <form action={createOrganization} className="card mt-7 space-y-4 p-7">
            <div>
              <label htmlFor="name" className="label">
                Company name
              </label>
              <input
                id="name"
                name="name"
                required
                autoFocus
                autoComplete="organization"
                placeholder="e.g. Unified Communications"
                className="input"
              />
            </div>
            <button type="submit" className="btn btn-primary w-full">
              Create workspace
            </button>
          </form>
        </div>

        <div className="text-center text-[12px] text-[color:var(--color-muted)]">
          Have a problem?{" "}
          <a
            href="sms:8325707361&body=Hey, I need help with Grasp, the problem is:"
            className="text-ink no-underline font-semibold"
          >
            Text us
          </a>
        </div>
      </main>
    </>
  );
}
