import { createHmac, randomBytes } from "node:crypto";

const TOKEN_TTL_SECONDS = 10 * 60;

interface SimulatorLaunchPayload {
  email: string;
  exp: number;
  nonce: string;
}

function base64url(input: Buffer | string) {
  return Buffer.from(input).toString("base64url");
}

function signingSecret() {
  return (
    process.env.SIMULATOR_ADMIN_SECRET?.trim() ||
    process.env.SIMULATOR_SHARED_SECRET?.trim() ||
    ""
  );
}

function sign(data: string, secret: string) {
  return createHmac("sha256", secret).update(data).digest("base64url");
}

export function simulatorAdminConfigured() {
  return Boolean(process.env.NEXT_PUBLIC_SIMULATOR_URL?.trim() && signingSecret());
}

export function createSimulatorAdminLaunchUrl(email: string) {
  const simulatorUrl = process.env.NEXT_PUBLIC_SIMULATOR_URL?.trim();
  const secret = signingSecret();
  if (!simulatorUrl || !secret) return null;

  const payload: SimulatorLaunchPayload = {
    email: email.trim().toLowerCase(),
    exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS,
    nonce: randomBytes(16).toString("base64url"),
  };
  const encoded = base64url(JSON.stringify(payload));
  const token = `${encoded}.${sign(encoded, secret)}`;
  const url = new URL("/api/admin/launch", simulatorUrl);
  url.searchParams.set("token", token);
  return url.toString();
}
