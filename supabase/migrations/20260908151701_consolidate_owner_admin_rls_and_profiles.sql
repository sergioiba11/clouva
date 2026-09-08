-- Consolidate exact owner/admin policy pairs and scope identity-dependent access to authenticated.
-- Preserve the public gallery read and public profile read; remove redundant self policies.

do $$
declare
  tbl text;
  prefix text;
  owner_col text;
  admin_expr text := '(exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = ''admin''::public.app_role))';
  access_expr text;
begin
  foreach tbl in array array[
    'avatar_profiles','clothing_items',
    'flow_agenda_blocks','flow_businesses','flow_content_calendar','flow_finances','flow_flows',
    'flow_launches','flow_lore_entries','flow_money_entries','flow_music_tracks','flow_projects',
    'flow_releases','flow_studio_sessions','flow_vault_files','flow_visuals'
  ]
  loop
    prefix := tbl;
    owner_col := case when tbl in ('avatar_profiles','clothing_items') then 'user_id' else 'owner_id' end;
    access_expr := format('(%I = (select auth.uid()) or %s)', owner_col, admin_expr);

    execute format('drop policy if exists %I on public.%I', prefix || '_admin', tbl);
    execute format('drop policy if exists %I on public.%I', prefix || '_owner', tbl);
    execute format(
      'create policy %I on public.%I for all to authenticated using (%s) with check (%s)',
      prefix || '_owner_or_admin', tbl, access_expr, access_expr
    );
  end loop;
end
$$;

-- Gallery is publicly readable; owner/admin access only needs to govern writes.
drop policy if exists community_gallery_admin on public.community_gallery_items;
drop policy if exists community_gallery_owner on public.community_gallery_items;
create policy community_gallery_owner_or_admin_insert
on public.community_gallery_items for insert to authenticated
with check (
  owner_profile_id = (select auth.uid())
  or exists (select 1 from public.profiles p where p.id=(select auth.uid()) and p.role='admin'::public.app_role)
);
create policy community_gallery_owner_or_admin_update
on public.community_gallery_items for update to authenticated
using (
  owner_profile_id = (select auth.uid())
  or exists (select 1 from public.profiles p where p.id=(select auth.uid()) and p.role='admin'::public.app_role)
)
with check (
  owner_profile_id = (select auth.uid())
  or exists (select 1 from public.profiles p where p.id=(select auth.uid()) and p.role='admin'::public.app_role)
);
create policy community_gallery_owner_or_admin_delete
on public.community_gallery_items for delete to authenticated
using (
  owner_profile_id = (select auth.uid())
  or exists (select 1 from public.profiles p where p.id=(select auth.uid()) and p.role='admin'::public.app_role)
);

-- profiles_select_public already grants SELECT; the two self-only SELECT policies are redundant.
drop policy if exists "profiles self select" on public.profiles;
drop policy if exists profiles_select_own on public.profiles;

-- Keep the strongest update policy (self or admin + WITH CHECK) and remove weaker duplicates.
drop policy if exists "profiles self update" on public.profiles;
drop policy if exists profiles_update_own on public.profiles;
alter policy profiles_self_update on public.profiles to authenticated;
alter policy "profiles self upsert" on public.profiles to authenticated;