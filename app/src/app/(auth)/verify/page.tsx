import Link from "next/link";
import { redirect } from "next/navigation";
import { OtpInput } from "@/components/otp-input";
import { OTP_LENGTH } from "@/lib/auth";

export const metadata = { title: "Enter your code" };

export default async function VerifyPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string; from?: string; error?: string }>;
}) {
  const { email = "", from, error } = await searchParams;

  if (!email) redirect("/sign-in");

  const callbackUrl = from && from.startsWith("/") ? from : "/dashboard";

  return (
    <main className="mx-auto flex min-h-screen max-w-[440px] flex-col px-6 pt-[104px] pb-12">
      <div className="flex flex-1 flex-col justify-center">
        <div className="card p-9">
          <span className="pill mb-5">
            <span className="pill-dot" />
            Check your inbox
          </span>
          <h1 className="serif text-[32px] leading-[1.1] mb-2">
            Enter your sign-in code
          </h1>
          <p className="text-[15px] text-[color:var(--color-muted)] mb-7 leading-[1.6]">
            We sent a {OTP_LENGTH}-digit code to{" "}
            <span className="font-semibold text-ink">{email}</span>. It expires
            in 10 minutes.
          </p>

          {error ? (
            <div className="mb-5 rounded-xl border border-red-200/70 bg-red-50/70 px-4 py-3 text-[13px] text-red-700">
              {error === "Verification" || error === "invalid"
                ? "That code didn't match or has expired. Send a fresh one and try again."
                : "Something went wrong. Please request a new code."}
            </div>
          ) : null}

          {/*
            Plain GET form straight to the Auth.js callback. The browser does
            a true document navigation, so the Set-Cookie returned by the
            callback's 302 is honored before the next request to /dashboard.
            (A server-action redirect into /api/* goes through the RSC client
            and the cookie can be dropped on the way.)
          */}
          <form
            method="GET"
            action="/api/auth/callback/nodemailer"
            className="space-y-4"
          >
            <input type="hidden" name="email" value={email} />
            <input type="hidden" name="callbackUrl" value={callbackUrl} />
            <OtpInput
              length={OTP_LENGTH}
              name="token"
              hasError={Boolean(error)}
            />
            <button type="submit" className="btn btn-primary w-full">
              Verify &amp; sign in
            </button>
          </form>

          <p className="mt-6 text-[12px] leading-[1.6] text-[color:var(--color-muted)]">
            Didn&rsquo;t get it? Check spam, or{" "}
            <Link
              href={`/sign-in${
                from ? `?from=${encodeURIComponent(from)}` : ""
              }`}
              className="text-ink underline decoration-[color:var(--color-line-strong)] underline-offset-2 hover:decoration-ink"
            >
              send a new code
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
