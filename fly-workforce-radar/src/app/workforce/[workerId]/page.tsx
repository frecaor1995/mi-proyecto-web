import Link from "next/link";
import { WorkerProfileView } from "../../../components/workforce/worker-profile-view";
import { ErrorState } from "../../../components/ui/foundation";
import { resolveServerLocale } from "../../../i18n/server-locale";
import { t } from "../../../i18n/translate";
import { getWorkerProfilePage } from "../../../server/workforce/get-worker-profile-page";
import { resolveWorkerUiPermissions } from "../../../server/workforce/worker-permissions";

export default async function WorkerProfilePage({ params, searchParams = Promise.resolve({}) }: {
  readonly params: Promise<{ workerId: string }>;
  readonly searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [locale, { workerId }, permissions, query] = await Promise.all([resolveServerLocale(), params, resolveWorkerUiPermissions(), searchParams]);
  const result = await getWorkerProfilePage(workerId);
  if (result.state !== "READY") {
    const titleKey = result.state === "NOT_FOUND" ? "workforce.emptyTitle"
      : result.state === "UNAUTHENTICATED" ? "workforce.requiresSignIn"
        : result.state === "UNAUTHORIZED" ? "workforce.requiresOperator"
          : "workforce.capabilityUnavailableTitle";
    return (
      <div className="page-stack detail-state">
        <Link className="detail-back" href="/workforce">← {t(locale, "workforce.listTitle")}</Link>
        <ErrorState locale={locale} title={t(locale, titleKey)} />
      </div>
    );
  }
  const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? null;
  const lifecycleOutcome = {
    success: one(query.lifecycle) === "archived" || one(query.lifecycle) === "reactivated" ? (one(query.lifecycle) as "archived" | "reactivated") : null,
    error: one(query.lifecycleError) === "archive" || one(query.lifecycleError) === "reactivate" ? (one(query.lifecycleError) as "archive" | "reactivate") : null,
  };
  return <WorkerProfileView locale={locale} profile={result.profile} taxonomy={result.taxonomy} permissions={permissions} lifecycleOutcome={lifecycleOutcome} />;
}
