-- Same gotcha as 20260729213600: Supabase grants EXECUTE on new functions to
-- anon/authenticated by default regardless of "revoke all from public" in
-- the defining migration. Security Advisors flagged that reserve/finalize/
-- release_ai_image_budget were callable by anon via PostgREST RPC -- anyone
-- could reserve or drain the real-money Gemini budget directly. These are
-- server-only primitives, called exclusively from admin-gated API routes
-- using the service-role client.
revoke execute on function public.reserve_ai_image_budget(text, numeric, boolean) from anon, authenticated;
revoke execute on function public.finalize_ai_image_budget(text, numeric, numeric) from anon, authenticated;
revoke execute on function public.release_ai_image_budget(text, numeric) from anon, authenticated;
