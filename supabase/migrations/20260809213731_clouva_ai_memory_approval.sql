-- Task 13: approved conversational memory, scoped to a user or Studio.
-- Proposals stay in ai_messages.metadata and therefore inherit the existing
-- conversation/message RLS. Only an explicitly approved proposal is promoted
-- into project_memory.

alter table public.project_memory
  add column if not exists studio_id uuid references public.studios(id) on delete cascade,
  add column if not exists source_message_id uuid references public.ai_messages(id) on delete set null,
  add column if not exists approved_by uuid references auth.users(id) on delete set null,
  add column if not exists approved_at timestamptz,
  add column if not exists dedupe_key text;

-- Existing personal memories are already effective/approved. Backfill their
-- provenance marker and deterministic content fingerprint before making the
-- new fields part of the canonical contract.
update public.project_memory
set dedupe_key = encode(
      digest(lower(trim(memory_type) || '|' || trim(title) || '|' || trim(content)), 'sha256'),
      'hex'
    ),
    approved_by = coalesce(approved_by, user_id),
    approved_at = coalesce(approved_at, created_at),
    metadata = metadata || '{"approval_origin":"legacy_pre_task_13"}'::jsonb
where dedupe_key is null;

alter table public.project_memory
  alter column dedupe_key set not null;

alter table public.project_memory drop constraint if exists project_memory_scope_check;
alter table public.project_memory
  add constraint project_memory_scope_check
  check (studio_id is null or project_key = 'clouva');

create unique index if not exists project_memory_personal_dedupe_idx
  on public.project_memory(user_id, project_key, dedupe_key)
  where studio_id is null;

create unique index if not exists project_memory_studio_dedupe_idx
  on public.project_memory(studio_id, project_key, dedupe_key)
  where studio_id is not null;

create unique index if not exists project_memory_source_message_idx
  on public.project_memory(source_message_id)
  where source_message_id is not null;

create index if not exists project_memory_studio_context_idx
  on public.project_memory(studio_id, project_key, status, importance desc, updated_at desc)
  where studio_id is not null;

-- Task 11/13 decisions lock and resolve metadata on the assistant message.
-- Production currently has SELECT + INSERT policies but no UPDATE policy, so
-- add the missing operation without allowing a Studio participant to mutate a
-- message authored for another user.
drop policy if exists ai_messages_update on public.ai_messages;
create policy ai_messages_update
  on public.ai_messages for update
  to authenticated
  using (
    (select auth.uid()) = user_id
    and exists (
      select 1
      from public.ai_conversations c
      where c.id = ai_messages.conversation_id
        and (
          (c.studio_id is null and c.user_id = (select auth.uid()))
          or (
            c.studio_id is not null
            and public.is_active_studio_participant(c.studio_id, (select auth.uid()))
          )
        )
    )
  )
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1
      from public.ai_conversations c
      where c.id = ai_messages.conversation_id
        and (
          (c.studio_id is null and c.user_id = (select auth.uid()))
          or (
            c.studio_id is not null
            and public.is_active_studio_participant(c.studio_id, (select auth.uid()))
          )
        )
    )
  );

drop policy if exists "users manage own project memory" on public.project_memory;
drop policy if exists project_memory_select on public.project_memory;
drop policy if exists project_memory_insert on public.project_memory;
drop policy if exists project_memory_update on public.project_memory;
drop policy if exists project_memory_delete on public.project_memory;

create policy project_memory_select
  on public.project_memory for select
  to authenticated
  using (
    (studio_id is null and (select auth.uid()) = user_id)
    or (
      studio_id is not null
      and public.is_active_studio_participant(studio_id, (select auth.uid()))
    )
  );

create policy project_memory_insert
  on public.project_memory for insert
  to authenticated
  with check (
    (select auth.uid()) = user_id
    and (
      studio_id is null
      or public.can_manage_studio(studio_id, (select auth.uid()))
    )
  );

create policy project_memory_update
  on public.project_memory for update
  to authenticated
  using (
    (select auth.uid()) = user_id
    and (
      studio_id is null
      or public.can_manage_studio(studio_id, (select auth.uid()))
    )
  )
  with check (
    (select auth.uid()) = user_id
    and (
      studio_id is null
      or public.can_manage_studio(studio_id, (select auth.uid()))
    )
  );

create policy project_memory_delete
  on public.project_memory for delete
  to authenticated
  using (
    (select auth.uid()) = user_id
    and (
      studio_id is null
      or public.can_manage_studio(studio_id, (select auth.uid()))
    )
  );
