# CLOUVA ↔ ChatGPT MCP — conexión permanente

Objetivo: mantener el MCP de CLOUVA como endpoint estable para ChatGPT y evitar depender de sesiones temporales de Work.

## Endpoint canónico

El endpoint canónico de CLOUVA para clientes MCP es:

- `https://clouva.com.ar/mcp`

No crear endpoints MCP alternativos por sesión.

## Arquitectura

`ChatGPT → OAuth/PKCE → CLOUVA /mcp → Gateway → Workspace Runtime → tools`

El Gateway debe conservar el pairing del workspace y exponer las herramientas registradas por el runtime, incluidas las integraciones de infraestructura disponibles para CLOUVA.

## Persistencia

- Mantener `/mcp` desplegado en producción.
- OAuth/PKCE y refresh tokens deben permitir renovar la autorización sin volver a crear el servidor MCP.
- El pairing debe persistirse fuera de la memoria efímera del proceso.
- Los reinicios/deploys del Gateway no deben invalidar el workspace emparejado.
- No almacenar secretos ni tokens OAuth en el repositorio.

## Assets

Para archivos binarios enviados desde móvil, usar el storage de CLOUVA como fuente persistente. El MCP debe exponer herramientas de lectura/listado de assets del runtime para que un cliente autorizado pueda operar sobre ellos sin depender de adjuntos temporales de ChatGPT Work.

## Registro en ChatGPT

El registro/autorización del endpoint MCP es una configuración del cliente ChatGPT, no del repositorio. Debe apuntar siempre al endpoint canónico anterior. Una vez autorizado, no debe crearse un MCP nuevo para cada conversación.
