/**
 * Auth.js (NextAuth v5) configuration.
 *
 * Providers:
 *   - Google OAuth      (enabled if AUTH_GOOGLE_ID + AUTH_GOOGLE_SECRET set)
 *   - Email 6-digit OTP (Resend in production; falls back to SMTP/console)
 *
 * The email provider issues a 6-digit code (10-minute expiry) instead of a
 * magic link. The user submits the code on /verify, which redirects to the
 * Auth.js callback URL with ?token=<code>&email=<email>; Auth.js validates
 * by hashed-comparison and creates the session.
 */

import { PrismaAdapter } from "@auth/prisma-adapter";
import NextAuth, { type DefaultSession } from "next-auth";
import Google from "next-auth/providers/google";
import Nodemailer from "next-auth/providers/nodemailer";
import nodemailer from "nodemailer";

import { prisma } from "@/lib/db";
import { isResendConfigured, sendResendEmail } from "@/lib/email/resend";

export const OTP_LENGTH = 6;
export const OTP_TTL_SECONDS = 10 * 60;

// Edge-compatible: rejection-sampled uniform integer in [0, 10**OTP_LENGTH)
// using Web Crypto. Avoids modulo bias from naïve `% 10**N` on a 32-bit int.
function generateOtp() {
  const max = 10 ** OTP_LENGTH;
  const limit = Math.floor(0xffffffff / max) * max;
  const buf = new Uint32Array(1);
  let n: number;
  do {
    crypto.getRandomValues(buf);
    n = buf[0];
  } while (n >= limit);
  return String(n % max).padStart(OTP_LENGTH, "0");
}

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      organizationId: string | null;
      organizationSlug: string | null;
      role: "owner" | "admin" | "member" | null;
      /// Closed-pilot gate, lifted from Organization.approvedAt. Null
      /// for orgs that haven't been approved by a Grasp operator yet
      /// — those workspaces can plan but cannot activate or configure
      /// integrations. Hydrated on every request in the session callback.
      organizationApprovedAt: Date | null;
    } & DefaultSession["user"];
  }
}

const hasSmtp = Boolean(
  process.env.EMAIL_SERVER_HOST &&
    process.env.EMAIL_SERVER_USER &&
    process.env.EMAIL_SERVER_PASSWORD,
);
const hasResend = isResendConfigured();

const hasGoogle = Boolean(
  process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET,
);

const emailProvider = Nodemailer({
  server: hasSmtp
    ? {
        host: process.env.EMAIL_SERVER_HOST,
        port: Number(process.env.EMAIL_SERVER_PORT ?? 587),
        auth: {
          user: process.env.EMAIL_SERVER_USER,
          pass: process.env.EMAIL_SERVER_PASSWORD,
        },
      }
    : { jsonTransport: true },
  from: process.env.EMAIL_FROM ?? "Grasp <noreply@withgrasp.com>",
  maxAge: OTP_TTL_SECONDS,
  generateVerificationToken: generateOtp,
  async sendVerificationRequest({ identifier, token, provider }) {
    const subject = `${token} is your Grasp sign-in code`;
    const text = `Your Grasp sign-in code is ${token}\n\nIt expires in ${Math.round(
      OTP_TTL_SECONDS / 60,
    )} minutes. If you didn't request this, you can ignore this email.`;
    const html = renderOtpEmail(token);
    const from = provider.from ?? "Grasp <noreply@withgrasp.com>";

    if (hasResend) {
      await sendResendEmail({
        to: identifier,
        from,
        subject,
        text,
        html,
      });
      return;
    }

    if (!hasSmtp) {
      // Dev fallback: print the OTP code so the user can sign in without
      // configuring Resend/SMTP. Never reached in production.
      console.log("\n────────────────────────────────────────────");
      console.log(`✉  Sign-in code for ${identifier}:`);
      console.log(`   ${token}`);
      console.log(`   (expires in ${Math.round(OTP_TTL_SECONDS / 60)} minutes)`);
      console.log("────────────────────────────────────────────\n");
      return;
    }
    const transporter = nodemailer.createTransport(provider.server);
    await transporter.sendMail({
      to: identifier,
      from,
      subject,
      text,
      html,
    });
  },
});

export const { handlers, signIn, signOut, auth } = NextAuth({
  adapter: PrismaAdapter(prisma),
  // Auth.js auto-detects a trusted host only on Vercel. For localhost and
  // any other environment we trust the x-forwarded-host header. Safe
  // because Vercel and Next.js dev both sit behind a single trusted proxy.
  trustHost: true,
  providers: [
    ...(hasGoogle
      ? [
          Google({
            clientId: process.env.AUTH_GOOGLE_ID!,
            clientSecret: process.env.AUTH_GOOGLE_SECRET!,
            allowDangerousEmailAccountLinking: true,
          }),
        ]
      : []),
    emailProvider,
  ],
  session: { strategy: "jwt" },
  pages: {
    signIn: "/sign-in",
    verifyRequest: "/verify",
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user?.id) token.userId = user.id;
      return token;
    },
    async session({ session, token }) {
      const userId = typeof token.userId === "string" ? token.userId : null;
      if (!userId) return session;

      // Verify the user row actually exists. With JWT sessions a cookie
      // can outlive the user it points at — most commonly when the dev
      // database is reset and an old cookie persists. Trusting the
      // stale id leads to FK violations downstream (e.g. onboarding's
      // Membership.create). Drop the auth cleanly instead so middleware
      // bounces the request to /sign-in.
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, email: true },
      });
      if (!user) {
        // Returning a session without a user.id means consumers see
        // "no session" and the user re-authenticates against the
        // current database. Cheaper than throwing; doesn't surface
        // a scary error to the browser.
        return { ...session, user: { ...session.user, id: "" } };
      }
      session.user.id = userId;

      await claimPendingInvitationForUser(user.id, user.email);

      const membership = await prisma.membership.findFirst({
        where: { userId },
        select: {
          organizationId: true,
          role: true,
          organization: { select: { slug: true, approvedAt: true } },
        },
      });

      session.user.organizationId = membership?.organizationId ?? null;
      session.user.organizationSlug = membership?.organization.slug ?? null;
      session.user.role = membership?.role ?? null;
      session.user.organizationApprovedAt =
        membership?.organization.approvedAt ?? null;
      return session;
    },
  },
});

async function claimPendingInvitationForUser(userId: string, email: string) {
  const existingMembership = await prisma.membership.findFirst({
    where: { userId },
    select: { userId: true },
  });
  if (existingMembership) return;

  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) return;

  try {
    await prisma.$transaction(async (tx) => {
      const invitation = await tx.organizationInvitation.findFirst({
        where: { email: normalizedEmail, acceptedAt: null },
        orderBy: { createdAt: "asc" },
      });
      if (!invitation) return;

      await tx.membership.create({
        data: {
          userId,
          organizationId: invitation.organizationId,
          role: invitation.role === "owner" ? "admin" : invitation.role,
        },
      });
      await tx.organizationInvitation.update({
        where: { id: invitation.id },
        data: {
          acceptedByUserId: userId,
          acceptedAt: new Date(),
        },
      });
    });
  } catch (err) {
    // Concurrent session hydration can race after the callback sets the
    // cookie. A follow-up membership read below is the source of truth.
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code?: string }).code === "P2002"
    ) {
      return;
    }
    throw err;
  }
}

function renderOtpEmail(code: string) {
  const minutes = Math.round(OTP_TTL_SECONDS / 60);
  return `<!doctype html>
<html><body style="margin:0;padding:32px;background:#FAF9F6;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#111">
  <div style="max-width:480px;margin:0 auto;background:#fff;border:1px solid rgba(0,0,0,0.06);border-radius:20px;padding:36px">
    <div style="font-family:Georgia,serif;font-size:24px;font-weight:300;letter-spacing:-0.02em;margin-bottom:8px">grasp</div>
    <h1 style="font-family:Georgia,serif;font-size:28px;font-weight:300;letter-spacing:-0.02em;margin:24px 0 12px">Your sign-in code</h1>
    <p style="color:#595959;line-height:1.6;margin:0 0 20px">Enter this code on the Grasp sign-in screen to finish signing in. It expires in ${minutes} minutes.</p>
    <div style="display:inline-block;background:#FAF9F6;border:1px solid rgba(0,0,0,0.08);border-radius:14px;padding:18px 28px;font-family:'SFMono-Regular',Menlo,Consolas,monospace;font-size:34px;font-weight:600;letter-spacing:0.32em;color:#111">${code}</div>
    <p style="color:#888;font-size:13px;line-height:1.6;margin:28px 0 0">If you didn't request this, you can safely ignore this email — no one can sign in without the code above.</p>
  </div>
</body></html>`;
}
