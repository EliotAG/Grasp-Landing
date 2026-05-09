-- Closed-pilot gate at the workspace level.
--
-- Anyone can sign up and create an Organization, but until this column
-- is non-null they cannot activate a rollout, publish an amendment, or
-- configure a Teams/Slack integration. Operators flip the bit by hand
-- (or via scripts/approve-org.ts) once they've talked to the customer.

ALTER TABLE "organization"
ADD COLUMN "approved_at" TIMESTAMP(3);
