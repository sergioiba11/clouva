# CLOUVA Canonical Navigation

Estado: rama `chatgpt/clouva-canonical-navigation`.

Este documento define el contrato canónico de navegación de CLOUVA. La arquitectura no elimina superficies existentes: organiza el producto detrás de puertas conceptuales estables y conserva rutas históricas como redirects/resolutores cuando corresponde.

## Mapa maestro

| Concepto | Ruta/contrato | Significado |
| --- | --- | --- |
| HOME | `/` | La casa del usuario. Landing sin sesión; dashboard con sesión. |
| PLAYER | `/{publicAlias}` | Identidad pública canónica. |
| MI FLOW | `/mi-flow` | Dinero, billetera, FLOWS, balances, ingresos y objetivos. |
| CREAR | `/crear` | Hub principal de creación. |
| MI SPOT | `/mi-spot` | Espacios, negocios y organizaciones que el usuario maneja. |
| MARKET | `/tienda` | Discovery comercial; `/catalogo` es el catálogo completo. |
| MATRIX | `/matrix` | Descubrimiento de Players, Studios y ecosistema. |
| STUDIOS | `/studios` | Directorio público; operación en `/studio-dashboard/[studioId]`. |
| ADMIN | `/admin` | Operación global interna, separada de espacios del usuario. |
| VIP | entitlement | Capa de capacidades/billing; no es Home ni destino principal. |

## Contrato de sesión y login

- Visitante: `/` muestra PublicLanding.
- Usuario autenticado normal: `/` muestra Home desktop o mobile.
- `admin` termina en `/admin`.
- `empleado` termina en `/empleado`.
- `cliente` termina en `/`.
- `vip` termina en `/`.
- Usuario de auth recién creado entra a `/onboarding/identity`.
- Overrides legítimos (Studio pendiente, OAuth, invitaciones, callbacks y `returnPath`) conservan prioridad.
- La elección inicial “Explorar” puede abrir `/matrix` durante onboarding, pero no transforma Matrix en el Home permanente.
- El cierre normal del onboarding, con o sin VIP, vuelve a `/` salvo continuación explícita.

## Navegación principal

Desktop: `Inicio · Crear · Market · Matrix`.

Mobile: `Inicio · Player · Crear · Market · Mi Flow`.

Home expone las seis puertas personales/producto: `Mi Player · Mi Flow · Crear · Mi Spot · Market · Matrix`.

AccountMenu: `Mi Flow · Mi Spot · Mi Player/Perfil público · Mi QR · Configuración · Todo CLOUVA · Mis Estudios · Cambiar cuenta · Cerrar sesión`; `Admin` aparece sólo con capacidad administrativa.

## Player público y aliases

`/[publicAlias]` es la única superficie moderna canónica. Un Player publicado resuelve ahí; un Player existente no publicado abre `/profile/edit`; un usuario sin Player entra a `/onboarding/identity`.

Aliases/resolutores históricos:
- `/players/[slug]` → `/{publicAlias}`.
- `/u/[username]` → `/{publicAlias}` cuando el Player moderno existe; mantiene fallback histórico únicamente para compatibilidad.
- `/perfil-publico/[id]` → `/{publicAlias}` cuando puede resolver el Player moderno; mantiene fallback histórico únicamente para compatibilidad.

Los aliases públicos nuevos se validan contra `RESERVED_PUBLIC_ALIASES`; rutas de sistema no pueden convertirse en identidad Player.

## Redirects canónicos

- `/shop` → `/catalogo`.
- `/account` → `/cuenta`.
- `/mi-flow/tasks` → `/mi-flow/tareas`.

Las UIs nuevas deben enlazar directamente al destino canónico.

## Market y productos

- `/tienda`: portada/discovery de CLOUVA MARKET.
- `/catalogo`: catálogo completo.
- `/producto/[slug]`: URL humana principal.
- `/producto/id/[id]`: resolución estable/técnica para QR e integraciones.
- `/carrito` → `/checkout` → `/pedido/[id]`.
- No se crea `/market` paralelo.
- Sólo se muestran categorías respaldadas por infraestructura/datos reales.

## Studios

Tres capas permanecen separadas:
1. Pública: `/studios`, `/studios/[slug]`.
2. Operativa del dueño/manager: `/studio-dashboard/[studioId]`.
3. Global CLOUVA: `/admin/estudios`.

Mi Spot puede representar un Studio existente sin duplicarlo como negocio paralelo.

## Clasificación

- `CANÓNICA`: superficie estable y visible.
- `LEGACY_REDIRECT`: alias histórico mantenido para compatibilidad.
- `TÉCNICA`: callback, resolver o ruta estable para integraciones.
- `PRIVADA`: superficie autenticada o contextual.
- `ADMIN`: operación global protegida.
- `EXPERIMENTAL`: lab/debug/herramienta fuera de navegación normal.
- `DINÁMICA`: recurso identificado por alias/id/slug con reglas propias.

## Inventario completo `app/**/page.tsx`

La rama actual contiene **130** archivos `page.tsx`: el inventario histórico aumentó en uno al mover Media Creator a la nueva ruta canónica `/crear/media` sin eliminar la experiencia existente.

| Ruta | Grupo | Clase | Propósito | Audiencia | Canonical | Legacy aliases | Permisos | Entrada | Salida |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| / | Core | CANÓNICA | Landing sin sesión; Home autenticada con las puertas maestras. | Visitantes y usuarios | / | — | Pública; Home autenticada requiere sesión contextual | Entrada principal / post-login | Player · Mi Flow · Crear · Mi Spot · Market · Matrix |
| /[publicAlias] | Player | DINÁMICA | Player público canónico por alias. | Público | /[publicAlias] | /players/[slug], /u/[username], /perfil-publico/[id] cuando resuelven | Pública; respeta privacidad/publicación | Matrix · links compartidos · Perfil | Matrix · Market · Studios · media |
| /account | Cuenta | LEGACY_REDIRECT | Alias histórico de cuenta. | Usuarios | /cuenta | /account | Redirect | Links históricos | /cuenta |
| /auth/callback | Auth | TÉCNICA | Callback técnico de autenticación/OAuth. | Usuarios | /auth/callback | — | Técnica | Proveedor OAuth | Continuación/returnPath o destino de auth |
| /auth/clouva-control-login | Auth | TÉCNICA | Login específico de CLOUVA Control. | Operación/Control | /auth/clouva-control-login | — | Técnica / autenticación | CLOUVA Control | Control / callback |
| /auth/mobile-preview | Lab | EXPERIMENTAL | Preview técnico móvil de auth/UI. | Desarrollo | /auth/mobile-preview | — | Internal/Lab | Herramientas internas | Lab |
| /avatar-analyzer-v4 | Lab | EXPERIMENTAL | Analyzer técnico de avatar V4. | Desarrollo/3D | /avatar-analyzer-v4 | — | Internal/Lab | Crear / herramientas técnicas | Pipeline avatar |
| /biblioteca | Crear | PRIVADA | Biblioteca de assets y medios del usuario. | Usuarios/creadores | /biblioteca | — | Sesión | Crear · Todo CLOUVA | Crear · assets |
| /carrito | Market | CANÓNICA | Carrito comercial. | Compradores | /carrito | — | Pública/sesión según checkout | Market · Producto | /checkout |
| /catalogo | Market | CANÓNICA | Catálogo completo, filtros y búsqueda. | Público | /catalogo | /shop | Pública | /tienda · búsqueda | /producto/[slug] · /carrito |
| /checkout | Market | CANÓNICA | Checkout comercial general. | Compradores | /checkout | — | Sesión/datos de compra | /carrito | /pedido/[id] |
| /checkout/vip | VIP | TÉCNICA | Entrada técnica al checkout VIP. | Usuarios | /vip | — | Sesión | /vip | Proveedor / estados VIP |
| /checkout/vip/failure | VIP | TÉCNICA | Estado de checkout VIP fallido. | Usuarios | /checkout/vip/failure | — | No index | Mercado Pago | /vip · / |
| /checkout/vip/pending | VIP | TÉCNICA | Estado de checkout VIP pendiente. | Usuarios | /checkout/vip/pending | — | No index | Mercado Pago | /vip · / |
| /checkout/vip/return | VIP | TÉCNICA | Retorno técnico y verificación VIP. | Usuarios | /checkout/vip/return | — | Sesión / técnica | Mercado Pago | Estado VIP / Home |
| /checkout/vip/success | VIP | TÉCNICA | Estado de checkout VIP confirmado. | Usuarios | /checkout/vip/success | — | No index | Mercado Pago | / |
| /clouva-ai | Crear | PRIVADA | Superficie de CLOUVA AI / Trébol. | Usuarios | /clouva-ai | — | Sesión/capacidades | /crear · Home | Crear · Home |
| /crear | Crear | CANÓNICA | Hub principal de creación. | Usuarios | /crear | — | Sesión | Home · nav | Media · Trébol · Creator Studio · Avatar · Ropa · Centro creativo |
| /crear/media | Crear | PRIVADA | Media Creator existente, preservado como herramienta especializada. | Creadores | /crear/media | — | Sesión/capacidades | /crear | /crear · /biblioteca |
| /creator-studio | Crear | PRIVADA | Creator Studio 3D especializado. | Creadores | /creator-studio | — | Sesión/capacidades | /crear | Objetos · Avatar · Armario · Market |
| /creator-studio/objects | Crear | PRIVADA | Creación y gestión de objetos 3D. | Creadores | /creator-studio/objects | — | Sesión/capacidades | Creator Studio | Creator Studio · inventario |
| /cuenta | Cuenta | CANÓNICA | Cuenta privada canónica en español. | Usuarios | /cuenta | /account | Sesión | AccountMenu | Perfil/configuración |
| /debug-auth | Lab | EXPERIMENTAL | Diagnóstico técnico de autenticación. | Desarrollo | /debug-auth | — | Internal/Lab | Directa | Auth |
| /empleado | Operación | PRIVADA | Inicio operativo de empleado. | Empleados | /empleado | — | role empleado/admin | Post-login empleado | Operación autorizada |
| /gracias | Support | CANÓNICA | Confirmación/agradecimiento de flujos públicos. | Público | /gracias | — | Pública | Flujos contextuales | Home/Market |
| /login | Auth | CANÓNICA | Ingreso a CLOUVA. | Visitantes | /login | — | Pública | Landing | Destino post-auth |
| /logo | Lab | EXPERIMENTAL | Herramienta/lab de logo. | Desarrollo | /logo | — | Internal/Lab | Directa | Lab |
| /lookbook | Public | CANÓNICA | Lookbook público existente. | Público | /lookbook | — | Pública | Market/contextual | Market |
| /matrix | Matrix | CANÓNICA | Descubrimiento de Players, Studios y ecosistema. | Público/usuarios | /matrix | — | Pública | Landing Ver · Home · nav | Players · Studios · perfiles |
| /mi-qr | Cuenta | PRIVADA | QR personal de CLOUVA. | Usuarios | /mi-qr | — | Sesión | AccountMenu | Player / compartir |
| /privacidad | Legal | CANÓNICA | Política de privacidad. | Público | /privacidad | — | Pública | Footer/legal | Home |
| /q/[identifierId] | QR | DINÁMICA | Resolución estable de QR/identificadores. | Público/integraciones | /q/[identifierId] | — | Pública/técnica según recurso | QR físico | Producto/Spot/recurso resuelto |
| /registro | Auth | CANÓNICA | Registro de usuario. | Visitantes | /registro | — | Pública | Landing | Onboarding |
| /shop | Market | LEGACY_REDIRECT | Alias histórico del catálogo. | Público | /catalogo | /shop | Redirect | Links históricos | /catalogo |
| /sobre-clouva | Public | CANÓNICA | Información pública sobre CLOUVA. | Público | /sobre-clouva | — | Pública | Footer/contextual | Home |
| /spaces/[slug] | Spaces | DINÁMICA | Superficie pública de un Space existente. | Público | /spaces/[slug] | — | Pública según publicación | Matrix/contextual | Market/Spot/Studio según tipo |
| /terminos | Legal | CANÓNICA | Términos del servicio. | Público | /terminos | — | Pública | Footer/legal | Home |
| /tienda | Market | CANÓNICA | Portada/discovery de CLOUVA MARKET. | Público | /tienda | — | Pública | Home · nav | /catalogo · productos |
| /truco | Lab | EXPERIMENTAL | Superficie experimental existente fuera de navegación normal. | Desarrollo | /truco | — | Internal/Lab | Directa | Lab |
| /u/[username] | Player | LEGACY_REDIRECT | Resolver histórico de perfil por username; canoniza cuando existe Player moderno. | Público | /[publicAlias] | /u/[username] | Pública; fallback histórico | Links históricos | /[publicAlias] |
| /vip | VIP | PRIVADA | Gestión/oferta de entitlement VIP, no destino principal. | Usuarios | /vip | — | Sesión/billing | Onboarding · Account/contextual | Home |
| /admin | Admin | ADMIN | Dashboard operativo global. | Administradores | /admin | — | role admin | /admin | /admin |
| /admin/avatar-oficial | Admin | ADMIN | Gestión del avatar oficial. | Administradores | /admin/avatar-oficial | — | role admin | /admin | /admin |
| /admin/banners | Admin | ADMIN | Gestión global de banners. | Administradores | /admin/banners | — | role admin | /admin | /admin |
| /admin/categorias | Admin | ADMIN | Gestión global de categorías. | Administradores | /admin/categorias | — | role admin | /admin | /admin |
| /admin/clientes | Admin | ADMIN | Gestión global de clientes. | Administradores | /admin/clientes | — | role admin | /admin | /admin |
| /admin/clouva-control | Admin | ADMIN | Control operativo interno. | Administradores | /admin/clouva-control | — | role admin | /admin | /admin |
| /admin/clouva-lab | Admin | ADMIN | Lab administrativo interno. | Administradores | /admin/clouva-lab | — | role admin | /admin | /admin |
| /admin/configuracion | Admin | ADMIN | Configuración administrativa. | Administradores | /admin/configuracion | — | role admin | /admin | /admin |
| /admin/configuracion/pagos | Admin | ADMIN | Configuración administrativa de pagos. | Administradores | /admin/configuracion/pagos | — | role admin | /admin | /admin |
| /admin/cupones | Admin | ADMIN | Gestión global de cupones. | Administradores | /admin/cupones | — | role admin | /admin | /admin |
| /admin/empleados | Admin | ADMIN | Gestión global de empleados. | Administradores | /admin/empleados | — | role admin | /admin | /admin |
| /admin/envios | Admin | ADMIN | Gestión global de envíos. | Administradores | /admin/envios | — | role admin | /admin | /admin |
| /admin/estudios | Admin | ADMIN | Administración global de Studios. | Administradores | /admin/estudios | — | role admin | /admin | /admin |
| /admin/estudios/membresias | Admin | ADMIN | Administración global de membresías de Studios. | Administradores | /admin/estudios/membresias | — | role admin | /admin | /admin |
| /admin/estudios/studio-os | Admin | ADMIN | Administración global de Studio OS. | Administradores | /admin/estudios/studio-os | — | role admin | /admin | /admin |
| /admin/flows | Admin | ADMIN | Administración global de FLOWS. | Administradores | /admin/flows | — | role admin | /admin | /admin |
| /admin/marketplace | Admin | ADMIN | Administración global del marketplace. | Administradores | /admin/marketplace | — | role admin | /admin | /admin |
| /admin/marketplace/compatibilidad | Admin | ADMIN | Compatibilidad administrativa del marketplace. | Administradores | /admin/marketplace/compatibilidad | — | role admin | /admin | /admin |
| /admin/pedidos | Admin | ADMIN | Administración global de pedidos. | Administradores | /admin/pedidos | — | role admin | /admin | /admin |
| /admin/productos | Admin | ADMIN | Administración global de productos. | Administradores | /admin/productos | — | role admin | /admin | /admin |
| /admin/productos/[id] | Admin | ADMIN | Edición administrativa de producto. | Administradores | /admin/productos/[id] | — | role admin | /admin | /admin |
| /admin/productos/[id]/imagenes | Admin | ADMIN | Administración de imágenes de producto. | Administradores | /admin/productos/[id]/imagenes | — | role admin | /admin | /admin |
| /admin/productos/nuevo | Admin | ADMIN | Alta administrativa de producto. | Administradores | /admin/productos/nuevo | — | role admin | /admin | /admin |
| /admin/reservas | Admin | ADMIN | Administración global de reservas. | Administradores | /admin/reservas | — | role admin | /admin | /admin |
| /admin/stock | Admin | ADMIN | Administración global de stock. | Administradores | /admin/stock | — | role admin | /admin | /admin |
| /admin/suscripciones | Admin | ADMIN | Administración global de suscripciones. | Administradores | /admin/suscripciones | — | role admin | /admin | /admin |
| /admin/ventas | Admin | ADMIN | Administración global de ventas. | Administradores | /admin/ventas | — | role admin | /admin | /admin |
| /mi-flow | Mi Flow | CANÓNICA | Economía personal: billetera, balances, FLOWS, ingresos y objetivos. | Usuarios | /mi-flow | — | Sesión | Home · AccountMenu · Todo CLOUVA | Mi Flow · Home · herramienta relacionada |
| /mi-flow/agenda | Mi Flow | PRIVADA | Agenda/herramienta personal preservada detrás de Todo CLOUVA. | Usuarios | /mi-flow/agenda | — | Sesión | Home · AccountMenu · Todo CLOUVA | Mi Flow · Home · herramienta relacionada |
| /mi-flow/armario | Mi Flow | PRIVADA | Armario e inventario wearable/avatar. | Usuarios | /mi-flow/armario | — | Sesión | Home · AccountMenu · Todo CLOUVA | Mi Flow · Home · herramienta relacionada |
| /mi-flow/assistant | Mi Flow | PRIVADA | Asistente histórico preservado. | Usuarios | /mi-flow/assistant | — | Sesión | Home · AccountMenu · Todo CLOUVA | Mi Flow · Home · herramienta relacionada |
| /mi-flow/avatar-customizer | Mi Flow | PRIVADA | Customizador de avatar. | Usuarios | /mi-flow/avatar-customizer | — | Sesión | Home · AccountMenu · Todo CLOUVA | Mi Flow · Home · herramienta relacionada |
| /mi-flow/avatar-ia | Mi Flow | PRIVADA | Herramienta IA para avatar. | Usuarios | /mi-flow/avatar-ia | — | Sesión | Home · AccountMenu · Todo CLOUVA | Mi Flow · Home · herramienta relacionada |
| /mi-flow/avatar | Mi Flow | PRIVADA | Identidad/avatar 3D del usuario. | Usuarios | /mi-flow/avatar | — | Sesión | Home · AccountMenu · Todo CLOUVA | Mi Flow · Home · herramienta relacionada |
| /mi-flow/billetera | Mi Flow | PRIVADA | Billetera explícita dentro de Mi Flow. | Usuarios | /mi-flow/billetera | — | Sesión | Home · AccountMenu · Todo CLOUVA | Mi Flow · Home · herramienta relacionada |
| /mi-flow/contenido | Mi Flow | PRIVADA | Herramienta de contenido preservada. | Usuarios | /mi-flow/contenido | — | Sesión | Home · AccountMenu · Todo CLOUVA | Mi Flow · Home · herramienta relacionada |
| /mi-flow/crear-prenda | Mi Flow | PRIVADA | Creación de prendas conectada al pipeline 3D. | Usuarios | /mi-flow/crear-prenda | — | Sesión | Home · AccountMenu · Todo CLOUVA | Mi Flow · Home · herramienta relacionada |
| /mi-flow/creative | Mi Flow | PRIVADA | Centro creativo existente. | Usuarios | /mi-flow/creative | — | Sesión | Home · AccountMenu · Todo CLOUVA | Mi Flow · Home · herramienta relacionada |
| /mi-flow/drops | Mi Flow | PRIVADA | Drops existentes. | Usuarios | /mi-flow/drops | — | Sesión | Home · AccountMenu · Todo CLOUVA | Mi Flow · Home · herramienta relacionada |
| /mi-flow/finanzas | Mi Flow | PRIVADA | Finanzas personales dentro de Mi Flow. | Usuarios | /mi-flow/finanzas | — | Sesión | Home · AccountMenu · Todo CLOUVA | Mi Flow · Home · herramienta relacionada |
| /mi-flow/flows | Mi Flow | PRIVADA | FLOWS y economía interna. | Usuarios | /mi-flow/flows | — | Sesión | Home · AccountMenu · Todo CLOUVA | Mi Flow · Home · herramienta relacionada |
| /mi-flow/ideas | Mi Flow | PRIVADA | Ideas/herramienta preservada. | Usuarios | /mi-flow/ideas | — | Sesión | Home · AccountMenu · Todo CLOUVA | Mi Flow · Home · herramienta relacionada |
| /mi-flow/launch | Mi Flow | PRIVADA | Launch/herramienta preservada. | Usuarios | /mi-flow/launch | — | Sesión | Home · AccountMenu · Todo CLOUVA | Mi Flow · Home · herramienta relacionada |
| /mi-flow/lore | Mi Flow | PRIVADA | Lore/herramienta preservada. | Usuarios | /mi-flow/lore | — | Sesión | Home · AccountMenu · Todo CLOUVA | Mi Flow · Home · herramienta relacionada |
| /mi-flow/menu | Mi Flow | PRIVADA | TODO CLOUVA: launcher general; URL histórica conservada por compatibilidad. | Usuarios | /mi-flow/menu | — | Sesión | Home · AccountMenu · Todo CLOUVA | Mi Flow · Home · herramienta relacionada |
| /mi-flow/money | Mi Flow | PRIVADA | Alias/herramienta monetaria histórica preservada. | Usuarios | /mi-flow/money | — | Sesión | Home · AccountMenu · Todo CLOUVA | Mi Flow · Home · herramienta relacionada |
| /mi-flow/music | Mi Flow | PRIVADA | Música personal/creativa. | Usuarios | /mi-flow/music | — | Sesión | Home · AccountMenu · Todo CLOUVA | Mi Flow · Home · herramienta relacionada |
| /mi-flow/negocios | Mi Flow | PRIVADA | Herramienta histórica de negocios; Mi Spot es la puerta canónica de operación. | Usuarios | /mi-flow/negocios | — | Sesión | Home · AccountMenu · Todo CLOUVA | Mi Flow · Home · herramienta relacionada |
| /mi-flow/roadmap | Mi Flow | PRIVADA | Roadmap/herramienta preservada. | Usuarios | /mi-flow/roadmap | — | Sesión | Home · AccountMenu · Todo CLOUVA | Mi Flow · Home · herramienta relacionada |
| /mi-flow/store | Mi Flow | PRIVADA | Store/herramienta preservada detrás de Todo CLOUVA. | Usuarios | /mi-flow/store | — | Sesión | Home · AccountMenu · Todo CLOUVA | Mi Flow · Home · herramienta relacionada |
| /mi-flow/studio | Mi Flow | PRIVADA | Herramienta histórica de Studio; dashboards canónicos permanecen separados. | Usuarios | /mi-flow/studio | — | Sesión | Home · AccountMenu · Todo CLOUVA | Mi Flow · Home · herramienta relacionada |
| /mi-flow/tareas | Mi Flow | PRIVADA | Tareas canónicas en español. | Usuarios | /mi-flow/tareas | /mi-flow/tasks | Sesión | Home · AccountMenu · Todo CLOUVA | Mi Flow · Home · herramienta relacionada |
| /mi-flow/tasks | Mi Flow | LEGACY_REDIRECT | Alias inglés histórico de tareas. | Usuarios | /mi-flow/tareas | /mi-flow/tasks | Sesión | Home · AccountMenu · Todo CLOUVA | Mi Flow · Home · herramienta relacionada |
| /mi-flow/vault | Mi Flow | PRIVADA | Vault/herramienta preservada. | Usuarios | /mi-flow/vault | — | Sesión | Home · AccountMenu · Todo CLOUVA | Mi Flow · Home · herramienta relacionada |
| /mi-flow/visual | Mi Flow | PRIVADA | Visual/herramienta preservada. | Usuarios | /mi-flow/visual | — | Sesión | Home · AccountMenu · Todo CLOUVA | Mi Flow · Home · herramienta relacionada |
| /mi-spot | Mi Spot | CANÓNICA | Puerta principal a los espacios que maneja el usuario. | Dueños/managers/equipo | /mi-spot | — | Sesión + permisos del Space | Home · AccountMenu · Mi Spot | Mi Spot · módulos autorizados |
| /mi-spot/new | Mi Spot | PRIVADA | Creación de un nuevo Space/Spot compatible con la arquitectura real. | Dueños/managers/equipo | /mi-spot/new | — | Sesión + permisos del Space | Home · AccountMenu · Mi Spot | Mi Spot · módulos autorizados |
| /mi-spot/[spotId] | Mi Spot | DINÁMICA | Dashboard operativo del Spot seleccionado. | Dueños/managers/equipo | /mi-spot/[spotId] | — | Sesión + permisos del Space | Home · AccountMenu · Mi Spot | Mi Spot · módulos autorizados |
| /mi-spot/[spotId]/commerce | Mi Spot | DINÁMICA | Commerce del Spot. | Dueños/managers/equipo | /mi-spot/[spotId]/commerce | — | Sesión + permisos del Space | Home · AccountMenu · Mi Spot | Mi Spot · módulos autorizados |
| /mi-spot/[spotId]/publicaciones | Mi Spot | DINÁMICA | Publicaciones del Spot. | Dueños/managers/equipo | /mi-spot/[spotId]/publicaciones | — | Sesión + permisos del Space | Home · AccountMenu · Mi Spot | Mi Spot · módulos autorizados |
| /mi-spot/[spotId]/team | Mi Spot | DINÁMICA | Equipo y roles del Spot. | Dueños/managers/equipo | /mi-spot/[spotId]/team | — | Sesión + permisos del Space | Home · AccountMenu · Mi Spot | Mi Spot · módulos autorizados |
| /onboarding/identity | Onboarding | PRIVADA | Elección inicial: qué hacer en CLOUVA. | Usuarios nuevos | /onboarding/identity | — | Sesión / onboarding | Registro / paso anterior | Siguiente paso; final normal / |
| /onboarding/instagram | Onboarding | PRIVADA | Conexión/importación de Instagram durante onboarding. | Usuarios nuevos | /onboarding/instagram | — | Sesión / onboarding | Registro / paso anterior | Siguiente paso; final normal / |
| /onboarding/instagram/select | Onboarding | PRIVADA | Selección de identidad/datos importados de Instagram. | Usuarios nuevos | /onboarding/instagram/select | — | Sesión / onboarding | Registro / paso anterior | Siguiente paso; final normal / |
| /onboarding/player-identity | Onboarding | PRIVADA | Creación inicial de identidad Player. | Usuarios nuevos | /onboarding/player-identity | — | Sesión / onboarding | Registro / paso anterior | Siguiente paso; final normal / |
| /onboarding/profile-preview | Onboarding | PRIVADA | Preview/publicación inicial del Player. | Usuarios nuevos | /onboarding/profile-preview | — | Sesión / onboarding | Registro / paso anterior | Siguiente paso; final normal / |
| /onboarding/vip-offer | Onboarding | PRIVADA | Oferta de entitlement VIP al final del onboarding. | Usuarios nuevos | /onboarding/vip-offer | — | Sesión / onboarding | Registro / paso anterior | Siguiente paso; final normal / |
| /pedido/[id] | Market | DINÁMICA | Detalle/seguimiento de pedido. | Comprador | /pedido/[id] | — | Sesión + acceso al pedido | Checkout / historial | Market |
| /producto/[slug] | Market | DINÁMICA | URL humana principal de producto. | Público | /producto/[slug] | — | Pública según publicación | Market · Catálogo · Player/Spot/Studio | Carrito · vendedor |
| /producto/id/[id] | Market | TÉCNICA | Resolución estable de producto por ID para QR/integraciones. | Integraciones/Público | /producto/id/[id] | — | Pública según producto | QR · referencias persistentes | /producto/[slug] cuando corresponde |
| /perfil | Player | PRIVADA | Resumen/configuración personal privada. | Usuarios | /perfil | — | Sesión si privada; pública si resolver/directorio | Home · AccountMenu · Matrix/contextual | Player · Home · Matrix |
| /perfil/configuracion | Player | PRIVADA | Preferencias y configuración privada. | Usuarios | /perfil/configuracion | — | Sesión si privada; pública si resolver/directorio | Home · AccountMenu · Matrix/contextual | Player · Home · Matrix |
| /perfil-publico/[id] | Player | LEGACY_REDIRECT | Resolver histórico por id hacia Player canónico cuando existe. | Público | /[publicAlias] | /perfil-publico/[id] | Sesión si privada; pública si resolver/directorio | Home · AccountMenu · Matrix/contextual | Player · Home · Matrix |
| /players | Player | CANÓNICA | Directorio de Players existente; Matrix es la puerta de descubrimiento global. | Público | /players | — | Sesión si privada; pública si resolver/directorio | Home · AccountMenu · Matrix/contextual | Player · Home · Matrix |
| /players/[slug] | Player | LEGACY_REDIRECT | Resolver histórico por slug hacia Player raíz canónico. | Público | /[publicAlias] | /players/[slug] | Sesión si privada; pública si resolver/directorio | Home · AccountMenu · Matrix/contextual | Player · Home · Matrix |
| /profile/edit | Player | PRIVADA | Editor profesional del Player público. | Usuarios con Player | /profile/edit | — | Sesión si privada; pública si resolver/directorio | Home · AccountMenu · Matrix/contextual | Player · Home · Matrix |
| /profile/memberships | Player | PRIVADA | Membresías/Studios del usuario. | Usuarios | /profile/memberships | — | Sesión si privada; pública si resolver/directorio | Home · AccountMenu · Matrix/contextual | Player · Home · Matrix |
| /profile/spotify-artist | Player | PRIVADA | Workspace profesional Spotify/Artists. | Creadores | /profile/spotify-artist | — | Sesión si privada; pública si resolver/directorio | Home · AccountMenu · Matrix/contextual | Player · Home · Matrix |
| /studios | Studios | CANÓNICA | Directorio público de Studios. | Público / miembros / managers según superficie | /studios | — | Pública | Matrix · Studios · Mi Spot | Studio público · Dashboard · Market según contexto |
| /studios/nuevo | Studios | PRIVADA | Creación de Studio usando arquitectura real. | Público / miembros / managers según superficie | /studios/nuevo | — | Sesión + permisos Studio | Matrix · Studios · Mi Spot | Studio público · Dashboard · Market según contexto |
| /studios/[slug] | Studios | DINÁMICA | Identidad y oferta pública del Studio. | Público / miembros / managers según superficie | /studios/[slug] | — | Pública | Matrix · Studios · Mi Spot | Studio público · Dashboard · Market según contexto |
| /studios/[slug]/checkout | Studios | DINÁMICA | Checkout contextual del Studio. | Público / miembros / managers según superficie | /studios/[slug]/checkout | — | Pública | Matrix · Studios · Mi Spot | Studio público · Dashboard · Market según contexto |
| /studios/[slug]/join | Studios | DINÁMICA | Ingreso/aplicación/membresía al Studio. | Público / miembros / managers según superficie | /studios/[slug]/join | — | Pública | Matrix · Studios · Mi Spot | Studio público · Dashboard · Market según contexto |
| /studios/[slug]/studio-os | Studios | DINÁMICA | Superficie Studio OS contextual existente. | Público / miembros / managers según superficie | /studios/[slug]/studio-os | — | Pública | Matrix · Studios · Mi Spot | Studio público · Dashboard · Market según contexto |
| /studios/[slug]/tienda | Studios | DINÁMICA | Tienda pública del Studio. | Público / miembros / managers según superficie | /studios/[slug]/tienda | — | Pública | Matrix · Studios · Mi Spot | Studio público · Dashboard · Market según contexto |
| /studios/[slug]/tienda/[productSlug] | Studios | DINÁMICA | Producto público dentro de la tienda del Studio. | Público / miembros / managers según superficie | /studios/[slug]/tienda/[productSlug] | — | Pública | Matrix · Studios · Mi Spot | Studio público · Dashboard · Market según contexto |
| /studio-dashboard/[studioId] | Studios | DINÁMICA | Dashboard operativo de dueño/manager del Studio. | Público / miembros / managers según superficie | /studio-dashboard/[studioId] | — | Sesión + permisos Studio | Matrix · Studios · Mi Spot | Studio público · Dashboard · Market según contexto |
| /studio-dashboard/[studioId]/commerce | Studios | DINÁMICA | Commerce operativo del Studio. | Público / miembros / managers según superficie | /studio-dashboard/[studioId]/commerce | — | Sesión + permisos Studio | Matrix · Studios · Mi Spot | Studio público · Dashboard · Market según contexto |
| /studio-dashboard/[studioId]/identity-preview | Studios | DINÁMICA | Preview operativo de identidad del Studio. | Público / miembros / managers según superficie | /studio-dashboard/[studioId]/identity-preview | — | Sesión + permisos Studio | Matrix · Studios · Mi Spot | Studio público · Dashboard · Market según contexto |

## Reglas de implementación

1. Ninguna navegación principal debe depender de conocer rutas internas históricas.
2. Desktop y mobile consumen `lib/navigation/clouva-navigation.ts`.
3. `Mi Flow` no reemplaza Home.
4. `Matrix` no reemplaza Market.
5. VIP habilita capacidades; no sustituye rol operativo ni Home.
6. Admin nunca se mezcla con Mi Spot o Studio Dashboard.
7. Una ruta legacy puede seguir existiendo por SEO, QR, enlaces compartidos, email, OAuth o integraciones, pero las UIs nuevas no deben generarla.
8. Las superficies de Lab/Debug se conservan fuera de navegación normal.
9. Los IDs de producto físico, asset 3D, inventory item y market listing siguen siendo conceptos distintos aunque puedan estar vinculados.
10. Los cambios de navegación no autorizan migraciones destructivas ni sustituciones de backend.

## Matriz de aceptación

| Caso | Contrato |
| --- | --- |
| A Visitante | `/` → landing; Entrar → `/login`; Ver → `/matrix`. |
| B Cliente existente | login → `/`. |
| C VIP existente | login → `/`. |
| D Admin | login → `/admin`. |
| E Empleado | login → `/empleado`. |
| F Usuario nuevo | auth → onboarding → flujo inicial → cierre normal `/`. |
| G Player publicado | botón Player → `/{publicAlias}`. |
| H Player no publicado | botón Player → `/profile/edit`. |
| I Comprar | Home/Market → `/tienda` → `/catalogo` → `/producto/[slug]` → `/carrito` → `/checkout` → `/pedido/[id]`. |
| J Crear | Home → `/crear` → herramienta real. |
| K Negocio | Home → `/mi-spot` → espacio → módulos autorizados. |
| L Studio | Matrix/Studios → `/studios/[slug]`; con permisos → `/studio-dashboard/[studioId]`. |
| M Aliases | `/shop` → `/catalogo`; `/account` → `/cuenta`; `/mi-flow/tasks` → `/mi-flow/tareas`; perfiles legacy canonizan al alias raíz cuando es resoluble. |
