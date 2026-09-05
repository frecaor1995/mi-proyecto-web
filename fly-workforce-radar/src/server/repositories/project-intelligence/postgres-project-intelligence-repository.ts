import type { SqlClient } from "../evidence/postgres-evidence-repository";

export interface ProjectRow { id:string; name:string|null; location_text:string|null; city:string|null; county:string|null; state:string|null; owner_company_id:string|null; first_seen_at:string|Date|null; last_seen_at:string|Date|null }
export interface ProjectListRow extends ProjectRow { company_count:string; opportunity_count:string; trade_count:string; known_headcount:string|null; pending_verification_count:string; evidence_count:string; total_count:string }
export interface ProjectCompanyRow { company_id:string; company_name:string|null; role:string; assertion_kind:string; verification_state:string; role_basis:string; evidence_id:string|null }
export interface ProjectOpportunityRow { id:string; title:string|null; lifecycle:string; last_seen_at:string|Date|null; company_id:string|null; company_name:string|null }
export interface ProjectDemandRow { id:string; title:string|null; role_type:string|null; city:string|null; state:string|null; headcount_estimate:number|null; per_diem_available:boolean|null; per_diem_amount:number|null; per_diem_frequency:string|null; schedule:string|null; published_at:string|Date|null; last_seen_at:string|Date|null; stale_after:string|Date|null; raw_evidence_id:string|null }
export interface ProjectContactRow { id:string; company_id:string; company_name:string|null; name:string; title:string|null; verification_state:string; route_id:string|null; route_type:string|null; target:string|null; route_grade:string|null; route_verification_state:string|null; route_last_seen_at:string|Date|null; route_stale_after:string|Date|null }
export interface ProjectVendorRow { id:string; company_id:string; company_name:string|null; route_type:string; target:string|null; instructions:string|null; lifecycle:string; last_seen_at:string|Date|null; stale_after:string|Date|null }
export interface ProjectAcceptanceRow { id:string; result:string; reason:string; evaluated_at:string|Date; valid_until:string|Date|null; supporting_evidence_ids:string[] }
export interface ProjectVerificationRow { id:string; status:string; verification_objective:string; primary_question:string; due_at:string|Date|null; created_at:string|Date }
export interface ProjectEvidenceRow { id:string; source_url:string; capture_method:string; captured_at:string|Date; source_name:string|null; supported_context:string }
export interface ProjectBundle { project:ProjectRow; companies:ProjectCompanyRow[]; opportunities:ProjectOpportunityRow[]; demands:ProjectDemandRow[]; contacts:ProjectContactRow[]; vendorRoutes:ProjectVendorRow[]; acceptance:ProjectAcceptanceRow[]; verification:ProjectVerificationRow[]; evidence:ProjectEvidenceRow[] }

/** UI-8's bounded canonical read boundary. Every statement is SELECT-only. */
export class PostgresProjectIntelligenceRepository {
  constructor(private readonly client:SqlClient){}
  async enumerate(search:string,limit:number,offset:number){
    const q=search?`%${search}%`:null;
    const result=await this.client.query<ProjectListRow>(`select p.*,
      (select count(distinct cr.company_id) from company_roles cr where cr.project_id=p.id)::text company_count,
      (select count(*) from opportunities o where o.project_id=p.id)::text opportunity_count,
      (select count(distinct d.role_type) from opportunities o join opportunity_demand_signals ods on ods.opportunity_id=o.id join demand_signals d on d.id=ods.demand_signal_id where o.project_id=p.id and d.role_type is not null)::text trade_count,
      (select sum(x.headcount_estimate)::text from (select distinct d.id,d.headcount_estimate from opportunities o join opportunity_demand_signals ods on ods.opportunity_id=o.id join demand_signals d on d.id=ods.demand_signal_id where o.project_id=p.id and d.headcount_estimate is not null) x) known_headcount,
      (select count(*) from human_verification_tasks h where h.project_id=p.id and h.status not in ('COMPLETED','CANCELLED','DUPLICATE','UNRESOLVABLE'))::text pending_verification_count,
      (select count(distinct el.evidence_id) from evidence_links el where el.project_id=p.id)::text evidence_count,
      count(*) over()::text total_count
      from projects p where ($1::text is null or p.name ilike $1 or p.location_text ilike $1 or p.city ilike $1 or p.county ilike $1 or p.state ilike $1)
      order by p.last_seen_at desc nulls last,p.id limit $2 offset $3`,[q,limit,offset]);
    return {items:result.rows,total:result.rows.length?Number(result.rows[0].total_count):0};
  }
  async get(id:string):Promise<ProjectBundle|null>{
    const base=await this.client.query<ProjectRow>(`select id,name,location_text,city,county,state,owner_company_id,first_seen_at,last_seen_at from projects where id=$1`,[id]);
    if(!base.rows[0])return null;
    const [companies,opportunities,demands,contacts,vendorRoutes,acceptance,verification,evidence]=await Promise.all([
      this.client.query<ProjectCompanyRow>(`select cr.company_id,coalesce(c.common_name,c.legal_name) company_name,cr.role,cr.assertion_kind,cr.verification_state,cr.role_basis,cr.raw_evidence_id evidence_id from company_roles cr join companies c on c.id=cr.company_id where cr.project_id=$1 order by company_name,cr.role`,[id]),
      this.client.query<ProjectOpportunityRow>(`select o.id,o.title,o.lifecycle,o.last_seen_at,oc.company_id,coalesce(c.common_name,c.legal_name) company_name from opportunities o left join lateral(select company_id from opportunity_companies where opportunity_id=o.id order by company_id limit 1)oc on true left join companies c on c.id=oc.company_id where o.project_id=$1 order by o.last_seen_at desc nulls last`,[id]),
      this.client.query<ProjectDemandRow>(`select distinct d.id,d.title,d.role_type,d.city,d.state,d.headcount_estimate,d.per_diem_available,d.per_diem_amount,d.per_diem_frequency,d.schedule,d.published_at,d.last_seen_at,d.stale_after,d.raw_evidence_id from opportunities o join opportunity_demand_signals ods on ods.opportunity_id=o.id join demand_signals d on d.id=ods.demand_signal_id where o.project_id=$1 order by d.last_seen_at desc nulls last`,[id]),
      this.client.query<ProjectContactRow>(`select cp.id,cp.company_id,coalesce(c.common_name,c.legal_name) company_name,cp.name,cp.title,cp.verification_state,cr.id route_id,cr.route_type,cr.target,cr.route_grade,cr.verification_state route_verification_state,cr.last_seen_at route_last_seen_at,cr.stale_after route_stale_after from (select distinct company_id from company_roles where project_id=$1) pc join companies c on c.id=pc.company_id join contact_people cp on cp.company_id=pc.company_id left join contact_routes cr on cr.contact_person_id=cp.id order by company_name,cp.name`,[id]),
      this.client.query<ProjectVendorRow>(`select vr.id,vr.company_id,coalesce(c.common_name,c.legal_name) company_name,vr.route_type,vr.target,vr.instructions,vr.lifecycle,vr.last_seen_at,vr.stale_after from (select distinct company_id from company_roles where project_id=$1) pc join companies c on c.id=pc.company_id join vendor_routes vr on vr.company_id=pc.company_id order by company_name,vr.route_type`,[id]),
      this.client.query<ProjectAcceptanceRow>(`select id,result,reason,evaluated_at,valid_until,supporting_evidence_ids from manpower_acceptance_evaluations where project_id=$1 order by evaluated_at desc`,[id]),
      this.client.query<ProjectVerificationRow>(`select id,status,verification_objective,primary_question,due_at,created_at from human_verification_tasks where project_id=$1 order by created_at desc`,[id]),
      this.client.query<ProjectEvidenceRow>(`select distinct re.id,re.source_url,re.capture_method,re.captured_at,s.name source_name,'PROJECT_RELATIONSHIP' supported_context from evidence_links el join raw_evidence re on re.id=el.evidence_id left join sources s on s.id=re.source_id where el.project_id=$1 union select distinct re.id,re.source_url,re.capture_method,re.captured_at,s.name,'WORKFORCE_DEMAND' from opportunities o join opportunity_demand_signals ods on ods.opportunity_id=o.id join demand_signals d on d.id=ods.demand_signal_id join raw_evidence re on re.id=d.raw_evidence_id left join sources s on s.id=re.source_id where o.project_id=$1 order by captured_at desc`,[id]),
    ]);
    return {project:base.rows[0],companies:companies.rows,opportunities:opportunities.rows,demands:demands.rows,contacts:contacts.rows,vendorRoutes:vendorRoutes.rows,acceptance:acceptance.rows,verification:verification.rows,evidence:evidence.rows};
  }
}
