# CLOUVA Anatomy Lab v1.3.1 — Garment Surface Landmarks

## Correcciones

- Los landmarks de prenda ahora se fijan a vértices reales de la superficie.
- Los nombres dejan de tapar la prenda: aparecen solo al seleccionar un punto.
- Una orientación con empate o confianza menor al 70% queda en estado Dudoso.
- El análisis distingue componentes crudos de componentes cercanos agrupados para diagnóstico.
- El cache anterior se invalida automáticamente: cada GLB se vuelve a analizar con el motor v1.3.1.
- Aceptar análisis exige confirmar arriba, frente/espalda y cuello/hombros/landmarks.
- El fitting continúa bloqueado hasta esa validación manual.

## Instalación

El instalador es directo: copia y verifica byte por byte. No ejecuta Python ni npm durante la instalación.
