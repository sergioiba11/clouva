-- Routing configuration only. Artistic profile content remains editable by its
-- owner and is never seeded here.

insert into public.public_slug_aliases (alias, entity_type, entity_id, is_primary, redirect_to_primary)
select 'clouva', 'player', id, true, true
from public.players
where lower(slug) = 'clouva'
on conflict (normalized_alias) do update
set entity_type = excluded.entity_type,
    entity_id = excluded.entity_id,
    is_primary = true,
    redirect_to_primary = true,
    updated_at = now();

insert into public.public_slug_aliases (alias, entity_type, entity_id, is_primary, redirect_to_primary)
select 'bless', 'player', id, true, true
from public.players
where lower(slug) = '0800bless'
on conflict (normalized_alias) do update
set entity_type = excluded.entity_type,
    entity_id = excluded.entity_id,
    is_primary = true,
    redirect_to_primary = true,
    updated_at = now();

insert into public.public_slug_aliases (alias, entity_type, entity_id, is_primary, redirect_to_primary)
select 'iglu', 'studio', id, true, true
from public.studios
where lower(slug) = 'el-iglu'
on conflict (normalized_alias) do update
set entity_type = excluded.entity_type,
    entity_id = excluded.entity_id,
    is_primary = true,
    redirect_to_primary = true,
    updated_at = now();

insert into public.public_slug_aliases (alias, entity_type, entity_id, is_primary, redirect_to_primary)
select '223-social-club', 'studio', id, true, true
from public.studios
where lower(slug) = '223-social-club'
on conflict (normalized_alias) do update
set entity_type = excluded.entity_type,
    entity_id = excluded.entity_id,
    is_primary = true,
    redirect_to_primary = true,
    updated_at = now();
