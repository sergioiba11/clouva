begin;

revoke all on function public.clouva_control_processes(integer) from public;
revoke all on function public.clouva_control_processes(integer) from anon;
grant execute on function public.clouva_control_processes(integer) to authenticated;

revoke all on function public.clouva_control_commerce_summary() from public;
revoke all on function public.clouva_control_commerce_summary() from anon;
grant execute on function public.clouva_control_commerce_summary() to authenticated;

commit;
