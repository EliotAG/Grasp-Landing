import {
  SimulatorClient,
  type Message,
  type ThreadRow,
} from "@/components/simulator-client";
import { getUser, listLatestPerUser, listMessagesFor, listUsers } from "@/lib/store";
import { getSimulatorUserPhotoUrl } from "@/lib/user-photo-urls";

export const dynamic = "force-dynamic";

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ as?: string }>;
}) {
  const { as: rawAs } = await searchParams;
  const [users, latest] = await Promise.all([
    listUsers(),
    listLatestPerUser(),
  ]);

  const rows: ThreadRow[] = users
    .map((u) => {
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
    })
    .sort((a, b) => {
      const ta = a.lastMessage?.createdAt ?? "";
      const tb = b.lastMessage?.createdAt ?? "";
      if (ta && tb) return tb.localeCompare(ta);
      if (ta) return -1;
      if (tb) return 1;
      return a.name.localeCompare(b.name);
    });

  // Default selection: ?as=<email> if valid, else most recent thread,
  // else first registered user, else nothing.
  const activeEmail =
    (rawAs && rows.find((r) => r.email === rawAs.toLowerCase())?.email) ??
    rows.find((r) => r.lastMessage)?.email ??
    rows[0]?.email ??
    null;

  let initialMessages: Message[] = [];
  let activeUser: {
    email: string;
    name: string;
    title: string | null;
    photoUrl: string | null;
  } | null = null;
  if (activeEmail) {
    const [u, msgs] = await Promise.all([
      getUser(activeEmail),
      listMessagesFor(activeEmail),
    ]);
    if (u) {
      activeUser = {
        email: u.email,
        name: u.name,
        title: u.title ?? null,
        photoUrl: getSimulatorUserPhotoUrl(u.email, u.photoUrl),
      };
      initialMessages = msgs.map((m) => ({
        id: m.id,
        from: m.from,
        kind: m.kind,
        text: m.text,
        createdAt: m.createdAt,
      }));
    }
  }

  return (
    <SimulatorClient
      initialRows={rows}
      activeEmail={activeEmail}
      activeUser={activeUser}
      initialMessages={initialMessages}
    />
  );
}
