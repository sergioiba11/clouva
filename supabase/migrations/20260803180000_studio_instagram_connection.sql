-- Instagram propio del Estudio (distinto del Instagram personal del dueño).
-- Reutiliza el mismo patrón ya usado por billing_products.studio_id: una
-- columna nullable agregada a una tabla existente user-scoped, en vez de un
-- subject_type/subject_id genérico. Cuando studio_id está seteado, la fila
-- pertenece al Estudio (visible/administrable por cualquier manager del
-- Estudio), no solo por quien la conectó -- user_id se sigue guardando como
-- registro de auditoría de quién la conectó, no como dueño exclusivo.

alter table public.social_connections
  add column if not exists studio_id uuid references public.studios(id) on delete cascade;

alter table public.social_oauth_states
  add column if not exists studio_id uuid references public.studios(id) on delete cascade;

alter table public.social_import_sessions
  add column if not exists studio_id uuid references public.studios(id) on delete cascade;

create index if not exists social_connections_studio_idx
  on public.social_connections(studio_id, provider)
  where studio_id is not null;

create index if not exists social_import_sessions_studio_idx
  on public.social_import_sessions(studio_id, status, created_at desc)
  where studio_id is not null;
