import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const hasSupabaseEnv = Boolean(supabaseUrl && supabaseAnonKey);

export const supabase = hasSupabaseEnv
  ? createClient(supabaseUrl as string, supabaseAnonKey as string, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      }
    })
  : null;

export type DbPlaceholder = {
  products: {
    id: string;
    slug: string;
    title: string;
    price_ars: number;
    drop_tag: string;
    is_active: boolean;
  };
  users: {
    id: string;
    username: string;
    role: "user" | "admin";
  };
  favorites: {
    id: string;
    user_id: string;
    product_id: string;
  };
  drops: {
    id: string;
    name: string;
    launch_at: string;
    status: "draft" | "live" | "archived";
  };
};
