# Learning Studio

Aplicación que muestra tests para el estudio, que pueden ser Verdadero/Falso u Opción Múltiple. Los ficheros de preguntas están en formato JSON y se pueden editar fácilmente.

## Aplicación Web

Usa [Next.js](https://nextjs.org) con [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app) y TypeScript, y la infrastructura en AWS usando S3, CloudFront y Cognito para autenticación.

La infrastructura contiene tests unitarios con [Jest](https://jestjs.io/), y el frontend también contiene tests end-to-end con [Playwright](https://playwright.dev/).

La aplicación incluye:

- **Autenticación con Google OAuth** para sincronizar progreso entre dispositivos
- **Modo invitado** para uso local sin registro
- **Almacenamiento persistente** del progreso del usuario

Los resultados se almacenan en el `LocalStorage` del navegador (modo invitado) o se sincronizan en la nube (usuarios autenticados).

### Para construir y publicar la aplicación web

```bash
npm run build
```

Esto generará un directorio `out/` con todos los archivos estáticos que puedes subir al bucket S3. Excluye los siguientes archivos y directorios:

```bash
node_modules/
src/
data/
.git/
*.config.* (e.g., next.config.ts, postcss.config.mjs, etc.)
package.json, package-lock.json, tsconfig.json, README.md, etc.
```

### Despliegue frontend (dos fases)

Para reducir errores `LambdaLimitExceeded` en CloudFront tras publicar una nueva versión:

1. Fase 1 (publicación segura, sin borrar assets antiguos):

```bash
cd frontend
scripts/deploy-frontend.sh
```

Qué hace:

- `npm run check`
- `npm run build`
- `aws s3 sync out/ s3://studio.humblyproud.com/` (sin `--delete`)
- invalidación solo de HTML de entrada (`/studio`, `/studio/`, `/studio/index.html`)

2. Fase 2 (limpieza de assets obsoletos):

```bash
cd frontend
scripts/cleanup-frontend-assets.sh
```

Cuándo ejecutar limpieza:

- Recomendado: ~24 horas después de la publicación.
- Si el tráfico es muy bajo, puedes hacerlo antes.
- Si hay sesiones largas de usuarios, espera más (24-48h) para minimizar riesgo de clientes con chunks antiguos en memoria.

Invalidación manual documentada:

```bash
cd frontend
scripts/invalidate-frontend-cache.sh
```

Notas:

- Evita invalidar `/studio/_next/*` salvo incidente excepcional.
- Los chunks de Next están hasheados; normalmente no requieren invalidación global.

## Configuración de variables de entorno (.env)

Las variables de entorno para cada proyecto se esperan en ficheros `.env`. `env.development.local` para desarrollo local, `.env.production` para producción, y `.env.test` para tests, incluidos los end-to-end con Playwright. Se incluye un fichero `.env.example` como referencia.

### Variables básicas de la aplicación

El contenido de los .env debería incluir al menos:

````bash
# Subcarpeta desde donde se sirve la aplicación web
NEXT_PUBLIC_BASE_PATH=/studio

# Base URL donde se sirven los JSON de datos (S3/CloudFront o servidor local)
# Ejemplos:
# - Producción: https://studio-data.humblyproud.com (o /studio-data si va bajo el mismo dominio)
# - Desarrollo local: http://localhost:4173
NEXT_PUBLIC_DATA_BASE_URL=

# Nombre del fichero JSON con las áreas de estudio, el punto de partida de las preguntas de test.
NEXT_PUBLIC_AREAS_FILE=areas.json

# Idioma por defecto de la UI (es | en | ca)
NEXT_PUBLIC_DEFAULT_LANGUAGE=es

# Habilita selector de idioma en UI (true | false)
# En Phase 1 se mantiene en false.
NEXT_PUBLIC_LANGUAGE_SELECTION_ENABLED=false

# Variables de entrorno para AWS Cognito (autenticación)
NEXT_PUBLIC_COGNITO_USER_POOL_ID=
NEXT_PUBLIC_COGNITO_CLIENT_ID=
NEXT_PUBLIC_COGNITO_DOMAIN=
NEXT_PUBLIC_REDIRECT_SIGN_IN=https://domain.com/studio
NEXT_PUBLIC_REDIRECT_SIGN_OUT=https://domain.com/studio
# Opcional: fuerza comportamiento de login (login, select_account)
NEXT_PUBLIC_COGNITO_PROMPT=

# El tracking ID de Google Analytics 4 o el texto 'disabled' para desactivar analytics
NEXT_PUBLIC_GA_TRACKING_ID=G-XXXXXXXXXX```
````

### Configuración de idioma (multilenguaje)

- `NEXT_PUBLIC_DEFAULT_LANGUAGE`
  : idioma inicial de la aplicación. Valores soportados: `es`, `en`, `ca`.  
  Si el valor es inválido o falta, se usa `es`.
- `NEXT_PUBLIC_LANGUAGE_SELECTION_ENABLED`
  : habilita o deshabilita el selector de idioma en la interfaz (`true`/`false`).  
  En la fase actual del rollout se recomienda `false`.

### Desarrollo local con datos separados

En desarrollo puedes servir los JSON de `learning-studio-data` con un servidor estático local y apuntar el frontend a ese host.

Ejecuta:

```bash
cd frontend
npm run dev:data
```

Esto sirve los datos en `http://localhost:4173`. En `.env.development.local`:

```bash
NEXT_PUBLIC_DATA_BASE_URL=http://localhost:4173
```

### Sincronización DynamoDB en desarrollo local

En `NODE_ENV=development`, existe un endpoint local `GET/PUT /api/learning-state` implementado por Next.js para validar lectura/escritura real en DynamoDB sin desplegar CloudFront/Lambda@Edge.

El frontend permite activar/desactivar acceso a DynamoDB para controlar coste en desarrollo:

- `NEXT_PUBLIC_STORAGE_MODE=local|dynamodb|hybrid`
  : `local` usa solo `localStorage`, `dynamodb` usa lectura/escritura remota, `hybrid` lee remoto y guarda local (escritura remota opcional).
- `NEXT_PUBLIC_ENABLE_DYNAMODB=true|false`
  : interruptor global para cortar cualquier llamada remota.
- `NEXT_PUBLIC_SYNC_WRITES=true|false`
  : en `hybrid`, habilita/deshabilita escrituras remotas.
- `NEXT_PUBLIC_MAX_DDB_CALLS_PER_SESSION=<n>`
  : presupuesto máximo de llamadas remotas por sesión de navegador.
- `NEXT_PUBLIC_STUDIO_LEARNING_STATE_TABLE=<name>` (opcional)
  : nombre de tabla solo para logging del cliente.
- `NEXT_PUBLIC_DYNAMODB_LOG_ENABLED=true|false` (opcional)
  : habilita logs de diagnóstico de llamadas DynamoDB en consola del navegador.  
  Por defecto: `true` en `development`, `false` en `test` y `production`.

Ejemplo recomendado para desarrollo sin coste:

```bash
NEXT_PUBLIC_STORAGE_MODE=local
NEXT_PUBLIC_ENABLE_DYNAMODB=false
NEXT_PUBLIC_MAX_DDB_CALLS_PER_SESSION=50
```

Ejemplo para experimentar lecturas reales sin escrituras:

```bash
NEXT_PUBLIC_STORAGE_MODE=hybrid
NEXT_PUBLIC_ENABLE_DYNAMODB=true
NEXT_PUBLIC_SYNC_WRITES=false
NEXT_PUBLIC_MAX_DDB_CALLS_PER_SESSION=100
```

Si `NEXT_PUBLIC_DYNAMODB_LOG_ENABLED=true`, cada llamada remota queda trazada en consola con `op`, `table`, `pk` y `sk`.

Requisitos:

- Credenciales AWS válidas en tu entorno local.
- Variables para tabla/región (si no usas los defaults):
  : `STUDIO_LEARNING_STATE_TABLE`, `STUDIO_LEARNING_STATE_REGION`
- Opcional para tabla admin de identidad:
  : `STUDIO_USER_IDENTITY_ADMIN_TABLE`, `STUDIO_USER_IDENTITY_ADMIN_REGION`

Fuera de `development`, este endpoint local devuelve `404`.

### Configurar áreas visibles para invitados

Las áreas que ve un usuario invitado se pueden limitar desde el JSON de áreas (el fichero indicado por `NEXT_PUBLIC_AREAS_FILE`).

Campo opcional:

- `guestAllowedAreaShortNames`: array ordenado de `shortName` permitidos para invitados.

Ejemplo:

```json
{
  "schemaVersion": 1,
  "updatedAt": "2026-02-25",
  "guestAllowedAreaShortNames": ["log1", "ipc"],
  "areas": [
    {
      "area": "Lógica I",
      "file": "questions-logica1.json",
      "type": "True False",
      "shortName": "log1"
    },
    {
      "area": "Introducción al Pensamiento Científico",
      "file": "questions-ipc.json",
      "type": "Multiple Choice",
      "shortName": "ipc"
    },
    {
      "area": "Filosofía del Lenguaje I",
      "file": "questions-fdl.json",
      "type": "Multiple Choice",
      "shortName": "fdl"
    }
  ]
}
```

Comportamiento:

- Si `guestAllowedAreaShortNames` existe y tiene valores válidos, invitados verán solo esas áreas en ese orden.
- Si no existe (o queda vacío), invitados verán todas las áreas definidas en `areas`.
- Usuarios autenticados no usan este campo: pueden configurar su propia lista y orden desde `Configurar áreas`.

### Sincronizar configuración de Cognito (sin IaC)

Si gestionas manualmente el App Client de Cognito y quieres versionar su configuración en el repo:

1. Exportar configuración live a snapshot:

```bash
npm run cognito:pull
```

2. Ver diferencias snapshot vs live:

```bash
npm run cognito:diff
```

3. Aplicar snapshot al App Client live:

```bash
npm run cognito:push
```

Detalles:

- Snapshot por defecto: `infra/config/cognito-user-pool-client.json`.
- Los scripts leen por defecto `frontend/.env.production.local` y luego `frontend/.env.production`.
- Reutiliza automáticamente `NEXT_PUBLIC_COGNITO_USER_POOL_ID`, `NEXT_PUBLIC_COGNITO_CLIENT_ID` y `NEXT_PUBLIC_AWS_REGION`.
- Variables de shell (`COGNITO_USER_POOL_ID`, `COGNITO_USER_POOL_CLIENT_ID`, `AWS_REGION`) tienen prioridad si las defines.
- Puedes cambiar la ruta con `COGNITO_SNAPSHOT_PATH`.
- Recomendado: después de cambios manuales en AWS Console, ejecutar `cognito:pull` y commitear el snapshot.

### Obtener PK de DynamoDB desde JWT

Para imprimir el `pk` exacto (`USER#<sub>`) del usuario actual y un comando de borrado:

```bash
npm run jwt:pk -- --jwt '<id_token>'
```

También acepta un JSON con campo `jwt`, `token` o `id_token`:

```bash
npm run jwt:pk -- --file /ruta/al/archivo.json
```

Opcionalmente, si usas tabla/región no estándar:

```bash
npm run jwt:pk -- --jwt '<id_token>' --table studio-learning-state --region eu-west-2
```

### Tabla admin de identidad (sub -> lastKnownEmail)

El backend puede mantener una tabla de soporte con el último email conocido por `sub` para tareas administrativas (sin mezclarlo en el estado de aprendizaje del usuario).

Variables para runtime de edge auth:

- `STUDIO_USER_IDENTITY_ADMIN_TABLE` (ejemplo: `studio-user-identity-admin`)
- `STUDIO_USER_IDENTITY_ADMIN_REGION` (ejemplo: `eu-west-2`)

### Consideraciones de privacidad

- El tracking respeta la privacidad del usuario
- No se almacena información personal identificable
