-- The Next.js polling route currently forwards a `summary` snapshot to the
-- frontend as soon as a job completes (before the separate /result/{runId}
-- fetch resolves), matching the worker's local-file job status today. Keep
-- that behavior identical after the Cloud Run Job switch instead of relying
-- solely on the follow-up result fetch.

alter table public.avatar_analyzer_jobs add column summary jsonb;
