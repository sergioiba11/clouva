-- Existing default plans were renamed from Miembro to Artista. Normalize their
-- internal slug too when doing so cannot collide with another plan in the same
-- Studio. Public links continue to resolve by plan ID after selection.
update public.studio_membership_plans mp
set slug = 'artista',
    updated_at = now()
where mp.is_free = true
  and mp.name = 'Artista'
  and mp.slug = 'miembro'
  and not exists (
    select 1
    from public.studio_membership_plans other
    where other.studio_id = mp.studio_id
      and other.id <> mp.id
      and other.slug = 'artista'
  );
