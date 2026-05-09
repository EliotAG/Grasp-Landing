/**
 * Inbound endpoint for Grasp to send a "bot" message to a simulated user.
 *
 * Auth: shared-secret bearer token. Mirrors how Bot Framework's POST to
 * /api/messages requires a JWT signed by the channel.
 */

import { authenticated, unauthorized } from "@/lib/auth";
import { buildDemoFeedbackReply } from "@/lib/demo-feedback";
import {
  appendMessage,
  upsertUser,
  type SimMessageKind,
} from "@/lib/store";
import { postToGrasp } from "@/lib/webhook";

interface IncomingBody {
  user: {
    email: string;
    name: string;
    title?: string | null;
  };
  text: string;
  kind?: SimMessageKind;
}

export async function POST(req: Request): Promise<Response> {
  if (!authenticated(req)) return unauthorized();

  let body: IncomingBody;
  try {
    body = (await req.json()) as IncomingBody;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.user?.email || !body.text) {
    return Response.json(
      { error: "user.email and text are required" },
      { status: 400 },
    );
  }

  await upsertUser({
    email: body.user.email,
    name: body.user.name ?? body.user.email,
    title: body.user.title ?? null,
  });

  const message = await appendMessage({
    userEmail: body.user.email,
    from: "bot",
    kind: body.kind ?? "message",
    text: body.text,
  });

  const demoReply = buildDemoFeedbackReply({
    email: body.user.email,
    name: body.user.name ?? body.user.email,
    botText: body.text,
    kind: body.kind ?? "message",
  });
  if (demoReply) {
    const savedReply = await appendMessage({
      userEmail: body.user.email,
      from: "user",
      kind: "message",
      text: demoReply,
    });
    postToGrasp({
      user: { email: body.user.email, name: body.user.name ?? body.user.email },
      message: {
        id: savedReply.id,
        text: savedReply.text,
        createdAt: savedReply.createdAt,
      },
    }).catch((err) => {
      console.error("[sim] demo feedback webhook failed:", err);
    });
  }

  return Response.json(
    { id: message.id, createdAt: message.createdAt },
    { status: 201 },
  );
}
