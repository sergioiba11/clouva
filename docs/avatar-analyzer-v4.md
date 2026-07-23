# CLOUVA Avatar Analyzer V4.0

## Objetivo

Avatar Analyzer V4.0 se ejecuta antes del Skeleton Planner y conserva el AutoRig V16 como creador oficial del Armature, pesos y exportación para Unreal. V3.2 sigue disponible durante la verificación: V4 usa rutas, scripts y resultados independientes y guarda la procedencia del resultado heredado.

El archivo original no se modifica. Cada análisis descarga el GLB/FBX limpio a un directorio temporal, Blender abre una escena nueva, duplica los datos de malla y aplica la normalización únicamente a esa copia.

## Flujo

```text
avatar original limpio
  -> copia temporal + canonicalización
  -> preflight de unidades/topología
  -> Analyzer V3.2 retenido
  -> cámaras adaptativas V4
  -> self-test matriz/depth/ID
  -> evidencia visual + geométrica
  -> confidence gates V4
  -> perfiles soportados
  -> Skeleton Planner con landmarks aprobados
  -> AutoRig V16
```

## Módulos

- `preflight_v4.py`: bounding box, unidades estimadas, triangulación sobre BMesh temporal, duplicados, degeneradas, normales, bordes abiertos/no-manifold, componentes sueltos y chequeo aproximado de autointersecciones.
- `multiview_renderer_v4.py`: 8 vistas corporales a 1024 px, 5 de rostro y 5 por mano a 512 px; RGB, máscara, depth, normal, region ID y object ID.
- `camera_projection_self_test_v4.py`: valida matrices, determinante/handedness, resolución, clipping, pases técnicos y round-trip píxel -> rayo + profundidad -> 3D -> píxel. Una vista inválida se descarta completa antes del detector.
- `analyzer_v4_contract.py`: capacidades topológicas, joint corridors, reparación de hombro derecho, confidence gates, perfiles de rig, causas raíz y contrato JSON determinista.
- `avatar_analyzer_v4.py`: orquestador Blender; V3.2 se conserva y V4 agrega el nuevo análisis sin modificar el rig.
- `autorig_avatar_v19.py`: wrapper profile-aware del AutoRig V16. Solo entrega al Skeleton Planner estados aprobados.
- `app_v18.py`: API V4 paralela a las rutas V3.2.

## Confidence gates

Cada landmark conserva puntuaciones separadas:

| Campo | Gate |
|---|---|
| `detection_confidence` | Confianza bruta del detector, nunca suficiente por sí sola. |
| `visual_confidence` | Es cero cuando `views == 0`. |
| `triangulation_confidence` | Es cero cuando `inliers == 0`. |
| `region_confidence` | Coincidencia con superficie, depth, ID y zona anatómica. |
| `topology_confidence` | Es cero si la rama geométrica requerida no existe. |
| `symmetry_confidence` | Solo se usa en fallback bilateral explícito. |
| `final_confidence` | Se calcula después de todos los gates y nunca muestra 100% sin evidencia válida. |

Estados: `verified`, `verified_with_fallback`, `needs_review`, `unsupported_by_topology`, `no_visual_evidence`, `technically_invalid`, `manually_verified`.

## Perfiles

- `BODY_BASIC`: cuerpo, hombros, brazos, muñecas, piernas, tobillos y pies.
- `BODY_FACE`: BODY_BASIC + mandíbula y ojos cuando la cara es compatible.
- `BODY_HANDS_BASIC`: BODY_BASIC + muñecas/manos simplificadas.
- `FULL_BODY_HANDS_FACE`: cuerpo, cara y cinco dedos reales en ambas manos.

Cara o dedos incompletos no bloquean `BODY_BASIC`. Una mano tipo mitten queda `HAND_TOPOLOGY_LIMITED`; no se crean cinco cadenas falsas.

## Shoulder Derecha

`shoulder_r` usa el corredor solapado `torso + clavicle_r + upper_arm_r`. Si la validación estricta falla, V4 compara un candidato espejado con longitudes de brazo, ángulos clavícula-hombro-codo, desplazamiento relativo a la altura y límites corporales. Un resultado aceptado queda `verified_with_fallback` con `verificationMethod=symmetry_fallback`; no se afirma evidencia visual.

## API

V3.2 permanece sin cambios. V4 agrega:

- `POST /avatar/analyze-v4`
- `POST /avatar/analyze-v4-preview`
- `GET /avatar/analyze-v4/result/{run_id}`
- `GET /avatar/analyze-v4/result/{run_id}/asset/{asset_path}`
- `POST /avatar/analyze-v4/result/{run_id}/manual-corrections`
- `POST /avatar/analyze-v4/result/{run_id}/reanalyze`
- `POST /avatar/complete-rig-v4`
- `GET /diagnostics/avatar-analyzer-v4`

`/avatar/complete-rig-v4` exige que el perfil pedido aparezca en `supported_rig_profiles`, que el SHA analizado coincida con el riggeado y que el Skeleton Planner no reciba landmarks inventados.

## Reanálisis dirigido

El contrato define cámara, región, landmark, cara, cada mano, cuerpo, hombro derecho y pipeline completo. La reparación del hombro derecho se recalcula en el resultado existente. Los demás planes quedan explícitos en la API y actualmente responden `requires_fresh_region_job`: todavía falta conectar el scheduler que vuelve a abrir una escena Blender temporal desde el archivo limpio, sin reutilizar una escena parcialmente modificada.

## Manual Correction Pro

El clic de superficie se guarda como evidencia. Nunca se usa directamente como centro articular. La API exige un candidato interno producido por el solver de sección corporal o conserva el centro interno actual. Las correcciones se etiquetan `manually_verified` y quedan registradas por run.

## Contrato JSON

```json
{
  "analyzer_version": "4.0",
  "requested_rig_profile": "BODY_BASIC",
  "supported_rig_profiles": ["BODY_BASIC", "BODY_HANDS_BASIC"],
  "overall_status": "approved_with_fallbacks",
  "regions": {},
  "landmarks": {},
  "camera_calibration": {},
  "topology_capabilities": {},
  "root_causes": [],
  "fallbacks_used": [],
  "manual_corrections": [],
  "blocking_reasons": [],
  "recommended_next_action": "create_body_basic"
}
```

## Determinismo y logs

El resultado incluye `diagnostic_fingerprint`, calculado con SHA-256 sobre capacidades, perfiles, posiciones/estados y causas raíz ordenadas. Los scripts imprimen una línea JSON estructurada por run. La misma entrada, configuración y perfil deben producir el mismo fingerprint.

## Pruebas

`test_avatar_analyzer_v4_contract.py` cubre confidence gates, topología limitada, aislamiento de perfiles, hombro derecho, causas raíz, cámaras inválidas, determinismo y filtrado del Skeleton Planner. `test_worker_api_v4.py` comprueba que V3.2 siga disponible junto con todas las rutas V4.

Casos Blender/integración previstos por el preflight y Docker: escala/orientación, determinante negativo, chibi, mitten/sin dedos, cabeza grande, brazos cortos, malla abierta, componentes desconectados y matriz de cámara inválida.
