import { HumanVerificationDetailView } from "../../../components/human-verification-desk/human-verification-desk";
import { resolveServerLocale } from "../../../i18n/server-locale";
import { authorizeOperator } from "../../../server/auth/authorization";
import { loadVerificationDetail } from "../../../server/human-verification-desk/get-human-verification-desk";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const [locale, { id }, authorization] = await Promise.all([
    resolveServerLocale(),
    params,
    authorizeOperator("human_verification.write"),
  ]);
  return <HumanVerificationDetailView locale={locale} result={await loadVerificationDetail(id)} authState={authorization.state} />;
}
