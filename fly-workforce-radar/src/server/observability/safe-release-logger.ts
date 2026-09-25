const SENSITIVE_KEY = /password|token|secret|authorization|cookie|phone|email|contact|database_url/i;

export function sanitizeLogFields(fields: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, SENSITIVE_KEY.test(key) ? "[REDACTED]" : value]));
}

export function logServerError(event: string, fields: Record<string, unknown> = {}): void {
  console.error(JSON.stringify({ level: "error", event, ...sanitizeLogFields(fields) }));
}
