CREATE TABLE "organization_invitation" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "email" TEXT NOT NULL,
  "role" "membership_role" NOT NULL DEFAULT 'admin',
  "invited_by_user_id" TEXT NOT NULL,
  "accepted_by_user_id" TEXT,
  "accepted_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "organization_invitation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "organization_invitation_organization_id_email_key"
ON "organization_invitation"("organization_id", "email");

CREATE INDEX "organization_invitation_email_idx"
ON "organization_invitation"("email");

CREATE INDEX "organization_invitation_accepted_at_idx"
ON "organization_invitation"("accepted_at");

ALTER TABLE "organization_invitation"
ADD CONSTRAINT "organization_invitation_organization_id_fkey"
FOREIGN KEY ("organization_id") REFERENCES "organization"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "organization_invitation"
ADD CONSTRAINT "organization_invitation_invited_by_user_id_fkey"
FOREIGN KEY ("invited_by_user_id") REFERENCES "user"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "organization_invitation"
ADD CONSTRAINT "organization_invitation_accepted_by_user_id_fkey"
FOREIGN KEY ("accepted_by_user_id") REFERENCES "user"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
