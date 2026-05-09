/**
 * UI endpoint: clear the entire thread for one user (keeps the user).
 */

import { clearThread } from "@/lib/store";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ email: string }> },
): Promise<Response> {
  const { email: rawEmail } = await params;
  const email = decodeURIComponent(rawEmail);
  await clearThread(email);
  return Response.json({ ok: true });
}
