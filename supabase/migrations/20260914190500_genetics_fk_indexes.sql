create index if not exists user_strain_favorites_strain_idx
  on public.user_strain_favorites (strain_id);

create index if not exists user_strain_views_strain_idx
  on public.user_strain_views (strain_id);
