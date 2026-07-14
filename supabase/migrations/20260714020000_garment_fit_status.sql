alter table public.clothing_items
  add column if not exists fit_status text not null default 'fallback'
    check (fit_status in ('pending','processing','fitted','failed','fallback')),
  add column if not exists rigged boolean not null default false,
  add column if not exists wearable boolean not null default false,
  add column if not exists hood_supported boolean not null default false,
  add column if not exists hood_state text default 'down' check (hood_state in ('up','down')),
  add column if not exists hood_up_model_url text,
  add column if not exists hood_down_model_url text,
  add column if not exists body_mask jsonb not null default '[]'::jsonb,
  add column if not exists processing_error text,
  add column if not exists processing_started_at timestamptz;

-- Backfill honesto para prendas ya generadas: si el pipeline de rigging
-- (lib/clothing-finalization.ts) ya había registrado éxito real en
-- metadata, reflejarlo en las columnas nuevas. Todo lo demás queda
-- como 'fallback'/no equipable (no se asume nada sobre datos viejos).
update public.clothing_items
set
  rigged = coalesce((metadata->>'rigged')::boolean, false),
  fit_status = case when coalesce((metadata->>'rigged')::boolean, false) then 'fitted' else 'fallback' end,
  wearable = coalesce((metadata->>'rigged')::boolean, false)
where status = 'ready';
