import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LoginForm } from "../../app/login/login-form";
import LoginPage from "../../app/login/page";
import Opportunities from "../../app/opportunities/page";
import Companies from "../../app/companies/page";
import Verification from "../../app/verification/page";

describe("3I-B3A operator sign-in UI", () => {
  it("21. renders the sign-in form in en-US", () => {
    const html = renderToStaticMarkup(<LoginForm locale="en-US" />);
    expect(html).toContain("Sign in");
    expect(html).toContain("Password");
  });

  it("22. renders the sign-in form in es-US", () => {
    const html = renderToStaticMarkup(<LoginForm locale="es-US" />);
    expect(html).toContain("Iniciar sesión");
    expect(html).toContain("Contraseña");
  });

  it("the login page renders the unauthenticated sign-in form when no Supabase session/configuration is present (this test environment has neither)", async () => {
    const html = renderToStaticMarkup(await LoginPage());
    expect(html).toContain("Operator sign-in");
    expect(html).not.toContain("Signed in, not authorized");
  });

  it("18/19. existing read-only UI-6/UI-7/UI-8 route scaffolds still render unmodified by this phase", async () => {
    const opportunities = renderToStaticMarkup(await Opportunities());
    expect(opportunities).toContain("The opportunity list is not connected yet");
    const companies = renderToStaticMarkup(await Companies());
    expect(companies).toContain("The company list is not connected yet");
    const verification = renderToStaticMarkup(await Verification());
    expect(verification).toContain("Human Verification is unavailable");
  });
});
