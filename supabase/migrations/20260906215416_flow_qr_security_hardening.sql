alter function public.sync_commerce_qr_to_clouva_registry() set search_path = public;
revoke all on function public.sync_commerce_qr_to_clouva_registry() from public;
revoke execute on function public.sync_commerce_qr_to_clouva_registry() from anon;
revoke execute on function public.sync_commerce_qr_to_clouva_registry() from authenticated;
grant execute on function public.sync_commerce_qr_to_clouva_registry() to service_role;
