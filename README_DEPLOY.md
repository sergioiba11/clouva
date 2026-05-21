# CLOUVA + Supabase Deploy Guide

## 1) Conectar Supabase con Vercel
En Vercel > Project Settings > Environment Variables:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

Luego redeploy.

## 2) Migraciones SQL
Ejecutar en Supabase SQL editor (o `supabase db push`):
- `supabase/migrations/20260521000000_init.sql`
- `supabase/migrations/20260521010000_store_core.sql`

Estas migraciones crean `profiles`, `products`, `orders`, `cart_items`, `favorites` y políticas RLS.

## 3) Auth y roles
- Registro/Login desde `/login`.
- Para crear admin: en SQL
```sql
update profiles set role='admin' where email='tu-admin@clouva.com';
```

## 4) Panel admin
Ruta: `/admin`
- Productos: `/admin/productos`
- Pedidos: `/admin/pedidos`
- Usuarios: `/admin/clientes`

## 5) Agregar productos
Desde `/admin/productos` (botón agregar), o SQL:
```sql
insert into products (slug, name, price, category, active) values ('hoodie-001','Hoodie 001',89990,'Hoodies',true);
```

## 6) Deploy producción
- `npm run build`
- Push a rama principal conectada a Vercel
- Verificar dominio `clouva.com.ar` en Vercel Domains

## 7) Rendimiento/SEO
- Next.js App Router + metadatos en `app/layout.tsx`
- Usar imágenes optimizadas y tamaños responsivos para catálogo.
- Evitar animaciones pesadas en mobile.
