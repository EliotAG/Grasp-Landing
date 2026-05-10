/**
 * Loads the Microsoft 365 Agents SDK auth configuration from env vars.
 *
 * The SDK ships two loaders:
 *   - `loadAuthConfigFromEnv`     reads `clientId` / `clientSecret` / `tenantId`
 *   - `loadPrevAuthConfigFromEnv` reads `MicrosoftAppId` / `MicrosoftAppPassword` / `MicrosoftAppTenantId`
 *
 * We standardize on the legacy Bot Framework names because that's what
 * Azure Bot Service / Entra app-registration setup walkthroughs print
 * in 2026 and what every Teams sample on Microsoft Learn uses. Easier
 * for pilot admins to follow without translating env-var names.
 */

import {
  loadPrevAuthConfigFromEnv,
  type AuthConfiguration,
} from "@microsoft/agents-hosting";
import type { TeamsCredentials } from "./integration";

let cached: AuthConfiguration | null = null;

export function getTeamsAuthConfig(): AuthConfiguration {
  if (cached) return cached;
  cached = loadPrevAuthConfigFromEnv();
  return cached;
}

export function getTeamsAuthConfigForCredentials(
  credentials: TeamsCredentials,
): AuthConfiguration {
  return {
    tenantId: credentials.tenantId,
    clientId: credentials.appId,
    clientSecret: credentials.appPassword,
    certPemFile: undefined,
    certKeyFile: undefined,
    sendX5C: false,
    connectionName: undefined,
    FICClientId: undefined,
    authority: "https://login.microsoftonline.com",
    scope: undefined,
    issuers: [
      "https://api.botframework.com",
      `https://sts.windows.net/${credentials.tenantId}/`,
      `https://login.microsoftonline.com/${credentials.tenantId}/v2.0`,
    ],
    altBlueprintConnectionName: undefined,
    WIDAssertionFile: undefined,
  };
}

export function getTeamsJwtAuthConfigForCredentials(
  credentials: TeamsCredentials,
): AuthConfiguration {
  const connection = getTeamsAuthConfigForCredentials(credentials);
  return {
    ...connection,
    connections: new Map([["serviceConnection", connection]]),
    connectionsMap: [{ serviceUrl: "*", connection: "serviceConnection" }],
  };
}

/** True iff the Teams bot env vars look populated. UI uses this to gate
 *  the integration card and avoid noisy 500s on the message endpoint. */
export function isTeamsConfigured(): boolean {
  return Boolean(process.env.MicrosoftAppId);
}
