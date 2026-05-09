/**
 * Seed a sample SOP-style training document into the most recent
 * active plan and run the chunk + index pipeline against it.
 *
 * Usage: pnpm tsx scripts/seed-sample-training-doc.ts
 *
 * Used to smoke-test the agent's `lookup_training_doc` tool without
 * needing to upload a real file through the wizard.
 */

import { prisma } from "@/lib/db";
import { indexTrainingDocument } from "@/lib/agent/rag/indexer";

const SAMPLE_TEXT = `
Field Visit Logging Policy — v3.2

1. Scope
This policy applies to all account managers, customer success engineers, and
field sales representatives who travel to a customer site for any reason
(prospect meeting, renewal conversation, on-site QBR, escalation handoff,
implementation kickoff). It does NOT apply to remote video calls, internal
team off-sites, or partner conferences where no specific customer account is
the subject of the visit.

2. Logging window
Every covered visit must be logged in the CRM within 24 hours of the meeting
ending. The 24-hour window starts at the wheels-up moment from the customer
site, not at end-of-day. If you are travelling with no connectivity, log on
the next reasonable opportunity and note the delay reason in the visit notes.

3. Required fields
Each visit log must include: account name, primary attendees on the customer
side (name + role), Grasp attendees, primary topic, one specific decision or
follow-up captured during the meeting, and a confidence read on the next
quarter's renewal posture (green / yellow / red, with a one-sentence
rationale). Free-form meeting notes are encouraged but not required.

4. Default visit category
Unless the deal record explicitly carries a custom category, use the
"discovery" category for any first-time visit and "expansion" for any visit
to an account already in the customer base. Do not use "support" — that
category is reserved for incident-driven visits and is owned by the
escalation team.

5. SLA on follow-up commitments
Any specific follow-up promised to a customer during a visit must be logged
as a follow-up task in the CRM with a due date no later than 5 business days
after the visit. Tasks beyond 5 days require a manager note explaining why.
This SLA exists because most expansion blockers we lose come from dropped
follow-ups, not from product gaps.

6. Privacy
Customer attendee names and titles are stored in the CRM and visible to the
account team and leadership only. They are NOT visible to other account
teams or to product/engineering. If a customer specifically requests their
name not be logged, capture them as "Customer attendee — [role]" instead and
add a note that they declined attribution.

7. Exceptions
Exceptions to logging requirements (typically for highly confidential
strategic meetings) require sign-off from the VP of Sales and the Privacy
Officer in advance of the visit. Post-hoc exceptions are not granted.
`.trim();

async function main() {
  const plan = await prisma.changePlan.findFirst({
    where: { status: "active" },
    orderBy: { activatedAt: "desc" },
    select: { id: true, name: true },
  });
  if (!plan) {
    console.error("No active plan found. Activate one first.");
    process.exit(1);
  }
  console.log(`Seeding sample SOP for plan "${plan.name}" (${plan.id})`);

  // Reuse an existing test row if one is present; the script is
  // meant to be re-runnable in the same dev DB without piling up
  // identical fixtures.
  const filename = "field-visit-logging-policy.md";
  const existing = await prisma.trainingDocument.findFirst({
    where: { changePlanId: plan.id, filename },
    select: { id: true },
  });

  const doc = existing
    ? await prisma.trainingDocument.update({
        where: { id: existing.id },
        data: {
          extractedText: SAMPLE_TEXT,
          processingStatus: "parsed",
          pageCount: 7,
          indexStatus: "pending",
          indexError: null,
        },
        select: { id: true },
      })
    : await prisma.trainingDocument.create({
        data: {
          changePlanId: plan.id,
          filename,
          mimeType: "text/markdown",
          bytes: Buffer.byteLength(SAMPLE_TEXT, "utf-8"),
          blobUrl: `local-fixture:${filename}`,
          processingStatus: "parsed",
          extractedText: SAMPLE_TEXT,
          pageCount: 7,
          indexStatus: "pending",
        },
        select: { id: true },
      });

  console.log(`Doc id: ${doc.id}. Indexing…`);
  const result = await indexTrainingDocument(doc.id);
  console.log(
    `Indexed: chunks=${result.chunkCount} embedded=${result.embedded} (${result.durationMs}ms)`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => process.exit(0));
