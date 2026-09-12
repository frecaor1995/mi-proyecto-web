begin;

-- Fly Workforce Radar LOCAL-ONLY deterministic development data.
-- Every business-facing value is deliberately marked DEMO / LOCAL / SYNTHETIC.
-- Fixed identifiers make route validation repeatable after `supabase db reset`.

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000',
  '10000000-0000-4000-8000-000000000001',
  'authenticated', 'authenticated', 'local-workforce-operator@example.invalid',
  null, '2026-09-01T12:00:00Z', '', '', '', '',
  '{"provider":"email","providers":["email"],"local_only":true}'::jsonb,
  '{"display_name":"DEMO LOCAL Workforce Operator"}'::jsonb,
  '2026-09-01T12:00:00Z', '2026-09-01T12:00:00Z'
);

insert into auth.identities (
  id, provider_id, user_id, identity_data, provider,
  last_sign_in_at, created_at, updated_at
) values (
  '10000000-0000-4000-8000-000000000002',
  '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  '{"sub":"10000000-0000-4000-8000-000000000001","email":"local-workforce-operator@example.invalid","email_verified":true,"phone_verified":false}'::jsonb,
  'email', '2026-09-01T12:00:00Z', '2026-09-01T12:00:00Z', '2026-09-01T12:00:00Z'
);

insert into workforce_operators (
  id, auth_user_id, email, display_name, status, permissions, created_at, updated_at
) values (
  '20000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  'local-workforce-operator@example.invalid',
  'DEMO LOCAL Workforce Operator', 'ACTIVE',
  array['human_verification.write','commercial_economics.write','commercial_economics.decide'],
  '2026-09-01T12:00:00Z', '2026-09-01T12:00:00Z'
);

insert into sources (
  id, name, source_type, domain, base_url, access_classification,
  allowed_capture_methods, requires_auth, paywalled, enabled,
  robots_review_status, tos_review_status, health_status, source_metadata,
  first_seen_at, last_seen_at, created_at, updated_at
) values (
  '30000000-0000-4000-8000-000000000001',
  'DEMO LOCAL SYNTHETIC Source', 'OTHER',
  'localhost.invalid', 'http://localhost.invalid/workforce-demo', 'PUBLIC',
  array['LOCAL_SYNTHETIC_SEED'], false, false, true,
  'NOT_REVIEWED', 'NOT_REVIEWED', 'UNKNOWN',
  '{"synthetic":true,"environment":"LOCAL","warning":"Not verified commercial intelligence"}'::jsonb,
  '2026-09-01T12:00:00Z', '2026-09-10T12:00:00Z',
  '2026-09-01T12:00:00Z', '2026-09-10T12:00:00Z'
);

insert into companies (
  id, legal_name, common_name, industry_metadata, first_seen_at, last_seen_at,
  created_at, updated_at, normalized_legal_name, normalized_common_name
) values (
  '40000000-0000-4000-8000-000000000001',
  'DEMO LOCAL SYNTHETIC Electrical Contractor LLC',
  'DEMO LOCAL Contractor',
  '{"synthetic":true,"industry":"DEMO electrical contracting"}'::jsonb,
  '2026-09-01T12:00:00Z', '2026-09-10T12:00:00Z',
  '2026-09-01T12:00:00Z', '2026-09-10T12:00:00Z',
  'demo local synthetic electrical contractor llc', 'demo local contractor'
);

insert into projects (
  id, name, location_text, city, county, state, owner_company_id,
  first_seen_at, last_seen_at, created_at, updated_at
) values (
  '50000000-0000-4000-8000-000000000001',
  'DEMO LOCAL SYNTHETIC Distribution Center',
  'DEMO LOCAL Site — Arlington, Virginia', 'Arlington', 'Arlington', 'VA',
  '40000000-0000-4000-8000-000000000001',
  '2026-09-01T12:00:00Z', '2026-09-10T12:00:00Z',
  '2026-09-01T12:00:00Z', '2026-09-10T12:00:00Z'
);

insert into opportunities (
  id, title, project_id, first_seen_at, last_seen_at, stale_after,
  verification_due_at, created_at, updated_at, lifecycle,
  opportunity_identity_key, unresolved_company_context, opportunity_metadata
) values
  (
    '60000000-0000-4000-8000-000000000001',
    'DEMO LOCAL SYNTHETIC — Complete Electrical Workforce Opportunity',
    '50000000-0000-4000-8000-000000000001',
    '2026-09-01T12:00:00Z', '2026-09-10T12:00:00Z', '2026-10-10T12:00:00Z',
    '2026-09-18T12:00:00Z', '2026-09-01T12:00:00Z', '2026-09-10T12:00:00Z',
    'ACTIVE', 'demo-local-complete-opportunity', null,
    '{"synthetic":true,"completeness":"DEMO_COMPLETE","warning":"Local development data only"}'::jsonb
  ),
  (
    '60000000-0000-4000-8000-000000000002',
    'DEMO LOCAL SYNTHETIC — Intentionally Incomplete Opportunity',
    null, '2026-09-09T12:00:00Z', '2026-09-09T12:00:00Z', null,
    '2026-09-16T12:00:00Z', '2026-09-09T12:00:00Z', '2026-09-09T12:00:00Z',
    'UNKNOWN', 'demo-local-incomplete-opportunity',
    'DEMO LOCAL — company and project intentionally unresolved',
    '{"synthetic":true,"completeness":"INTENTIONALLY_INCOMPLETE","missing":["company","project","economics","decision"]}'::jsonb
  );

insert into raw_evidence (
  id, source_id, source_url, captured_at, capture_method, content_hash,
  extractor_version, metadata, content_type, payload_size_bytes, http_metadata, created_at
) values (
  '70000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001',
  'http://localhost.invalid/workforce-demo/evidence/complete-opportunity',
  '2026-09-10T12:00:00Z', 'LOCAL_SYNTHETIC_SEED',
  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  'local-seed-v1',
  '{"synthetic":true,"warning":"DEMO evidence; not externally verified"}'::jsonb,
  'application/json', 256, '{"local":true}'::jsonb, '2026-09-10T12:00:00Z'
);

insert into opportunity_companies (opportunity_id, company_id, link_reason, evidence_id, created_at)
values (
  '60000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000001',
  'DEMO LOCAL SYNTHETIC relationship',
  '70000000-0000-4000-8000-000000000001', '2026-09-10T12:00:00Z'
);

insert into opportunity_evidence (opportunity_id, evidence_id, link_reason, created_at)
values (
  '60000000-0000-4000-8000-000000000001',
  '70000000-0000-4000-8000-000000000001',
  'DEMO LOCAL SYNTHETIC support only', '2026-09-10T12:00:00Z'
);

insert into demand_signals (
  id, title, role_type, publisher_company_id, publisher_type, city, county, state,
  pay_currency, base_pay_min, base_pay_max, pay_period, overtime_available,
  overtime_rate, overtime_terms, per_diem_available, per_diem_amount,
  per_diem_frequency, schedule, headcount_estimate, published_at, first_seen_at,
  last_seen_at, stale_after, verification_due_at, source_id, raw_evidence_id,
  original_title, external_posting_id, source_identity_key, parser_version,
  source_compensation_text, normalized_metadata, created_at, updated_at
) values (
  '80000000-0000-4000-8000-000000000001',
  'DEMO LOCAL SYNTHETIC Journeyman Electricians', 'ELECTRICIAN',
  '40000000-0000-4000-8000-000000000001', 'DEMO_CONTRACTOR',
  'Arlington', 'Arlington', 'VA', 'USD', 30.00, 34.00, 'HOUR', true,
  1.500, 'DEMO LOCAL assumption', false, 0.00, 'DAY', 'DEMO 4x10', 4,
  '2026-09-01T12:00:00Z', '2026-09-01T12:00:00Z', '2026-09-10T12:00:00Z',
  '2026-10-10T12:00:00Z', '2026-09-18T12:00:00Z',
  '30000000-0000-4000-8000-000000000001',
  '70000000-0000-4000-8000-000000000001',
  'DEMO LOCAL SYNTHETIC Journeyman Electricians', 'DEMO-LOCAL-001',
  'demo-local-source-identity-001', 'local-seed-v1',
  'DEMO LOCAL: synthetic $30–$34/hour; not market intelligence',
  '{"synthetic":true,"certainty":"UNVERIFIED_SOURCED"}'::jsonb,
  '2026-09-01T12:00:00Z', '2026-09-10T12:00:00Z'
);

insert into opportunity_demand_signals (opportunity_id, demand_signal_id, created_at)
values (
  '60000000-0000-4000-8000-000000000001',
  '80000000-0000-4000-8000-000000000001', '2026-09-10T12:00:00Z'
);

insert into commercial_terms_versions (
  id, context_type, company_id, opportunity_id, terms,
  supporting_claim_ids, supporting_evidence_ids, rule_version, asserted_by,
  evaluated_at, supersedes_commercial_terms_id, created_at
) values (
  '90000000-0000-4000-8000-000000000001', 'OPPORTUNITY', null,
  '60000000-0000-4000-8000-000000000001',
  '{
    "billRate":{"tier":"OPERATOR_ASSUMPTION","value":{"amount":85,"currency":"USD"}},
    "overtimeBillBasis":{"tier":"OPERATOR_ASSUMPTION","value":{"kind":"MULTIPLIER","multiplier":{"value":1.5}}},
    "reimbursablePerDiem":{"tier":"OPERATOR_ASSUMPTION","value":{"amount":0,"currency":"USD"}},
    "perDiemMarkup":{"tier":"OPERATOR_ASSUMPTION","value":{"value":0}},
    "paymentTerms":{"tier":"OPERATOR_ASSUMPTION","value":{"days":30}},
    "billingCadence":{"tier":"OPERATOR_ASSUMPTION","value":"WEEKLY"}
  }'::jsonb,
  '{}', array['70000000-0000-4000-8000-000000000001'::uuid],
  'local-seed-commercial-terms-v1', 'DEMO LOCAL Workforce Operator',
  '2026-09-10T12:00:00Z', null, '2026-09-10T12:00:00Z'
);

insert into burden_profile_versions (
  id, scope_level, jurisdiction, trade_id, occupation_id, company_id, scenario_id,
  components, rule_version, asserted_by, evaluated_at,
  supersedes_burden_profile_id, created_at
) values (
  'a0000000-0000-4000-8000-000000000001', 'PLATFORM_DEFAULT',
  null, null, null, null, null,
  '[{"type":"PAYROLL_TAX","rate":{"tier":"OPERATOR_ASSUMPTION","value":{"value":0.0765}},"appliesTo":["REGULAR_WAGES","OVERTIME_BASE_PORTION","OVERTIME_PREMIUM_PORTION"]}]'::jsonb,
  'local-seed-burden-v1', 'DEMO LOCAL Workforce Operator',
  '2026-09-10T12:00:00Z', null, '2026-09-10T12:00:00Z'
);

insert into economics_scenario_snapshots (
  id, opportunity_id, scenario_label, commercial_terms_version_id,
  burden_profile_version_id, basis, result, rule_version, asserted_by,
  evaluated_at, as_of, supersedes_scenario_id, created_at
) values (
  'b0000000-0000-4000-8000-000000000001',
  '60000000-0000-4000-8000-000000000001', 'BASE',
  '90000000-0000-4000-8000-000000000001',
  'a0000000-0000-4000-8000-000000000001',
  '{"resolvedInputs":{"synthetic":true,"note":"DEMO LOCAL resolved inputs; no external commercial truth"}}'::jsonb,
  '{
    "economics":{
      "billing":{"completeTotalWorkforcePerWeek":{"state":"KNOWN","tier":"OPERATOR_ASSUMPTION","value":{"amount":13600,"currency":"USD"}}},
      "labor":{"completeTotalWorkforcePerWeek":{"state":"KNOWN","tier":"OPERATOR_ASSUMPTION","value":{"amount":5167.2,"currency":"USD"}},"workerPerDiemCost":{"state":"KNOWN","tier":"OPERATOR_ASSUMPTION","value":{"amount":0,"currency":"USD"}}},
      "grossProfit":{}
    },
    "cashFlow":{"complete":{"workingCapital":{"state":"KNOWN","tier":"OPERATOR_ASSUMPTION","value":{"workingCapitalRequirement":{"amount":20668.8,"currency":"USD"},"fundingNeededWeek":0,"recovery":{"kind":"RECOVERED","weekIndex":5}}},"ledger":{"state":"KNOWN","tier":"OPERATOR_ASSUMPTION","value":{"currency":"USD","entries":[{"weekIndex":0,"outflows":[],"inflows":[],"totalOutflow":{"amount":5167.2,"currency":"USD"},"totalInflow":{"amount":0,"currency":"USD"},"netCashFlow":{"amount":-5167.2,"currency":"USD"},"cumulativeCash":{"amount":-5167.2,"currency":"USD"}},{"weekIndex":5,"outflows":[],"inflows":[],"totalOutflow":{"amount":5167.2,"currency":"USD"},"totalInflow":{"amount":13600,"currency":"USD"},"netCashFlow":{"amount":8432.8,"currency":"USD"},"cumulativeCash":{"amount":3265.6,"currency":"USD"}}]}}},"laborOnly":{}},
    "profitability":{"complete":{"grossProfit":{"state":"KNOWN","tier":"OPERATOR_ASSUMPTION","value":{"amount":8432.8,"currency":"USD"}},"grossMargin":{"state":"KNOWN","tier":"OPERATOR_ASSUMPTION","value":{"value":0.6200588235}},"classification":"PROFIT"},"laborOnly":{"grossProfit":{"state":"KNOWN","tier":"OPERATOR_ASSUMPTION","value":{"amount":8432.8,"currency":"USD"}},"grossMargin":{"state":"KNOWN","tier":"OPERATOR_ASSUMPTION","value":{"value":0.6200588235}},"classification":"PROFIT"}},
    "weakestTier":"OPERATOR_ASSUMPTION",
    "blockingReasons":["DEMO LOCAL: commercial values are operator assumptions, not verified market intelligence"]
  }'::jsonb,
  'local-seed-scenario-v1', 'DEMO LOCAL Workforce Operator',
  '2026-09-10T12:00:00Z', '2026-09-10T12:00:00Z', null,
  '2026-09-10T12:00:00Z'
);

insert into economic_decisions (
  id, opportunity_id, scenario_snapshot_id, disposition, rationale,
  scenario_effective_certainty, scenario_blocking_reasons, rule_version,
  decided_by, decided_at, supersedes_decision_id, created_at
) values
  (
    'c0000000-0000-4000-8000-000000000001',
    '60000000-0000-4000-8000-000000000001',
    'b0000000-0000-4000-8000-000000000001', 'DEFER',
    'DEMO LOCAL human decision: postpone pending review of synthetic operator-assumption terms.',
    'OPERATOR_ASSUMPTION',
    array['DEMO LOCAL: commercial values are operator assumptions, not verified market intelligence'],
    'local-seed-economic-decision-v1',
    '20000000-0000-4000-8000-000000000001',
    '2026-09-10T13:00:00Z', null, '2026-09-10T13:00:00Z'
  ),
  (
    'c0000000-0000-4000-8000-000000000002',
    '60000000-0000-4000-8000-000000000001',
    'b0000000-0000-4000-8000-000000000001', 'PROCEED',
    'DEMO LOCAL human decision: continue the synthetic exercise despite assumption-tier economics; this is not a system recommendation.',
    'OPERATOR_ASSUMPTION',
    array['DEMO LOCAL: commercial values are operator assumptions, not verified market intelligence'],
    'local-seed-economic-decision-v1',
    '20000000-0000-4000-8000-000000000001',
    '2026-09-10T14:00:00Z',
    'c0000000-0000-4000-8000-000000000001', '2026-09-10T14:00:00Z'
  );

insert into human_verification_tasks (
  id, company_id, opportunity_id, project_id, target_type, target_id,
  verification_objective, question_type, primary_question, follow_up_question,
  blocker_code, preferred_method, assigned_operator_id, trade_id, occupation_id,
  scope, packet_snapshot, deduplication_key, status, due_at, created_by,
  rule_version, created_at
) values (
  'd0000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000001',
  '60000000-0000-4000-8000-000000000001',
  '50000000-0000-4000-8000-000000000001',
  'PROJECT', '50000000-0000-4000-8000-000000000001',
  'DEMO LOCAL verification of the synthetic project relationship',
  'RELATIONSHIP',
  'DEMO LOCAL: confirm that this record is synthetic and must not be treated as verified intelligence.',
  'Record a synthetic-only assessment; do not contact any real party.',
  'DEMO_SYNTHETIC_REVIEW', null,
  '20000000-0000-4000-8000-000000000001', 'ELECTRICAL', 'ELECTRICIAN',
  '{"environment":"LOCAL","synthetic":true}'::jsonb,
  '{"evidenceIds":["70000000-0000-4000-8000-000000000001"],"warning":"DEMO LOCAL only"}'::jsonb,
  'demo-local-synthetic-project-verification', 'ASSIGNED',
  '2026-09-18T12:00:00Z', 'LOCAL_BOOTSTRAP',
  'local-seed-human-verification-v1', '2026-09-10T12:00:00Z'
);

commit;
