import { CommercialIntakeForm } from "../../../components/commercial-intake/commercial-intake-form";
import { commercialIntakeCopy } from "../../../components/commercial-intake/commercial-intake-copy";
import { ErrorState, PageHeader } from "../../../components/ui/foundation";
import { resolveServerLocale } from "../../../i18n/server-locale";
import { authorizeOperator } from "../../../server/auth/authorization";
import { getWorkforceTaxonomy } from "../../../server/workforce/get-workforce-taxonomy";

export default async function CommercialIntakePage(){
  const [locale,authorization,taxonomy]=await Promise.all([resolveServerLocale(),authorizeOperator("demand_requirement.write"),getWorkforceTaxonomy()]);
  const copy=commercialIntakeCopy[locale];
  return <div className="page-stack"><PageHeader eyebrow={copy.eyebrow} title={copy.title} description={copy.description} locale={locale}/>
    {authorization.state!=="AUTHORIZED"?<ErrorState locale={locale} title={copy.restricted}/>:<CommercialIntakeForm locale={locale} taxonomy={taxonomy} idempotencyKey={randomUUID()}/>}</div>;
}
import { randomUUID } from "node:crypto";
