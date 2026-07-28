-- Retire the one-use Avatar Analyzer production helper after its Edge Function
-- has been deleted. This migration deliberately avoids CASCADE so an unexpected
-- dependency stops the cleanup instead of removing unrelated production objects.

begin;

do $$
begin
  if to_regclass('public.avatar_analyzer_ops_auth') is not null
     and exists (select 1 from public.avatar_analyzer_ops_auth where active) then
    raise exception 'avatar_analyzer_ops_auth still contains an active authorization';
  end if;
end
$$;

drop table if exists public.avatar_analyzer_ops_auth;
drop extension if exists pg_net;

commit;
