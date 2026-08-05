# CLOUVA CONTROL

Aplicación Android privada para inspeccionar, probar y controlar CLOUVA desde el celular sin abrir Chrome.

## Arquitectura

- Interfaz principal: React Native + Expo.
- Identidad: `com.clouva.control`.
- Autenticación: la misma cuenta de Supabase Auth de CLOUVA.
- Autorización: cada API recibe el JWT real del administrador y vuelve a validarlo mediante RLS y funciones `security definer` con control administrativo explícito.
- Preview: WebView interna que muestra la web real de CLOUVA; no abre un navegador externo.
- Datos: APIs administrativas de CLOUVA y tablas actuales de Supabase.
- Releases: APK firmado en el bucket privado `admin-apk-releases`.
- Ícono: se genera automáticamente desde `assets/icon-source.svg` antes del build.

La persona simulada del preview solo modifica la experiencia visual. Nunca autoriza operaciones de backend.

La aplicación web no utiliza una `service_role` para atender a CLOUVA CONTROL. La service role se limita al workflow privado que publica el APK en Storage.

## Variables locales

Crear `mobile/clouva-control/.env.local` sin commitearlo:

```bash
EXPO_PUBLIC_CLOUVA_API_URL=https://clouva.com.ar
EXPO_PUBLIC_SUPABASE_URL=https://PROJECT_REF.supabase.co
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

También puede utilizarse temporalmente la anon key pública mediante `EXPO_PUBLIC_SUPABASE_ANON_KEY`.

## Redirect de Google

Para que **Continuar con Google** vuelva a la aplicación instalada, agregar esta URL a la lista de redirect URLs permitidas de Supabase Auth:

```text
clouvacontrol://auth/callback
```

El login por email y contraseña no depende de este redirect.

## Desarrollo Android

Requisitos:

- Node.js 22.13 o superior.
- Java 17.
- Android Studio y Android SDK.
- Un dispositivo Android con depuración USB o un emulador.

```bash
cd mobile/clouva-control
npm install
npm run expo:sync
npm run typecheck
npm run prebuild
npm run android
```

## Firma definitiva

El APK debe conservar siempre el mismo keystore. Cambiarlo impide instalar una actualización sobre una versión anterior.

Generación inicial, una sola vez:

```bash
keytool -genkeypair \
  -v \
  -storetype JKS \
  -keystore clouva-control-release.jks \
  -alias clouva-control \
  -keyalg RSA \
  -keysize 4096 \
  -validity 10000
```

Guardar el archivo original y sus contraseñas fuera del repositorio. Para GitHub Actions, convertirlo a Base64:

```bash
base64 -w 0 clouva-control-release.jks
```

## Configuración de GitHub Actions

Variables del repositorio:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`, cuando no se utiliza una publishable key moderna.
- `CLOUVA_CONTROL_API_URL` con valor `https://clouva.com.ar`.

Secrets:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`, usada solo para publicar releases desde CI.
- `SUPABASE_PUBLISHABLE_KEY`, recomendado para el APK.
- `CLOUVA_CONTROL_KEYSTORE_BASE64`
- `CLOUVA_CONTROL_KEY_ALIAS`
- `CLOUVA_CONTROL_KEYSTORE_PASSWORD`
- `CLOUVA_CONTROL_KEY_PASSWORD`

Nunca guardar el keystore, sus contraseñas o la service role dentro del APK o del repositorio.

## Crear una versión

En GitHub:

1. Abrir **Actions**.
2. Elegir **Build CLOUVA CONTROL APK**.
3. Tocar **Run workflow**.
4. Completar versión y notas.
5. Elegir si será estable.
6. Completar `minimum_required` solo para bloquear instalaciones anteriores.

El workflow:

1. genera el ícono oficial del módulo;
2. verifica TypeScript;
3. genera el proyecto Android;
4. firma el APK;
5. calcula SHA-256 y tamaño;
6. sube el archivo al bucket privado;
7. registra la versión en `mobile_app_releases`;
8. la deja disponible en `/admin/clouva-control` y dentro de la app.

## Primera instalación

1. Entrar como administrador a `https://clouva.com.ar/admin/clouva-control`.
2. Descargar el APK mediante el enlace firmado.
3. Android solicitará permiso para instalar aplicaciones desde CLOUVA o desde la aplicación que descargó el archivo.
4. Instalar `CLOUVA CONTROL`.
5. Abrirla desde su propio ícono.
6. Iniciar sesión con la cuenta administradora de CLOUVA.

Las actualizaciones siguientes se descargan desde la pestaña **Sistema** de CLOUVA CONTROL y se instalan sobre la aplicación existente.

## Migraciones requeridas

Aplicar, en orden:

```text
supabase/migrations/20260805010000_clouva_control.sql
supabase/migrations/20260805014500_clouva_control_user_scoped_api.sql
```

Crean:

- `mobile_app_releases`;
- `admin_mobile_issues`;
- `admin_audit_logs`;
- bucket privado `admin-apk-releases`;
- bucket privado `admin-mobile-issues`;
- políticas RLS para administradores;
- RPC segura para validar al administrador y consultar procesos sin exponer la service role.

## Pantallas nativas

- **Mapa:** inventario central de pantallas y recorridos.
- **Probar:** CLOUVA real dentro de la app con selector de persona.
- **Procesos:** jobs reales de avatar, IA, importaciones, pagos y servicios.
- **Problemas:** reportes con ruta, persona, dispositivo, versión y captura.
- **Sistema:** versiones, descarga, instalación y actualización obligatoria.
