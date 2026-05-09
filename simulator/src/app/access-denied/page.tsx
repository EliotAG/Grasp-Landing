export const metadata = { title: "Simulator access required" };

export default function AccessDeniedPage() {
  const appUrl = process.env.NEXT_PUBLIC_GRASP_APP_URL ?? "https://app.withgrasp.com";
  return (
    <main className="flex min-h-screen items-center justify-center bg-[color:var(--color-canvas)] px-6">
      <section className="max-w-md rounded-2xl border border-[color:var(--color-line)] bg-white p-8 text-center shadow-sm">
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[color:var(--color-muted-2)]">
          Internal simulator
        </p>
        <h1 className="mt-2 text-[26px] font-semibold tracking-[-0.03em] text-[color:var(--color-ink)]">
          Open from Grasp admin.
        </h1>
        <p className="mt-3 text-[14px] leading-[1.65] text-[color:var(--color-muted)]">
          This simulator is only available through the Grasp admin dashboard
          for agentgrasp.com accounts. Direct visits are blocked.
        </p>
        <a
          href={`${appUrl}/admin/simulator`}
          className="mt-6 inline-flex rounded-full bg-[color:var(--color-teams)] px-4 py-2 text-[13px] font-semibold text-white no-underline"
        >
          Go to Grasp admin
        </a>
      </section>
    </main>
  );
}
