create or replace function public.reorder_video_project_clips(
  p_project_id uuid,
  p_user_id uuid,
  p_clip_ids uuid[]
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_expected integer;
  v_received integer;
begin
  select count(*)::integer
  into v_expected
  from public.media_generation_jobs
  where project_id = p_project_id
    and user_id = p_user_id
    and type = 'video';

  v_received := coalesce(cardinality(p_clip_ids), 0);

  if v_expected = 0 or v_received <> v_expected then
    raise exception 'invalid_clip_order';
  end if;

  if (
    select count(distinct id)::integer
    from unnest(p_clip_ids) as id
  ) <> v_received then
    raise exception 'duplicate_clip_order';
  end if;

  if exists (
    select 1
    from unnest(p_clip_ids) as requested(id)
    left join public.media_generation_jobs jobs
      on jobs.id = requested.id
      and jobs.project_id = p_project_id
      and jobs.user_id = p_user_id
      and jobs.type = 'video'
    where jobs.id is null
  ) then
    raise exception 'foreign_clip_order';
  end if;

  if not exists (
    select 1
    from public.video_projects
    where id = p_project_id
      and user_id = p_user_id
      and status in ('draft', 'failed')
  ) then
    raise exception 'project_locked';
  end if;

  update public.media_generation_jobs
  set sequence_index = -1000000 - sequence_index
  where project_id = p_project_id
    and user_id = p_user_id
    and type = 'video';

  update public.media_generation_jobs jobs
  set sequence_index = requested.ordinality - 1
  from unnest(p_clip_ids) with ordinality as requested(id, ordinality)
  where jobs.id = requested.id
    and jobs.project_id = p_project_id
    and jobs.user_id = p_user_id
    and jobs.type = 'video';
end;
$$;

revoke all on function public.reorder_video_project_clips(uuid, uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.reorder_video_project_clips(uuid, uuid, uuid[]) to service_role;
