alter table public.structure_images
  add column if not exists spatial_source text not null default 'unplaced';

alter table public.structure_camera_nodes
  add column if not exists spatial_source text not null default 'unplaced';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'structure_images_spatial_source_check'
      and conrelid = 'public.structure_images'::regclass
  ) then
    alter table public.structure_images
      add constraint structure_images_spatial_source_check
      check (spatial_source in ('unplaced','exif','filename','manual','inferred_cloud'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'structure_camera_nodes_spatial_source_check'
      and conrelid = 'public.structure_camera_nodes'::regclass
  ) then
    alter table public.structure_camera_nodes
      add constraint structure_camera_nodes_spatial_source_check
      check (spatial_source in ('unplaced','exif','filename','manual','inferred_cloud'));
  end if;
end $$;

update public.structure_images
set spatial_source = case
  when manual_verified then 'manual'
  when coalesce(metadata #>> '{deterministic,spatialTruthPriority}', '') = 'exif' then 'exif'
  when latitude is not null or longitude is not null or heading is not null then 'filename'
  else 'unplaced'
end
where spatial_source = 'unplaced';

update public.structure_camera_nodes c
set spatial_source = i.spatial_source
from public.structure_images i
where i.id = c.image_id
  and c.spatial_source = 'unplaced';

create index if not exists structure_images_placement_idx
  on public.structure_images(structure_id, spatial_source, manual_verified);
