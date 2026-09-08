-- Fix an ownership scoping bug in commerce product visibility and reduce per-row auth.uid() evaluation.

alter policy "commerce_products_select_published_or_owner"
on public.commerce_products
using (
  (status = 'published'::text)
  or (created_by = (select auth.uid()))
  or ((owner_type = 'user'::text) and (owner_user_id = (select auth.uid())))
  or ((spot_id is not null) and (public.commerce_spot_role_for_user(spot_id, (select auth.uid())) is not null))
  or ((owner_type = 'player'::text) and exists (
      select 1 from public.players p
      where p.id = commerce_products.player_id
        and p.owner_user_id = (select auth.uid())
  ))
  or ((owner_type = 'player'::text) and exists (
      select 1 from public.player_members m
      where m.player_id = commerce_products.player_id
        and m.user_id = (select auth.uid())
        and m.status = 'active'::text
        and m.role = any (array['owner'::text,'manager'::text,'editor'::text])
  ))
  or ((owner_type = 'studio'::text) and exists (
      select 1 from public.studios s
      where s.id = commerce_products.studio_id
        and s.owner_id = (select auth.uid())
  ))
  or ((owner_type = 'studio'::text) and exists (
      select 1 from public.studio_members m
      where m.studio_id = commerce_products.studio_id
        and m.profile_id = (select auth.uid())
        and m.status = 'active'::text
        and m.role = any (array['owner'::text,'admin'::text,'manager'::text,'editor'::text])
  ))
  or exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid())
        and (p.role)::text = 'admin'::text
  )
);

alter policy "flow_operations_read_own"
on public.flow_purchase_operations
using (((select auth.uid()) = recipient_user_id) or ((select auth.uid()) = buyer_user_id));

alter policy "flow_assets_read_own"
on public.flow_assets
using (((select auth.uid()) = owner_user_id) or ((select auth.uid()) = original_buyer_user_id));

alter policy "flow_asset_movements_read_related"
on public.flow_asset_movements
using (exists (
  select 1 from public.flow_assets a
  where a.id = flow_asset_movements.flow_asset_id
    and ((a.owner_user_id = (select auth.uid())) or (a.original_buyer_user_id = (select auth.uid())))
));

alter policy "flow_funding_read_related"
on public.flow_funding_ledger
using (
  exists (
    select 1 from public.flow_purchase_operations o
    where o.id = flow_funding_ledger.operation_id
      and ((o.buyer_user_id = (select auth.uid())) or (o.recipient_user_id = (select auth.uid())))
  )
  or exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.role = 'admin'::public.app_role
  )
);

alter policy "flow_documents_read_related"
on public.flow_payment_documents
using (
  exists (
    select 1 from public.flow_purchase_operations o
    where o.id = flow_payment_documents.operation_id
      and ((o.buyer_user_id = (select auth.uid())) or (o.recipient_user_id = (select auth.uid())))
  )
  or exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.role = 'admin'::public.app_role
  )
);

alter policy "flow_refund_cases_read_related"
on public.flow_refund_cases
using (
  exists (
    select 1 from public.flow_purchase_operations o
    where o.id = flow_refund_cases.operation_id
      and ((o.buyer_user_id = (select auth.uid())) or (o.recipient_user_id = (select auth.uid())))
  )
  or exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.role = 'admin'::public.app_role
  )
);

alter policy "mi_flow_money_ledger_self_or_admin_select"
on public.mi_flow_money_ledger
using (
  (beneficiary_user_id = (select auth.uid()))
  or exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.role = 'admin'::public.app_role
  )
);