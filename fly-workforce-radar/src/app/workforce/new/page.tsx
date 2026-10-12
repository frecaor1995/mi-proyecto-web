import { WorkerCreateForm } from "../../../components/workforce/worker-create-form";
import { PageHeader, ErrorState } from "../../../components/ui/foundation";
import { resolveServerLocale } from "../../../i18n/server-locale";
import { t } from "../../../i18n/translate";
import { getWorkforceTaxonomy } from "../../../server/workforce/get-workforce-taxonomy";
import { resolveWorkerUiPermissions } from "../../../server/workforce/worker-permissions";

export default async function NewWorkerPage() {
  const [locale, permissions, taxonomy] = await Promise.all([resolveServerLocale(), resolveWorkerUiPermissions(), getWorkforceTaxonomy()]);
  return (
    <div className="page-stack">
      <PageHeader eyebrow={t(locale, "workforce.eyebrow")} title={t(locale, "workforce.create.title")} description={t(locale, "workforce.create.description")} locale={locale} />
      {!permissions.profileWrite ? (
        <ErrorState locale={locale} title={t(locale, permissions.authenticated ? "workforce.requiresOperator" : "workforce.requiresSignIn")} />
      ) : (
        <>
          <p className="detail-honest-empty">{t(locale, "workforce.create.primaryTradeHint")}</p>
          <WorkerCreateForm locale={locale} trades={taxonomy.trades} occupations={taxonomy.occupations} />
        </>
      )}
    </div>
  );
}
