-- Per-workspace mailbox used to organize Graph-created voice kickoff meetings.
ALTER TABLE "organization_teams_integration"
  ADD COLUMN IF NOT EXISTS "voice_organizer_upn" TEXT;
