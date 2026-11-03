import { resolveServerLocale } from "../../i18n/server-locale";
import { CommandCenterView } from "../../components/command-center/command-center-view";
import { ProductOverview } from "../../components/command-center/product-overview";
import { getCommandCenterPageData } from "../../server/command-center/get-command-center-summary";
import { getWorkforceOverview } from "../../server/command-center/get-workforce-overview";
import { loadSignalCounts } from "../../server/opportunity-discovery/signals";

export default async function CommandCenter() {
  const locale = await resolveServerLocale();
  const asOf = new Date();
  const [{ summary, commercialActions, demoCommercialActions, demo }, overview, signals] = await Promise.all([getCommandCenterPageData(asOf), getWorkforceOverview(), loadSignalCounts()]);
  // dataAsOf stays null: `asOf` above is only the computation instant for
  // currentness math, not a real evidence timestamp -- see UI-3 section 16.
  return <div className="page-stack"><ProductOverview locale={locale} result={overview} signals={signals} /><CommandCenterView locale={locale} summary={summary} commercialActions={commercialActions} demoCommercialActions={demoCommercialActions} demoMetrics={demo} dataAsOf={null} /></div>;
}
