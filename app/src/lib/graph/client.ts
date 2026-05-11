/**
 * Microsoft Graph client (application token).
 *
 * Two responsibilities live here:
 *
 *  1. **Teams app bootstrap** — used by [src/lib/teams/bootstrap.ts]
 *     to look up tenant users, install the Grasp Teams app per-user,
 *     and resolve their personal-chat conversation. Permissions:
 *       - User.Read.All
 *       - TeamsAppInstallation.ReadWriteForUser.All
 *       - AppCatalog.Read.All (for the org app catalog lookup)
 *       - Chat.ReadBasic.All
 *
 *  2. **Voice kickoff** — creates a unique online Teams meeting per
 *     enrollment and sends a real Outlook calendar invite with the
 *     join URL. Permissions:
 *       - OnlineMeetings.ReadWrite.All  (PLUS a Teams Application
 *         Access Policy granting this app id permission to act on
 *         behalf of the relevant users — see the env docs)
 *       - Calendars.ReadWrite
 *
 * Token cache is in-process: client_credentials returns a token with
 * a ~60min lifetime; we hold it in a module-level Map keyed by tenant
 * id and refresh ~60s before expiry. On dev hot-reload the cache
 * resets, which is fine.
 */

const GRAPH_BASE_URL = "https://graph.microsoft.com/v1.0";
const TOKEN_REFRESH_BUFFER_SECONDS = 60;

interface CachedToken {
  accessToken: string;
  /** Unix epoch seconds when the token expires. We refresh `BUFFER` early. */
  expiresAt: number;
}

const tokenCache = new Map<string, CachedToken>();

export class GraphClientError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null,
    readonly raw: unknown,
  ) {
    super(message);
    this.name = "GraphClientError";
  }
}

/** Backwards-compat alias for the voice module's import. */
export const GraphError = GraphClientError;
export type GraphError = GraphClientError;

export interface TeamsAppCredentials {
  appId: string;
  appPassword: string;
  tenantId: string;
}

function readCredentials(): TeamsAppCredentials | null {
  const appId = process.env.MicrosoftAppId?.trim();
  const appPassword = process.env.MicrosoftAppPassword?.trim();
  const tenantId = process.env.MicrosoftAppTenantId?.trim();
  if (!appId || !appPassword || !tenantId) return null;
  return { appId, appPassword, tenantId };
}

export function getGraphClientConfig(): TeamsAppCredentials | null {
  return readCredentials();
}

export function getMissingGraphClientConfig(): string[] {
  const missing: string[] = [];
  if (!process.env.MicrosoftAppId?.trim()) missing.push("MicrosoftAppId");
  if (!process.env.MicrosoftAppPassword?.trim())
    missing.push("MicrosoftAppPassword");
  if (!process.env.MicrosoftAppTenantId?.trim())
    missing.push("MicrosoftAppTenantId");
  return missing;
}

export function isGraphConfigured(): boolean {
  return readCredentials() !== null;
}

async function fetchAppToken(
  creds: TeamsAppCredentials,
): Promise<CachedToken> {
  const params = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: creds.appId,
    client_secret: creds.appPassword,
    scope: "https://graph.microsoft.com/.default",
  });
  const res = await fetch(
    `https://login.microsoftonline.com/${encodeURIComponent(
      creds.tenantId,
    )}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    },
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "<unreadable>");
    throw new GraphClientError(
      `Failed to acquire Graph token: ${res.status} ${res.statusText}`,
      res.status,
      null,
      text,
    );
  }
  const json = (await res.json()) as {
    access_token?: string;
    expires_in?: number;
  };
  if (!json.access_token || !json.expires_in) {
    throw new GraphClientError(
      "Graph token response missing access_token or expires_in",
      500,
      null,
      json,
    );
  }
  return {
    accessToken: json.access_token,
    expiresAt: Math.floor(Date.now() / 1000) + json.expires_in,
  };
}

async function getAppToken(credentials?: TeamsAppCredentials): Promise<string> {
  const creds = credentials ?? readCredentials();
  if (!creds) {
    throw new GraphClientError(
      "Microsoft Graph credentials not configured (MicrosoftAppId / MicrosoftAppPassword / MicrosoftAppTenantId)",
      500,
      "graph_not_configured",
      null,
    );
  }
  const cacheKey = `${creds.tenantId}:${creds.appId}`;
  const cached = tokenCache.get(cacheKey);
  const now = Math.floor(Date.now() / 1000);
  if (cached && cached.expiresAt - TOKEN_REFRESH_BUFFER_SECONDS > now) {
    return cached.accessToken;
  }
  const token = await fetchAppToken(creds);
  tokenCache.set(cacheKey, token);
  return token.accessToken;
}

interface GraphRequestInit {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  path: string;
  body?: unknown;
  /** When set, retry exactly once on a 401 by refreshing the token. */
  allowTokenRefresh?: boolean;
  credentials?: TeamsAppCredentials;
}

async function graphRequest(init: GraphRequestInit): Promise<Response> {
  const token = await getAppToken(init.credentials);
  const res = await fetch(`${GRAPH_BASE_URL}${init.path}`, {
    method: init.method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  if (res.status === 401 && init.allowTokenRefresh !== false) {
    const creds = init.credentials ?? readCredentials();
    if (creds) tokenCache.delete(`${creds.tenantId}:${creds.appId}`);
    return graphRequest({ ...init, allowTokenRefresh: false });
  }
  return res;
}

async function readGraphError(res: Response): Promise<GraphClientError> {
  let raw: unknown = null;
  try {
    raw = await res.json();
  } catch {
    raw = await res.text().catch(() => "<unreadable>");
  }
  const code =
    raw &&
    typeof raw === "object" &&
    raw !== null &&
    "error" in raw &&
    typeof (raw as { error: { code?: string } }).error?.code === "string"
      ? ((raw as { error: { code: string } }).error.code ?? null)
      : null;
  const message =
    raw &&
    typeof raw === "object" &&
    raw !== null &&
    "error" in raw &&
    typeof (raw as { error: { message?: string } }).error?.message === "string"
      ? (raw as { error: { message: string } }).error.message
      : `Graph ${res.status} ${res.statusText}`;
  return new GraphClientError(message, res.status, code, raw);
}

// =========================================================================
// Teams app bootstrap
// =========================================================================

export interface GraphUser {
  id: string;
  userPrincipalName: string | null;
  mail: string | null;
  displayName: string | null;
}

/**
 * Look up an Entra/AAD user by email. Tries `mail`, then
 * `userPrincipalName`, then `otherMails` — covers cloud-only,
 * federated, and proxy-address tenants.
 */
export async function findGraphUserByEmail(
  email: string,
  credentials?: TeamsAppCredentials,
): Promise<GraphUser | null> {
  const trimmed = email.trim();
  if (!trimmed) return null;
  // OData filter uses single quotes; escape any in the email by doubling.
  const escaped = trimmed.replace(/'/g, "''");
  const filter = `mail eq '${escaped}' or userPrincipalName eq '${escaped}' or otherMails/any(o:o eq '${escaped}')`;
  const res = await graphRequest({
    method: "GET",
    path: `/users?$filter=${encodeURIComponent(filter)}&$select=id,userPrincipalName,mail,displayName&$top=1`,
    credentials,
  });
  if (!res.ok) throw await readGraphError(res);
  const json = (await res.json()) as { value?: GraphUser[] };
  const user = json.value?.[0];
  return user ?? null;
}

export interface TeamsCatalogApp {
  id: string;
  displayName: string | null;
  externalId: string | null;
  distributionMethod: string | null;
}

/**
 * Look up a Teams app in the org's app catalog by its manifest id
 * (the GUID baked into the app manifest, also called "externalId" in
 * Graph). Returns the catalog id we can pass to install endpoints.
 */
export async function findTeamsAppByManifestId(
  manifestId: string,
  credentials?: TeamsAppCredentials,
): Promise<TeamsCatalogApp | null> {
  const escaped = manifestId.replace(/'/g, "''");
  const filter = `externalId eq '${escaped}'`;
  const res = await graphRequest({
    method: "GET",
    path: `/appCatalogs/teamsApps?$filter=${encodeURIComponent(filter)}&$select=id,displayName,externalId,distributionMethod`,
    credentials,
  });
  if (!res.ok) throw await readGraphError(res);
  const json = (await res.json()) as { value?: TeamsCatalogApp[] };
  return json.value?.[0] ?? null;
}

export interface InstalledTeamsApp {
  id: string;
}

export async function findInstalledTeamsAppForUser(
  userId: string,
  teamsAppCatalogId: string,
  credentials?: TeamsAppCredentials,
): Promise<InstalledTeamsApp | null> {
  const escaped = teamsAppCatalogId.replace(/'/g, "''");
  const filter = `teamsApp/id eq '${escaped}'`;
  const res = await graphRequest({
    method: "GET",
    path: `/users/${encodeURIComponent(userId)}/teamwork/installedApps?$expand=teamsApp&$filter=${encodeURIComponent(filter)}`,
    credentials,
  });
  if (!res.ok) throw await readGraphError(res);
  const json = (await res.json()) as { value?: InstalledTeamsApp[] };
  return json.value?.[0] ?? null;
}

export async function installTeamsAppForUser(
  userId: string,
  teamsAppCatalogId: string,
  credentials?: TeamsAppCredentials,
): Promise<void> {
  const res = await graphRequest({
    method: "POST",
    path: `/users/${encodeURIComponent(userId)}/teamwork/installedApps`,
    body: {
      "teamsApp@odata.bind": `https://graph.microsoft.com/v1.0/appCatalogs/teamsApps/${teamsAppCatalogId}`,
    },
    credentials,
  });
  // 201 = installed, 409 = already there. Both are fine.
  if (!res.ok && res.status !== 409) throw await readGraphError(res);
}

export interface InstalledTeamsAppChat {
  id: string;
  topic: string | null;
}

export async function getInstalledTeamsAppChat(
  userId: string,
  installedAppId: string,
  credentials?: TeamsAppCredentials,
): Promise<InstalledTeamsAppChat | null> {
  const res = await graphRequest({
    method: "GET",
    path: `/users/${encodeURIComponent(userId)}/teamwork/installedApps/${encodeURIComponent(installedAppId)}/chat`,
    credentials,
  });
  // 404 is normal when Teams hasn't yet provisioned the personal chat.
  if (res.status === 404) return null;
  if (!res.ok) throw await readGraphError(res);
  const json = (await res.json()) as { id?: string; topic?: string | null };
  if (!json.id) return null;
  return { id: json.id, topic: json.topic ?? null };
}

// =========================================================================
// Voice kickoff: online meetings + calendar invites
// =========================================================================

export interface CreateOnlineMeetingInput {
  /** UPN (or AAD object id) of the user the meeting will belong to. */
  organizerUpn: string;
  subject: string;
  start: Date;
  end: Date;
  credentials?: TeamsAppCredentials;
}

export interface OnlineMeeting {
  id: string;
  joinWebUrl: string;
}

export async function createOnlineMeeting(
  input: CreateOnlineMeetingInput,
): Promise<OnlineMeeting> {
  const res = await graphRequest({
    method: "POST",
    path: `/users/${encodeURIComponent(input.organizerUpn)}/onlineMeetings`,
    body: {
      subject: input.subject,
      startDateTime: input.start.toISOString(),
      endDateTime: input.end.toISOString(),
      // Lobby bypass = "everyone" because the bot is always going to
      // be the first one in the room, and we want the employee to
      // join without an admit click. The single-attendee invite is
      // what keeps this tight: only the invited employee has the URL.
      lobbyBypassSettings: {
        scope: "everyone",
        isDialInBypassEnabled: true,
      },
    },
    credentials: input.credentials,
  });
  if (!res.ok) throw await readGraphError(res);
  const json = (await res.json()) as {
    id?: string;
    joinWebUrl?: string;
  };
  if (!json.id || !json.joinWebUrl) {
    throw new GraphClientError(
      "onlineMeeting response missing id or joinWebUrl",
      500,
      null,
      json,
    );
  }
  return { id: json.id, joinWebUrl: json.joinWebUrl };
}

export interface CreateCalendarEventInput {
  /** UPN of the calendar owner — usually the activator/leader. */
  organizerUpn: string;
  attendeeEmail: string;
  attendeeName: string | null;
  subject: string;
  /** HTML body. We embed the join URL so older Outlook clients still see it. */
  bodyHtml: string;
  start: Date;
  end: Date;
  /**
   * The Teams meeting URL we generated via createOnlineMeeting. Set
   * here so Outlook renders the click-to-join chip on the event.
   */
  joinUrl: string;
  credentials?: TeamsAppCredentials;
}

export interface CalendarEvent {
  id: string;
}

export async function createCalendarEvent(
  input: CreateCalendarEventInput,
): Promise<CalendarEvent> {
  const res = await graphRequest({
    method: "POST",
    path: `/users/${encodeURIComponent(input.organizerUpn)}/events`,
    body: {
      subject: input.subject,
      body: { contentType: "HTML", content: input.bodyHtml },
      start: { dateTime: input.start.toISOString(), timeZone: "UTC" },
      end: { dateTime: input.end.toISOString(), timeZone: "UTC" },
      // Attach the meeting via `onlineMeeting` rather than letting
      // Graph auto-create one — that way the join URL we surface in
      // our DM matches the URL Outlook puts on the event.
      isOnlineMeeting: true,
      onlineMeetingProvider: "teamsForBusiness",
      onlineMeeting: { joinUrl: input.joinUrl },
      location: { displayName: "Microsoft Teams Meeting" },
      attendees: [
        {
          emailAddress: {
            address: input.attendeeEmail,
            name: input.attendeeName ?? undefined,
          },
          type: "required",
        },
      ],
      // Send the invite immediately. Without this Graph creates the
      // event on the organizer's calendar but won't email attendees.
      responseRequested: true,
    },
    credentials: input.credentials,
  });
  if (!res.ok) throw await readGraphError(res);
  const json = (await res.json()) as { id?: string };
  if (!json.id) {
    throw new GraphClientError(
      "event response missing id",
      500,
      null,
      json,
    );
  }
  return { id: json.id };
}

export async function deleteCalendarEvent(
  organizerUpn: string,
  eventId: string,
  credentials?: TeamsAppCredentials,
): Promise<void> {
  const res = await graphRequest({
    method: "DELETE",
    path: `/users/${encodeURIComponent(organizerUpn)}/events/${encodeURIComponent(eventId)}`,
    credentials,
  });
  // 404 is fine — already gone.
  if (!res.ok && res.status !== 404) throw await readGraphError(res);
}

// =========================================================================
// Diagnostics (used by the wizard's "Test connection" button)
// =========================================================================

export interface GraphProbeResult {
  ok: boolean;
  /** Human-readable summary for the wizard's "Test connection" button. */
  detail: string;
  status?: number;
  code?: string | null;
}

/**
 * Try to read the organizer's mailbox settings — this succeeds iff
 * the app token is valid AND the organizer is a real user in the
 * tenant whose mailbox the app can reach. We use mailboxSettings
 * (rather than just /users/{upn}) because it requires the same
 * permission scope as the calendar invite — so a green probe
 * actually means the invite step will work.
 */
export async function probeGraph(
  organizerUpn: string,
  credentials?: TeamsAppCredentials,
): Promise<GraphProbeResult> {
  if (!credentials && !isGraphConfigured()) {
    return {
      ok: false,
      detail:
        "Microsoft bot credentials are not set. Configure MicrosoftAppId / MicrosoftAppPassword / MicrosoftAppTenantId in your env.",
    };
  }
  try {
    const res = await graphRequest({
      method: "GET",
      path: `/users/${encodeURIComponent(organizerUpn)}/mailboxSettings`,
      credentials,
    });
    if (res.ok) {
      return {
        ok: true,
        detail: `Reached ${organizerUpn} via Graph. Voice kickoff is wired up.`,
      };
    }
    const err = await readGraphError(res);
    return {
      ok: false,
      detail: explainGraphError(err, organizerUpn),
      status: err.status,
      code: err.code,
    };
  } catch (err) {
    if (err instanceof GraphClientError) {
      return {
        ok: false,
        detail: explainGraphError(err, organizerUpn),
        status: err.status,
        code: err.code,
      };
    }
    return {
      ok: false,
      detail: err instanceof Error ? err.message : "Unknown Graph error",
    };
  }
}

export function explainGraphError(
  err: GraphClientError,
  organizerUpn: string,
): string {
  if (err.status === 401) {
    return "Graph rejected the bot's app token. Confirm MicrosoftAppId / MicrosoftAppPassword / MicrosoftAppTenantId are correct and the app secret hasn't expired.";
  }
  if (err.status === 403) {
    return `Graph returned 403 for ${organizerUpn}. Most common cause: tenant admin still needs to (1) grant admin consent for OnlineMeetings.ReadWrite.All + Calendars.ReadWrite, and (2) run Grant-CsApplicationAccessPolicy in Teams PowerShell so the bot is allowed to act on behalf of this user. The PowerShell policy can take ~30min to propagate.`;
  }
  if (err.status === 404) {
    return `Graph could not find ${organizerUpn} in the tenant. Confirm this email matches a real Microsoft 365 user in your test tenant.`;
  }
  if (err.status === 429) {
    return "Graph throttled the request. Wait a minute and try again.";
  }
  return `Graph error ${err.status}${err.code ? ` (${err.code})` : ""}: ${err.message}`;
}
