-- Trigger-only functions must not be exposed through PostgREST RPC.
revoke all on function public.clouva_sync_business_request_knowledge() from public, anon, authenticated;
revoke all on function public.clouva_archive_business_request_knowledge() from public, anon, authenticated;
grant execute on function public.clouva_sync_business_request_knowledge() to service_role;
grant execute on function public.clouva_archive_business_request_knowledge() to service_role;
