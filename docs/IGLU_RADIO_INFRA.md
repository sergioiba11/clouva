# IGLÚ RADIO — Infraestructura

## Objetivo

IGLÚ RADIO vive dentro de El Iglú en CLOUVA y separa claramente tres capas:

1. **CLOUVA / Supabase**: biblioteca, playlists, programación, permisos, metadata y panel de administración.
2. **Servidor radial**: AzuraCast + Liquidsoap + Icecast para emisión continua 24/7.
3. **Web pública**: reproductor persistente y metadata real de la señal.

La aplicación no inventa una señal. Si el servidor o stream no están configurados, la interfaz muestra estado offline.

## Rutas

- Público: `/studios/el-iglu/radio`
- Admin: `/studios/el-iglu/radio/admin`
- Biblioteca: `/studios/el-iglu/radio/admin/library`
- Playlists: `/studios/el-iglu/radio/admin/playlists`
- Programación: `/studios/el-iglu/radio/admin/schedule`
- Servidor: `/studios/el-iglu/radio/admin/infra`

## Base de datos

La migración `20260914194500_iglu_radio_control_plane.sql` crea:

- `radio_station_settings`
- `radio_tracks`
- `radio_playlists`
- `radio_playlist_items`
- `radio_schedule_blocks`
- `radio_play_history`

También crea el bucket privado `iglu-radio`, con límite de 500 MB por archivo y soporte de MP3, WAV y FLAC.

El acceso administrativo reutiliza `requireStudioManager`, por lo que mantiene los permisos reales de Studio OS y no agrega un auth paralelo.

## Variables server-side

```bash
IGLU_RADIO_API_URL=https://radio.clouva.com.ar
IGLU_RADIO_STATION_ID=1
IGLU_RADIO_API_KEY=<secreto>
```

Estas variables son privadas y nunca deben usar `NEXT_PUBLIC_`.

## Stream público

```bash
NEXT_PUBLIC_IGLU_RADIO_STREAM_URL=https://radio.clouva.com.ar/listen/iglu_radio/radio.mp3
```

Esta URL se integra al único elemento `<audio>` persistente que ya existe en la radio.

## AzuraCast

La configuración recomendada es una VM persistente con Docker y AzuraCast. AzuraCast administra Liquidsoap, Icecast, AutoDJ, media library y endpoints de now-playing.

CLOUVA consulta:

- `GET /api/nowplaying/{station_id}` para metadata pública.
- `GET /api/station/{station_id}/status` para health privado.
- `POST /api/station/{station_id}/backend/start` para iniciar AutoDJ.
- `POST /api/station/{station_id}/backend/stop` para detener AutoDJ.

La API key vive únicamente en el backend de CLOUVA.

## DNS / TLS

Crear `radio.clouva.com.ar` apuntando a la IP pública de la VM radial. Mantener HTTPS activo antes de configurar el stream en producción.

## Flujo de biblioteca

1. El administrador solicita un upload firmado desde CLOUVA.
2. El archivo se sube directamente al bucket privado `iglu-radio`.
3. CLOUVA verifica que el archivo exista y marca el track `ready`.
4. Cuando AzuraCast está conectado, el track puede sincronizarse con la biblioteca radial y pasar a `synced`.
5. Playlists y programación usan los IDs canónicos de Supabase.

## Metadata pública

`/api/studios/el-iglu/radio/now-playing` traduce el now-playing de AzuraCast a un DTO público. `RadioLiveData` lo consulta periódicamente y actualiza el `RadioProvider` sin recrear el elemento de audio.

## Health

`/api/studios/el-iglu/radio/health` expone solamente estado operativo no sensible: stream configurado, AzuraCast configurado, reachability, AutoDJ y estado live. Nunca devuelve claves ni secretos.

## Estado offline

Si faltan `IGLU_RADIO_API_URL`, `IGLU_RADIO_STATION_ID`, `IGLU_RADIO_API_KEY` o `NEXT_PUBLIC_IGLU_RADIO_STREAM_URL`, el panel debe indicar exactamente qué capa falta. No se deben generar URLs, listeners, canciones o emisiones ficticias.
