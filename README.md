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
