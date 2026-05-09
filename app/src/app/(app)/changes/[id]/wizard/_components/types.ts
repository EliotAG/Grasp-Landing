import type {
  ChangePlan,
  StakeholderGroup,
  StakeholderGroupMember,
  Employee,
  RolloutCheckInTemplate,
  TrainingDocument,
} from "@prisma/client";

export type WizardPlan = ChangePlan & {
  stakeholderGroups: Array<
    StakeholderGroup & {
      members: Array<StakeholderGroupMember & { employee: Pick<Employee, "id" | "name"> }>;
    }
  >;
  trainingDocuments: TrainingDocument[];
  checkInTemplates: RolloutCheckInTemplate[];
};

export type EmployeePick = Pick<
  Employee,
  "id" | "name" | "email" | "team" | "title"
>;
