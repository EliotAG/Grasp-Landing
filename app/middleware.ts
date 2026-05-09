import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const PUBLIC_PATHS = new Set([
  "/",
  "/sign-in",
  "/verify",
  "/terms",
  "/privacy",
]);

const PUBLIC_PREFIXES = [
  "/api/auth",
  // Teams / Bot Framework webhook authenticates requests with its own
  // JWT validation in the route handler — the session cookie isn't
  // present on inbound calls from Azure Bot Service.
  "/api/teams",
  // Simulator webhook: messages from the standalone simulator app.
  // Authenticated by a shared-secret bearer token in the route handler;
  // no session cookie since the call originates from a separate process.
  "/api/sim",
  // Baseline survey for individual employees. Token-only auth via the
  // unguessable URL in the kickoff DM; no session cookie required (and
  // shouldn't have one — survey responses are private to the
  // employee–agent relationship per Spec.MD §"Step 3").
  "/s/",
  "/_next",
  "/fonts",
  "/favicon",
];

export default auth((req) => {
  const { pathname } = req.nextUrl;

  if (PUBLIC_PATHS.has(pathname)) return;
  if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) return;

  if (!req.auth) {
    const signInUrl = new URL("/sign-in", req.nextUrl.origin);
    signInUrl.searchParams.set("from", pathname);
    return NextResponse.redirect(signInUrl);
  }
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|fonts).*)"],
};
