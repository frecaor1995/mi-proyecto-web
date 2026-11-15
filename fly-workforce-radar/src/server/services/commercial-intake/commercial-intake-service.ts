import type { CommercialIntakeInput, CommercialIntakeResult } from "../../../domain/commercial-intake";
import { validateCommercialIntake } from "../../../domain/commercial-intake";
import { authorizeOperator } from "../../auth/authorization";
import type { ServerSession } from "../../auth/session";
import type { TransactionRunner } from "../../database/transaction";
import type { OperatorRepository } from "../../repositories/operator/operator-repository";
import { PostgresCommercialIntakeRepository } from "../../repositories/commercial-intake/postgres-commercial-intake-repository";

export interface CommercialIntakeServiceDeps {
  readonly transactionRunner: TransactionRunner | null;
  readonly getSession?: () => Promise<ServerSession | null>;
  readonly operatorRepository?: OperatorRepository | null;
  readonly clock?: () => Date;
}

export class CommercialIntakeService {
  constructor(private readonly deps: CommercialIntakeServiceDeps) {}
  async activate(input: CommercialIntakeInput): Promise<CommercialIntakeResult> {
    const errors = validateCommercialIntake(input);
    if (Object.keys(errors).length) return { kind: "VALIDATION_ERROR", errors };
    const auth = await authorizeOperator("demand_requirement.write", { getSession: this.deps.getSession, repository: this.deps.operatorRepository });
    if (auth.state === "UNAUTHENTICATED") return { kind: "UNAUTHENTICATED" };
    if (auth.state !== "AUTHORIZED") return { kind: "UNAUTHORIZED" };
    if (!this.deps.transactionRunner) return { kind: "UNAVAILABLE" };
    try {
      const value = await this.deps.transactionRunner((client) => new PostgresCommercialIntakeRepository(client)
        .activate(input, auth.operator.operatorId, (this.deps.clock ?? (() => new Date()))()));
      return { kind: "ACTIVATED", value };
    } catch (error) {
      const code = (error as { code?: string } | null)?.code;
      if (["23503", "23514", "22P02"].includes(code ?? "")) return { kind: "VALIDATION_ERROR", errors: { form: "canonicalReferenceInvalid" } };
      throw error;
    }
  }
}
