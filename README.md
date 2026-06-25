# CLOUVA Official App

Base real de producción con 3 mundos:
- Tienda pública
- Panel Admin
- Mi Flow (owner)

## Stack
Next.js + TypeScript + Tailwind + Supabase.

## Rutas
Incluye rutas públicas, admin y Mi Flow solicitadas.

## Seguridad
- Guards de rol en layout admin y mi-flow (mock para primera entrega)
- SQL con RLS para productos, órdenes y módulos Flow owner-only.

## Deploy
Preparado para Vercel y dominio `clouva.com.ar`.

## Tienda online editable con Supabase

Esta implementación agrega una storefront editable y un panel administrativo protegido para vender productos físicos sin tocar código.

### Rutas principales

- `/tienda`: home comercial con banner editable, productos destacados y categorías.
- `/catalogo`: catálogo responsive con búsqueda, filtro por categoría y orden por precio o fecha.
- `/producto/[slug]`: ficha con galería, precio anterior, stock, SKU, etiquetas, talles y colores.
- `/carrito`: carrito persistente con cantidades, subtotal y total.
- `/checkout`: formulario de cliente, guardado de pedido en Supabase y acceso a WhatsApp Checkout.
- `/admin`: dashboard protegido por Supabase Auth.
- `/admin/productos`: CRUD de productos, imágenes, ocultar, eliminar y duplicar.
- `/admin/categorias`: CRUD de categorías con imagen.
- `/admin/banners`: CRUD de banners con imagen, título, subtítulo y orden.
- `/admin/pedidos`: gestión de pedidos y estados.

### Variables de entorno

```bash
NEXT_PUBLIC_SUPABASE_URL=https://TU-PROYECTO.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=TU_ANON_KEY
NEXT_PUBLIC_SITE_URL=https://tu-dominio.com
```

### Supabase

Ejecutá la migración `supabase/migrations/20260625000000_editable_store.sql` para crear:

- Tablas: `products`, `product_images`, `categories`, `orders`, `order_items`, `banners`, `coupons`.
- Buckets públicos: `products`, `categories`, `banners`.
- Políticas RLS para lectura pública, creación de pedidos y gestión autenticada desde el admin.

### Funciones comerciales preparadas

El esquema y el panel ya contemplan variantes de ropa (`sizes`, `colors`), cupones, WhatsApp Checkout, stock por producto y campos listos para integrar Mercado Pago, Pixel de Meta y Google Analytics.
