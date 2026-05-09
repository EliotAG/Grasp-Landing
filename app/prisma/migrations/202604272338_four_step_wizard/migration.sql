ALTER TABLE "change_plan" ALTER COLUMN "current_step" DROP DEFAULT;

ALTER TYPE "change_plan_wizard_step" RENAME TO "change_plan_wizard_step_old";

CREATE TYPE "change_plan_wizard_step" AS ENUM (
  'change',
  'audience',
  'support',
  'approve'
);

ALTER TABLE "change_plan"
  ALTER COLUMN "current_step" TYPE "change_plan_wizard_step"
  USING (
    CASE "current_step"::text
      WHEN 'frame' THEN 'change'
      WHEN 'timeline' THEN 'change'
      WHEN 'mechanism' THEN 'change'
      WHEN 'stakeholders' THEN 'audience'
      WHEN 'behaviors' THEN 'audience'
      WHEN 'materials' THEN 'support'
      WHEN 'cadence' THEN 'support'
      WHEN 'announcement' THEN 'approve'
      WHEN 'review' THEN 'approve'
      ELSE 'change'
    END
  )::"change_plan_wizard_step";

ALTER TABLE "change_plan" ALTER COLUMN "current_step" SET DEFAULT 'change';

DROP TYPE "change_plan_wizard_step_old";
