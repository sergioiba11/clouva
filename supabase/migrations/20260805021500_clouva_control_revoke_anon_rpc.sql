begin;

revoke execute on function public.clouva_control_is_admin() from public, anon;
revoke execute on function public.clouva_control_processes(integer) from public, anon;

grant execute on function public.clouva_control_is_admin() to authenticated;
grant execute on function public.clouva_control_processes(integer) to authenticated;

commit;
