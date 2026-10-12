import type { CreateOperatorInput, OperatorPermission, OperatorRecord, OperatorStatus } from "../../../domain/operator";
import type { SqlClient } from "../evidence/postgres-evidence-repository";
import type { OperatorRepository } from "./operator-repository";

type Row = Record<string, unknown>;
const columns = "id,auth_user_id,email,display_name,status,permissions,created_at,updated_at";

function operator(row: Row): OperatorRecord {
  return {
    id: String(row.id),
    authUserId: String(row.auth_user_id),
    email: String(row.email),
    displayName: row.display_name ? String(row.display_name) : null,
    status: row.status as OperatorStatus,
    permissions: Array.isArray(row.permissions) ? (row.permissions as string[]).map((value) => value as OperatorPermission) : [],
    createdAt: new Date(String(row.created_at)),
    updatedAt: new Date(String(row.updated_at)),
  };
}

export class PostgresOperatorRepository implements OperatorRepository {
  constructor(private readonly client: SqlClient) {}

  async findByAuthUserId(authUserId: string): Promise<OperatorRecord | null> {
    const result = await this.client.query<Row>(`select ${columns} from workforce_operators where auth_user_id=$1`, [authUserId]);
    return result.rows[0] ? operator(result.rows[0]) : null;
  }

  async getById(id: string): Promise<OperatorRecord | null> {
    const result = await this.client.query<Row>(`select ${columns} from workforce_operators where id=$1`, [id]);
    return result.rows[0] ? operator(result.rows[0]) : null;
  }

  async create(input: CreateOperatorInput): Promise<OperatorRecord> {
    const result = await this.client.query<Row>(
      `insert into workforce_operators(auth_user_id,email,display_name,status,permissions)values($1,$2,$3,$4,$5::text[])returning ${columns}`,
      [input.authUserId, input.email, input.displayName ?? null, input.status ?? "ACTIVE", input.permissions ?? []],
    );
    return operator(result.rows[0]);
  }
}
