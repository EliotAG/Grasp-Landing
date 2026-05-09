/**
 * UI endpoint: list every known user with a one-line preview of the
 * latest message in their thread. Powers the simulator's left rail.
 *
 * No bearer auth: this is called by the operator's browser. Bind the
 * dev port to localhost only (default) or add basic-auth if hosting.
 */

import { listLatestPerUser, listUsers } from "@/lib/store";
import { getSimulatorUserPhotoUrl } from "@/lib/user-photo-urls";

export async function GET(): Promise<Response> {
  const [users, latest] = await Promise.all([
    listUsers(),
    listLatestPerUser(),
  ]);
  const rows = users.map((u) => {
    const last = latest.get(u.email);
    return {
      email: u.email,
      name: u.name,
      title: u.title ?? null,
      photoUrl: getSimulatorUserPhotoUrl(u.email, u.photoUrl),
      lastMessage: last
        ? {
            text: last.text,
            from: last.from,
            kind: last.kind,
            createdAt: last.createdAt,
          }
        : null,
    };
  });
  return Response.json({ users: rows });
}
