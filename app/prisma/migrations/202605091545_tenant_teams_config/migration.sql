CREATE TABLE "organization_teams_integration" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "microsoft_tenant_id" TEXT,
  "microsoft_app_id" TEXT,
  "microsoft_app_password_encrypted" TEXT,
  "teams_app_catalog_id" TEXT,
  "teams_app_manifest_id" TEXT,
  "service_url" TEXT,
  "last_checked_at" TIMESTAMP(3),
  "last_check_error" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "organization_teams_integration_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "organization_teams_integration_organization_id_key"
ON "organization_teams_integration"("organization_id");

CREATE INDEX "organization_teams_integration_microsoft_app_id_idx"
ON "organization_teams_integration"("microsoft_app_id");

CREATE INDEX "organization_teams_integration_microsoft_tenant_id_idx"
ON "organization_teams_integration"("microsoft_tenant_id");

ALTER TABLE "organization_teams_integration"
ADD CONSTRAINT "organization_teams_integration_organization_id_fkey"
FOREIGN KEY ("organization_id") REFERENCES "organization"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
