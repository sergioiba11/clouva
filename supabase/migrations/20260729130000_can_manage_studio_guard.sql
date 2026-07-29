-- can_manage_studio() is only ever called from RLS policies with p_user_id =
-- auth.uid() -- but being SECURITY DEFINER, it's also directly callable via
-- PostgREST RPC with an arbitrary p_user_id (flagged by the security
-- advisor), which would let anyone probe whether some other user id is a
-- global admin. Guard it so it only ever evaluates for the caller's own id.

create or replace function public.can_manage_studio(p_studio_id uuid, p_user_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select
    p_user_id is not null
    and p_user_id = auth.uid()
    and (
      exists (select 1 from public.studios s where s.id = p_studio_id and s.owner_id = p_user_id)
      or exists (
        select 1 from public.studio_members m
        where m.studio_id = p_studio_id and m.profile_id = p_user_id and m.role = 'admin' and m.status = 'active'
      )
      or exists (select 1 from public.profiles p where p.id = p_user_id and p.role = 'admin')
    );
$$;
