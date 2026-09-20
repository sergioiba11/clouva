begin;

revoke all on table public.facebook_connections from anon, authenticated;
drop policy if exists facebook_connections_owner_select on public.facebook_connections;

revoke all on table public.facebook_page_credentials from anon, authenticated;

commit;
