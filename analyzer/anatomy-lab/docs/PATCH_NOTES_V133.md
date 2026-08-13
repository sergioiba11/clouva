# CLOUVA Anatomy Lab v1.3.3 — Structural Centerline Fix

Corrige la clasificación geométrica de los landmarks centrales de las prendas.

## Error corregido

En v1.3.2 todos los puntos se proyectaban al vértice de superficie más cercano. Por eso `center`, `neck_center`, `chest_center`, `waist_center` y `hem_center` quedaban sobre la cara frontal —o podían parecer pegados a la espalda— en lugar de representar el eje interno de la prenda.

## Implementación

- Se mantienen como landmarks de superficie: frente, espalda, extremos, hombros y sisas.
- Se convierten en puntos estructurales internos: centro, cuello, pecho, cintura y ruedo.
- Cada punto estructural calcula una sección local en espacio semántico.
- La profundidad se obtiene con superficies opuestas robustas (percentiles 10/90).
- El punto final queda exactamente en el punto medio local entre frente y espalda.
- Si una sección no tiene muestras suficientes, se usa el centro de profundidad de los bounds semánticos; nunca se vuelve a pegar el punto a una cara.
- Se separan en el contrato `surface_locked` y `structural_internal`.
- El visor muestra el eje interno en magenta y permite inspeccionar profundidad, espesor y cantidad de muestras.
- Se invalida automáticamente la caché de análisis v1.3.2.

## Contrato esperado para una remera

- `surface_locked_count`: 10
- `structural_internal_count`: 5
- `structural_landmarks`: `center`, `neck_center`, `chest_center`, `waist_center`, `hem_center`

Los puntos estructurales deben cumplir:

```text
midpoint_depth = (front_depth + back_depth) / 2
surface_locked = false
landmark_type = structural_internal
```
