-- Voice kickoff scheduling and Recall.ai participant join tracking.

DO $$ BEGIN
  CREATE TYPE "voice_call_status" AS ENUM ('scheduled', 'dispatched', 'completed', 'skipped', 'failed');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "change_plan"
  ADD COLUMN IF NOT EXISTS "voice_kickoff_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "voice_kickoff_start_offset_minutes" INTEGER NOT NULL DEFAULT 1440,
  ADD COLUMN IF NOT EXISTS "voice_kickoff_stagger_minutes" INTEGER NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS "voice_kickoff_duration_minutes" INTEGER NOT NULL DEFAULT 15;

CREATE TABLE IF NOT EXISTS "scheduled_voice_call" (
  "id" UUID NOT NULL,
  "enrollment_id" UUID NOT NULL,
  "change_plan_id" UUID NOT NULL,
  "scheduled_for" TIMESTAMP(3) NOT NULL,
  "status" "voice_call_status" NOT NULL DEFAULT 'scheduled',
  "meeting_join_url" TEXT,
  "graph_meeting_id" TEXT,
  "graph_event_id" TEXT,
  "invite_sent_at" TIMESTAMP(3),
  "invite_error" TEXT,
  "recall_bot_id" TEXT,
  "participant_joined_at" TIMESTAMP(3),
  "participant_last_seen_at" TIMESTAMP(3),
  "participant_recall_id" INTEGER,
  "participant_name" TEXT,
  "participant_email" TEXT,
  "participant_platform" TEXT,
  "participant_last_event" JSONB,
  "dispatched_at" TIMESTAMP(3),
  "completed_at" TIMESTAMP(3),
  "transcript" JSONB,
  "error" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "scheduled_voice_call_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "scheduled_voice_call_enrollment_id_fkey" FOREIGN KEY ("enrollment_id") REFERENCES "change_enrollment"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "scheduled_voice_call_change_plan_id_fkey" FOREIGN KEY ("change_plan_id") REFERENCES "change_plan"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

ALTER TABLE "scheduled_voice_call"
  ADD COLUMN IF NOT EXISTS "participant_joined_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "participant_last_seen_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "participant_recall_id" INTEGER,
  ADD COLUMN IF NOT EXISTS "participant_name" TEXT,
  ADD COLUMN IF NOT EXISTS "participant_email" TEXT,
  ADD COLUMN IF NOT EXISTS "participant_platform" TEXT,
  ADD COLUMN IF NOT EXISTS "participant_last_event" JSONB;

CREATE UNIQUE INDEX IF NOT EXISTS "scheduled_voice_call_enrollment_id_key"
  ON "scheduled_voice_call"("enrollment_id");

CREATE INDEX IF NOT EXISTS "scheduled_voice_call_status_scheduled_for_idx"
  ON "scheduled_voice_call"("status", "scheduled_for");

CREATE INDEX IF NOT EXISTS "scheduled_voice_call_recall_bot_id_idx"
  ON "scheduled_voice_call"("recall_bot_id");
