ALTER TYPE "agent_message_channel" ADD VALUE 'slack';

ALTER TABLE "employee"
ADD COLUMN "slack_bootstrap_checked_at" TIMESTAMP(3),
ADD COLUMN "slack_bootstrap_error" TEXT;

CREATE TABLE "organization_slack_integration" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "slack_team_id" TEXT,
  "slack_team_name" TEXT,
  "slack_app_id" TEXT,
  "slack_bot_user_id" TEXT,
  "slack_bot_token_encrypted" TEXT,
  "slack_signing_secret_encrypted" TEXT,
  "last_checked_at" TIMESTAMP(3),
  "last_check_error" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "organization_slack_integration_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "slack_contact" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "employee_id" UUID,
  "slack_team_id" TEXT NOT NULL,
  "slack_user_id" TEXT NOT NULL,
  "slack_dm_channel_id" TEXT,
  "user_email" TEXT,
  "user_name" TEXT,
  "bootstrap_checked_at" TIMESTAMP(3),
  "bootstrap_error" TEXT,
  "last_activity_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "slack_contact_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "slack_event_receipt" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "slack_event_id" TEXT NOT NULL,
  "slack_team_id" TEXT,
  "organization_id" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "slack_event_receipt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "organization_slack_integration_organization_id_key"
ON "organization_slack_integration"("organization_id");

CREATE INDEX "organization_slack_integration_slack_team_id_idx"
ON "organization_slack_integration"("slack_team_id");

CREATE INDEX "organization_slack_integration_slack_app_id_idx"
ON "organization_slack_integration"("slack_app_id");

CREATE UNIQUE INDEX "slack_contact_slack_team_id_slack_user_id_key"
ON "slack_contact"("slack_team_id", "slack_user_id");

CREATE UNIQUE INDEX "slack_contact_organization_id_employee_id_key"
ON "slack_contact"("organization_id", "employee_id");

CREATE INDEX "slack_contact_organization_id_idx"
ON "slack_contact"("organization_id");

CREATE INDEX "slack_contact_employee_id_idx"
ON "slack_contact"("employee_id");

CREATE INDEX "slack_contact_user_email_idx"
ON "slack_contact"("user_email");

CREATE UNIQUE INDEX "slack_event_receipt_slack_event_id_key"
ON "slack_event_receipt"("slack_event_id");

CREATE INDEX "slack_event_receipt_slack_team_id_idx"
ON "slack_event_receipt"("slack_team_id");

CREATE INDEX "slack_event_receipt_organization_id_idx"
ON "slack_event_receipt"("organization_id");

ALTER TABLE "organization_slack_integration"
ADD CONSTRAINT "organization_slack_integration_organization_id_fkey"
FOREIGN KEY ("organization_id") REFERENCES "organization"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "slack_contact"
ADD CONSTRAINT "slack_contact_employee_id_fkey"
FOREIGN KEY ("employee_id") REFERENCES "employee"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
