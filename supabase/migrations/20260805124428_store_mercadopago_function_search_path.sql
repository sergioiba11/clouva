-- Fix the two store trigger functions flagged by Supabase Security Advisor.
-- They only reference objects in public, so pinning search_path removes the
-- mutable-path warning without changing checkout behavior.

alter function public.ensure_stock_before_order_items() set search_path = public;
alter function public.apply_stock_on_order_state_change() set search_path = public;
