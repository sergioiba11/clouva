-- profiles has never had a public SELECT policy -- only profiles_select_own
-- (auth.uid() = id). This means the *existing* /u/[username] and
-- /perfil-publico/[id] pages have never actually worked for anyone viewing
-- someone else's profile (anonymous or logged in as a different user always
-- got zero rows back), and it makes the entire new Comunidad feature
-- (Players grid, studio member rosters, viewing others' proyectos/gallery)
-- non-functional too, since they all need to read OTHER users' profiles.
-- Confirmed via a real anonymous browser request before this fix (returned
-- "No encontramos ese perfil" for an existing username).

create policy profiles_select_public
  on public.profiles for select
  using (true);

-- profiles.phone was never meant to be public (unlike email, which the
-- Comunidad "Contacto" section deliberately surfaces) -- RLS is row-level
-- only, so the public policy above would otherwise expose it to anyone.
-- authenticated keeps SELECT on it (needed for a user's own /perfil page,
-- which reads its own phone via the browser client) -- narrowing to anon
-- blocks unauthenticated scraping, the most likely threat; a logged-in
-- user reading another user's phone via a raw API call is a known,
-- smaller residual gap that would need a proper public-profile view to
-- fully close.
revoke select (phone) on public.profiles from anon;
