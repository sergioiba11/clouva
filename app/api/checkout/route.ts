import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

export async function POST(request: Request) {
  const body = await request.json();
  const supabase = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
  const total = body.items.reduce((sum: number, item: any) => sum + item.price * item.quantity, 0);
  const { data: order, error } = await supabase.from("orders").insert({ customer_name: body.customer.name, customer_phone: body.customer.phone, customer_email: body.customer.email, customer_address: body.customer.address, total, status: "pendiente" }).select("*").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  const items = body.items.map((item: any) => ({ order_id: order.id, product_id: item.id, quantity: item.quantity, unit_price: item.price, product_name: item.name }));
  await supabase.from("order_items").insert(items);
  return NextResponse.json({ order });
}
