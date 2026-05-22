-- Ensure Sergio profile is admin based on auth.users email

insert into public.profiles (id, role, display_name)
select au.id, 'admin'::app_role, 'Sergio'
from auth.users au
where lower(au.email) = 'sergio.iba.11@gmail.com'
on conflict (id) do update
set role = 'admin'::app_role,
    display_name = coalesce(public.profiles.display_name, 'Sergio');
