-- RLS policies reference private SECURITY DEFINER helpers by OID. PostgreSQL
-- still requires EXECUTE on those functions for the authenticated query role.
-- The private schema remains without USAGE and is not exposed by the Data API,
-- so these helpers cannot become a parallel public RPC surface.

begin;

grant execute on function private.agenda_user_manages_player(uuid,uuid) to authenticated;
grant execute on function private.agenda_role_for_user(uuid,uuid) to authenticated;
grant execute on function private.agenda_event_can_read(uuid,uuid) to authenticated;
grant execute on function private.agenda_event_can_manage(uuid,uuid) to authenticated;

commit;
