-- Comunidad needs a "Ciudad" field on profiles (player cards, profile identity
-- section) that didn't exist before -- small, nullable, additive.

alter table public.profiles add column if not exists city text;
