import Link from "next/link";
import { resolveServerLocale } from "../../i18n/server-locale";
import { commercialIntakeCopy } from "../../components/commercial-intake/commercial-intake-copy";
import { CommandCenterView } from "../../components/command-center/command-center-view";
import { getCommandCenterCommercialActions, getCommandCenterSummary } from "../../server/command-center/get-command-center-summary";

export default async function CommandCenter() {
  const locale = await resolveServerLocale();
  const asOf = new Date();
  const summary = getCommandCenterSummary(asOf);
  const commercialActions = getCommandCenterCommercialActions();
  // dataAsOf stays null: `asOf` above is only the computation instant for
  // currentness math, not a real evidence timestamp -- see UI-3 section 16.
  return <div className="page-stack"><div className="radar-filter-actions"><Link href="/opportunities/new">{commercialIntakeCopy[locale].title}</Link></div><CommandCenterView locale={locale} summary={summary} commercialActions={commercialActions} dataAsOf={null} /></div>;
}
