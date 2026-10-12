export const REQUIRED_PRODUCTION_ENV = [
  "NEXT_PUBLIC_APP_URL",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "DATABASE_URL",
  "CRON_SECRET",
  "BRAVE_SEARCH_API_KEY",
] as const;

export interface ProductionConfigValidation {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

const unsafeHost = (hostname: string) =>
  hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";

function validateUrl(name: string, value: string, protocols: readonly string[]): string | null {
  try {
    const parsed = new URL(value);
    if (!protocols.includes(parsed.protocol)) return `${name} uses an unsupported protocol`;
    if (unsafeHost(parsed.hostname)) return `${name} must not target a loopback host in production`;
    return null;
  } catch {
    return `${name} is not a structurally valid URL`;
  }
}

/** Validates production configuration without ever returning or logging values. */
export function validateProductionConfig(env: Readonly<Record<string, string | undefined>>): ProductionConfigValidation {
  const errors: string[] = [];
  for (const name of REQUIRED_PRODUCTION_ENV) {
    const value = env[name]?.trim();
    if (!value) errors.push(`${name} is required`);
    else if (/replace|example|changeme|your[-_]/i.test(value)) errors.push(`${name} contains a placeholder`);
  }
  const appUrl = env.NEXT_PUBLIC_APP_URL?.trim();
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const publishableKey = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
  const databaseUrl = env.DATABASE_URL?.trim();
  const cronSecret = env.CRON_SECRET?.trim();
  if (appUrl) errors.push(...[validateUrl("NEXT_PUBLIC_APP_URL", appUrl, ["https:"])].filter((x): x is string => x !== null));
  if (supabaseUrl) errors.push(...[validateUrl("NEXT_PUBLIC_SUPABASE_URL", supabaseUrl, ["https:"])].filter((x): x is string => x !== null));
  if (publishableKey && !/^sb_publishable_[A-Za-z0-9_-]{12,}$/.test(publishableKey) && publishableKey.split(".").length !== 3) {
    errors.push("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY has an invalid structure");
  }
  if (databaseUrl) errors.push(...[validateUrl("DATABASE_URL", databaseUrl, ["postgres:", "postgresql:"])].filter((x): x is string => x !== null));
  if (cronSecret && cronSecret.length < 24) errors.push("CRON_SECRET is too short");
  return { valid: errors.length === 0, errors };
}

export function assertProductionConfig(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV !== "production") return;
  const result = validateProductionConfig(env);
  if (!result.valid) throw new Error(`Invalid production configuration: ${result.errors.join("; ")}`);
}
