begin;

-- 3I-B3A foundation: maps a Supabase Auth user (auth_user_id) to an internal,
-- admin-provisioned Workforce Radar operator. No public signup writes this
-- table; it is populated only by an administrative provisioning path.
create table workforce_operators(
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null,
  email text not null check(length(trim(email))>0),
  display_name text,
  status text not null default 'ACTIVE' check(status in('ACTIVE','INACTIVE')),
  permissions text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(auth_user_id)
);
create index workforce_operator_status_idx on workforce_operators(status);

create function touch_workforce_operator_updated_at()returns trigger language plpgsql as $$
begin new.updated_at=now(); return new; end;$$;
create trigger workforce_operators_touch_updated_at before update on workforce_operators
  for each row execute function touch_workforce_operator_updated_at();

-- Narrow idempotency foundation for future protected mutations (e.g. B3
-- Human Verification writes). One row claims one logical submission; a
-- retry with the same key/actor/action/target/payload safely replays the
-- stored result instead of re-executing, and any mismatch on those fields
-- is a rejected conflict rather than a silent overwrite.
create table command_idempotency_keys(
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null check(length(trim(idempotency_key))>0),
  operator_id uuid not null references workforce_operators(id) on delete restrict,
  action text not null check(length(trim(action))>0),
  target_type text not null check(length(trim(target_type))>0),
  target_id uuid not null,
  request_fingerprint text not null check(length(trim(request_fingerprint))>0),
  result jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique(idempotency_key)
);
create index command_idempotency_operator_idx on command_idempotency_keys(operator_id,created_at desc);

commit;
