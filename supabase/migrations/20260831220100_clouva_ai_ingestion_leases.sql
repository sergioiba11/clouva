-- Recoverable leases for CLOUVA AI event ingestion.
-- A worker may die after claiming an event; processing_started_at lets a later
-- run return that event to the retry queue instead of leaving it stuck forever.

alter table public.project_events
  add column if not exists processing_started_at timestamptz;

create index if not exists project_events_processing_lease_idx
  on public.project_events(processing_started_at)
  where processing_status = 'processing';

update public.project_events
set processing_started_at = null
where processing_status <> 'processing'
  and processing_started_at is not null;
