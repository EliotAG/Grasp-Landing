ALTER TABLE "employee"
ADD COLUMN "microsoft_aad_object_id" TEXT,
ADD COLUMN "microsoft_user_principal_name" TEXT,
ADD COLUMN "teams_app_installation_id" TEXT,
ADD COLUMN "teams_app_installed_at" TIMESTAMP(3),
ADD COLUMN "teams_bootstrap_checked_at" TIMESTAMP(3),
ADD COLUMN "teams_bootstrap_error" TEXT;

ALTER TABLE "teams_conversation_reference"
ADD COLUMN "employee_id" UUID;

CREATE UNIQUE INDEX "employee_organization_id_microsoft_aad_object_id_key"
ON "employee"("organization_id", "microsoft_aad_object_id");

CREATE INDEX "employee_microsoft_aad_object_id_idx"
ON "employee"("microsoft_aad_object_id");

CREATE INDEX "teams_conversation_reference_employee_id_idx"
ON "teams_conversation_reference"("employee_id");

ALTER TABLE "teams_conversation_reference"
ADD CONSTRAINT "teams_conversation_reference_employee_id_fkey"
FOREIGN KEY ("employee_id") REFERENCES "employee"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
