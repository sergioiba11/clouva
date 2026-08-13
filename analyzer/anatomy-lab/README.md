# CLOUVA Anatomy Lab Local v8

Cambios v8:
- corrige articulaciones internas tiradas en el piso (convierte Z-up canónico a Y-up del GLB);
- normaliza izquierda/derecha por vista;
- enfoca cada mano usando la geometría exterior real;
- analiza 4 vistas por mano a 768 px;
- no descarta manos por handedness invertida;
- agrega imagen detector-friendly para MediaPipe;
- registra warnings reales cuando una mano no se detecta o no se proyecta.

# CLOUVA Anatomy Lab Local v7

Laboratorio local para analizar el **avatar activo de tu cuenta CLOUVA** sin hacer deploy y sin ejecutar Blender.

## Inicio

1. Descomprimí el ZIP.
2. Entrá en `tools\anatomy-lab`.
3. Abrí `INICIAR.bat`.
4. El navegador abre `http://localhost:3000`.
5. Tocá **Conectar con CLOUVA** e iniciá sesión.
6. El laboratorio busca `user_avatars.is_active = true`, descarga el GLB original limpio y lo muestra automáticamente.
7. Tocá **Analizar avatar**.

La primera ejecución instala Python 3.11, Node.js y las dependencias cuando hagan falta.

## Conexión con la app

La conexión usa la clave pública de Supabase y la sesión del propio usuario. No incluye ni necesita `service_role`.

El laboratorio aplica la misma prioridad que el Analyzer de CLOUVA:

1. `user_avatars.storage_path` cuando no es un rig derivado;
2. `metadata.original_meshy_url`;
3. `model_url` limpio;
4. `profiles.avatar_3d_url` como respaldo.

No usa archivos cuyos nombres parezcan `rigged`, `processed`, `final` o `complete-rigged` cuando existe una fuente original.

### Inicio con Google

El botón principal usa el proveedor Google configurado en Supabase. Como `localhost` no puede leer la sesión de `clouva.com.ar`, hay que entrar una vez dentro del laboratorio.

Si Google devuelve a la web pública en vez de regresar al laboratorio, agregá estas URLs en **Supabase → Authentication → URL Configuration → Redirect URLs**:

```text
http://localhost:3000
http://localhost:3000/**
```

Esto no requiere deploy ni cambios de código.

También existe acceso por enlace de email como alternativa.

## GLB manual

La carga manual sigue disponible debajo de **GLB alternativo**. Sirve para probar otro modelo sin modificar el avatar guardado en CLOUVA.

## Datos y privacidad

- El GLB se descarga únicamente a la PC y se analiza localmente.
- La sesión se guarda en el almacenamiento de `localhost`.
- No se guarda la contraseña.
- No se usa la clave administrativa de Supabase.
- No se escribe en `user_avatars` ni en ninguna otra tabla.
- No se hace deploy.
- No se ejecuta Blender.

## URLs

```text
Frontend: http://localhost:3000
Backend:  http://localhost:8000
Health:   http://localhost:8000/health
```

## Resultados

Cada análisis queda en:

```text
output/{runId}/
```

Incluye los JSON, renders técnicos y diagnóstico generado por el laboratorio.

## Detener

Abrí `DETENER.bat`.

## Reparar

Abrí `REPARAR.bat` para reinstalar dependencias locales sin tocar CLOUVA producción.

## Motor geométrico v7

Open3D dejó de ser obligatorio. Si sus DLL no cargan en una PC Windows, el laboratorio usa automáticamente un rasterizador geométrico local basado en NumPy y Numba. No hay que ejecutar `REPARAR_OPEN3D.bat`.


# Cambios v8.1 — Face Clamp

- corrige la cámara facial: ahora observa el frente anatómico real (-Y) y no la parte posterior de la cabeza;
- usa frente y dos diagonales para la cara;
- crea un volumen geométrico de cabeza basado en la malla real;
- rechaza puntos faciales proyectados en cuello, parte posterior de la cabeza o fuera del volumen craneal;
- exige ojos, nariz, boca y mentón válidos antes de marcar la cara como lista;
- guarda `face_validation.json` y `rejected_face_landmarks.json`;
- permite mostrar faciales rechazados en rojo desde una capa desactivada por defecto;
- reduce el tamaño visual de los 478 puntos para inspeccionar mejor la superficie.

## V8.2 — Surface Snap + aritos

- La fusión multivista conserva un punto real de triángulo y ya no promedia posiciones en el aire.
- La malla facial completa queda oculta por defecto; se muestran primero los rasgos clave.
- Los candidatos faciales rechazados quedan ocultos al comenzar cada análisis.
- Genera `left_earlobe_anchor` y `right_earlobe_anchor` con triángulo, baricéntricas, normal y dirección de colgado.
- Corrige la validación de rasgos en avatares estilizados para no rechazar ojos, nariz, boca y mentón válidos.
