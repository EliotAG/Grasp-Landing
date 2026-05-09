import type { NextConfig } from "next";

function devOriginFromEnv(): string[] {
  const raw =
    process.env.AUTH_URL?.trim() || process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (!raw) return [];
  try {
    return [new URL(raw).hostname];
  } catch {
    return [];
  }
}

const config: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  allowedDevOrigins: devOriginFromEnv(),
  // Microsoft 365 Agents SDK + jwks-rsa + MSAL pull in Node-only deps
  // (jsonwebtoken, axios + http, MSAL native lookups) that fail when
  // bundled by Turbopack. Externalize so Next requires them at runtime.
  serverExternalPackages: [
    "@microsoft/agents-hosting",
    "@microsoft/agents-activity",
    "@microsoft/agents-hosting-extensions-teams",
    "@azure/msal-node",
    "jsonwebtoken",
    "jwks-rsa",
  ],
};

export default config;
