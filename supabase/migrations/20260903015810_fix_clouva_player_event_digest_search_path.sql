-- pgcrypto is installed in Supabase's extensions schema. The Player event
-- trigger has a fixed search_path, so its unqualified digest() call could not
-- be resolved and every identity update was rolled back.

alter function public.clouva_player_event_trigger()
  set search_path = public, extensions;

