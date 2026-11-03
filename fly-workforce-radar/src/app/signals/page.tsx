import{CapabilityPage}from"../../components/ui/capability-page";import{resolveServerLocale}from"../../i18n/server-locale";import{t}from"../../i18n/translate";
export default async function Page(){const locale=await resolveServerLocale();return <CapabilityPage title={t(locale,"routes.signals.title")} description={t(locale,"routes.signals.description")} icon="signal" backendReady locale={locale}/>}
