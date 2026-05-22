import { create } from "zustand";
import { products } from "@/lib/data";

type CartItem = { id: string; qty: number };

type StoreState = {
  favorites: string[];
  cart: CartItem[];
  checkoutStep: "cart" | "shipping" | "payment" | "done";
  toggleFavorite: (id: string) => void;
  addToCart: (id: string) => void;
  removeFromCart: (id: string) => void;
  setCheckoutStep: (step: StoreState["checkoutStep"]) => void;
  cartTotal: () => number;
};

export const useStore = create<StoreState>((set, get) => ({
  favorites: [],
  cart: [],
  checkoutStep: "cart",
  toggleFavorite: (id) => set((s) => ({ favorites: s.favorites.includes(id) ? s.favorites.filter((x) => x !== id) : [...s.favorites, id] })),
  addToCart: (id) => set((s) => ({ cart: s.cart.some((it) => it.id === id) ? s.cart.map((it) => (it.id === id ? { ...it, qty: it.qty + 1 } : it)) : [...s.cart, { id, qty: 1 }] })),
  removeFromCart: (id) => set((s) => ({ cart: s.cart.filter((it) => it.id !== id) })),
  setCheckoutStep: (checkoutStep) => set({ checkoutStep }),
  cartTotal: () => get().cart.reduce((acc, item) => {
    const product = products.find((p) => p.id === item.id);
    return acc + (product?.price ?? 0) * item.qty;
  }, 0),
}));
