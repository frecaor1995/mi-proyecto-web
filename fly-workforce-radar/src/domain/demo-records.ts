/**
 * Single DEMO criterion for local demonstration workers. It is the same rule the Workforce, matching and candidate
 * slate repositories already apply in SQL: the word "demo" anywhere in the display name, as a whole word and in any
 * case ("DEMO LOCAL …", "Demo segundo …"). A prefix-only rule ("DEMO LOCAL%") misses records such as "demo segundo"
 * and would count them as real personnel.
 */
export const DEMO_WORD_SQL_REGEX = "(^|[^[:alnum:]_])demo([^[:alnum:]_]|$)";

/** JavaScript equivalent of DEMO_WORD_SQL_REGEX ([:alnum:]_ is \w for the names stored here). */
export const DEMO_WORD_PATTERN = /(^|[^\p{L}\p{N}_])demo([^\p{L}\p{N}_]|$)/iu;

export function isDemoWorkerName(displayName: string | null | undefined): boolean {
  return DEMO_WORD_PATTERN.test(displayName ?? "");
}

/** SQL predicate (case-insensitive regex match) for a display-name column, e.g. `isDemoWorkerSql("w.display_name")`. */
export function isDemoWorkerSql(column: string): string {
  return `${column} ~* '${DEMO_WORD_SQL_REGEX}'`;
}
