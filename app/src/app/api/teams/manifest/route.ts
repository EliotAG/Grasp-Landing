import { headers } from "next/headers";

import { auth } from "@/lib/auth";
import { buildTeamsManifest } from "@/lib/teams/manifest";
import {
  describeTeamsConfigProblem,
  getOrganizationTeamsConfig,
} from "@/lib/teams/integration";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const session = await auth();
  const organizationId = session?.user?.organizationId;
  if (!session?.user || !organizationId) {
    return Response.json({ error: "Not signed in to a workspace" }, { status: 401 });
  }

  const config = await getOrganizationTeamsConfig(organizationId);
  const problem = describeTeamsConfigProblem(config);
  if (problem || !config.credentials) {
    return Response.json(
      { error: problem ?? "Teams is not configured for this workspace." },
      { status: 400 },
    );
  }

  const hdrs = await headers();
  const host = hdrs.get("x-forwarded-host") ?? hdrs.get("host");
  if (!host) {
    return Response.json({ error: "Could not determine app hostname." }, { status: 400 });
  }

  const manifest = buildTeamsManifest({
    microsoftAppId: config.credentials.appId,
    teamsAppManifestId: config.teamsAppManifestId,
    appHostname: host,
  });

  return new Response(`${JSON.stringify(manifest, null, 2)}\n`, {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": 'attachment; filename="manifest.json"',
      "cache-control": "no-store",
    },
  });
}
