# CLOUVA OS — Roadmap por fases

## Fase 1 (implementada base)
- Auth con email/password y Google.
- Registro con teléfono obligatorio.
- Roles base (`admin`, `employee`, `customer`) y redirección por rol.
- Modelo multi-tienda inicial (`stores`, `store_employees`).
- Productos extendidos para ropa y 3D.
- Stock con movimientos (`stock_movements`).

## Fase 2
- Módulo música (`songs`) y storage para WAV/MP3/covers.
- Gestión editorial y estados de producción.

## Fase 3
- Lanzamientos, checklist visual y contenido (reels/shorts).

## Fase 4
- Generación de emails de distribución e integración con Resend/Edge Functions.

## Fase 5
- Integración YouTube API + fallback manual.

## Fase 6
- Avatar/probador virtual con GLB, medidas y recomendaciones.

## Principios
- No romper flujo actual.
- Arquitectura mobile-first.
- RLS en cada tabla nueva antes de pasar a producción.
- Componentes reutilizables y validaciones centralizadas.
