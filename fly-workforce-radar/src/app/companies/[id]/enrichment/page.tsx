import { notFound } from "next/navigation";
import { resolveServerLocale } from "../../../../i18n/server-locale";
import { getProductionSqlClient } from "../../../../server/database/production-sql-client";
import { loadEnrichmentPeople } from "../../../../server/contact-intelligence/enrichment-service";
import { ContactEnrichmentWorkspace } from "../../../../components/contact-enrichment/contact-enrichment-workspace";
export default async function ContactEnrichmentPage({params}:{readonly params:Promise<{id:string}>}){const [{id},locale]=await Promise.all([params,resolveServerLocale()]);const client=getProductionSqlClient();if(!client)return <p>Contact Intelligence is unavailable. / Inteligencia de contactos no disponible.</p>;const company=(await client.query<{name:string}>("select coalesce(common_name,legal_name) name from companies where id=$1 and merged_into_company_id is null",[id])).rows[0];if(!company)notFound();const people=await loadEnrichmentPeople(client,id);return <ContactEnrichmentWorkspace companyId={id} companyName={company.name} people={people} locale={locale}/>;}
