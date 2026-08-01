import type { SupabaseClient } from "@supabase/supabase-js";

/** Crea una notificación in-app. Siempre vía service role -- la tabla no
 * tiene policy de insert para el usuario autenticado a propósito. */
export async function createNotification(
  admin: SupabaseClient,
  args: { userId: string; type: string; title: string; body?: string; link?: string },
) {
  const { error } = await admin.from("notifications").insert({
    user_id: args.userId,
    type: args.type,
    title: args.title,
    body: args.body ?? null,
    link: args.link ?? null,
  });
  if (error) throw new Error(error.message);
}
