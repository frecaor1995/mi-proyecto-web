import type { CreateOperatorInput, OperatorRecord } from "../../../domain/operator";

export interface OperatorRepository {
  findByAuthUserId(authUserId: string): Promise<OperatorRecord | null>;
  getById(id: string): Promise<OperatorRecord | null>;
  create(input: CreateOperatorInput): Promise<OperatorRecord>;
}
