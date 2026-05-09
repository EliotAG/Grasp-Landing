import { constantTimeEqual } from "./constant-time";

export const SIMULATOR_ADMIN_COOKIE = "grasp_sim_admin";

const SESSION_TTL_SECONDS = 8 * 60 * 60;

interface SignedPayload {
  email: string;
  exp: number;
  nonce?: string;
}

function getAdminSecret() {
  return (
    process.env.SIMULATOR_ADMIN_SECRET?.trim() ||
    process.env.SIMULATOR_SHARED_SECRET?.trim() ||
    ""
  );
}

function bytesToBase64url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64urlToString(value: string) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(
    Math.ceil(value.length / 4) * 4,
    "=",
  );
  return atob(padded);
}

async function hmac(data: string, secret: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(data),
  );
  return bytesToBase64url(new Uint8Array(signature));
}

async function verifySignedToken(token: string): Promise<SignedPayload | null> {
  const secret = getAdminSecret();
  if (!secret) return null;
  const [encoded, signature] = token.split(".");
  if (!encoded || !signature) return null;
  const expected = await hmac(encoded, secret);
  if (!constantTimeEqual(signature, expected)) return null;

  try {
    const payload = JSON.parse(base64urlToString(encoded)) as SignedPayload;
    if (!payload.email || !payload.exp) return null;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

async function createSignedToken(payload: SignedPayload) {
  const secret = getAdminSecret();
  if (!secret) throw new Error("SIMULATOR_ADMIN_SECRET is not configured");
  const encoded = bytesToBase64url(
    new TextEncoder().encode(JSON.stringify(payload)),
  );
  return `${encoded}.${await hmac(encoded, secret)}`;
}

export async function verifySimulatorLaunchToken(token: string) {
  return verifySignedToken(token);
}

export async function createSimulatorAdminSession(email: string) {
  const now = Math.floor(Date.now() / 1000);
  const nonce = bytesToBase64url(crypto.getRandomValues(new Uint8Array(16)));
  const value = await createSignedToken({
    email: email.trim().toLowerCase(),
    exp: now + SESSION_TTL_SECONDS,
    nonce,
  });
  return {
    value,
    maxAge: SESSION_TTL_SECONDS,
  };
}

export async function verifySimulatorAdminSession(value?: string | null) {
  if (!value) return null;
  return verifySignedToken(value);
}
