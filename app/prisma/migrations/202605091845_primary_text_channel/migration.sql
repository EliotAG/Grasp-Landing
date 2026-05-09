CREATE TYPE "organization_text_channel" AS ENUM ('teams', 'slack');

ALTER TABLE "organization"
ADD COLUMN "primary_text_channel" "organization_text_channel" NOT NULL DEFAULT 'teams';
