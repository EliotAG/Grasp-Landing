/**
 * Singleton CloudAdapter for the Teams bot.
 *
 * One adapter per process. The adapter holds the MSAL connection
 * manager (token cache, JWKS client) so re-creating it on every
 * request would defeat caching and burn rate-limit budget against
 * Entra. Cached on globalThis to survive Next.js HMR re-imports.
 */

import { CloudAdapter } from "@microsoft/agents-hosting";
import type { AuthConfiguration } from "@microsoft/agents-hosting";

import { getTeamsAuthConfig } from "./auth-config";

const globalForAdapter = globalThis as unknown as {
  teamsAdapter: CloudAdapter | undefined;
  teamsAdaptersByAppId: Map<string, CloudAdapter> | undefined;
};

export function getTeamsAdapter(): CloudAdapter {
  if (globalForAdapter.teamsAdapter) return globalForAdapter.teamsAdapter;
  const adapter = createTeamsAdapter(getTeamsAuthConfig());
  globalForAdapter.teamsAdapter = adapter;
  return adapter;
}

export function getTeamsAdapterForAuthConfig(
  authConfig: AuthConfiguration,
): CloudAdapter {
  const appId = authConfig.clientId ?? "unknown";
  const key = `${authConfig.tenantId ?? "unknown"}:${appId}`;
  globalForAdapter.teamsAdaptersByAppId ??= new Map();
  const cached = globalForAdapter.teamsAdaptersByAppId.get(key);
  if (cached) return cached;

  const adapter = createTeamsAdapter(authConfig);
  globalForAdapter.teamsAdaptersByAppId.set(key, adapter);
  return adapter;
}

function createTeamsAdapter(authConfig: AuthConfiguration): CloudAdapter {
  const adapter = new CloudAdapter(authConfig);
  // Surface adapter-level errors centrally; per-turn errors propagate
  // to the route handler which logs and returns 500.
  adapter.onTurnError = async (_context, error) => {
    console.error("[teams] adapter turn error:", error);
  };
  return adapter;
}
