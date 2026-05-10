/**
 * CloudAdapter management for the Teams bot.
 *
 * The Microsoft 365 Agents SDK ties one CloudAdapter to a single set
 * of (clientId, clientSecret, tenantId) credentials — that's what
 * the underlying MSAL client uses to fetch outbound tokens. Because
 * we want per-organization Teams configs, we keep a Map of adapters
 * keyed by tenant+app id. Each adapter holds an MSAL connection
 * manager (token cache, JWKS client), so re-creating per request
 * would defeat caching and burn through Entra rate-limit budget.
 *
 * The map lives on globalThis so it survives Next.js HMR reloads
 * during local dev.
 */

import { CloudAdapter } from "@microsoft/agents-hosting";
import type { AuthConfiguration } from "@microsoft/agents-hosting";

const globalForAdapter = globalThis as unknown as {
  teamsAdaptersByAppId: Map<string, CloudAdapter> | undefined;
  teamsPlaceholderAdapter: CloudAdapter | undefined;
};

export function getTeamsAdapterForAuthConfig(
  authConfig: AuthConfiguration,
): CloudAdapter {
  const appId = authConfig.clientId ?? "unknown";
  const key = `${authConfig.tenantId ?? "unknown"}:${appId}`;
  globalForAdapter.teamsAdaptersByAppId ??= new Map();
  const cached = globalForAdapter.teamsAdaptersByAppId.get(key);
  if (cached) return cached;

  if (!authConfig.clientId || !authConfig.clientSecret || !authConfig.tenantId) {
    throw new Error(
      "Teams DB auth config is missing app id, app password, or tenant id.",
    );
  }

  const adapter = new CloudAdapter(authConfig);
  // Surface adapter-level errors centrally; per-turn errors propagate
  // to the route handler which logs and returns 500.
  adapter.onTurnError = async (_context, error) => {
    console.error("[teams] adapter turn error:", error);
  };
  globalForAdapter.teamsAdaptersByAppId.set(key, adapter);
  return adapter;
}

/**
 * AgentApplication's constructor will instantiate its own CloudAdapter
 * with no args if you don't pass one — and that path reads `clientId`
 * out of `process.env`, which throws "ClientId required in production"
 * because we don't ship app credentials via env any more (each org
 * brings its own from the database).
 *
 * We never call `agent.continueConversation` or wire up authorization
 * on the agent, so the adapter on the agent is effectively unused.
 * Returning a CloudAdapter built from harmless placeholder credentials
 * satisfies the constructor without leaking any secrets or hitting
 * Entra. The real per-org adapter created by `getTeamsAdapterForAuthConfig`
 * is what actually services every incoming activity.
 */
export function getTeamsPlaceholderAdapter(): CloudAdapter {
  if (globalForAdapter.teamsPlaceholderAdapter) {
    return globalForAdapter.teamsPlaceholderAdapter;
  }
  const adapter = new CloudAdapter({
    clientId: "00000000-0000-0000-0000-000000000000",
    clientSecret: "placeholder-not-used",
    tenantId: "common",
    authority: "https://login.microsoftonline.com",
    issuers: ["https://api.botframework.com"],
  } as AuthConfiguration);
  adapter.onTurnError = async (_context, error) => {
    console.error("[teams] placeholder adapter turn error:", error);
  };
  globalForAdapter.teamsPlaceholderAdapter = adapter;
  return adapter;
}
