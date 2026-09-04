begin;

create or replace function public.sync_new_space_inventory_item_reorder()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.active = true
     and new.minimum_quantity > 0
     and new.added_by_user_id is not null then
    perform public.sync_space_inventory_reorder(new.id, new.added_by_user_id);
  end if;
  return new;
end;
$$;

revoke all on function public.sync_new_space_inventory_item_reorder() from public, anon, authenticated;

drop trigger if exists space_inventory_items_initial_reorder on public.space_inventory_items;
create trigger space_inventory_items_initial_reorder
after insert on public.space_inventory_items
for each row execute function public.sync_new_space_inventory_item_reorder();

commit;
