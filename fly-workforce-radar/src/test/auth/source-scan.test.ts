import { readFile, readdir, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

async function collectFiles(relativeDir: string, extensions: readonly string[]): Promise<string[]> {
  const absolute = resolve(root, relativeDir);
  const entries = await readdir(absolute, { recursive: true }).catch(() => [] as string[]);
  const files: string[] = [];
  for (const entry of entries) {
    const path = resolve(absolute, entry as string);
    if (!extensions.some((extension) => path.endsWith(extension))) continue;
    if ((await stat(path)).isFile()) files.push(path);
  }
  return files;
}

describe("3I-B3A safe-mutation and secrets boundary (static source scan)", () => {
  it("19. no service-role/secret Supabase key is referenced anywhere in browser-reachable code (src/app, src/components)", async () => {
    const files = [...(await collectFiles("src/app", [".ts", ".tsx"])), ...(await collectFiles("src/components", [".ts", ".tsx"]))];
    for (const file of files) {
      const source = await readFile(file, "utf8");
      expect(source).not.toMatch(/SUPABASE_SERVICE_ROLE|SERVICE_ROLE_KEY|SUPABASE_SECRET/);
    }
  });

  it("the browser Supabase client module never reads a secret/service-role key or DATABASE_URL (comments explaining the boundary are fine; actual env reads are not)", async () => {
    const source = await readFile(resolve(root, "src/server/auth/supabase-browser-client.ts"), "utf8");
    expect(source).not.toMatch(/process\.env\.(SUPABASE_SERVICE_ROLE_KEY|SUPABASE_SECRET_KEY|DATABASE_URL)/);
  });

  it("20. DATABASE_URL is never read outside src/server", async () => {
    const files = (await collectFiles("src", [".ts", ".tsx"])).filter((path) => !path.startsWith(resolve(root, "src/server")) && !path.startsWith(resolve(root, "src/test")));
    for (const file of files) {
      const source = await readFile(file, "utf8");
      expect(source).not.toMatch(/process\.env\.DATABASE_URL/);
    }
  });

  it("8. there is no public signup route", async () => {
    const appEntries = await readdir(resolve(root, "src/app")).catch(() => []);
    expect(appEntries).not.toContain("signup");
    expect(appEntries).not.toContain("register");
  });

  it("the login page and form contain no self-service registration path", async () => {
    for (const file of ["src/app/login/page.tsx", "src/app/login/login-form.tsx"]) {
      const source = (await readFile(resolve(root, file), "utf8")).toLowerCase();
      expect(source).not.toMatch(/signup|sign up|register|create an account/);
    }
  });

  it(".env.example carries no secret/service-role key placeholder for auth", async () => {
    const source = await readFile(resolve(root, ".env.example"), "utf8");
    expect(source).not.toMatch(/SERVICE_ROLE|SECRET_KEY/);
    expect(source).toContain("NEXT_PUBLIC_SUPABASE_URL");
    expect(source).toContain("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  });

  it("the proxy (session-refresh, formerly middleware) only refreshes session lifecycle -- it never imports the authorization guard module", async () => {
    const source = await readFile(resolve(root, "src/proxy.ts"), "utf8");
    expect(source).not.toMatch(/from\s+["'][^"']*auth\/authorization["']/);
  });
});
