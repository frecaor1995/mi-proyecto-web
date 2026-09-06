import { redirect } from "next/navigation";
import { resolveServerLocale } from "../../i18n/server-locale";
import { t } from "../../i18n/translate";
import { authorizeOperator } from "../../server/auth/authorization";
import { signOutAction } from "../../server/auth/actions";
import { LoginForm } from "./login-form";

export default async function LoginPage() {
  const [locale, authorization] = await Promise.all([resolveServerLocale(), authorizeOperator("human_verification.write")]);
  if (authorization.state === "AUTHORIZED") redirect("/command-center");

  return (
    <div className="page-stack login-view">
      <section className="login-card">
        <p className="overline">{t(locale, "auth.signInTitle")}</p>
        <h1>{t(locale, "shell.brandName")}</h1>
        <p>{t(locale, "auth.signInDescription")}</p>
        {authorization.state === "AUTHENTICATED_BUT_UNAUTHORIZED" ? (
          <div className="login-unauthorized">
            <h2>{t(locale, "auth.unauthorizedTitle")}</h2>
            <p>{t(locale, "auth.unauthorizedDescription")}</p>
            <p>{t(locale, "auth.sessionEmailLabel")}: {authorization.email ?? "—"}</p>
            <form action={signOutAction}><button type="submit">{t(locale, "auth.signOutAction")}</button></form>
          </div>
        ) : (
          <LoginForm locale={locale} />
        )}
      </section>
    </div>
  );
}
