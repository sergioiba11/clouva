create index if not exists commerce_creator_projects_player_idx on public.commerce_creator_projects(player_id) where player_id is not null;
create index if not exists commerce_creator_projects_studio_idx on public.commerce_creator_projects(studio_id) where studio_id is not null;
create index if not exists commerce_creator_projects_spot_idx on public.commerce_creator_projects(spot_id) where spot_id is not null;
create index if not exists commerce_creator_projects_clothing_idx on public.commerce_creator_projects(clothing_item_id) where clothing_item_id is not null;
create index if not exists commerce_creator_projects_creator_3d_idx on public.commerce_creator_projects(creator_3d_asset_id) where creator_3d_asset_id is not null;
