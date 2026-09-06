"use client";
import { useActionState } from "react";
import type { DictionaryKey } from "../../i18n/dictionary-shape";
import type { Locale } from "../../i18n/locale";
import { t } from "../../i18n/translate";
import { signInWithPasswordAction, type SignInFormState } from "../../server/auth/actions";

const initialState: SignInFormState = { error: null };

export function LoginForm({ locale }: { readonly locale: Locale }) {
  const [state, formAction, pending] = useActionState(signInWithPasswordAction, initialState);
  return (
    <form action={formAction} className="login-form">
      <label>
        <span>{t(locale, "auth.emailLabel")}</span>
        <input type="email" name="email" required autoComplete="username" />
      </label>
      <label>
        <span>{t(locale, "auth.passwordLabel")}</span>
        <input type="password" name="password" required autoComplete="current-password" />
      </label>
      {state.error ? <p role="alert" className="login-error">{t(locale, state.error as DictionaryKey)}</p> : null}
      <button type="submit" disabled={pending}>{pending ? t(locale, "auth.signInPending") : t(locale, "auth.signInAction")}</button>
    </form>
  );
}
