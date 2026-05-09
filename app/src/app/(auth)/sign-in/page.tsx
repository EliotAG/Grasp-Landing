import Link from "next/link";
import { redirect } from "next/navigation";
import { signIn } from "@/lib/auth";

const hasGoogle = Boolean(
  process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET,
);

export const metadata = { title: "Sign in" };

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; error?: string }>;
}) {
  const { from, error } = await searchParams;

  return (
    <main className="mx-auto flex min-h-screen max-w-[440px] flex-col px-6 pt-[104px] pb-12">
      <div className="flex flex-1 flex-col justify-center">
        <div className="card p-9">
          <span className="pill mb-5">
            <span className="pill-dot" />
            Early access
          </span>
          <h1 className="serif text-[34px] leading-[1.1] mb-2">
            Sign in to <span className="italic font-normal">Grasp</span>
          </h1>
          <p className="text-[15px] text-[color:var(--color-muted)] mb-7 leading-[1.6]">
            Run process changes that actually land. Plan, communicate, and
            close the loop with your team.
          </p>

          {error ? (
            <div className="mb-5 rounded-xl border border-red-200/70 bg-red-50/70 px-4 py-3 text-[13px] text-red-700">
              {error === "OAuthAccountNotLinked"
                ? "An account with this email already exists. Try signing in with your original method."
                : error === "email"
                  ? "We couldn't send your code. Please double-check the address and try again."
                  : "Something went wrong. Please try again."}
            </div>
          ) : null}

          {hasGoogle ? (
            <>
              <form
                action={async () => {
                  "use server";
                  await signIn("google", { redirectTo: from ?? "/dashboard" });
                }}
              >
                <button type="submit" className="btn btn-secondary w-full">
                  <GoogleGlyph />
                  Continue with Google
                </button>
              </form>
              <div className="my-6 flex items-center gap-3 text-[11px] uppercase tracking-[0.1em] text-[color:var(--color-muted)]">
                <div className="h-px flex-1 bg-[color:var(--color-line)]" />
                or
                <div className="h-px flex-1 bg-[color:var(--color-line)]" />
              </div>
            </>
          ) : null}

          <form
            action={async (formData) => {
              "use server";
              const email = String(formData.get("email") ?? "")
                .trim()
                .toLowerCase();
              if (!email) return;
              try {
                await signIn("nodemailer", { email, redirect: false });
              } catch (err) {
                // `redirect()` throws a NEXT_REDIRECT error — let that bubble.
                if (
                  err &&
                  typeof err === "object" &&
                  "digest" in err &&
                  String((err as { digest?: string }).digest).startsWith(
                    "NEXT_REDIRECT",
                  )
                ) {
                  throw err;
                }
                console.error("[signIn nodemailer] failed to send code:", err);
                redirect(
                  `/sign-in?error=email${
                    from ? `&from=${encodeURIComponent(from)}` : ""
                  }`,
                );
              }
              redirect(
                `/verify?email=${encodeURIComponent(email)}${
                  from ? `&from=${encodeURIComponent(from)}` : ""
                }`,
              );
            }}
            className="space-y-3"
          >
            <div>
              <label htmlFor="email" className="label">
                Work email
              </label>
              <input
                id="email"
                name="email"
                type="email"
                required
                autoComplete="email"
                placeholder="you@company.com"
                className="input"
              />
            </div>
            <button type="submit" className="btn btn-primary w-full">
              Email me a sign-in code
            </button>
          </form>

          <p className="mt-6 text-[12px] leading-[1.6] text-[color:var(--color-muted)]">
            By continuing you agree to our{" "}
            <Link
              href="/terms"
              className="text-ink underline decoration-[color:var(--color-line-strong)] underline-offset-2 hover:decoration-ink"
            >
              Terms of Service
            </Link>{" "}
            &amp;{" "}
            <Link
              href="/privacy"
              className="text-ink underline decoration-[color:var(--color-line-strong)] underline-offset-2 hover:decoration-ink"
            >
              Privacy Policy
            </Link>
            .
          </p>
        </div>
      </div>

      <div className="text-center text-[12px] text-[color:var(--color-muted)]">
        Need help? Text{" "}
        <a
          href="sms:8325707361&body=Hey, I need help with Grasp, the problem is:"
          className="text-ink no-underline font-semibold"
        >
          (832) 570-7361
        </a>
      </div>
    </main>
  );
}

function GoogleGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" aria-hidden>
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.75h3.57c2.08-1.92 3.28-4.74 3.28-8.07z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.75c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.12a6.6 6.6 0 0 1 0-4.24V7.04H2.18a11 11 0 0 0 0 9.92l3.66-2.84z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.04l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z"
      />
    </svg>
  );
}
