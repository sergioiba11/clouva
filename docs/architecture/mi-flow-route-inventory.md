# Inventario de rutas `/mi-flow`

Fecha de auditoría: 2026-08-25

## Regla canónica

`/mi-flow` es la billetera CLOUVA del Player. No es el dashboard operativo de un Space ni el contenedor conceptual de herramientas creativas históricas.

La migración de rutas es progresiva: **ninguna ruta histórica se elimina en esta normalización**. Las URLs siguen operativas hasta que exista un destino equivalente y un redirect explícito.

## Rutas financieras canónicas

| Ruta | Estado | Concepto |
| --- | --- | --- |
| `/mi-flow` | CANÓNICA | Alias directo de la billetera. |
| `/mi-flow/billetera` | CANÓNICA | Dinero personal, FLOWS, Diamantes, movimientos y espacios administrados con fondos separados. |
| `/mi-flow/money` | LEGACY / REDIRECT | Compatibilidad histórica; redirige a `/mi-flow/billetera`. |
| `/mi-flow/finanzas` | LEGACY NO-LEDGER | Herramienta manual/proyección. No modifica el saldo real de Mi Flow. |
| `/mi-flow/negocios` | LEGACY PLAYER | Proyectos de ingresos personales. No es MI SPOT ni el admin de un Space. |

## Rutas históricas que pertenecen conceptualmente al Player / Creator

Estas rutas siguen vivas por compatibilidad, pero no definen el significado de Mi Flow:

- `/mi-flow/agenda`
- `/mi-flow/armario`
- `/mi-flow/assistant`
- `/mi-flow/avatar-customizer`
- `/mi-flow/avatar-ia`
- `/mi-flow/avatar`
- `/mi-flow/contenido`
- `/mi-flow/crear-prenda`
- `/mi-flow/creative`
- `/mi-flow/drops`
- `/mi-flow/flows` — CRUD histórico de notas creativas; **no** representa la moneda FLOWS.
- `/mi-flow/ideas`
- `/mi-flow/launch`
- `/mi-flow/lore`
- `/mi-flow/menu`
- `/mi-flow/music`
- `/mi-flow/roadmap`
- `/mi-flow/store`
- `/mi-flow/studio`
- `/mi-flow/tareas`
- `/mi-flow/tasks`
- `/mi-flow/vault`
- `/mi-flow/visual`

## Decisión de migración

1. Mantener todas las URLs anteriores durante esta fase.
2. No mover datos ni tablas por el solo hecho de mover una pantalla.
3. Cuando exista un nuevo namespace de Player/Creator, mover pantalla por pantalla con alias o redirect.
4. No colocar operaciones de Space dentro de `/mi-flow`; el botón `Administrar` debe abrir el admin del Space.
5. No mezclar fondos `personal` con fondos `managed` aunque el mismo Player tenga permisos `finance` sobre varios Spaces.
6. Reservar el nombre **FLOWS** para el activo/moneda; la ruta histórica `/mi-flow/flows` debe seguir rotulada como notas creativas hasta su futura reubicación.

## Fuera de alcance destructivo

No se borraron rutas, tablas, datos ni componentes legacy en esta tarea. La limpieza física sólo debe hacerse después de comprobar tráfico, enlaces internos, imports y redirects de cada ruta.
