import{CapabilityPage}from"../../components/ui/capability-page";import{resolveServerLocale}from"../../i18n/server-locale";import{t}from"../../i18n/translate";
export default async function Page(){const locale=await resolveServerLocale();return <CapabilityPage title={t(locale,"routes.sources.title")} description={t(locale,"routes.sources.description")} icon="source" backendReady locale={locale}/>}
