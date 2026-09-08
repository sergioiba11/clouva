-- Preserve Player authorization semantics while avoiding per-row auth.uid() evaluation.
-- Write-only policies that require a logged-in identity are explicitly scoped to authenticated.

alter policy "players_select_public_or_member"
on public.players
to public
using (
  (is_published = true)
  or (owner_user_id = (select auth.uid()))
  or exists (
    select 1 from public.player_members m
    where m.player_id = players.id
      and m.user_id = (select auth.uid())
      and m.status = 'active'::text
  )
  or exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid())
      and p.role = 'admin'::public.app_role
  )
);

alter policy "players_update_member_or_admin"
on public.players
to authenticated
using (
  (owner_user_id = (select auth.uid()))
  or exists (
    select 1 from public.player_members m
    where m.player_id = players.id
      and m.user_id = (select auth.uid())
      and m.status = 'active'::text
      and m.role = any (array['owner'::text,'manager'::text,'editor'::text])
  )
  or exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid())
      and p.role = 'admin'::public.app_role
  )
)
with check (
  (owner_user_id = (select auth.uid()))
  or exists (
    select 1 from public.player_members m
    where m.player_id = players.id
      and m.user_id = (select auth.uid())
      and m.status = 'active'::text
      and m.role = any (array['owner'::text,'manager'::text,'editor'::text])
  )
  or exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid())
      and p.role = 'admin'::public.app_role
  )
);

alter policy "players_insert_self_or_admin"
on public.players
to authenticated
with check (
  (owner_user_id = (select auth.uid()))
  or exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid())
      and p.role = 'admin'::public.app_role
  )
);

alter policy "players_delete_admin_only"
on public.players
to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid())
      and p.role = 'admin'::public.app_role
  )
);

alter policy "player_members_select_self_or_player_admin_or_admin"
on public.player_members
to authenticated
using (
  (user_id = (select auth.uid()))
  or public.is_active_player_manager(player_id, (select auth.uid()))
  or exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid())
      and p.role = 'admin'::public.app_role
  )
);

alter policy "player_members_admin_write"
on public.player_members
to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid())
      and p.role = 'admin'::public.app_role
  )
)
with check (
  exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid())
      and p.role = 'admin'::public.app_role
  )
);

alter policy "player_media_public_read"
on public.player_media
to public
using (
  (visibility = 'public'::text)
  or exists (
    select 1 from public.player_members pm
    where pm.player_id = player_media.player_id
      and pm.user_id = (select auth.uid())
      and pm.status = 'active'::text
  )
  or exists (
    select 1 from public.studios s
    where s.id = player_media.studio_id
      and s.owner_id = (select auth.uid())
  )
  or exists (
    select 1 from public.studio_members sm
    where sm.studio_id = player_media.studio_id
      and sm.profile_id = (select auth.uid())
      and sm.status = 'active'::text
      and sm.role = any (array['owner'::text,'admin'::text,'manager'::text,'editor'::text])
  )
);

alter policy "player_media_authorized_write"
on public.player_media
to authenticated
using (
  exists (
    select 1 from public.player_members pm
    where pm.player_id = player_media.player_id
      and pm.user_id = (select auth.uid())
      and pm.status = 'active'::text
      and pm.role = any (array['owner'::text,'manager'::text,'editor'::text])
  )
  or exists (
    select 1 from public.studios s
    where s.id = player_media.studio_id
      and s.owner_id = (select auth.uid())
  )
  or exists (
    select 1 from public.studio_members sm
    where sm.studio_id = player_media.studio_id
      and sm.profile_id = (select auth.uid())
      and sm.status = 'active'::text
      and sm.role = any (array['owner'::text,'admin'::text,'manager'::text,'editor'::text])
  )
)
with check (
  exists (
    select 1 from public.player_members pm
    where pm.player_id = player_media.player_id
      and pm.user_id = (select auth.uid())
      and pm.status = 'active'::text
      and pm.role = any (array['owner'::text,'manager'::text,'editor'::text])
  )
  or exists (
    select 1 from public.studios s
    where s.id = player_media.studio_id
      and s.owner_id = (select auth.uid())
  )
  or exists (
    select 1 from public.studio_members sm
    where sm.studio_id = player_media.studio_id
      and sm.profile_id = (select auth.uid())
      and sm.status = 'active'::text
      and sm.role = any (array['owner'::text,'admin'::text,'manager'::text,'editor'::text])
  )
);

alter policy "player_profile_versions_select_public_or_member"
on public.player_profile_versions
to public
using (
  (status = 'published'::text)
  or exists (
    select 1 from public.player_members m
    where m.player_id = player_profile_versions.player_id
      and m.user_id = (select auth.uid())
      and m.status = 'active'::text
      and m.role = any (array['owner'::text,'manager'::text,'editor'::text])
  )
  or exists (
    select 1 from public.players pl
    where pl.id = player_profile_versions.player_id
      and pl.owner_user_id = (select auth.uid())
  )
  or exists (
    select 1 from public.studio_members m
    where m.studio_id = player_profile_versions.studio_id
      and m.profile_id = (select auth.uid())
      and m.status = 'active'::text
      and m.role = any (array['owner'::text,'admin'::text,'manager'::text,'editor'::text])
  )
  or exists (
    select 1 from public.studios s
    where s.id = player_profile_versions.studio_id
      and s.owner_id = (select auth.uid())
  )
  or exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid())
      and p.role = 'admin'::public.app_role
  )
);

alter policy "player_profile_versions_admin_write"
on public.player_profile_versions
to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid())
      and p.role = 'admin'::public.app_role
  )
)
with check (
  exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid())
      and p.role = 'admin'::public.app_role
  )
);