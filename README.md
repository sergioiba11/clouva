# CLOUVA PRO

Frontend premium cyber/y2k underground con Next.js + TypeScript + Tailwind + Framer Motion.

## Variables de entorno en Vercel
Configurar en **Project Settings → Environment Variables**:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

Sin esas variables, la app mantiene placeholders y no rompe deploy.

## Estructura PRO incluida
- Home (`/`)
- Productos (`/productos`)
- Universo (`/universo`)
- Galería (`/galeria`)
- Login (`/login`)
- Registro (`/registro`)
- Perfil (`/perfil`)

## Notas
- Cliente Supabase en `lib/supabase.ts` con fallback seguro cuando faltan variables.
- Base lista para tablas: `products`, `users`, `favorites`, `drops`.
