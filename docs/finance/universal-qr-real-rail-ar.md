# CLOUVA Universal QR — rail real Argentina

Estado de investigación: 2026-09-07.

## Objetivo

`FLOW respaldado → hold → obligación merchant QR → PCT ARS → comercio recibe ARS → confirmación provider → redeem FLOW → release backing → receipt`

La lectura del QR y la ejecución monetaria son capacidades distintas. Ningún QR se considera pagable por CLOUVA hasta que el rail esté configurado, autorizado y habilitado en producción.

## Estado del repositorio

- `main` inspeccionado: `75c1c7351c92255fd93de6adb3eca23138e2a801`.
- PR histórico Universal QR: `#388`, abierto y no mergeado al momento de esta investigación.
- El contrato actual de pagos de `main` distingue `payin` y `payout`; merchant QR necesita una abstracción propia porque no es un payout bancario genérico.
- Esta rama agrega únicamente preparación de rail real. No hace merge, deploy, migraciones productivas ni pagos.

## Hallazgo regulatorio BCRA

Fuentes oficiales:

- https://www.bcra.gob.ar/billeteras-digitales-interoperables/
- https://www.bcra.gob.ar/inscripcion-registro-billeteras-digitales-interoperables/
- https://www.bcra.gob.ar/registro-de-proveedores-de-servicios-de-pago/

El BCRA describe a una billetera digital interoperable como la que permite efectuar Pagos con Transferencia tomando fondos desde una cuenta bancaria o de un PSP al leer QR. La inscripción en el Registro de Billeteras Digitales Interoperables está dirigida a entidades financieras o PSP y requiere certificación de integración con administradores de esquemas de transferencias inmediatas.

Consecuencia para CLOUVA: FLOW no puede presentarse ante Transferencias 3.0 como si fuera por sí mismo una cuenta/CVU. Debe existir una cuenta/fuente ARS dentro de un rail regulado.

## Mercado Pago interoperable

Fuentes oficiales:

- https://www.mercadopago.com.ar/developers/es/docs/qr-code/interoperable/acceptor-flow
- https://www.mercadopago.com.ar/developers/es/docs/qr-code/interoperable/acceptor-flow/configuration
- https://www.mercadopago.com.ar/developers/es/docs/qr-code/interoperable/acceptor-flow/tests
- https://www.mercadopago.com.ar/developers/es/docs/qr-code/interoperable/issuer-flow

Confirmado:

- requiere cuenta empresa, app `Pagos presenciales / Código QR`, onboarding, OAuth Client Credentials, webhooks, pruebas y homologación;
- el Access Token OAuth de esa integración es distinto del Access Token normal de Checkout Pro;
- el token Client Credentials documentado dura 6 horas;
- `GET /instore/v2/external/resolve?data=...` resuelve el QR para una billetera incorporada;
- configuración indica enviar el `order.id` de Mercado Pago como `qr_trx_id` a COELSA;
- pruebas de `Dinero en cuenta` piden evidencia `coelsa_id` de pagos aprobados.

Inconsistencia pública a escalar con Mercado Pago:

- la introducción del flujo aceptador declara que aplica únicamente a tarjeta de crédito;
- configuración y pruebas muestran selector `Dinero en cuenta` y trazabilidad COELSA.

Conclusión: Mercado Pago es un aceptador/resolver relevante, pero su documentación pública no demuestra que CLOUVA pueda originar PCT de dinero en cuenta sin una capa de administrador/PSP. No reutilizar Checkout Pro para esto.

## Opción BIND PSP — CONFIRMADA TÉCNICAMENTE

Fuentes oficiales:

- https://psp.bind.com.ar/
- https://psp.bind.com.ar/developers/general
- https://psp.bind.com.ar/developers/apis/guia-pago-qr
- https://psp.bind.com.ar/developers/apis/leer-qr
- https://psp.bind.com.ar/developers/apis/pagar-qr
- https://psp.bind.com.ar/developers/apis/consultaroperacionporid-pagoqr
- https://psp.bind.com.ar/developers/apis/consultaroperacionporidext-pagoqr
- https://psp.bind.com.ar/developers/apis/webhook-pagoqr
- https://psp.bind.com.ar/developers/apis/webhook-devolucionqr

BIND PSP publica un producto `PSP as a Service`: si la empresa integradora no es PSP, puede utilizar la licencia/operación de BIND para ofrecer funciones de billetera. BIND indica que se ocupa de compliance, operaciones y administración contable.

Para QR, su documentación expresa que puede leer cualquier QR interoperable de Argentina y, si es válido, iniciar un pago. El saldo sale de un CVU y el POST de pago `instruye un PCT en Coelsa`.

### Resolver

`GET /walletentidad-operaciones/v1/api/v1.201/QR/GetInfoPagoQR?textoQR=...`

Devuelve estado standard Transferencias 3.0, collector, CBU/CVU del comercio, CUIT, order ID, monto y retry delay.

### Pagar

`POST /walletentidad-operaciones/v1/api/v1.201/pagoQR`

Requiere:

- CVU origen del comprador;
- CUIT origen;
- CBU/CVU vendedor;
- CUIT vendedor;
- `transaccionId` = order ID del resolve;
- importe;
- QR raw;
- `idExterno` opcional para idempotencia/recovery de CLOUVA.

Devuelve `operacionId` y `operacionIdExterno`; BIND documenta este último como identificador COELSA central para consultas/reclamos.

### Estado y recovery

- `GET /Operacion/{id}`
- `GET /OperacionByIdExterno/{idExterno}`

Estados BIND relevantes:

1. A procesar → pending
2. Aprobada → confirmed
3. Rechazada → failed
4. A consultar → pending
5. Auditar → pending/manual reconciliation
6. Devuelta → refunded
7. Devuelta parcialmente → partially_refunded

### Webhooks

`PAGO_QR` informa Aprobada/Rechazada e incluye `coelsaId`.

`CONTRACARGO_PAGO_QR` cubre devolución total/parcial.

BIND informa que por defecto sus webhooks no incluyen firma a nivel aplicación. Recomienda whitelist de IP fija por ambiente y ofrece mTLS opcional. CLOUVA no debe marcar una operación confirmada solamente por el body del webhook: debe deduplicar `mensajeId` y recuperar la operación por API antes de finalizar redemption.

### OAuth BIND

OAuth2 Client Credentials. Token Bearer de 60 minutos.

- staging API: `https://gw-staging-qrbind.epays.services`
- production API: `https://api.bindpagos.com.ar`
- las credenciales/scopes son entregadas por BIND por ambiente/producto.

### Evidencia BCRA

El BCRA lista a BIND PSP/BIND PAGO dentro de sus publicaciones de PSP/billeteras. Además, los informes de pagos minoristas 2026 muestran combinaciones `BIND PAGO - MP` dentro de PCT iniciados con QR interoperable, evidencia de operación real BIND→Mercado Pago en el ecosistema.

Nota: el registro público de billeteras muestra `Habilitación VQR: No` para BIND PSP. No inferir el alcance de ese campo: debe preguntarse a BIND qué impacto tiene para el modelo CLOUVA/PSP-as-a-Service. No contradice por sí solo la evidencia de PCT QR publicada por el BCRA, pero requiere aclaración contractual/regulatoria.

## Opción Gallo Pay — CONFIRMADA COMO ALTERNATIVA A CONSULTAR

Fuentes:

- https://gallo-pay.com/
- https://gallo-pay.com/soluciones/qr
- https://gallo-pay.com/developers/guias/pago-qr
- BCRA: responsables de atención de PSP, donde figura GALLO PAY.

Publica:

- cuentas de pago/CVU;
- API;
- rol billetera;
- pago QR interoperable sobre COELSA;
- `POST /v1/qr/pay`;
- sandbox;
- webhooks;
- contracargos;
- rol aceptador opcional.

Debe confirmarse comercialmente qué modalidad contractual permitiría a CLOUVA ofrecer la UX bajo la infraestructura de Gallo Pay y cómo se modelan titularidad/KYC/fondeo.

## Mercado Pago directo vs PSP partner

Mercado Pago resuelve sus QRs e incorpora billeteras externas, pero para dinero en cuenta su documentación remite trazabilidad a COELSA. Por lo tanto, `Mercado Pago directo` no se considera todavía un rail PCT completo para CLOUVA.

Un partner PSP como BIND sí publica explícitamente la instrucción PCT en COELSA desde un CVU y recovery/webhooks.

## Matriz de decisión

| Alternativa | QR interoperable | Dinero en cuenta/PCT | PSP propio CLOUVA | Partner | API | Homologación/alta | Evaluación CLOUVA |
|---|---|---|---|---|---|---|---|
| CLOUVA PSP propio | Sí, tras integración/certificación | Sí | Sí | No necesariamente | A construir/integrar | BCRA + administradores | Largo plazo; mayor control y mayor carga regulatoria |
| BIND PSP as a Service | Sí, documentado | Sí, PCT COELSA documentado | No según propuesta comercial publicada | Sí | Sí | Contrato/onboarding BIND + credenciales + validaciones | **Recomendación inicial** |
| Gallo Pay | Sí, documentado | Sí, QR Transferencias 3.0/COELSA publicado | Por confirmar modelo contractual | Sí | Sí | Onboarding/homologación con proveedor | Alternativa real para cotizar/validar |
| Mercado Pago aceptador directo | MP QR: sí | Documentación pública ambigua; Account Money remite a COELSA | Requiere billetera externa válida | Administrador/PCT probablemente sí | Resolve + APIs de interoperabilidad | MP onboarding/homologación | Complemento importante, no rail único demostrado |
| Payway | Aceptador QR interoperable confirmado | No se verificó API B2B de billetera pagadora para CLOUVA | N/A | POR CONFIRMAR | POR CONFIRMAR | POR CONFIRMAR | No elegir como rail pagador con la evidencia actual |

## Arquitectura recomendada

Primera implementación objetivo:

`CLOUVA Universal QR → BIND PSP resolver → quote FLOW → hold FLOW → verificar saldo/fondeo ARS → BIND POST pagoQR → pending → webhook/poll BIND → confirmar estado por API → redeem FLOW + release backing → receipt`

Reglas:

1. El CVU/rail ARS es la fuente monetaria de Transferencias 3.0; FLOW no viaja por COELSA.
2. El `operationId` CLOUVA debe viajar como `idExterno` para recovery.
3. `operacionId`, `operacionIdExterno/CoelsaId`, order ID y QR hash deben persistirse.
4. Si el POST pierde conexión, recuperar por `idExterno`; no emitir otro PCT.
5. Un webhook no finaliza dinero por sí solo: deduplicar y consultar verdad provider.
6. Rechazo antes de settlement definitivo libera hold FLOW.
7. Confirmación definitiva redime FLOW y libera backing asociado.
8. Devoluciones requieren conciliación ARS antes de reemitir/acreditar valor FLOW.

## Código preparado en esta rama

- `core/flows/payments/merchant-qr.ts`: contrato provider-neutral merchant QR.
- `core/flows/payments/providers/bind/config.ts`: ambientes, feature flag, credenciales y readiness.
- `core/flows/payments/providers/bind/token.ts`: OAuth2 Client Credentials server-side con cache y renovación.
- `core/flows/payments/providers/bind/merchant-qr.ts`: resolve, PCT, lookup por operation ID y `idExterno`.
- `app/api/flows/qr/rail-readiness/route.ts`: readiness seguro para admin, sin exponer secretos.

`BIND_PSP_QR_EXECUTION_ENABLED` queda `false` por defecto. No hay credenciales ni CVU configurados en esta rama.

## Variables previstas

```text
BIND_PSP_QR_ENVIRONMENT=staging
BIND_PSP_QR_CLIENT_ID=
BIND_PSP_QR_CLIENT_SECRET=
BIND_PSP_QR_ORIGIN_CVU=
BIND_PSP_QR_ORIGIN_CUIT=
BIND_PSP_QR_EXECUTION_ENABLED=false
BIND_PSP_QR_WEBHOOK_SOURCE_IPS=
```

Opcionales de override técnico:

```text
BIND_PSP_QR_BASE_URL=
BIND_PSP_QR_TOKEN_URL=
BIND_PSP_QR_SCOPE=
```

## Próximo paso externo recomendado

Contactar primero a **BIND PSP** con el caso exacto de CLOUVA y pedir:

1. modalidad PSP-as-a-Service aplicable;
2. staging Wallet/Pago QR;
3. requisitos societarios/KYC/AML;
4. definición de titularidad del CVU origen;
5. fondeo/settlement;
6. límites y costos PCT QR;
7. confirmación de cobertura de QRs MP, Payway, Fiserv, Link, etc.;
8. significado práctico de `Habilitación VQR: No` en el registro BCRA para este caso;
9. IPs de webhook y opción mTLS;
10. proceso de homologación y paso a producción.

En paralelo, solicitar la misma arquitectura y costos a Gallo Pay para comparar.

## Mensaje preparado — BIND PSP

Hola, equipo BIND PSP. Estamos desarrollando CLOUVA, una plataforma argentina que integra una billetera/ledger propio de valor respaldado y queremos incorporar pagos reales mediante QR interoperable de Transferencias 3.0.

Vimos en su documentación de PSP as a Service y Pago QR que permiten leer QR interoperables de Argentina e instruir PCT en COELSA desde un CVU. Nuestro objetivo es que el usuario escanee el QR normal de un comercio dentro de CLOUVA, confirmemos la obligación, reservemos internamente el valor FLOW correspondiente y el pago monetario salga en ARS por la infraestructura PSP/CVU de BIND hacia el comercio.

Queremos confirmar si este modelo puede operar bajo BIND PSP sin que CLOUVA deba convertirse inicialmente en PSP propio. Necesitamos acceso de staging para Wallet/Pago QR y detalles de onboarding, KYC/AML, titularidad y fondeo del CVU origen, costos/límites, homologación, webhooks/IPs o mTLS, refunds y proceso de activación productiva. También agradeceríamos aclarar el alcance del campo `Habilitación VQR` del registro BCRA para este modelo.

## Mensaje preparado — Mercado Pago

Hola, equipo Mercado Pago. Representamos CLOUVA y estamos trabajando en una experiencia de billetera que necesita incorporarse al flujo aceptador de QR interoperable en Argentina, específicamente para pagos de `Dinero en cuenta / Pago con Transferencia` contra QRs Mercado Pago.

Ya revisamos la documentación de onboarding, OAuth Client Credentials, resolve, pruebas y homologación. Necesitamos confirmar el modelo vigente para Account Money/PCT porque la introducción pública del flujo aceptador indica tarjeta de crédito, mientras las páginas de configuración y tests muestran Dinero en cuenta y requieren `coelsa_id`; además, configuración indica enviar el `order.id` como `qr_trx_id` a COELSA.

¿Actualmente incorporan nuevas billeteras para este flujo de dinero en cuenta? ¿Qué registro BCRA exigen, qué administrador debe utilizar la billetera, COELSA es obligatorio, qué APIs concretas originan hoy el PCT, cómo se transmite `qr_trx_id`, cómo se obtiene/evidencia `coelsa_id` y qué pruebas/requisitos legales-operativos deben cumplirse para homologación y producción?

## Decisión

**Camino recomendado hoy: B — PSP partner, con BIND PSP como primera integración a validar comercialmente y Gallo Pay como alternativa.**

Motivo: es la opción con evidencia pública más directa de la capacidad que CLOUVA necesita: CVU + lectura de QR interoperable + PCT COELSA + estado/recovery + webhook + reversa, sin obligar a CLOUVA a arrancar construyendo su propia infraestructura PSP.

## Respuesta inequívoca

¿CLOUVA puede pagar hoy un QR real de un kiosco? **NO.**

¿Qué falta exactamente para convertirlo en SÍ?

Contrato/onboarding con un PSP que habilite el rol billetera PCT, cuenta/CVU ARS real y fondeada, credenciales de staging/producción, homologación, webhooks/reconciliation y conectar el rail confirmado al state machine Universal QR de CLOUVA. Después de una prueba homologada end-to-end exitosa puede habilitarse `productionEnabled`.
