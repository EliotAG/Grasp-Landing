-- Track the currently "routed" change enrollment for each Teams 1:1
-- thread. Lets the inbound message handler stick to a single rollout
-- for a chain of replies, and lets the classifier remember the last
-- explicit disambiguation across turns.
ALTER TABLE "teams_conversation_reference"
  ADD COLUMN "routed_enrollment_id" UUID,
  ADD COLUMN "routed_enrollment_at" TIMESTAMP(3);

CREATE INDEX "teams_conversation_reference_routed_enrollment_id_idx"
  ON "teams_conversation_reference"("routed_enrollment_id");
