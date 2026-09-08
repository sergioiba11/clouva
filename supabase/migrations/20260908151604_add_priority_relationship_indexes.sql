-- Target only high-value ownership, commerce and canonical FLOW relationships used by joins/RLS/workflows.
-- Existing covering indexes were audited first to avoid duplicates.

create index if not exists commerce_inventory_product_idx on public.commerce_inventory(product_id);
create index if not exists commerce_inventory_clothing_item_idx on public.commerce_inventory(clothing_item_id);
create index if not exists commerce_orders_seller_user_idx on public.commerce_orders(seller_user_id);
create index if not exists commerce_products_owner_user_idx on public.commerce_products(owner_user_id);
create index if not exists commerce_shipping_methods_player_idx on public.commerce_shipping_methods(player_id);
create index if not exists commerce_shipping_methods_studio_idx on public.commerce_shipping_methods(studio_id);

create index if not exists flow_asset_movements_from_user_idx on public.flow_asset_movements(from_user_id);
create index if not exists flow_asset_movements_to_user_idx on public.flow_asset_movements(to_user_id);
create index if not exists flow_asset_movements_from_player_idx on public.flow_asset_movements(from_player_id);
create index if not exists flow_asset_movements_to_player_idx on public.flow_asset_movements(to_player_id);
create index if not exists flow_asset_movements_operation_idx on public.flow_asset_movements(operation_id);
create index if not exists flow_assets_backing_operation_idx on public.flow_assets(backing_operation_id);
create index if not exists flow_assets_original_buyer_user_idx on public.flow_assets(original_buyer_user_id);
create index if not exists flow_assets_original_buyer_player_idx on public.flow_assets(original_buyer_player_id);
create index if not exists flow_backing_allocations_funding_entry_idx on public.flow_backing_allocations(funding_entry_id);
create index if not exists flow_funding_reverses_entry_idx on public.flow_funding_ledger(reverses_entry_id);
create index if not exists flow_purchase_buyer_user_idx on public.flow_purchase_operations(buyer_user_id);
create index if not exists flow_purchase_buyer_player_idx on public.flow_purchase_operations(buyer_player_id);
create index if not exists flow_purchase_recipient_player_idx on public.flow_purchase_operations(recipient_player_id);
create index if not exists flow_payout_destinations_player_idx on public.flow_payout_destinations(player_id);
create index if not exists flow_redemption_items_funding_entry_idx on public.flow_redemption_items(funding_entry_id);
create index if not exists flow_redemption_payout_destination_idx on public.flow_redemption_operations(payout_destination_id);
create index if not exists flow_redemption_player_idx on public.flow_redemption_operations(player_id);
create index if not exists flow_refund_cases_funding_entry_idx on public.flow_refund_cases(funding_entry_id);
create index if not exists flow_transfer_sender_player_idx on public.flow_transfer_intents(sender_player_id);
create index if not exists flow_transfer_recipient_player_idx on public.flow_transfer_intents(recipient_player_id);