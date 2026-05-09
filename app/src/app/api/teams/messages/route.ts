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

import { getTeamsAdapter, getTeamsAdapterForAuthConfig } from "@/lib/teams/adapter";
import { getTeamsAgent } from "@/lib/teams/agent";
import {
  getTeamsAuthConfig,
  getTeamsAuthConfigForCredentials,
} from "@/lib/teams/auth-config";
import { getTeamsConfigByMicrosoftAppId } from "@/lib/teams/integration";

export const runtime = "nodejs";
// Each Teams activity is independent; no caching, always fresh.
export const dynamic = "force-dynamic";

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

  // 1. Validate the inbound JWT. authorizeJWT writes 401 directly to
  //    fakeRes on failure (and never calls next), which resolves the
  //    response promise via our shim. On success it stamps req.user.
  const authConfig = organizationConfig?.authConfig ?? getTeamsAuthConfig();
  let jwtFailed = false;
  await new Promise<void>((resolve) => {
    authorizeJWT(authConfig)(
      fakeReq as unknown as Parameters<ReturnType<typeof authorizeJWT>>[0],
      fakeRes as unknown as Parameters<ReturnType<typeof authorizeJWT>>[1],
      ((err?: unknown) => {
        if (err) {
          jwtFailed = true;
          console.error("[teams] authorizeJWT error:", err);
        }
        resolve();
      }) as unknown as Parameters<ReturnType<typeof authorizeJWT>>[2],
    );
  });

  if (responded || jwtFailed) {
    return responsePromise;
  }

  // 2. Hand the activity to the adapter, which dispatches into the
  //    AgentApplication via `agent.run(turnContext)`.
  try {
    const adapter = organizationConfig
      ? getTeamsAdapterForAuthConfig(organizationConfig.authConfig)
      : getTeamsAdapter();
    const agent = getTeamsAgent();
    await adapter.process(
      fakeReq as unknown as Parameters<typeof adapter.process>[0],
      fakeRes as unknown as Parameters<typeof adapter.process>[1],
      async (context) => {
        await agent.run(context);
      },
    );
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
  const appId = readAppIdFromBearer(req.headers.get("authorization"));
  if (!appId) return null;
  const config = await getTeamsConfigByMicrosoftAppId(appId);
  if (!config?.credentials) return null;
  return { authConfig: getTeamsAuthConfigForCredentials(config.credentials) };
}

function readAppIdFromBearer(header: string | null): string | null {
  const token = header?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return null;
  const [, payload] = token.split(".");
  if (!payload) return null;

  try {
    const json = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      aud?: unknown;
      appid?: unknown;
      azp?: unknown;
    };
    return firstString(json.aud, json.appid, json.azp) ?? null;
  } catch {
    return null;
  }
}

function firstString(...values: unknown[]): string | undefined {
  return values.find(
    (value): value is string =>
      typeof value === "string" && value.trim().length > 0,
  )?.trim();
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
