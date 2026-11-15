begin;

alter table public.company_discovery_candidates
  drop constraint company_discovery_candidates_query_kind_check;

alter table public.company_discovery_candidates
  add constraint company_discovery_candidates_query_kind_check
  check (query_kind in (
    'EXACT_COMPANY', 'PROJECTS', 'ELECTRICAL_HIRING', 'WORKFORCE',
    'CONSTRUCTION', 'PROCUREMENT', 'TEXAS', 'DISCOVERED_LOCATION',
    'COMBINED', 'KEYWORD', 'TRADE_PROFESSION', 'LOCATION'
  ));

commit;
