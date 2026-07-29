alter table public.studio_applications
  add column if not exists contact_email text;

create table if not exists public.public_form_rate_limits (
  action text not null,
  key_hash text not null,
  bucket_started_at timestamptz not null,
  request_count integer not null default 1,
  updated_at timestamptz not null default now(),
  primary key (action, key_hash, bucket_started_at)
);

alter table public.public_form_rate_limits enable row level security;

create or replace function public.consume_public_form_rate_limit(
  p_action text,
  p_key_hash text,
  p_limit integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bucket timestamptz;
  v_count integer;
begin
  if p_limit < 1 or p_window_seconds < 60 then
    return false;
  end if;

  v_bucket := to_timestamp(
    floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds
  );

  insert into public.public_form_rate_limits (
    action, key_hash, bucket_started_at, request_count, updated_at
  ) values (
    left(p_action, 80), p_key_hash, v_bucket, 1, now()
  )
  on conflict (action, key_hash, bucket_started_at)
  do update set
    request_count = public.public_form_rate_limits.request_count + 1,
    updated_at = now()
  returning request_count into v_count;

  return v_count <= p_limit;
end;
$$;

revoke all on function public.consume_public_form_rate_limit(text, text, integer, integer) from public;
grant execute on function public.consume_public_form_rate_limit(text, text, integer, integer) to service_role;
