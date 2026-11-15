begin;

-- TX-INTEGRITY-04B. human_interactions already carries a generic `metadata`
-- jsonb column (populated in the same INSERT that creates the row -- see
-- postgres-human-verification-repository.ts createInteraction), and
-- raw_evidence already carries interactionId/assessmentId in ITS metadata
-- (see human-verification-closure-service.ts). human_response_assessments is
-- the one row in the response-capture recovery chain with no existing
-- surface to durably carry the idempotencyKey that produced it -- this is
-- the single narrow, additive schema element TX-INTEGRITY-04A's architecture
-- freeze identified as genuinely required (04A report AF/AT/D6).
--
-- A plain nullable text column, not a generic jsonb metadata bag: the
-- recovery invariant this exists to satisfy is exactly one thing --
-- "given a stuck response-capture idempotency key, deterministically find
-- the assessment (if any) produced by this logical submission" -- and
-- nothing else in this table's write paths (human verification assessments
-- created outside response capture, if any exist today or in the future)
-- needs a generic metadata bag to satisfy that. A plain text column is also
-- directly indexable without an expression index.
alter table human_response_assessments add column idempotency_key text;

-- Exactly one assessment can ever be produced by one logical response-capture
-- submission (executeProtectedHumanVerificationResponseCapture calls
-- assessResponse at most once per invocation) -- so a second INSERT
-- attempting to reuse the same idempotency_key is never legitimate and
-- should fail closed at the database level as defense-in-depth alongside the
-- application-level recovery check, not just be silently allowed. This does
-- NOT constrain legitimate reassessment: a genuine reassessment is a new
-- logical submission and therefore always carries a NEW idempotency key
-- (supersedes_assessment_id already carries the reassessment relationship
-- separately and is untouched here). Assessments created by any other
-- workflow, or existing assessments created before this column existed,
-- simply have idempotency_key null, and this partial index places no
-- constraint on null values at all.
create unique index human_response_assessments_idempotency_key_idx
  on human_response_assessments(idempotency_key)
  where idempotency_key is not null;

commit;
