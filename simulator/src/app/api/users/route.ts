/**
 * UI endpoint: register a simulated user manually.
 *
 * Useful when the operator wants to send the first inbound message
 * before Grasp has ever DM'd this person (i.e. testing the agent's
 * response flow in isolation).
 */

import { upsertUser } from "@/lib/store";

interface CreateBody {
  email: string;
  name: string;
  title?: string | null;
  photoUrl?: string | null;
}

export async function POST(req: Request): Promise<Response> {
  let body: CreateBody;
  try {
    body = (await req.json()) as CreateBody;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body.email || !body.name) {
    return Response.json(
      { error: "email and name are required" },
      { status: 400 },
    );
  }
  const user = await upsertUser({
    email: body.email,
    name: body.name,
    title: body.title ?? null,
    photoUrl: body.photoUrl ?? null,
  });
  return Response.json({ user }, { status: 201 });
}
