/**
 * UI endpoint: send a reply *as* the simulated user.
 *
 * 1. Save the user message immediately so the operator sees it.
 * 2. Fire-and-await POST to GRASP_WEBHOOK_URL so the agent can react.
 *    Grasp's reply (if any) comes back via POST /api/messages — this
 *    handler does NOT synthesize a reply itself.
 * 3. Return both the saved message and the webhook delivery result so
 *    the UI can show "agent didn't respond" if the webhook failed.
 */

import { appendMessage, getUser, upsertUser } from "@/lib/store";
import { postToGrasp } from "@/lib/webhook";

interface ReplyBody {
  text: string;
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ email: string }> },
): Promise<Response> {
  const { email: rawEmail } = await params;
  const email = decodeURIComponent(rawEmail);

  let body: ReplyBody;
  try {
    body = (await req.json()) as ReplyBody;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const text = body.text?.trim();
  if (!text) {
    return Response.json({ error: "text is required" }, { status: 400 });
  }

  let user = await getUser(email);
  if (!user) {
    // Auto-register when the operator types into a thread for someone
    // Grasp hasn't touched yet (the manual "Add user" flow does the
    // same thing under the hood).
    user = await upsertUser({ email, name: email });
  }

  const saved = await appendMessage({
    userEmail: email,
    from: "user",
    kind: "message",
    text,
  });

  const delivery = await postToGrasp({
    user: { email: user.email, name: user.name },
    message: {
      id: saved.id,
      text: saved.text,
      createdAt: saved.createdAt,
    },
  });

  return Response.json({ message: saved, delivery });
}
