begin;

-- TX-INTEGRITY-05B. Refuse to guess a winner if an environment already
-- contains more than one unfinished response-capture claim for one task.
do $$
begin
  if exists(
    select 1
      from command_idempotency_keys
     where action='human_verification.capture_response'
       and target_type='HUMAN_VERIFICATION_TASK'
       and result is null
     group by target_type,target_id
    having count(*)>1
  ) then
    raise exception 'TX-INTEGRITY-05B cannot install active task guard: duplicate active response-capture claims exist';
  end if;
end;$$;

-- One unfinished logical response capture owns one human-verification task.
-- Completed historical keys remain append-only and unconstrained by this
-- predicate, while a crashed IN_PROGRESS key durably reserves the task for
-- TX-INTEGRITY-04B same-key recovery.
create unique index command_idempotency_active_response_capture_task_idx
  on command_idempotency_keys(target_type,target_id)
  where action='human_verification.capture_response'
    and target_type='HUMAN_VERIFICATION_TASK'
    and result is null;

commit;
