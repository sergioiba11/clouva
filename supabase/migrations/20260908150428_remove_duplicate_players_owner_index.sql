-- players_owner_unique and players_owner_user_unique are structurally identical.
-- Neither backs a constraint; keep the more explicit canonical name.
drop index if exists public.players_owner_unique;