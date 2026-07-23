# CLOUVA Avatar Analyzer V4.1

## Objetivo y garantías

Avatar Analyzer V4.1 se ejecuta antes del Skeleton Planner y conserva el AutoRig como único creador del Armature, los pesos y la exportación. El GLB original es inmutable: cada ejecución abre una escena Blender limpia y trabaja sobre una copia temporal. V3.2 continúa disponible en sus rutas existentes mientras V4.1 usa scripts, resultados y caché versionados.

El contrato compartido `avatar_analyzer_version.json` identifica el Analyzer, el mapa anatómico, los thresholds de confianza, el frontend y la caché. Un resultado de otra versión devuelve `410 ANALYZER_RESULT_STALE` en vez de mezclarse con el mapa actual.

## Flujo

```text
GLB original limpio
  -> copia temporal + canonicalización
  -> preflight de escala, orientación y topología
  -> segmentación con fronteras anatómicas solapadas
  -> BVH global + BVH por región con IDs globales
  -> cámaras adaptativas multivista
  -> RGB + world position + valid mask + normal + depth
     + primary/secondary region + object + triangle + barycentric
  -> detector robusto por variantes
  -> mapeo exacto píxel RGB -> píxel técnico -> punto de superficie
  -> triangulación separada para superficie e interiores
  -> confidence gates y readiness por subsistema
  -> Skeleton Planner recibe sólo estados aprobados
  -> AutoRig
```

## Correcciones V4.1

- Los triángulos mixtos nunca se descartan por mayoría. Conservan región primaria, regiones secundarias, pesos semánticos, estado de frontera, ID global y vértices del triángulo. Las regiones vecinas pueden compartir primitivas de frontera con penalización explícita.
- Los pases técnicos escriben `world_position.npy`, `valid_mask.npy`, `normal.npy`, `depth.npy`, `primary_region_id.npy`, `primary_region_weight.npy`, `secondary_region_mask.npy`, `object_id.npy`, `triangle_id.npy` y `barycentric.npy`.
- El proyector transforma coordenadas normalizadas al píxel técnico real, usa radios adaptativos por región y resolución, puntúa región/profundidad/normal/curvatura/visibilidad y registra todos los candidatos.
- Un landmark de superficie termina en un punto observado sobre un triángulo real. La solución de mínimos cuadrados queda reservada a centros internos.
- El hombro derecho se valida dentro del corredor `torso + clavicle_r + upper_arm_r`. La simetría es un prior minoritario, no un reemplazo de la geometría observada.
- Las manos se clasifican como `five_finger_separated`, `five_finger_connected`, `partial_fingers`, `simplified_mitten` o `unsupported_or_corrupt`. Una mitten puede habilitar la base de mano, pero nunca inventa cinco cadenas.
- Cara y manos usan siete vistas adaptativas. Todos los intentos robustos del detector se fusionan y los outliers se rechazan.

## Estados y confianza

Cada landmark conserva por separado:

| Componente | Significado |
|---|---|
| `detection_confidence` | Evidencia del detector 2D. |
| `visual_confidence` | Consenso multivista; vale cero con `views == 0`. |
| `triangulation_confidence` | Calidad geométrica; vale cero con `inliers == 0`. |
| `region_confidence` | Compatibilidad con región primaria/secundaria. |
| `topology_confidence` | Capacidad real de la malla. |
| `geometry_confidence` | Coherencia de superficie o sección interna. |
| `semantic_confidence` | Compatibilidad anatómica. |
| `symmetry_confidence` | Prior bilateral opcional. |
| `final_confidence` | Combinación posterior a todos los gates. |

Estados V4.1:

- Aprobados: `verified_visual_geometry`, `verified_geometry_fallback`, `verified_single_view_depth`, `manually_corrected`.
- No aprobados: `inferred_template_prior`, `insufficient_views`, `projection_mismatch`, `topology_invalid`, `unsupported`, `corrupt_geometry`.

Un rechazado nunca se convierte en 100% por usar el máximo de señales parciales.

## Readiness y perfiles

El resultado publica readiness independiente para:

- `bodyRigScore` / `bodyRigReady`
- `faceAnalysisScore` / `faceAnalysisReady`
- `leftHandBaseReady` / `rightHandBaseReady`
- `leftFingerRigReady` / `rightFingerRigReady`
- `fullHumanoidRigReady`
- `unrealExportReady`

Perfiles canónicos:

- `body_only`
- `body_with_hands`
- `full_humanoid`
- `full_humanoid_with_face`

Los nombres históricos en mayúsculas siguen aceptados por compatibilidad. Una cara o unos dedos incompletos no bloquean `body_only`.

## Visualizer V4.1

La ruta `/avatar-analyzer-v4/{runId}` carga el `diagnostic_landmarks.glb` real y presenta:

- malla original, regiones, landmarks superficiales, articulaciones internas, cadenas óseas, centerlines, raycasts, rechazados, fronteras, heatmap, volúmenes y correcciones manuales;
- filtros por cuerpo, cara y cada mano;
- inspector con estado, confianza, método, vistas, inliers, posición, triángulo, baricéntricas, píxel RGB/técnico, región y depth;
- hasta siete capturas de evidencia por región;
- readiness por subsistema, trazabilidad de versiones, SHA y run;
- X-Ray, pantalla completa, siguiente error y comparación automática/manual.

Los puntos rechazados siguen visibles en rojo dentro del GLB diagnóstico.

## Reanálisis y corrección manual

`POST /avatar/analyze-v4/result/{run_id}/reanalyze` recupera el GLB inmutable guardado por el run y ejecuta un pipeline Blender completo en una escena nueva. Devuelve un `newRunId`; no muta el resultado anterior ni simula un reanálisis reutilizando JSON viejo.

El clic manual de superficie se guarda como evidencia. Nunca se usa directamente como centro articular: la API exige un centro interno del solver o conserva el centro interno actual. Una corrección aprobada queda `manually_corrected` y auditada por run.

## API

- `POST /avatar/analyze-v4`
- `POST /avatar/analyze-v4-preview`
- `GET /avatar/analyze-v4/result/{run_id}`
- `GET /avatar/analyze-v4/result/{run_id}/asset/{asset_path}`
- `POST /avatar/analyze-v4/result/{run_id}/manual-corrections`
- `POST /avatar/analyze-v4/result/{run_id}/reanalyze`
- `POST /avatar/complete-rig-v4`
- `GET /diagnostics/avatar-analyzer-v4`

`/avatar/complete-rig-v4` exige que el perfil aparezca en `supported_rig_profiles`, que el SHA analizado coincida con el riggeado y que el Skeleton Planner reciba únicamente estados aprobados.

## Pruebas

- `npm run test:avatar-analyzer`
- `npm run test:avatar-analyzer:python`
- `npm run typecheck`
- `npm run lint`
- `npm run build`

Las pruebas V4.1 cubren fronteras hombro/torso, vecinos cuello/cabeza, manos conectadas y mitten, superficie con profundidad exacta, confianza rechazada, aislamiento de readiness, contratos de pases técnicos, versionado y preservación de V3.2.
