/**
 * UI endpoint: full message thread for one user. Used to hydrate the
 * chat pane after picking someone in the sidebar (and to refresh after
 * sending a reply).
 */

import { getUser, listMessagesFor } from "@/lib/store";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ email: string }> },
): Promise<Response> {
  const { email: rawEmail } = await params;
  const email = decodeURIComponent(rawEmail);
  const user = await getUser(email);
  if (!user) {
    return Response.json({ error: "Unknown user" }, { status: 404 });
  }
  const messages = await listMessagesFor(email);
  return Response.json({ user, messages });
}
