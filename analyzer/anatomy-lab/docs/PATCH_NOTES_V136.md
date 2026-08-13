# CLOUVA Anatomy Lab v1.3.6 — reparación forzada del contrato de orientación

## Error confirmado

El laboratorio seguía ejecutando archivos v1.3.3 aunque se había intentado instalar v1.3.5. La evidencia era doble:

- la interfaz todavía mostraba controles X/Y/Z;
- el JSON aceptado seguía declarando `clouva-garment-structural-centerline-v1.3.3` y permitía `x=1`, intercambiando alto y profundidad.

## Qué hace este parche

- reemplaza backend y frontend sin exigir que la base haya quedado exactamente en v1.3.4;
- conserva el desempate vertical correcto `source +Y -> semantic +Z`;
- elimina definitivamente las rotaciones X/Y y los giros Z de 90°/270°;
- permite solamente frente original o frente/espalda invertidos 180° alrededor de Z;
- bloquea cualquier aceptación con `depth >= height`;
- agrega contrato de versión entre frontend y backend: un frontend v1.3.6 no acepta respuestas viejas;
- muestra `v1.3.6` en el encabezado para confirmar visualmente la instalación;
- elimina cachés de análisis, GLB aceptados viejos, caché Vite y `__pycache__`.

## Resultado obligatorio para r1

- ancho aproximado: 0.825;
- profundidad aproximada: 0.301;
- alto aproximado: 0.700;
- ningún botón X/Y/Z;
- JSON con versión `clouva-garment-upright-contract-v1.3.6`;
- `manual_rotation_quarter_turns_xyz.x = 0`;
- `manual_rotation_quarter_turns_xyz.y = 0`;
- `manual_rotation_quarter_turns_xyz.z` solo puede ser 0 o 2.
