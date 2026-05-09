/**
 * Shared-secret auth for the Grasp <-> Simulator REST surface.
 *
 * Mirrors how Bot Framework / Teams authenticate cross-service calls
 * (in their case, signed JWTs). Here we use a single shared secret
 * because this is a local testing tool — the deployment surface is
 * "two processes on the same laptop." If you ever stand this up on a
 * shared host, swap in HMAC-signed requests + per-tenant secrets.
 */

import { constantTimeEqual } from "./constant-time";

const HEADER = "authorization";

export function getSharedSecret(): string | null {
  return process.env.SIMULATOR_SHARED_SECRET?.trim() || null;
}

export function authenticated(req: Request): boolean {
  const expected = getSharedSecret();
  if (!expected) {
    // No secret configured: refuse all cross-service traffic. UI routes
    // (which never carry a Bearer header) are exempt — see route handlers.
    return false;
  }
  const header = req.headers.get(HEADER) ?? "";
  if (!header.startsWith("Bearer ")) return false;
  const token = header.slice("Bearer ".length).trim();
  return constantTimeEqual(token, expected);
}

export function unauthorized(): Response {
  return Response.json(
    { error: "Missing or invalid Authorization bearer token" },
    { status: 401 },
  );
}
