-- Mechanically wrap bare auth.uid() calls in fully-unoptimized public-schema RLS policies.
-- This preserves each policy's roles, command and boolean logic while allowing PostgreSQL
-- to evaluate auth.uid() as an InitPlan rather than once per row.

do $$
declare
  r record;
  next_qual text;
  next_check text;
begin
  for r in
    select schemaname, tablename, policyname, qual, with_check
    from pg_policies
    where schemaname = 'public'
      and (coalesce(qual, '') || coalesce(with_check, '')) like '%auth.uid()%'
      and (coalesce(qual, '') || coalesce(with_check, '')) not like '%SELECT auth.uid()%'
  loop
    if r.qual is not null then
      next_qual := replace(r.qual, 'auth.uid()', '(select auth.uid())');
      execute format(
        'alter policy %I on %I.%I using (%s)',
        r.policyname, r.schemaname, r.tablename, next_qual
      );
    end if;

    if r.with_check is not null then
      next_check := replace(r.with_check, 'auth.uid()', '(select auth.uid())');
      execute format(
        'alter policy %I on %I.%I with check (%s)',
        r.policyname, r.schemaname, r.tablename, next_check
      );
    end if;
  end loop;
end
$$;