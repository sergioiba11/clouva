# CLOUVA Anatomy Lab v1.3.0 — Garment Analysis Workspace

## Separación real en dos etapas

### Etapa 1 — Prenda sola
- Pestaña `Prenda` independiente del avatar.
- Preview centrado del GLB analizado.
- Rotación libre con OrbitControls.
- Wireframe opcional.
- Bounding box opcional.
- Ejes y pivote opcionales.
- Landmarks de prenda visibles.
- Estado: OK, Dudoso o Incompleto.
- Botones `Rotar +90°`, `Reset orientación` y `Aceptar análisis`.
- Cache por SHA-256: un GLB sin cambios reutiliza su análisis.

### Etapa 2 — Fit con avatar
- El botón de fitting queda bloqueado hasta aceptar el análisis.
- El backend usa exactamente el análisis aceptado; no vuelve a adivinar la orientación.
- Pestaña `Resultado` para ver avatar + prenda adaptada.
- Export de GLB, fit JSON y reporte de colisiones.

## Backend
- Nuevo endpoint: `POST /api/runs/{run_id}/accept-garment-analysis`.
- El análisis aceptado se guarda como `garment_analysis_accepted.json`.
- `fit-library-asset` exige un análisis aceptado del mismo GLB.
