CREATE TABLE "rollout_check_in_template" (
    "id" UUID NOT NULL,
    "change_plan_id" UUID NOT NULL,
    "kind" "scheduled_check_in_kind" NOT NULL,
    "offset_days" INTEGER NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rollout_check_in_template_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "rollout_check_in_template_change_plan_id_kind_key" ON "rollout_check_in_template"("change_plan_id", "kind");
CREATE INDEX "rollout_check_in_template_change_plan_id_idx" ON "rollout_check_in_template"("change_plan_id");

ALTER TABLE "rollout_check_in_template" ADD CONSTRAINT "rollout_check_in_template_change_plan_id_fkey" FOREIGN KEY ("change_plan_id") REFERENCES "change_plan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
