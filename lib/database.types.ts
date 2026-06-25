export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
      categories: { Row: { id: string; name: string; slug: string; image_url: string | null; created_at: string }; Insert: { id?: string; name: string; slug: string; image_url?: string | null; created_at?: string }; Update: Partial<Database['public']['Tables']['categories']['Insert']> };
      products: { Row: { id: string; name: string; slug: string; description: string | null; price: number; old_price: number | null; stock: number; sku: string | null; category_id: string | null; featured: boolean; active: boolean; tags: string[]; sizes: string[]; colors: string[]; created_at: string }; Insert: { id?: string; name: string; slug: string; description?: string | null; price: number; old_price?: number | null; stock?: number; sku?: string | null; category_id?: string | null; featured?: boolean; active?: boolean; tags?: string[]; sizes?: string[]; colors?: string[]; created_at?: string }; Update: Partial<Database['public']['Tables']['products']['Insert']> };
      product_images: { Row: { id: string; product_id: string; image_url: string; sort_order: number }; Insert: { id?: string; product_id: string; image_url: string; sort_order?: number }; Update: Partial<Database['public']['Tables']['product_images']['Insert']> };
      banners: { Row: { id: string; title: string; subtitle: string | null; image_url: string | null; active: boolean; sort_order: number; created_at: string }; Insert: { id?: string; title: string; subtitle?: string | null; image_url?: string | null; active?: boolean; sort_order?: number; created_at?: string }; Update: Partial<Database['public']['Tables']['banners']['Insert']> };
      orders: { Row: { id: string; order_number: number; customer_name: string; customer_phone: string; customer_email: string; customer_address: string; total: number; status: 'pendiente' | 'confirmado' | 'enviado' | 'entregado' | 'cancelado'; created_at: string }; Insert: { id?: string; order_number?: number; customer_name: string; customer_phone: string; customer_email: string; customer_address: string; total: number; status?: 'pendiente' | 'confirmado' | 'enviado' | 'entregado' | 'cancelado'; created_at?: string }; Update: Partial<Database['public']['Tables']['orders']['Insert']> };
      order_items: { Row: { id: string; order_id: string; product_id: string | null; quantity: number; unit_price: number; product_name: string }; Insert: { id?: string; order_id: string; product_id?: string | null; quantity: number; unit_price: number; product_name: string }; Update: Partial<Database['public']['Tables']['order_items']['Insert']> };
      coupons: { Row: { id: string; code: string; discount_percent: number; active: boolean; created_at: string }; Insert: { id?: string; code: string; discount_percent: number; active?: boolean; created_at?: string }; Update: Partial<Database['public']['Tables']['coupons']['Insert']> };
    };
    Views: Record<string, never>; Functions: Record<string, never>; Enums: Record<string, never>; CompositeTypes: Record<string, never>;
  };
};
