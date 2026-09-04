import type {
  CreateHumanInteractionInput, CreateHumanResponseAssessmentInput, CreateHumanVerificationTaskEventInput,
  CreateHumanVerificationTaskInput, HumanInteraction, HumanResponseAssessment, HumanVerificationTask,
  HumanVerificationTaskEvent, HumanVerificationTaskStatus,
} from "../../../domain/human-verification";

export interface PersistHumanVerificationTaskInput extends CreateHumanVerificationTaskInput { deduplicationKey: string }

export interface HumanVerificationRepository {
  findOpenTaskByDeduplicationKey(key: string): Promise<HumanVerificationTask | null>;
  createTask(input: PersistHumanVerificationTaskInput): Promise<HumanVerificationTask>;
  getTask(id: string): Promise<HumanVerificationTask | null>;
  transitionTask(id: string, status: HumanVerificationTaskStatus, event: Omit<CreateHumanVerificationTaskEventInput, "verificationTaskId">): Promise<HumanVerificationTask>;
  createInteraction(input: CreateHumanInteractionInput): Promise<HumanInteraction>;
  listInteractions(taskId: string): Promise<HumanInteraction[]>;
  createAssessment(input: CreateHumanResponseAssessmentInput): Promise<HumanResponseAssessment>;
  listAssessments(interactionId: string): Promise<HumanResponseAssessment[]>;
  createTaskEvent(input: CreateHumanVerificationTaskEventInput): Promise<HumanVerificationTaskEvent>;
  listTaskEvents(taskId: string): Promise<HumanVerificationTaskEvent[]>;
}
