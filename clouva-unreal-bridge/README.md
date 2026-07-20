# clouva-unreal-bridge

Servicio local de solo lectura entre Unreal Engine Remote Control API y CLOUVA.

## Seguridad

- Unreal se consulta únicamente mediante `http://127.0.0.1:30010`.
- No se abre ningún puerto público.
- El bridge realiza una solicitud saliente HTTPS hacia CLOUVA.
- `CLOUVA_BRIDGE_TOKEN` debe existir tanto en el `.env` local como en las variables privadas de Vercel.
- `SUPABASE_SERVICE_ROLE_KEY` solo debe configurarse en Vercel; nunca usarla en variables `NEXT_PUBLIC_*`.

## Configuración

1. Aplicar la migración `supabase/migrations/20260720043000_unreal_avatar_snapshots.sql`.
2. En Vercel agregar:
   - `CLOUVA_BRIDGE_TOKEN`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `NEXT_PUBLIC_SUPABASE_URL` (si todavía no existe)
3. Copiar `.env.example` como `.env` dentro de esta carpeta.
4. Completar `CLOUVA_APP_URL` y usar exactamente el mismo `CLOUVA_BRIDGE_TOKEN` configurado en Vercel.
5. Mantener Unreal abierto, con Remote Control API activo y el preset `RC_CLOUVA_Avatar` guardado.
6. Ejecutar `start-windows.bat`.

## Prueba local directa

Para probar solamente la lectura local, configurá `DRY_RUN=true`. En ese modo el bridge imprime el snapshot normalizado antes de cualquier envío, no requiere `CLOUVA_APP_URL` ni `CLOUVA_BRIDGE_TOKEN`, y no envía datos a CLOUVA o Supabase.

En PowerShell:

```powershell
Invoke-RestMethod http://127.0.0.1:30010/remote/info
Invoke-RestMethod http://127.0.0.1:30010/remote/presets
Invoke-RestMethod http://127.0.0.1:30010/remote/preset/RC_CLOUVA_Avatar | ConvertTo-Json -Depth 100
```

El bridge imprime en la consola el snapshot JSON real después de cada envío exitoso.

## API CLOUVA

- `POST /api/unreal/snapshot`: privado, requiere `Authorization: Bearer <CLOUVA_BRIDGE_TOKEN>`.
- `GET /api/unreal/avatar`: devuelve el último snapshot y estado `online` u `offline`.

El estado pasa a `offline` cuando el último snapshot tiene más de 45 segundos.

## Datos disponibles

El normalizador busca actor, transform, escala, Skeletal Mesh, Skeleton, Physics Asset, materiales, bounds, sockets, morph targets y huesos. Unreal solo devuelve los campos que estén expuestos en el preset. Para datos que no aparezcan, exponer en `RC_CLOUVA_Avatar` las propiedades correspondientes del componente Skeletal Mesh de `BP_ClouvaCharacter`.

No se implementan comandos de escritura en esta fase.
