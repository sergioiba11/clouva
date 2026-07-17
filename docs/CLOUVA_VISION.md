# Visión integral de CLOUVA

## Definición

**CLOUVA es una plataforma social, creativa y comercial centrada en la identidad digital.**

Su promesa es:

> Tu mundo. Tu avatar. Tu estilo. Tu música. Tu negocio. Tu legado.

CLOUVA no es solamente una tienda, un creador de prendas 3D ni un videojuego. Es un ecosistema en el que personas, artistas, productores, marcas y comunidades construyen identidad, contenido, relaciones y economía alrededor de un avatar y un perfil persistentes.

## Experiencia principal

1. La persona crea su cuenta y recibe un **CLOUVA ID**.
2. Elige, crea o personaliza su avatar oficial.
3. Completa su perfil con música, estilo, intereses, proyectos y comunidad.
4. Descubre artistas, productores, amigos y universos.
5. Sigue perfiles, escucha música, mira contenido, conversa y participa en eventos.
6. Compra, colecciona o equipa merch físico y digital.
7. Crea contenido, ropa, objetos, música o experiencias.
8. Publica y monetiza dentro del ecosistema.
9. En el futuro usa la misma identidad, avatar e inventario dentro de **CLOUVA Worlds**.

## Pilares

### 1. Identidad y avatar

El avatar no es decoración. Es la representación persistente de la persona dentro de CLOUVA.

- CLOUVA ID y perfil público.
- Avatar 3D oficial.
- Ropa, accesorios, peinados, animaciones y gestos.
- Armario e historial de looks.
- Inventario compartido entre app, marketplace y Worlds.
- Identidad personal, artística o de marca.

### 2. Red social y comunidad

La aplicación debe ser útil y estar viva incluso antes de que exista un mundo 3D completo.

- Perfiles de usuarios, artistas, productores, marcas y proyectos.
- Seguidores y descubrimiento.
- Publicaciones, música, videos y procesos creativos.
- Comentarios, mensajería y eventos.
- Comunidades alrededor de artistas y escenas culturales.

### 3. Música y universos de artistas

Cada artista puede tener un micro-universo propio con:

- historia e identidad visual;
- música, videoclips y lanzamientos;
- escenarios y lugares;
- personajes y avatares oficiales;
- merch físico y digital;
- comunidad y seguidores;
- eventos y contenido exclusivo;
- estadísticas, ventas y herramientas de crecimiento.

Los primeros universos de referencia son **El Iglú Records** y **223 Social Club**.

### 4. Marketplace y economía

Todo lo que se crea dentro de CLOUVA puede convertirse en valor.

- Merch físico.
- Ropa y accesorios para avatares.
- Música y contenido exclusivo.
- Entradas y experiencias.
- Escenarios, props, packs y objetos digitales.
- Herramientas para publicar, vender, comprar, equipar y medir resultados.

### 5. Creator Studio

Creator Studio es la fábrica de contenido compatible con el ecosistema.

Debe permitir crear y validar:

- prendas;
- accesorios;
- props;
- avatares;
- personajes;
- escenarios.

Pipeline objetivo:

1. Concepto o referencia.
2. Preview local sin gastar créditos.
3. Generación o importación de geometría.
4. Ajuste contra el avatar oficial.
5. Rigging y transferencia de pesos.
6. Validación técnica y visual.
7. Optimización, versionado y almacenamiento.
8. Publicación en perfil, armario, marketplace y Worlds.

Meshy puede producir geometría. Blender Worker debe realizar trabajo técnico reproducible. Supabase debe guardar estados, relaciones, versiones y assets publicados.

### 6. CLOUVA Worlds

CLOUVA Worlds es la capa inmersiva futura.

- Usa la misma cuenta, avatar e inventario de la app.
- Consume assets y universos mediante una API estable.
- Puede construirse con Unreal Engine 5.
- No debe convertirse en una segunda fuente de verdad.
- No debe bloquear el lanzamiento del núcleo social, creativo y comercial de la aplicación.

### 7. Trébol — CLOUVA AI

El asistente canónico se llama **Trébol — CLOUVA AI**.

Su función es acompañar todo el ecosistema:

- orientar a usuarios;
- ayudar a crear perfiles y universos;
- asistir en diseño y producción;
- explicar procesos y errores;
- investigar el repositorio;
- proponer planes y cambios verificables;
- conservar memoria del proyecto.

Trébol debe distinguir hechos, inferencias y propuestas. Nunca debe fingir que leyó código, ejecutó pruebas o verificó un deploy.

## Arquitectura de producto

### Capa de identidad

- Supabase Auth.
- Perfil y CLOUVA ID.
- Roles y permisos.
- Avatar activo.
- Inventario y armario.

### Capa social

- Perfiles públicos.
- Seguidores.
- Publicaciones y actividad.
- Música y medios.
- Comunidad y mensajería.

### Capa comercial

- Catálogo y marketplace.
- Productos físicos y digitales.
- Pedidos, pagos y stock.
- Inventario adquirido.
- Economía de creadores.

### Capa creativa

- Mi Flow.
- Creator Studio.
- Generación y procesamiento de assets.
- Lanzamientos, vault, visuales y lore.

### Capa de universos

- Artistas y proyectos.
- Escenarios y lugares.
- Eventos y membresías.
- Contenido exclusivo.
- API para CLOUVA Worlds.

### Capa de inteligencia

- Gemini como motor principal de Trébol.
- Contexto maestro de producto.
- Memoria persistente en Supabase.
- Lectura controlada de GitHub.
- Acciones confirmables y auditables.

## Principios no negociables

- **Mobile-first.**
- **Avatar-first, pero no avatar-only.**
- **Producto real antes que demo convincente.**
- **Una fuente de verdad por dominio.**
- **Procesos pesados persistentes y reanudables.**
- **Assets en storage, no acumulados en Git.**
- **Validación antes de publicación.**
- **No gastar créditos para repetir pasos ya válidos.**
- **No bloquear la red social por perfeccionar Blender.**
- **Toda afirmación técnica debe tener evidencia.**

## Roadmap

### Fase 0 — Fundaciones confiables

- Unificar documentación, nombres y arquitectura.
- Definir una sola fuente de verdad para roles.
- Revisar y ordenar migraciones de Supabase.
- Completar `.env.example` y documentación de Railway.
- Establecer build, typecheck, pruebas y observabilidad.
- Definir contratos canónicos para avatar, asset, inventario, publicación y universo.

### Fase 1 — Bucle principal de la app

- Registro, perfil y CLOUVA ID.
- Avatar activo y armario.
- Explorar personas y artistas.
- Seguir perfiles y consumir contenido.
- Música integrada.
- Tienda e inventario conectado.
- Trébol disponible globalmente.

### Fase 2 — Economía de creadores

- Marketplace unificado físico/digital.
- Una categoría de prenda funcionando de punta a punta.
- Pipeline Meshy/Blender/Supabase persistente.
- Publicación, compra, equipamiento y métricas.

### Fase 3 — Universos de artistas

- Modelo de datos de universo.
- Páginas de universo, miembros, contenido y eventos.
- El Iglú Records y 223 Social Club como universos piloto.
- Herramientas para crear nuevos micro-universos.

### Fase 4 — CLOUVA Worlds

- API de identidad, inventario, assets y universos.
- Cliente Unreal Engine 5.
- Sincronización progresiva con la plataforma principal.

## Criterio para decidir prioridades

Una tarea tiene prioridad cuando mejora al menos uno de estos bucles:

1. identidad → perfil → avatar;
2. descubrir → seguir → volver;
3. crear → publicar → compartir;
4. comprar → poseer → equipar;
5. artista → comunidad → monetización.

Una tarea puramente visual o técnica que no fortalezca un bucle debe justificarse antes de desplazar trabajo de producto.
