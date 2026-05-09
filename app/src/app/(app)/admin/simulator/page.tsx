import { requireAgentGraspAdmin } from "@/lib/admin";
import {
  createSimulatorAdminLaunchUrl,
  simulatorAdminConfigured,
} from "@/lib/simulator-admin";

export const metadata = { title: "Simulator · Admin" };

export default async function AdminSimulatorPage() {
  const session = await requireAgentGraspAdmin();
  const launchUrl = createSimulatorAdminLaunchUrl(session.user.email ?? "");
  const configured = simulatorAdminConfigured();

  return (
    <div className="space-y-8">
      <header>
        <p className="text-[12px] font-semibold uppercase tracking-[0.1em] text-[color:var(--color-muted)]">
          Internal admin
        </p>
        <h1 className="serif mt-1 text-[42px] leading-[1.05]">
          Simulator access
        </h1>
        <p className="mt-3 max-w-[680px] text-[15px] leading-[1.65] text-[color:var(--color-muted)]">
          The Teams simulator is an internal testing surface. Access is granted
          through your Grasp login, limited to agentgrasp.com accounts, and
          handed off with a short-lived signed launch token.
        </p>
      </header>

      <section className="card max-w-2xl p-7">
        <h2 className="serif text-[24px] leading-[1.2]">
          Open the simulator
        </h2>
        <p className="mt-2 text-[14px] leading-[1.65] text-[color:var(--color-muted)]">
          Click below to mint a 10-minute launch link. The simulator will set an
          httpOnly admin cookie and then redirect you into the fake Teams inbox.
          Direct visits to the simulator are blocked.
        </p>

        {configured && launchUrl ? (
          <a
            href={launchUrl}
            target="_blank"
            rel="noreferrer"
            className="btn btn-primary mt-6"
          >
            Launch simulator
          </a>
        ) : (
          <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] leading-[1.55] text-amber-900">
            Simulator launch is not configured. Set{" "}
            <code>NEXT_PUBLIC_SIMULATOR_URL</code> and{" "}
            <code>SIMULATOR_ADMIN_SECRET</code> (or reuse{" "}
            <code>SIMULATOR_SHARED_SECRET</code>) on the Grasp app.
          </div>
        )}
      </section>
    </div>
  );
}
