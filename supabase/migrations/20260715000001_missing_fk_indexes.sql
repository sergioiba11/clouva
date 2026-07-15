-- Ninguna foreign key del proyecto tenía índice — esto es lo que hace
-- que "escalar a millones de usuarios" se caiga primero, ya que las
-- políticas de RLS de este proyecto filtran justamente por estas
-- columnas (ej. owner_id = auth.uid()).

create index if not exists idx_customers_profile_id on public.customers(profile_id);

create index if not exists idx_flow_agenda_blocks_owner_id on public.flow_agenda_blocks(owner_id);
create index if not exists idx_flow_businesses_owner_id on public.flow_businesses(owner_id);
create index if not exists idx_flow_content_calendar_owner_id on public.flow_content_calendar(owner_id);
create index if not exists idx_flow_finances_owner_id on public.flow_finances(owner_id);
create index if not exists idx_flow_flows_owner_id on public.flow_flows(owner_id);
create index if not exists idx_flow_ideas_owner_id on public.flow_ideas(owner_id);
create index if not exists idx_flow_launches_owner_id on public.flow_launches(owner_id);
create index if not exists idx_flow_lore_entries_owner_id on public.flow_lore_entries(owner_id);
create index if not exists idx_flow_money_entries_owner_id on public.flow_money_entries(owner_id);
create index if not exists idx_flow_music_tracks_owner_id on public.flow_music_tracks(owner_id);
create index if not exists idx_flow_notes_owner_id on public.flow_notes(owner_id);
create index if not exists idx_flow_projects_owner_id on public.flow_projects(owner_id);
create index if not exists idx_flow_releases_owner_id on public.flow_releases(owner_id);
create index if not exists idx_flow_studio_sessions_owner_id on public.flow_studio_sessions(owner_id);
create index if not exists idx_flow_tasks_owner_id on public.flow_tasks(owner_id);
create index if not exists idx_flow_vault_files_owner_id on public.flow_vault_files(owner_id);
create index if not exists idx_flow_visuals_owner_id on public.flow_visuals(owner_id);

create index if not exists idx_order_items_order_id on public.order_items(order_id);
create index if not exists idx_order_items_product_id on public.order_items(product_id);
create index if not exists idx_order_status_history_created_by on public.order_status_history(created_by);
create index if not exists idx_order_status_history_order_id on public.order_status_history(order_id);
create index if not exists idx_orders_customer_id on public.orders(customer_id);
create index if not exists idx_payment_events_order_id on public.payment_events(order_id);

create index if not exists idx_product_images_product_id on public.product_images(product_id);
create index if not exists idx_product_variants_product_id on public.product_variants(product_id);
create index if not exists idx_products_category_id on public.products(category_id);
create index if not exists idx_products_store_id on public.products(store_id);

create index if not exists idx_stock_movements_product_variant_id on public.stock_movements(product_variant_id);
create index if not exists idx_stock_movements_product_id on public.stock_movements(product_id);
create index if not exists idx_stock_movements_created_by on public.stock_movements(created_by);

create index if not exists idx_user_outfits_top_id on public.user_outfits(top_id);
create index if not exists idx_user_outfits_bottom_id on public.user_outfits(bottom_id);
create index if not exists idx_user_outfits_shoes_id on public.user_outfits(shoes_id);
create index if not exists idx_user_outfits_accessory_id on public.user_outfits(accessory_id);
