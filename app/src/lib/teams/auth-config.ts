/**
 * Builds the Microsoft 365 Agents SDK `AuthConfiguration` for a given
 * organization's Teams credentials.
 *
 * We deliberately do NOT use the SDK's `loadAuthConfigFromEnv` /
 * `loadPrevAuthConfigFromEnv` loaders — Teams app credentials live
 * per-organization in the database, not in `process.env`. Loading
 * from env would either pin every workspace to one app, or throw
 * "ClientId required in production" when the env isn't set.
 *
 * Two flavors are needed because the SDK uses the same type
 * differently in two places:
 *   - `getTeamsAuthConfigForCredentials` returns a flat config used
 *     when constructing a `CloudAdapter`. The adapter's
 *     `getAuthConfigWithDefaults` is happy with a customConfig that
 *     has `clientId`/`clientSecret`/`tenantId` set directly.
 *   - `getTeamsJwtAuthConfigForCredentials` wraps the same config
 *     in a `connections` Map, which the `authorizeJWT` middleware
 *     needs in order to look up the matching connection by
 *     audience (`config.connections.find(c => c.clientId === aud)`).
 */

import type { AuthConfiguration } from "@microsoft/agents-hosting";
import type { TeamsCredentials } from "./integration";

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
