import { RecallOutputClient } from "./recall-output-client";

export const dynamic = "force-dynamic";

export default async function RecallOutputPage({
  params,
  searchParams,
}: {
  params: Promise<{ callId: string }>;
  searchParams: Promise<{ token?: string }>;
}) {
  const [{ callId }, { token }] = await Promise.all([params, searchParams]);

  if (!token) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-950 p-8 text-white">
        <p>Missing voice session token.</p>
      </main>
    );
  }

  return <RecallOutputClient callId={callId} token={token} />;
}
