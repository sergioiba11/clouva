-- CLOUVA AI knowledge retrieval is server-side only. The canonical chat route
-- and Tool Router already authenticate the Player; this SECURITY DEFINER RPC
-- is not a directly callable client surface.
revoke all on function public.clouva_resolve_knowledge_context(uuid,text,uuid,integer)
  from public, anon, authenticated;
grant execute on function public.clouva_resolve_knowledge_context(uuid,text,uuid,integer)
  to service_role;
