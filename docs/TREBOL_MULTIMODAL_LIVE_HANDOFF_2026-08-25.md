# Trébol multimodal Live — entrega 2026-08-25

## Estado

Trébol quedó integrado en este repositorio como un único agente con dos transportes:

- texto, mediante el Orchestrator canónico `/api/clouva-ai/chat`;
- voz en tiempo real, mediante Gemini Live y un token efímero emitido por `/api/clouva-ai/live/token`.

Ambos transportes comparten conversación, memoria aprobada, contexto seguro, Tool Router, confirmaciones y auditoría. Railway no forma parte de esta implementación. El destino real de la web sigue siendo Cloud Run (`clouva-web`, proyecto `gen-lang-client-0737053175`, región `us-central1`). No se desplegó ni se hizo push durante esta entrega.

## Arquitectura resultante

- `ClouvaAIAssistantProvider` mantiene una sola conversación activa y el panel global durante la navegación.
- `ClouvaAIChat` sigue siendo la interfaz canónica. El panel compacto la reutiliza; no hay un segundo motor de chat.
- `buildTrebolRuntimeContext` arma y limita el contexto. El servidor vuelve a normalizarlo antes de persistirlo.
- El contexto puede incluir ruta, superficie, Studio, Player/avatar, selección visual, asset y estado de procesos. Se excluyen HTML, inputs, cookies, secretos, tokens, URLs firmadas y URLs de modelos.
- `createAgentToolRouter` construye el mismo catálogo de herramientas para texto, Live y confirmaciones.
- Gemini Live corre directo entre navegador y Gemini con un token efímero. La API key nunca llega al cliente.
- El audio usa AudioWorklet: PCM 16-bit mono a 16 kHz de entrada y 24 kHz de salida. El audio crudo no se guarda.
- Los transcripts finales se escriben en `ai_messages` con UUID idempotente y en la misma conversación del chat.
- Barge-in corta el audio de salida. Hay mute, cierre explícito, reconexión limitada y session resumption.

## Herramientas y permisos

Las herramientas disponibles dependen del alcance real del usuario y la conversación:

- contexto actual, selección y entidades CLOUVA activas;
- memoria aprobada y relevante;
- lecturas y cambios de Studio/Player mediante los servicios canónicos;
- Workspace y GitHub sólo en sus ámbitos autorizados;
- procesos/runtime sólo para administradores reales de CLOUVA CONTROL;
- generación de imágenes sólo para administradores, con confirmación explícita reforzada, presupuesto separado, idempotencia y un máximo global de dos generaciones activas.

Las lecturas seguras pueden ejecutarse directamente. Toda escritura, acción sensible o generación de imagen crea una propuesta persistida. La confirmación se revalida en el servidor y se bloquea de forma atómica para evitar doble ejecución. Las frases de voz aceptadas son deliberadamente estrictas. La generación de video queda diferida: no se simula ni se anuncia como disponible.

## Persistencia y seguridad

Aplicar, en este orden, las migraciones locales:

1. `20260825020000_trebol_agent_audit.sql`: crea `ai_agent_runs` y `ai_tool_calls`, índices y RLS por usuario/conversación.
2. `20260825021000_trebol_live_rate_limit.sql`: crea el límite distribuido y atómico para emitir tokens Live; sólo `service_role` puede usarlo.
3. `20260825022000_media_generation_jobs_reconciliation.sql`: reconcilia el esquema genérico ya existente de `media_generation_jobs` y agrega el presupuesto separado `trebol_media_2026` (USD 5 de límite duro).

Estas migraciones se prepararon localmente pero **no fueron aplicadas al Supabase remoto**. Los endpoints Live fallan de forma cerrada si faltan las tablas de auditoría o rate limit. La ruta de texto conserva compatibilidad durante la transición.

No se persisten audio, API keys, credenciales, tokens efímeros ni contenido binario. La auditoría guarda sólo contexto saneado, argumentos sensibles resumidos y resultados acotados.

## Variables para Cloud Run

Configurar como secretos o variables del servicio, nunca como `NEXT_PUBLIC_*` salvo las claves públicas de Supabase:

- `GEMINI_API_KEY` (obligatoria para texto, token Live e imágenes);
- `GEMINI_LIVE_MODEL` (por defecto `gemini-3.1-flash-live-preview`);
- `TREBOL_LIVE_VOICE` (por defecto `Kore`);
- `GEMINI_IMAGE_MODEL` (por defecto `gemini-3.1-flash-image`);
- `GEMINI_IMAGE_GENERATION_ENABLED`;
- `CLOUVA_GENERATED_MEDIA_BUCKET`;
- `SUPABASE_SERVICE_ROLE_KEY`;
- `CLOUVA_ADMIN_EMAILS`;
- `GITHUB_TOKEN`, si se habilitan herramientas de Proyecto;
- `WORKSPACE_DEVICE_TOKEN_ENCRYPTION_KEY` y `CLOUVA_CONTROL_GATEWAY_URL`, si se habilita Workspace.

Los placeholders seguros están documentados en `.env.example`. La publicación debe usar el flujo existente de Cloud Run; no configurar Railway.

## Validación ejecutada

- `npm run typecheck`: aprobado.
- `npm run lint`: 0 errores; 119 warnings ya existentes en el repositorio.
- `npm run test:clouva-ai`: 89/89 pruebas aprobadas.
- `npm run build`: aprobado; 113 páginas estáticas generadas y rutas Live/tools incluidas.
- `npm test`: falla en `tests-creator-rig.mjs` porque espera `CLOUVA_RIG_VERSION=v43`, mientras el cambio preexistente de `worker/garment-rig/Dockerfile` ya declara `v46`. No se modificó ese trabajo ajeno.

Las pruebas cubren sanitización y diferencias de contexto, permisos, confirmación por voz, estado/reconexión Live, seguridad de tokens, PCM/worklets, barge-in, Tool Router, memoria, Workspace/GitHub, idempotencia y generación de imagen simulada. Son pruebas automatizadas locales; no equivalen a una llamada real a Gemini ni a una sesión real de micrófono.

## Antes de habilitarlo en producción

1. Revisar y aplicar las tres migraciones en Supabase.
2. Configurar los secretos/variables en `clouva-web` sin cambiar tráfico todavía.
3. Ejecutar una prueba autenticada de texto y confirmar continuidad de conversación.
4. Probar permiso denegado de micrófono, conexión Live, transcripciones, mute, barge-in, reconexión y cierre.
5. Probar una lectura segura y una escritura cancelada/confirmada desde voz y desde botones.
6. Probar una generación de imagen administrativa y comprobar job, presupuesto, objeto guardado y mensaje persistido.
7. Revisar `ai_agent_runs`, `ai_tool_calls`, `project_events` y `ai_messages` para confirmar que no contienen secretos ni audio.
8. Corregir o actualizar por separado el test legado del rig v43/v46 antes de exigir `npm test` completamente verde.

## Referencias de protocolo

- Gemini Live ephemeral tokens: <https://ai.google.dev/gemini-api/docs/live-api/ephemeral-tokens>
- Gemini Live capabilities: <https://ai.google.dev/gemini-api/docs/live-api/capabilities>
- Modelos Gemini: <https://ai.google.dev/gemini-api/docs/models>
- SDK JavaScript `@google/genai`: <https://googleapis.github.io/js-genai/release_docs/>
