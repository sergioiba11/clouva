# CLOUVA Logo Engine V4

## Regla principal

El mockup o archivo raster es una referencia de análisis. Nunca se publica como logo oficial.

## Flujo de identidad propia

1. Detectar o seleccionar manualmente el lockup.
2. Leer nombre y descriptor.
3. Descomponer símbolo, wordmark y descriptor.
4. Reconstruir cada componente como paths SVG.
5. Comparar referencia y reconstrucción.
6. Validar fidelidad, transparencia y tamaño pequeño.
7. Derivar todo el Brand Kit desde el SVG maestro.
8. Publicar únicamente después de confirmación, clearance y declaración de titularidad.

## Flujo de referencia ajena

La referencia aporta lenguaje visual, pero CLOUVA crea un símbolo y una composición originales. El símbolo generado también se vectoriza antes de crear el Brand Kit.

## Generador de páginas

- Si existe una identidad oficial, la reutiliza.
- Sin identidad oficial, crea una identidad original desde la referencia.
- La reconstrucción fiel requiere confirmación explícita en `/logo`.

## Invariantes

- El SVG maestro no contiene `<image>` ni raster base64.
- `primary_logo_url` siempre deriva del SVG maestro en identidades V4.
- Todas las variantes pertenecen a la misma `brand_asset_version`.
- El recorte se guarda únicamente como `source_reference_url`.
