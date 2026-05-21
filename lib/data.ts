export const products = [
  { id: "1", slug: "hoodie-shadow-core", name: "Shadow Core Hoodie", price: 89990, category: "Hoodies", stock: 8 },
  { id: "2", slug: "gorra-night-grid", name: "Night Grid Cap", price: 39990, category: "Gorras", stock: 22 }
];

import { supabase } from "@/lib/supabase";

export async function getProducts() {
  const { data, error } = await supabase
    .from("products")
    .select("id,slug,name,price_cents,active,product_variants(id,size,color,stock)")
    .eq("active", true)
    .order("name");

  if (error) throw error;
  return data ?? [];
}

export async function addToCart(profileId: string, productId: string, quantity = 1) {
  const { data, error } = await supabase
    .from("cart_items")
    .upsert({ profile_id: profileId, product_id: productId, quantity }, { onConflict: "profile_id,product_id" })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function removeFromCart(profileId: string, productId: string) {
  const { error } = await supabase.from("cart_items").delete().eq("profile_id", profileId).eq("product_id", productId);
  if (error) throw error;
}

export async function toggleFavorite(profileId: string, productId: string) {
  const { data: existing } = await supabase
    .from("favorites")
    .select("id")
    .eq("profile_id", profileId)
    .eq("product_id", productId)
    .maybeSingle();

  if (existing) {
    const { error } = await supabase.from("favorites").delete().eq("id", existing.id);
    if (error) throw error;
    return { favorite: false };
  }

  const { error } = await supabase.from("favorites").insert({ profile_id: profileId, product_id: productId });
  if (error) throw error;
  return { favorite: true };
}

export async function createOrder(profileId: string) {
  const { data: cartItems, error: cartError } = await supabase
    .from("cart_items")
    .select("quantity,product:products(price_cents,id)")
    .eq("profile_id", profileId);

  if (cartError) throw cartError;
  const totalCents = (cartItems ?? []).reduce((sum, item: any) => sum + item.quantity * (item.product?.price_cents ?? 0), 0);

  const { data, error } = await supabase
    .from("orders")
    .insert({ profile_id: profileId, total_cents: totalCents, status: "pendiente" })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function updateProfile(profileId: string, displayName: string) {
  const { data, error } = await supabase
    .from("profiles")
    .update({ display_name: displayName })
    .eq("id", profileId)
    .select()
    .single();

  if (error) throw error;
  return data;
}
