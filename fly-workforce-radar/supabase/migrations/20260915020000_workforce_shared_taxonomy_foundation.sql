-- WORKFORCE PUBLICATION R3-B/R3-R2: shared canonical workforce taxonomy and
-- demand-requirement foundation. Extracted verbatim (table/constraint/index
-- definitions and seed data unchanged) from the pre-existing, unpublished
-- 20260914094253_canonical_multi_profession_demand.sql, whose taxonomy
-- tables were discovered to be a hard, undeclared dependency of
-- 20260915022837 (unconditional runtime GRANT on demand_skill_requirements/
-- demand_credential_requirements), 20260915090000 (RLS policies), and
-- 20260915100000 (foreign keys on trade_code/occupation_code/skill_code/
-- credential_code) -- Workforce Talent's schema and security foundation
-- cannot be created on a fresh database without these tables existing
-- first. Timestamped 20260915020000, before 20260915022837, specifically
-- so 022837's own unconditional grant on the two demand-requirement tables
-- is satisfied at execution time (R3-R1 proved retimestamping was required:
-- a later migration cannot satisfy an earlier one's dependency). This
-- The unpublished source migration was removed from the executable chain to
-- avoid creating these taxonomy tables twice. Its demand_signals columns,
-- constraints, and deterministic legacy-role backfill are retained below so
-- later Matching migrations receive the complete canonical demand contract.
-- demand_signals and raw_evidence themselves are guaranteed to already exist
-- (20260817010000_canonical_model.sql).

create table public.workforce_trades (
  code text primary key,
  label_en text not null,
  label_es text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.workforce_occupations (
  code text primary key,
  trade_code text not null references public.workforce_trades(code),
  label_en text not null,
  label_es text not null,
  role_class text not null check (role_class in ('CRAFT','TECHNICIAN','SUPERVISION','MANAGEMENT','ENGINEERING','PROFESSIONAL','SUPPORT','UNKNOWN')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (code, trade_code)
);

create table public.workforce_skills (
  code text primary key,
  trade_code text references public.workforce_trades(code),
  label_en text not null,
  label_es text not null,
  active boolean not null default true
);

create table public.workforce_credentials (
  code text primary key,
  trade_code text references public.workforce_trades(code),
  label_en text not null,
  label_es text not null,
  credential_type text not null,
  active boolean not null default true
);

insert into public.workforce_trades (code,label_en,label_es) values
 ('ELECTRICAL','Electrical','Electricidad'),('HVAC','HVAC','HVAC'),
 ('PLUMBING','Plumbing','Plomería'),('PIPEFITTING','Pipefitting','Tubería industrial'),
 ('WELDING','Welding','Soldadura'),('INSTRUMENTATION_CONTROLS','Instrumentation & Controls','Instrumentación y controles'),
 ('LOW_VOLTAGE','Low Voltage','Bajo voltaje'),('FIBER','Fiber','Fibra óptica'),
 ('GENERAL_CRAFT','General Craft','Oficios generales'),('FIELD_MANAGEMENT','Field Management','Gestión de campo');

insert into public.workforce_occupations (code,trade_code,label_en,label_es,role_class) values
 ('ELECTRICIAN','ELECTRICAL','Electrician','Electricista','CRAFT'),
 ('ELECTRICAL_FOREMAN','ELECTRICAL','Electrical Foreman','Capataz eléctrico','SUPERVISION'),
 ('ELECTRICAL_SUPERINTENDENT','ELECTRICAL','Electrical Superintendent','Superintendente eléctrico','SUPERVISION'),
 ('HVAC_TECHNICIAN','HVAC','HVAC Technician','Técnico de HVAC','TECHNICIAN'),
 ('PLUMBER','PLUMBING','Plumber','Plomero','CRAFT'),('PIPEFITTER','PIPEFITTING','Pipefitter','Tubero industrial','CRAFT'),
 ('WELDER','WELDING','Welder','Soldador','CRAFT'),
 ('INSTRUMENTATION_TECHNICIAN','INSTRUMENTATION_CONTROLS','Instrumentation Technician','Técnico de instrumentación','TECHNICIAN'),
 ('LOW_VOLTAGE_TECHNICIAN','LOW_VOLTAGE','Low Voltage Technician','Técnico de bajo voltaje','TECHNICIAN'),
 ('FIBER_TECHNICIAN','FIBER','Fiber Technician','Técnico de fibra óptica','TECHNICIAN'),
 ('GENERAL_CRAFT_LABORER','GENERAL_CRAFT','General Craft Laborer','Trabajador de oficios generales','CRAFT'),
 ('GENERAL_SUPERINTENDENT','FIELD_MANAGEMENT','General Superintendent','Superintendente general','SUPERVISION'),
 ('PROJECT_MANAGER','FIELD_MANAGEMENT','Project Manager','Gerente de proyecto','MANAGEMENT');

insert into public.workforce_skills (code,trade_code,label_en,label_es) values
 ('INDUSTRIAL_ELECTRICAL','ELECTRICAL','Industrial electrical','Electricidad industrial'),
 ('CONTROLS','INSTRUMENTATION_CONTROLS','Controls','Controles'),
 ('TIG','WELDING','TIG welding','Soldadura TIG'),('SMAW','WELDING','SMAW welding','Soldadura SMAW'),
 ('FIBER_SPLICING','FIBER','Fiber splicing','Empalme de fibra');

insert into public.workforce_credentials (code,trade_code,label_en,label_es,credential_type) values
 ('ELECTRICAL_LICENSE','ELECTRICAL','Electrical license','Licencia eléctrica','LICENSE'),
 ('OSHA_10',null,'OSHA 10','OSHA 10','SAFETY'),('OSHA_30',null,'OSHA 30','OSHA 30','SAFETY'),
 ('EPA_CFC','HVAC','EPA CFC certification','Certificación EPA CFC','CERTIFICATION'),
 ('WELDING_CERTIFICATION','WELDING','Welding certification','Certificación de soldadura','CERTIFICATION');

create table public.demand_skill_requirements (
  demand_signal_id uuid not null references public.demand_signals(id) on delete cascade,
  skill_code text not null references public.workforce_skills(code),
  requirement_level text not null check (requirement_level in ('REQUIRED','PREFERRED')),
  source_label text,
  raw_evidence_id uuid references public.raw_evidence(id),
  created_at timestamptz not null default now(),
  primary key (demand_signal_id,skill_code,requirement_level)
);

create table public.demand_credential_requirements (
  demand_signal_id uuid not null references public.demand_signals(id) on delete cascade,
  credential_code text not null references public.workforce_credentials(code),
  requirement_level text not null check (requirement_level in ('REQUIRED','PREFERRED')),
  jurisdiction text,
  source_requirement_text text,
  raw_evidence_id uuid references public.raw_evidence(id),
  created_at timestamptz not null default now(),
  primary key (demand_signal_id,credential_code,requirement_level)
);

alter table public.demand_signals
  add column project_id uuid references public.projects(id),
  add column unresolved_project_context text,
  add column trade_code text references public.workforce_trades(code),
  add column occupation_code text,
  add column source_role_label text,
  add column minimum_experience_months integer check (minimum_experience_months >= 0),
  add column travel_required boolean,
  add column relocation_required boolean,
  add column shift text,
  add column hours_per_day numeric check (hours_per_day > 0 and hours_per_day <= 24),
  add column hours_per_week numeric check (hours_per_week > 0 and hours_per_week <= 168),
  add column start_date date,
  add column expected_end_date date,
  add column duration_text text,
  add column demand_status text check (demand_status in ('CURRENT','STALE','EXPIRED','UNKNOWN')),
  add column verification_state text check (verification_state in ('VERIFIED','UNVERIFIED','DISPUTED','UNKNOWN')),
  add column last_verified_at timestamptz,
  add column evidence_tier text,
  add constraint demand_signals_occupation_trade_fk foreign key (occupation_code,trade_code)
    references public.workforce_occupations(code,trade_code),
  add constraint demand_signals_occupation_requires_trade check (occupation_code is null or trade_code is not null),
  add constraint demand_signals_date_order check (expected_end_date is null or start_date is null or expected_end_date >= start_date),
  add constraint demand_signals_verified_timestamp check (verification_state <> 'VERIFIED' or last_verified_at is not null),
  add constraint demand_signals_current_freshness check (demand_status <> 'CURRENT' or (published_at is not null and stale_after is not null));

update public.demand_signals set
 trade_code = case when role_type in ('INSTRUMENTATION','E_AND_I') then 'INSTRUMENTATION_CONTROLS' else 'ELECTRICAL' end,
 occupation_code = case
   when role_type in ('INSTRUMENTATION','E_AND_I') then 'INSTRUMENTATION_TECHNICIAN'
   when role_type in ('FOREMAN','GENERAL_FOREMAN') then 'ELECTRICAL_FOREMAN'
   when role_type = 'SUPERINTENDENT' then 'ELECTRICAL_SUPERINTENDENT'
   else 'ELECTRICIAN' end,
 source_role_label = coalesce(original_title,title)
where role_type in ('APPRENTICE_ELECTRICIAN','ELECTRICIAN','JOURNEYMAN_ELECTRICIAN','INDUSTRIAL_ELECTRICIAN','ELECTRICAL_TECHNICIAN','INSTRUMENTATION','E_AND_I','FOREMAN','GENERAL_FOREMAN','SUPERINTENDENT');

alter table public.workforce_trades enable row level security;
alter table public.workforce_occupations enable row level security;
alter table public.workforce_skills enable row level security;
alter table public.workforce_credentials enable row level security;
alter table public.demand_skill_requirements enable row level security;
alter table public.demand_credential_requirements enable row level security;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on public.workforce_trades, public.workforce_occupations, public.workforce_skills,
      public.workforce_credentials, public.demand_skill_requirements, public.demand_credential_requirements from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on public.workforce_trades, public.workforce_occupations, public.workforce_skills,
      public.workforce_credentials, public.demand_skill_requirements, public.demand_credential_requirements from authenticated;
  end if;
end $$;
