alter table public.structure_images
  add column if not exists placement_status text not null default 'unplaced';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'structure_images_placement_status_check'
      and conrelid = 'public.structure_images'::regclass
  ) then
    alter table public.structure_images
      add constraint structure_images_placement_status_check
      check (placement_status in ('unplaced','placed','needs_review','blocked'));
  end if;
end $$;

update public.structure_images
set placement_status = case
  when local_x is not null and local_y is not null and heading is not null then 'placed'
  else 'unplaced'
end
where placement_status = 'unplaced';

create index if not exists structure_images_placement_status_idx
  on public.structure_images(structure_id, placement_status, created_at);
