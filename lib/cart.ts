export type CartItem = {
  productId: string;
  slug: string;
  name: string;
  priceCents: number;
  qty: number;
  variant?: string;
};

const KEY = "clouva_cart_v1";

export function loadCart(): CartItem[] {
  if (typeof window === "undefined") return [];
  try { return JSON.parse(localStorage.getItem(KEY) ?? "[]") as CartItem[]; } catch { return []; }
}

export function saveCart(items: CartItem[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(KEY, JSON.stringify(items));
}

export function totalCents(items: CartItem[]) {
  return items.reduce((acc, it) => acc + it.priceCents * it.qty, 0);
}
