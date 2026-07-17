# CLOUVA Garment Worker

Servicio de Auto Rig para Creator Studio. Recibe un GLB existente, ejecuta Blender con el avatar oficial y devuelve un GLB riggeado.

## Estrategias

- `transfer_from_avatar`: para objetos sin rig. Transfiere Vertex Groups y pesos desde `clouva-base-rig-v1`, agrega el Armature, normaliza influencias y valida vértices sin peso.
- `preserve_existing_skinning`: para plantillas Base-Mesh. Conserva topología, Vertex Groups y pesos existentes.

## Deploy en Railway

Creá un servicio separado desde el mismo repositorio y configurá:

- Dockerfile: `Dockerfile.worker`
- Healthcheck: `/health`
- Puerto: Railway provee `PORT` automáticamente.

Variables recomendadas:

```text
GARMENT_WORKER_TOKEN=<token largo y secreto>
CLOUVA_AVATAR_URL=<URL pública o firmada del avatar GLB oficial en Supabase>
CLOUVA_AVATAR_TOKEN=<opcional, solo si la URL requiere Bearer token>
PUBLIC_BASE_URL=https://rig.clouva.com.ar
CORS_ORIGINS=https://clouva.com.ar,https://www.clouva.com.ar
BLENDER_JOB_TIMEOUT_SECONDS=900
JOB_RETENTION_SECONDS=86400
```

`CLOUVA_AVATAR_URL` debe apuntar al mismo avatar base que usa Creator Studio. El worker lo descarga una sola vez al iniciar y valida que tenga encabezado `glTF` antes de aceptar trabajos.

En Vercel, usar:

```text
GARMENT_WORKER_URL=https://rig.clouva.com.ar
GARMENT_WORKER_TOKEN=<mismo token>
```

## Endpoints

- `GET /health`
- `POST /jobs` multipart con `file` y `job`
- `GET /jobs/{jobId}`
- `GET /jobs/{jobId}/result.glb`
- `GET /jobs/{jobId}/report`

El frontend no expone el token. La descarga del resultado pasa por `/api/creator-studio/blender/result` en CLOUVA.
