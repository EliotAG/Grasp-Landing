/**
 * Bot Framework messaging endpoint for Microsoft Teams.
 *
 * Teams (via Azure Bot Service) POSTs activity payloads to this URL.
 * For local dev: tunnel with `ngrok http 3000` and point the bot's
 * "Messaging endpoint" at https://<id>.ngrok-free.app/api/teams/messages
 * in the Azure portal.
 *
 * Implementation notes:
 *   - The Microsoft 365 Agents SDK assumes Express-shaped req/res.
 *     Next.js App Router gives us Web standard Request/Response. We
 *     bridge it with a tiny shim below — `authorizeJWT` runs first
 *     to validate the bearer token and stamp `req.user`, then
 *     `adapter.process` does the real work.
 *
 *   - Runs on the Node.js runtime: the SDK pulls in `crypto`, `jwks-rsa`,
 *     and MSAL which need Node APIs. Edge runtime would not work.
 */

import type { NextRequest } from "next/server";
import { authorizeJWT } from "@microsoft/agents-hosting";

import { getTeamsAdapterForAuthConfig } from "@/lib/teams/adapter";
import { getTeamsAgent } from "@/lib/teams/agent";
import { getTeamsAuthConfigForCredentials } from "@/lib/teams/auth-config";
import {
  getSingleEnabledTeamsConfig,
  getTeamsConfigByMicrosoftAppId,
} from "@/lib/teams/integration";

export const runtime = "nodejs";
// Each Teams activity is independent; no caching, always fresh.
export const dynamic = "force-dynamic";

const AUTH_TIMEOUT_MS = 10_000;
const TURN_TIMEOUT_MS = 55_000;

// Express-ish shapes that the SDK expects. Kept narrow on purpose so
// we don't pretend to implement more of the Express API than we use.
type ExpressLikeReq = {
  method: string;
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
  user?: unknown;
};

type ExpressLikeRes = {
  status(code: number): ExpressLikeRes;
  setHeader(name: string, value: string): ExpressLikeRes;
  send(body?: unknown): ExpressLikeRes;
  end(): ExpressLikeRes;
};

export async function POST(req: NextRequest): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const headers: Record<string, string | string[] | undefined> = {};
  req.headers.forEach((value, key) => {
    headers[key] = value;
  });

  const fakeReq: ExpressLikeReq = {
    method: "POST",
    headers,
    body,
  };

  // Captured by the shim below; resolved when authorizeJWT or
  // adapter.process writes a final response.
  let resolveResponse!: (resp: Response) => void;
  const responsePromise = new Promise<Response>((r) => {
    resolveResponse = r;
  });

  let statusCode = 200;
  const responseHeaders: Record<string, string> = {};
  let responded = false;

  const respond = (payload: BodyInit | null) => {
    if (responded) return;
    responded = true;
    resolveResponse(
      new Response(payload, { status: statusCode, headers: responseHeaders }),
    );
  };

  const fakeRes: ExpressLikeRes = {
    status(code) {
      statusCode = code;
      return this;
    },
    setHeader(name, value) {
      responseHeaders[name.toLowerCase()] = value;
      return this;
    },
    send(payload) {
      if (payload == null) {
        respond(null);
      } else if (typeof payload === "string") {
        respond(payload);
      } else {
        if (!responseHeaders["content-type"]) {
          responseHeaders["content-type"] = "application/json";
        }
        respond(JSON.stringify(payload));
      }
      return this;
    },
    end() {
      respond(null);
      return this;
    },
  };

  const organizationConfig = await resolveAuthConfigForRequest(req);
  if (!organizationConfig) {
    console.error("[teams] no enabled organization Teams config matched request");
    return new Response(
      JSON.stringify({
        error: "No enabled organization Teams config matched this request.",
      }),
      { status: 503, headers: { "content-type": "application/json" } },
    );
  }

  // 1. Validate the inbound JWT. authorizeJWT writes 401 directly to
  //    fakeRes on failure (and never calls next), which resolves the
  //    response promise via our shim. On success it stamps req.user.
  const authConfig = organizationConfig.authConfig;
  let jwtFailed = false;
  const authCompleted = await withTimeout(
    new Promise<"ok">((resolve) => {
      authorizeJWT(authConfig)(
        fakeReq as unknown as Parameters<ReturnType<typeof authorizeJWT>>[0],
        fakeRes as unknown as Parameters<ReturnType<typeof authorizeJWT>>[1],
        ((err?: unknown) => {
          if (err) {
            jwtFailed = true;
            console.error("[teams] authorizeJWT error:", err);
          }
          resolve("ok");
        }) as unknown as Parameters<ReturnType<typeof authorizeJWT>>[2],
      );
    }),
    AUTH_TIMEOUT_MS,
    "timeout",
  );

  if (authCompleted === "timeout") {
    console.error("[teams] authorizeJWT timed out");
    return new Response("Teams auth timed out", { status: 504 });
  }

  if (responded || jwtFailed) {
    return responsePromise;
  }

  // 2. Hand the activity to the adapter, which dispatches into the
  //    AgentApplication via `agent.run(turnContext)`.
  try {
    const adapter = getTeamsAdapterForAuthConfig(organizationConfig.authConfig);
    const agent = getTeamsAgent();
    const processPromise = adapter.process(
      fakeReq as unknown as Parameters<typeof adapter.process>[0],
      fakeRes as unknown as Parameters<typeof adapter.process>[1],
      async (context) => {
        await agent.run(context);
      },
    );

    const outcome = await Promise.race([
      responsePromise.then((response) => ({ kind: "response" as const, response })),
      processPromise.then(() => ({ kind: "done" as const })),
      delay(TURN_TIMEOUT_MS).then(() => ({ kind: "timeout" as const })),
    ]);

    if (outcome.kind === "response") {
      processPromise.catch((err) => {
        console.error("[teams] adapter.process failed after response:", err);
      });
      return outcome.response;
    }

    if (outcome.kind === "timeout") {
      console.error("[teams] adapter.process timed out");
      processPromise.catch((err) => {
        console.error("[teams] adapter.process failed after timeout:", err);
      });
      return new Response(null, { status: 202 });
    }
  } catch (err) {
    console.error("[teams] adapter.process threw:", err);
    if (!responded) {
      statusCode = 500;
      responseHeaders["content-type"] = "application/json";
      respond(
        JSON.stringify({
          error: err instanceof Error ? err.message : "internal error",
        }),
      );
    }
  }

  if (!responded) respond(null);
  return responsePromise;
}

async function resolveAuthConfigForRequest(
  req: NextRequest,
): Promise<{ authConfig: ReturnType<typeof getTeamsAuthConfigForCredentials> } | null> {
  const appIds = readAppIdsFromBearer(req.headers.get("authorization"));
  for (const appId of appIds) {
    const config = await getTeamsConfigByMicrosoftAppId(appId);
    if (config?.credentials) {
      return { authConfig: getTeamsAuthConfigForCredentials(config.credentials) };
    }
  }

  const config = await getSingleEnabledTeamsConfig();
  if (!config?.credentials) return null;
  return { authConfig: getTeamsAuthConfigForCredentials(config.credentials) };
}

function readAppIdsFromBearer(header: string | null): string[] {
  const token = header?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return [];
  const [, payload] = token.split(".");
  if (!payload) return [];

  try {
    const json = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      aud?: unknown;
      appid?: unknown;
      azp?: unknown;
    };
    return uniqueStrings(json.aud, json.appid, json.azp);
  } catch {
    return [];
  }
}

function uniqueStrings(...values: unknown[]): string[] {
  return [
    ...new Set(
      values
        .filter(
          (value): value is string =>
            typeof value === "string" && value.trim().length > 0,
        )
        .map((value) => value.trim()),
    ),
  ];
}

async function withTimeout<T, U>(
  promise: Promise<T>,
  ms: number,
  timeoutValue: U,
): Promise<T | U> {
  return Promise.race([promise, delay(ms).then(() => timeoutValue)]);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// GET is handy as a liveness probe when registering the endpoint:
// hit it from a browser to confirm the route exists, without dealing
// with a 405 from a missing handler.
export async function GET(): Promise<Response> {
  return new Response(
    JSON.stringify({
      ok: true,
      service: "grasp-teams-bot",
      hint: "POST Bot Framework activities to this URL.",
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}
