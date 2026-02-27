# Evolution API + Firebase — Guía Completa de Integración

Esta guía cubre la configuración completa para conectar WhatsApp a MessageHub
usando Evolution API (Baileys) con Firebase Cloud Functions como backend.

---

## Arquitectura

```
WhatsApp (teléfono del usuario)
    │  Mensaje entrante
    ▼
Evolution API (servidor auto-hospedado, Baileys)
    │  POST webhook → MESSAGES_UPSERT
    ▼
Firebase Cloud Function: whatsappEvolutionWebhook
    │  1. Identifica la organización por evolutionInstanceName
    │  2. Busca/crea conversación por teléfono
    │  3. Guarda mensaje en Firestore (direction: 'incoming')
    ▼
Firebase Cloud Function: autoResponder  ← Firestore trigger automático
    │  1. Verifica aiEnabled en la conversación
    │  2. Busca agente IA activo para WhatsApp
    │  3. Construye prompt con KB + herramientas (save_contact, create_order, query_database)
    │  4. Llama a OpenAI / Anthropic
    │  5. Ejecuta herramientas (guarda contacto, crea pedido, consulta productos)
    │  6. Guarda respuesta en Firestore (direction: 'outgoing')
    │  7. Envía respuesta de vuelta via Evolution API → sendText
    ▼
Evolution API
    │  Envía mensaje al usuario
    ▼
WhatsApp (teléfono del usuario recibe respuesta)
```

---

## Requisitos Previos

1. **Firebase (Plan Blaze)**
   - Proyecto con Firestore habilitado
   - Cloud Functions desplegadas (ver `DEPLOY.md`)
   - Firebase CLI instalado (`npm install -g firebase-tools`)

2. **Servidor para Evolution API**
   - VPS o servidor con Docker (mínimo 1 GB RAM, 1 vCPU)
   - IP pública o dominio con HTTPS (recomendado: nginx + Let's Encrypt)
   - Puertos: 8080 (API) abiertos

3. **WhatsApp**
   - Un número de teléfono con WhatsApp activo
   - El teléfono debe estar cerca para escanear el QR inicial

---

## Paso 1: Instalar Evolution API

### Opción A: Docker Compose (Recomendado)

Crea un archivo `docker-compose.yml` en tu servidor:

```yaml
version: "3.7"
services:
  evolution-api:
    image: atendai/evolution-api:latest
    container_name: evolution-api
    restart: always
    ports:
      - "8080:8080"
    environment:
      # ── Autenticación ─────────────────────────────────────────
      AUTHENTICATION_API_KEY: "tu-api-key-segura-aqui"
      AUTHENTICATION_EXPOSE_IN_FETCH_INSTANCES: "true"

      # ── Servidor ──────────────────────────────────────────────
      SERVER_URL: "https://api.tudominio.com"
      SERVER_PORT: "8080"

      # ── CORS (necesario para que el frontend se conecte) ─────
      CORS_ORIGIN: "*"
      CORS_METHODS: "GET,POST,PUT,DELETE"
      CORS_CREDENTIALS: "true"

      # ── Almacenamiento ────────────────────────────────────────
      # Usa SQLite local (más simple) o PostgreSQL para producción
      DATABASE_PROVIDER: "postgresql"
      DATABASE_CONNECTION_URI: "postgresql://user:pass@db:5432/evolution"

      # ── Webhook global (opcional, se configura por instancia) ─
      WEBHOOK_GLOBAL_ENABLED: "false"

      # ── Logs ──────────────────────────────────────────────────
      LOG_LEVEL: "WARN"
    volumes:
      - evolution_data:/evolution/instances

  # Base de datos PostgreSQL (opcional, puedes usar SQLite)
  db:
    image: postgres:15-alpine
    restart: always
    environment:
      POSTGRES_USER: user
      POSTGRES_PASSWORD: pass
      POSTGRES_DB: evolution
    volumes:
      - pg_data:/var/lib/postgresql/data

volumes:
  evolution_data:
  pg_data:
```

Inicia el servicio:

```bash
docker compose up -d
```

### Opción B: NPM directo

```bash
git clone https://github.com/EvolutionAPI/evolution-api.git
cd evolution-api
cp src/dev-env.yml src/env.yml
# Edita src/env.yml con tu configuración
npm install
npm run build
npm start
```

### Verificar que está corriendo

```bash
curl https://api.tudominio.com/
# Debe responder: { "status": 200, "message": "Welcome to the Evolution API..." }
```

---

## Paso 2: Configurar HTTPS (Producción)

Evolution API necesita HTTPS para que los webhooks de Firebase funcionen
correctamente. Usa nginx como reverse proxy:

```nginx
server {
    listen 443 ssl http2;
    server_name api.tudominio.com;

    ssl_certificate /etc/letsencrypt/live/api.tudominio.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.tudominio.com/privkey.pem;

    location / {
        proxy_pass http://localhost:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Obtén certificado SSL:

```bash
sudo certbot --nginx -d api.tudominio.com
```

---

## Paso 3: Configurar Firebase

### 3.1 Variables de entorno del frontend

En el archivo `.env` o `.env.local` del frontend (`apps/web/`), agrega:

```env
# URL de la Cloud Function del webhook de Evolution API
# Se obtiene después de hacer deploy (paso 4)
VITE_EVOLUTION_WEBHOOK_URL=https://REGION-PROJECT_ID.cloudfunctions.net/whatsappEvolutionWebhook
```

### 3.2 Desplegar Cloud Functions

Las funciones ya incluyen el webhook de Evolution API. Despliega:

```bash
cd functions
npm install
cd ..
firebase deploy --only functions
```

Anota la URL que aparece para `whatsappEvolutionWebhook`:

```
Function URL (whatsappEvolutionWebhook): https://us-central1-TU-PROJECT.cloudfunctions.net/whatsappEvolutionWebhook
```

### 3.3 Desplegar índices de Firestore

Los índices necesarios para buscar organizaciones por `evolutionInstanceName`
ya están definidos en `firestore.indexes.json`:

```bash
firebase deploy --only firestore:indexes
```

Esto crea un índice de grupo de colección para el campo
`evolutionInstanceName` en la subcolección `integrations`.

### 3.4 Desplegar reglas de Firestore

```bash
firebase deploy --only firestore:rules
```

Las reglas permiten que los miembros de una organización lean/escriban
sus integraciones. Las Cloud Functions usan Admin SDK y no necesitan reglas.

### 3.5 Verificar la configuración de Firebase

Comprueba que las funciones están activas:

```bash
firebase functions:list
```

Prueba que el webhook responde (debe devolver 405 porque solo acepta POST):

```bash
curl -X GET https://us-central1-TU-PROJECT.cloudfunctions.net/whatsappEvolutionWebhook
# Debe responder: 405 Method Not Allowed
```

---

## Paso 4: Conectar WhatsApp desde la UI de MessageHub

1. Ve a **Configuración → Integraciones** en MessageHub.
2. En la tarjeta de WhatsApp Business, haz clic en **QR (Evolution)**.
3. Ingresa:
   - **URL del servidor**: `https://api.tudominio.com`
   - **API Key global**: La que definiste en `AUTHENTICATION_API_KEY`
   - **Nombre de la instancia**: Un identificador único (ej: `mi-empresa-wa`)
4. Haz clic en **Obtener QR**.
5. Escanea el código QR con tu teléfono:
   - Abre WhatsApp → **Dispositivos vinculados** → **Vincular dispositivo**
6. Espera a que el status cambie a **"¡Conectado!"**.

La UI automáticamente:
- Crea la instancia en Evolution API (si no existe)
- Configura el webhook apuntando a tu Cloud Function
- Guarda la configuración en Firestore

---

## Paso 5: Configurar el Webhook manualmente (si es necesario)

Si el webhook no se configuró automáticamente (la variable
`VITE_EVOLUTION_WEBHOOK_URL` no estaba definida), configúralo manualmente:

### Vía API de Evolution:

```bash
curl -X POST "https://api.tudominio.com/webhook/set/mi-empresa-wa" \
  -H "apikey: tu-api-key-segura-aqui" \
  -H "Content-Type: application/json" \
  -d '{
    "webhook": {
      "enabled": true,
      "url": "https://us-central1-TU-PROJECT.cloudfunctions.net/whatsappEvolutionWebhook",
      "webhookByEvents": false,
      "webhookBase64": false,
      "events": ["MESSAGES_UPSERT"]
    }
  }'
```

### Verificar que el webhook está configurado:

```bash
curl "https://api.tudominio.com/webhook/find/mi-empresa-wa" \
  -H "apikey: tu-api-key-segura-aqui"
```

---

## Paso 6: Verificar el Flujo Completo

### 1. Envía un mensaje de prueba

Desde otro teléfono, envía un mensaje de WhatsApp al número conectado.

### 2. Revisa los logs de Firebase

```bash
# Ver logs del webhook
firebase functions:log --only whatsappEvolutionWebhook

# Ver logs del auto-responder
firebase functions:log --only autoResponder
```

Deberías ver:
```
[Evolution] Mensaje guardado. instance="mi-empresa-wa" org="abc123" conv="xyz789" from="5215512345678"
[autoResponder] Respuesta guardada para msg="..." en conv="xyz789"
[autoResponder] Mensaje enviado via Evolution API a phone="5215512345678" instance="mi-empresa-wa"
```

### 3. Verifica en la UI

- El mensaje aparece en **Conversaciones**
- Si hay un agente IA activo para WhatsApp con `aiEnabled: true`, la respuesta automática se envía de vuelta

---

## Estructura de Datos en Firestore

### Integración de Evolution API
```
organizations/{orgId}/integrations/{integrationId}
{
  platform: "whatsapp",
  method: "evolution",
  connected: true,
  evolutionApiUrl: "https://api.tudominio.com",
  evolutionApiKey: "tu-api-key-segura-aqui",
  evolutionInstanceName: "mi-empresa-wa",
  evolutionPhone: "5215512345678",  // se llena después de conectar
  orgId: "abc123",
  updatedAt: Timestamp
}
```

### Conversación creada por webhook
```
organizations/{orgId}/conversations/{convId}
{
  contactId: "5215512345678",       // Teléfono como ID temporal
  contactName: "Nombre del Push",   // pushName de WhatsApp
  contactPhone: "5215512345678",
  platform: "whatsapp",
  status: "open",
  funnelStage: "curioso",
  aiEnabled: true,                  // Habilita auto-responder IA
  createdBy: "webhook",
  createdAt: Timestamp,
  lastMessage: "Hola!",
  lastMessageAt: Timestamp,
  unreadCount: 1
}
```

### Mensaje entrante
```
organizations/{orgId}/conversations/{convId}/messages/{msgId}
{
  text: "Hola, necesito un faro para Toyota Corolla 2015",
  sender: "5215512345678",
  senderName: "Juan",
  platform: "whatsapp",
  direction: "incoming",
  timestamp: Timestamp,
  status: "received"
}
```

---

## Solución de Problemas

### El webhook no recibe mensajes

1. Verifica que el webhook está configurado en la instancia:
   ```bash
   curl "https://api.tudominio.com/webhook/find/mi-empresa-wa" \
     -H "apikey: tu-api-key"
   ```
2. Verifica que la URL del webhook es correcta y accesible desde internet
3. Revisa los logs de Evolution API:
   ```bash
   docker logs evolution-api --tail 50
   ```

### El auto-responder no responde

1. Verifica que hay un agente IA activo con el canal `whatsapp` habilitado
2. Verifica que la conversación tiene `aiEnabled: true`
3. Verifica que el agente tiene una API key válida (OpenAI o Anthropic)
4. Revisa los logs:
   ```bash
   firebase functions:log --only autoResponder
   ```

### Error "Org no encontrada para instance"

El webhook no encuentra la organización. Verifica:
1. Que el índice `evolutionInstanceName` existe en Firestore
2. Que la integración tiene `connected: true` y el `evolutionInstanceName` correcto
3. Despliega los índices: `firebase deploy --only firestore:indexes`

### QR no aparece o la conexión falla

1. Verifica que la URL de Evolution API es correcta y accesible
2. Verifica que CORS está habilitado (`CORS_ORIGIN: "*"`)
3. Prueba la conexión directamente:
   ```bash
   curl "https://api.tudominio.com/instance/connectionState/mi-empresa-wa" \
     -H "apikey: tu-api-key"
   ```

### El mensaje se guarda pero no se envía la respuesta por WhatsApp

1. Verifica la configuración de Evolution API en Firestore:
   - `evolutionApiUrl`, `evolutionApiKey`, `evolutionInstanceName` deben estar presentes
   - `method` debe ser `"evolution"` y `connected` debe ser `true`
2. Verifica que la instancia sigue conectada:
   ```bash
   curl "https://api.tudominio.com/instance/connectionState/mi-empresa-wa" \
     -H "apikey: tu-api-key"
   # state debe ser "open"
   ```

---

## Resumen de Configuraciones Necesarias en Firebase

| Componente | Acción | Comando |
|-----------|--------|---------|
| Cloud Functions | Desplegar todas | `firebase deploy --only functions` |
| Firestore Indexes | Crear índice evolutionInstanceName | `firebase deploy --only firestore:indexes` |
| Firestore Rules | Desplegar reglas de seguridad | `firebase deploy --only firestore:rules` |
| Frontend .env | Agregar VITE_EVOLUTION_WEBHOOK_URL | Editar `apps/web/.env` |
| Plan Firebase | Debe ser Blaze (pago por uso) | Consola de Firebase |
| Firestore | Debe estar habilitado | Consola de Firebase |

---

## Notas de Seguridad

- **API Key de Evolution**: Guarda la API key de forma segura. Se almacena
  en Firestore dentro del documento de integración. Solo los miembros de la
  organización pueden acceder a ella.
- **Webhook sin autenticación**: El webhook de Firebase no tiene un token
  de verificación como Meta. Cualquier POST a esa URL será procesado. Para
  mayor seguridad, puedes agregar una validación del `instance` name en el
  webhook.
- **HTTPS obligatorio**: Tanto Evolution API como Firebase Cloud Functions
  deben usar HTTPS en producción.
