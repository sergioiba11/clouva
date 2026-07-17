# Auditoría de producto y tecnología de CLOUVA

> Revisión amplia del repositorio y su historial. No es una lectura byte por byte de todos los archivos. Las conclusiones separan implementación real, prototipo e intención histórica.

## Resumen ejecutivo

CLOUVA ya contiene piezas importantes de la visión: autenticación, perfiles, seguimiento social, tienda, administración, Mi Flow, avatar 3D, armario, Creator Studio, Meshy/Blender, Spotify embebido y CLOUVA AI.

El problema principal no es la falta de funciones. Es la **fragmentación**:

- el proyecto evolucionó rápidamente por capas y PR sucesivos;
- existen nombres y direcciones de producto superpuestos;
- parte de la interfaz representa funciones futuras como si ya fueran reales;
- hay lógica 3D duplicada en varios visores;
- las migraciones y roles atravesaron varias fuentes de verdad;
- el worker de Blender depende de memoria y disco efímeros;
- la documentación todavía describe una tienda o un despliegue en Vercel, mientras el producto y la infraestructura actual son mayores y usan Railway;
- CLOUVA AI fue construido mediante parches rápidos sin una fuente maestra de visión.

La recomendación es **consolidar antes de expandir**. El MVP no debe esperar a que todo el pipeline 3D sea perfecto: primero tiene que funcionar el bucle identidad → perfil → avatar → descubrir → seguir → contenido → tienda.

## Mapa de módulos

### 1. Aplicación y despliegue

**Estado:** real, operativo con deuda documental.

- Next.js 15, React 19, TypeScript, Tailwind y Supabase.
- Scripts de build y start correctos para Railway.
- `prebuild` reconstruye el GLB oficial desde partes base64 cuando están disponibles.
- No hay Dockerfile en la raíz; Railway puede construir con su builder estándar.
- `next.config.ts` es mínimo.
- `.env.example` estaba incompleto y no representaba la infraestructura real.
- README todavía hablaba de Vercel y de una plataforma centrada en tienda/admin/Mi Flow.

**Riesgos:**

- falta de contrato documentado de variables por servicio;
- deploys sin una etapa obligatoria de typecheck/test;
- assets binarios y preparación de modelos mezclados con el build web;
- falta de observabilidad centralizada.

### 2. Identidad, autenticación y roles

**Estado:** real, con historia de migraciones y normalizaciones repetidas.

- Supabase Auth y `AuthProvider` global.
- Perfiles con nombre, username, avatar, avatar 3D y Spotify.
- Roles actuales normalizados como `admin`, `empleado`, `cliente` y `vip`.
- Históricamente convivieron `role`, `role_v2`, valores en inglés y aliases como `owner`.
- Existen guards de administración y rutas por rol.
- Existe cambio local de cuentas.

**Riesgo crítico:** las políticas RLS históricas y el frontend pueden no usar siempre la misma columna de rol. Antes de ampliar permisos o economía hay que auditar el esquema real de producción y dejar una sola fuente de verdad.

### 3. Perfil, comunidad y descubrimiento

**Estado:** parcialmente real.

Implementado:

- perfiles públicos por username;
- avatar 2D o 3D;
- biografía, CLOUVA ID, VIP y color de acento;
- contador de seguidores;
- seguir y dejar de seguir;
- Spotify embebido.

Incompleto:

- feed social canónico;
- publicaciones y comentarios conectados;
- descubrimiento real de personas/artistas/universos;
- búsqueda global;
- notificaciones;
- mensajería y presencia;
- modelo explícito de artista, proyecto y universo.

La navegación llama “Explorar” a `/lookbook`, lo que todavía no representa la experiencia de descubrimiento definida en la visión.

### 4. Mi Flow

**Estado:** base funcional y modular, pero genérica.

- Dashboard y módulos para flows, estudio, vault, lanzamientos, visuales, dinero, tareas, asistente y lore.
- Tablas `flow_*` con CRUD y RLS por propietario.
- Métricas básicas desde Supabase.

**Problema:** varios módulos nacieron como CRUD genérico. Sirven como base, pero todavía no forman recorridos conectados de artista o creador. Deben convertirse en un sistema coherente de proyecto, lanzamiento, contenido, asset y monetización.

### 5. Tienda, administración y comercio

**Estado:** una de las áreas más completas.

- Catálogo, producto, carrito, checkout y pedidos.
- CRUD de productos, categorías y banners.
- Stock, variantes, cupones y WhatsApp Checkout preparados.
- RLS y buckets de Supabase.

**Brecha con la visión:** el modelo comercial está orientado principalmente a producto físico. Falta unificar:

- producto físico;
- wearable digital;
- asset de escenario;
- entrada o experiencia;
- adquisición e inventario;
- licencia y autoría;
- equipamiento del avatar;
- publicación por artista/universo.

### 6. Home inmersiva

**Estado:** real como experiencia visual.

- Home cliente-only con avatar central.
- Fondo, atmósfera y UI oculta.
- Datos del perfil y música.
- navegación mínima;
- acceso a CLOUVA AI.

**Problemas:**

- la home comunica identidad, pero todavía tiene poca acción social;
- existen componentes históricos llamados `CloverAI`, mientras la marca canónica es Trébol;
- metadata del sitio todavía posicionaba CLOUVA como “Premium Underground fashion”; 
- se usa `model-viewer` global desde CDN además de runtimes Three.js propios.

### 7. Avatar Engine

**Estado:** implementación real con una base importante.

- Avatar activo persistido.
- Catálogo de piezas y configuración en Supabase.
- Resolución de assets remotos.
- Carga GLB/GLTF con Three.js.
- normalización, framing, materiales, morphs y animaciones;
- fallback procedural;
- poses idle, T-Pose y walk;
- validación de prendas preajustadas contra el esqueleto.

**Riesgo arquitectónico alto:** existen varios runtimes similares:

- `AvatarModelViewer`;
- `OutfitPreview`;
- `CreatorStudioAvatarViewer`;
- `SmartTryOnViewer`;
- `model-viewer` en perfiles/home histórica.

Repiten renderer, cámara, luces, GLTFLoader, framing, búsqueda de huesos, poses y limpieza de recursos. Esto aumenta bugs, diferencias de escala y costo de mantenimiento.

**Recomendación:** crear un núcleo 3D compartido con contratos de escena, avatar, wearable, animación, lifecycle y diagnóstico.

### 8. Creator Studio

**Estado:** mezcla de funcionalidad real y panel conceptual.

Real:

- biblioteca local de referencias GLB en IndexedDB;
- carga Android corregida;
- preview sobre el avatar activo;
- controles de escala, posición, profundidad, rotación y vistas;
- envío del archivo a Blender Worker;
- job ID persistido en localStorage;
- polling de estado;
- descarga del GLB final.

Conceptual o simulado:

- porcentajes fijos de compatibilidad;
- simulación de animaciones mediante timeout;
- herramientas de wireframe, weight paint, colisiones y body masks sin pipeline real completo;
- botones de publicación múltiple;
- sincronización con CLOUVA Worlds/Unreal.

La interfaz debe etiquetar claramente “preview conceptual” versus “validación técnica real”.

### 9. Meshy y generación de prendas

**Estado:** historial experimental con varias estrategias.

El repositorio pasó por:

- referencias generadas por OpenAI;
- múltiples vistas;
- Meshy Multi-Image;
- Meshy Text-to-3D;
- separación de geometría y textura;
- uso de medidas del avatar;
- importación de GLB de terceros.

Hay PR abiertos con enfoques que compiten entre sí. No deben fusionarse por acumulación. Primero hay que escoger un único pipeline oficial.

**Pipeline recomendado para el primer producto:**

1. una sola categoría inicial, por ejemplo hoodie;
2. avatar base y contrato de rig congelados;
3. geometría importada o generada;
4. preview local;
5. job persistente de Blender;
6. validación automática;
7. revisión humana;
8. storage y registro de versión;
9. publicación/equipamiento.

### 10. Blender Worker

**Estado:** lógica Blender real, orquestación no apta todavía para producción confiable.

Implementado:

- FastAPI;
- recepción de GLB;
- descarga del avatar oficial;
- proceso Blender en background;
- ajuste por categoría;
- transferencia de pesos por vecinos usando KDTree;
- unión al armature;
- validación y exportación;
- endpoint de estado y resultado.

**Bloqueadores:**

- `JOBS` vive en memoria del proceso;
- outputs viven en un directorio temporal local;
- reiniciar o escalar el servicio pierde trabajos y resultados;
- los threads daemon no son una cola durable;
- la URL pública de resultado está hardcodeada;
- no se ve validación del bearer token dentro del worker;
- no hay deduplicación, reintentos persistentes ni idempotencia;
- no existe registro durable del estado en Supabase.

**Arquitectura objetivo:**

- tabla de jobs en Supabase;
- input/output en Supabase Storage u object storage;
- worker reclamando jobs con lock;
- heartbeat, progreso y logs persistidos;
- estados y errores normalizados;
- autenticación obligatoria entre app y worker;
- limpieza y retención configurables;
- resultados accesibles mediante URLs firmadas.

### 11. Música y Spotify

**Estado:** embeds reales; integración completa pendiente.

- perfiles y home pueden mostrar Spotify mediante URL/embed.
- existe un reproductor global.
- hay un PR draft con OAuth, refresh tokens, escucha reciente y datos privados.

Antes de integrar el PR debe revisarse contra:

- manejo server-side de secretos;
- cifrado o aislamiento de refresh tokens;
- migración y RLS;
- redirect URI de producción;
- experiencia cuando Spotify no está conectado.

### 12. Universos y CLOUVA Worlds

**Estado:** visión y prototipo visual, no backend completo.

- Creator Studio V2 menciona El Iglú Records, 223 Social Club, escenarios y Unreal Engine 5.
- todavía falta un dominio persistente para `universes`, lugares, miembros, roles, eventos, publicaciones, assets y permisos.
- no hay evidencia suficiente de una API estable consumida por Unreal.

**Recomendación:** construir primero universos como una función web/social. La representación 3D se suma después usando los mismos IDs y permisos.

### 13. Trébol — CLOUVA AI

**Estado:** chat, selector de modelo, memoria de conversación, lectura de GitHub y análisis de proyecto.

Problemas detectados en la evolución reciente:

- cambios demasiado rápidos y acoplados;
- promesas de agente más grandes que la implementación estable;
- respuestas que llamaban “exhaustivo” a una lectura parcial;
- falta de visión canónica;
- selección de archivos sesgada hacia rigging;
- interfaz de confirmación heredada aunque el endpoint actual de análisis no prepara cambios.

Se incorporó un contexto maestro para que Gemini trabaje desde la visión completa, declare evidencia y relacione tareas con el roadmap.

## Deuda transversal

### Nombres

- CLOUVA AI / Clover AI / Trébol.
- Iglú / El Iglú / LIGLÚ.
- Mi Flow / CLOUVA OS / Creator Studio.

Debe existir un glosario y una decisión canónica por concepto.

### Documentación

- README desactualizado.
- `.env.example` incompleto.
- referencias históricas a Vercel.
- falta de mapa de servicios y migraciones aplicadas.

### Calidad

- cobertura automatizada mínima;
- tests concentrados en avatar;
- ausencia de contrato de integración para app → worker → storage;
- interfaces con valores simulados que parecen resultados reales.

### Gestión de ramas

Hay PR abiertos con alternativas del mismo flujo de prendas. Deben clasificarse como:

- vigente;
- reemplazado;
- experimento;
- listo para revisión;
- cerrar.

## Prioridades recomendadas

### P0 — Estabilizar la base

1. Confirmar build y typecheck del `main` actual.
2. Auditar el esquema real de Supabase y unificar roles.
3. Actualizar README, variables y diagrama de servicios.
4. Separar claramente prototipos de funciones reales.
5. Definir contratos canónicos de dominio.
6. Agregar health checks y registros de errores.

### P1 — Construir el bucle principal

1. Rediseñar Explorar como descubrimiento real.
2. Consolidar perfil público, follows y actividad.
3. Unificar avatar activo, armario e inventario.
4. Conectar compras digitales con equipamiento.
5. Integrar música de forma progresiva.
6. Convertir Trébol en copiloto contextual de esos recorridos.

### P2 — Producto creador vendible

1. Elegir una categoría de prenda.
2. Persistir jobs del worker.
3. Guardar inputs, outputs y validaciones.
4. Unificar runtime 3D.
5. Publicar el wearable en marketplace.
6. Comprar, equipar y visualizar sobre el avatar.

### P3 — Universos

1. Crear esquema `universes` y membresías.
2. Páginas web de universo.
3. Contenido, eventos, merch y métricas.
4. Universos piloto oficiales.
5. API para clientes 3D.

## Criterio de aceptación del próximo MVP

Un usuario nuevo debe poder:

1. registrarse;
2. crear perfil y CLOUVA ID;
3. elegir avatar;
4. descubrir y seguir un artista;
5. escuchar su música y ver su contenido;
6. visitar su tienda;
7. adquirir un artículo digital;
8. verlo en su inventario y equiparlo;
9. volver a la home y conservar identidad, avatar y relación social.

Ese recorrido demuestra CLOUVA mejor que sumar otra pantalla conceptual o perfeccionar una categoría 3D aislada.
