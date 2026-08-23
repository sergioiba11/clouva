# Identificadores y etiquetas de Mi Spot

## Resultado canónico

El circuito implementado usa un único registro de identidad para Catálogo, Códigos, Inventario y Escáner:

`PRODUCTO → VARIANTE → commerce_product_identifiers → ETIQUETA DERIVADA → ESCANEO → MISMO PRODUCTO/VARIANTE`

No existe una tabla paralela de códigos ni se guardan archivos PNG, SVG o PDF en Postgres. Los archivos se recrean desde el valor canónico persistido.

## Registro persistente

`commerce_product_identifiers` conserva:

- producto canónico y variante canónica;
- Studio y Spot de registro;
- tipo (`ean_13`, `ean_8`, `upc_a`, `upc_e`, `sku`, `code_128`, `clouva_barcode`, `clouva_qr`);
- valor y valor normalizado;
- origen (`manufacturer`, `imported`, `manual`, `clouva_generated`);
- estado (`active`, `disabled`, `replaced`), indicador principal y código reemplazado;
- token público y destino editable de QR;
- creador, fechas de creación/desactivación/actualización.

Los EAN/UPC activos tienen unicidad global. Si otro producto intenta conservar el mismo código, la operación devuelve conflicto junto con la publicación que ya lo usa. SKU y códigos CLOUVA mantienen alcance de Spot.

`commerce_product_identifier_events` conserva el historial inmutable de creación, desactivación, reemplazo, cambio de destino, descarga e impresión.

## QR CLOUVA

La URL pública es `https://clouva.com.ar/q/{TOKEN_PUBLICO}`. El token:

- se genera con 24 bytes aleatorios en la API;
- no deriva del UUID interno;
- es único, no secuencial y revocable;
- resuelve solamente identificadores activos;
- puede cambiar su destino interno sin cambiar la URL impresa.

El resolvedor abre el producto o la variante correcta. También acepta los UUID de QR históricos para no romper etiquetas anteriores a esta migración. Los destinos `product_3d`, `digital_claim` y `experience` quedan modelados, pero no simulan una entrega digital que todavía no exista.

## Servicios HTTP

- `POST /api/studios/[slug]/commerce/codes`: adjunta un código real o genera SKU, Code 128 y QR. `generate_all_variants` completa solamente faltantes.
- `PATCH /api/studios/[slug]/commerce/codes`: desactiva, reemplaza o cambia el destino de un QR.
- `GET /api/studios/[slug]/commerce/scan`: resuelve fabricante/CLOUVA contra el catálogo canónico.
- `POST /api/studios/[slug]/commerce/scan`: crea o reutiliza identidad global y la agrega al Spot.
- `GET /api/studios/[slug]/commerce/labels/[identifierId]`: deriva una etiqueta individual.
- `GET /api/studios/[slug]/commerce/labels`: deriva etiquetas de una variante o todas las variantes.
- `GET /q/[token]`: resuelve el token público activo.

## Impresión

El motor admite:

- SVG, PNG a 300 DPI y PDF;
- código de barras, QR, combinación o etiqueta completa;
- 30 × 20 mm, 40 × 30 mm y 50 × 30 mm;
- etiqueta individual o A4 con grilla automática;
- copias, márgenes y visibilidad de precio, SKU y QR.

SVG conserva códigos vectoriales. PDF usa medidas reales en puntos (`72 / 25,4` por milímetro) y compone la grilla A4 desde las dimensiones seleccionadas.

## Verificación

- `node --import tsx --test tests-commerce-identifiers-labels.mjs`
- suite `test:identity-revenue` (80 pruebas al momento de esta entrega);
- `tsc --noEmit`;
- `next build`;
- `supabase/tests/commerce_identifier_registry.sql` ejecutado dentro de una transacción con `ROLLBACK`.

La prueba SQL cubre reutilización y conflicto EAN, resolución y revocación QR, variante Negra/M, aislamiento de stock, reemplazo e historial. Después de ejecutarla, la base conserva cero productos, identificadores y eventos de prueba.
