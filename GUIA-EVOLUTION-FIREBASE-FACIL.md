# Evolution API + Firebase - Guia Paso a Paso para Principiantes

> Esta guia esta escrita para personas NO tecnicas. Sigue cada paso exactamente
> como se describe y tendras WhatsApp funcionando con tu MessageHub.

---

## Que vas a lograr

Al final de esta guia tendras:

1. Un **numero de WhatsApp conectado** a tu MessageHub
2. Los mensajes que recibas en WhatsApp **aparecen automaticamente** en tu panel
3. Un **agente de IA** que responde automaticamente a tus clientes 24/7
4. Todo funcionando con **Firebase** (sin servidores complicados)

---

## Que necesitas antes de empezar

| Requisito | Para que sirve | Donde conseguirlo |
|-----------|---------------|-------------------|
| Cuenta de Google | Para usar Firebase | gmail.com |
| Tarjeta de credito/debito | Firebase pide una tarjeta (pero NO cobra si es poco uso) | Tu banco |
| Una computadora | Para ejecutar los comandos | La que tengas |
| Un telefono con WhatsApp | El numero que quieres conectar | Tu celular |
| Un servidor con Evolution API | El "puente" entre WhatsApp y Firebase | Ver Paso 1 |

---

## PASO 1: Instalar Evolution API en un servidor

Evolution API es el programa que conecta tu numero de WhatsApp (como WhatsApp Web pero automatizado).

### Opcion A: Usar un servicio de hosting VPS (Recomendado para principiantes)

Servicios faciles y baratos:

- **Hetzner** (3 EUR/mes) - hetzner.com
- **DigitalOcean** (6 USD/mes) - digitalocean.com
- **Contabo** (4 EUR/mes) - contabo.com

Pide un servidor con **Ubuntu 22.04** y minimo **1 GB de RAM**.

### Una vez que tengas tu servidor, conéctate y ejecuta estos comandos:

**Paso 1.1 - Instalar Docker:**

```bash
curl -fsSL https://get.docker.com | sh
```

**Paso 1.2 - Crear el archivo de configuracion:**

```bash
mkdir -p /opt/evolution && cd /opt/evolution
```

Ahora crea un archivo llamado `docker-compose.yml`. Copia y pega EXACTAMENTE esto:

```bash
cat > docker-compose.yml << 'ARCHIVO'
version: "3.7"
services:
  evolution-api:
    image: atendai/evolution-api:latest
    container_name: evolution-api
    restart: always
    ports:
      - "8080:8080"
    environment:
      AUTHENTICATION_API_KEY: "CAMBIA-ESTO-POR-UNA-CLAVE-SECRETA-LARGA"
      AUTHENTICATION_EXPOSE_IN_FETCH_INSTANCES: "true"
      SERVER_URL: "https://TU-DOMINIO-O-IP:8080"
      SERVER_PORT: "8080"
      CORS_ORIGIN: "*"
      CORS_METHODS: "GET,POST,PUT,DELETE"
      CORS_CREDENTIALS: "true"
      DATABASE_PROVIDER: "postgresql"
      DATABASE_CONNECTION_URI: "postgresql://evouser:evopass123@db:5432/evolution"
      WEBHOOK_GLOBAL_ENABLED: "false"
      LOG_LEVEL: "WARN"
    volumes:
      - evolution_data:/evolution/instances

  db:
    image: postgres:15-alpine
    restart: always
    environment:
      POSTGRES_USER: evouser
      POSTGRES_PASSWORD: evopass123
      POSTGRES_DB: evolution
    volumes:
      - pg_data:/var/lib/postgresql/data

volumes:
  evolution_data:
  pg_data:
ARCHIVO
```

> **IMPORTANTE:** Cambia `CAMBIA-ESTO-POR-UNA-CLAVE-SECRETA-LARGA` por una
> clave que TU inventes (ejemplo: `MiClave-Secreta-2024-XyZ`). Anotala, la
> necesitaras despues.

**Paso 1.3 - Iniciar Evolution API:**

```bash
docker compose up -d
```

**Paso 1.4 - Verificar que funciona:**

```bash
curl http://localhost:8080/
```

Debe responder algo como: `{"status":200,"message":"Welcome to the Evolution API..."}`.

Tu Evolution API ahora esta corriendo en: `http://TU-IP-DEL-SERVIDOR:8080`

---

## PASO 2: Crear tu proyecto en Firebase

### 2.1 Crear el proyecto

1. Abre tu navegador y ve a: **https://console.firebase.google.com/**
2. Inicia sesion con tu cuenta de Google
3. Haz clic en **"Add project"** (Agregar proyecto)
4. Escribe un nombre, por ejemplo: `mi-messagehub`
5. Deshabilita Google Analytics (no es necesario)
6. Haz clic en **"Create project"**
7. Espera a que se cree y haz clic en **"Continue"**

### 2.2 Activar el Plan Blaze (pago por uso)

Las Cloud Functions REQUIEREN el plan Blaze. **No te preocupes**: Firebase tiene
un tier gratuito generoso y no te cobrara a menos que tengas miles de mensajes
al dia.

1. En la consola de Firebase, haz clic en **"Upgrade"** (abajo a la izquierda)
2. Selecciona **"Blaze"** (Pay as you go)
3. Ingresa tu tarjeta de credito/debito
4. Confirma

> **Cuanto cuesta?** Para un negocio pequeno (menos de 1,000 mensajes/dia):
> **$0 a $2 USD/mes** maximo. Firebase tiene 2 millones de invocaciones GRATIS
> al mes.

### 2.3 Activar Firestore (base de datos)

1. En el menu de la izquierda, haz clic en **"Firestore Database"**
2. Haz clic en **"Create database"**
3. Selecciona **"Start in production mode"**
4. Elige la ubicacion **"us-central1"** (o la mas cercana a ti)
5. Haz clic en **"Enable"**

### 2.4 Activar Authentication

1. En el menu de la izquierda, haz clic en **"Authentication"**
2. Haz clic en **"Get started"**
3. Habilita **"Email/Password"**
4. Habilita **"Google"** (opcional pero recomendado)

---

## PASO 3: Instalar herramientas en tu computadora

Necesitas instalar 2 programas. Abre la **terminal** de tu computadora
(en Windows: CMD o PowerShell; en Mac: Terminal).

### 3.1 Instalar Node.js

Ve a **https://nodejs.org/** y descarga la version **LTS** (la de la
izquierda, el boton verde). Instala con todo por defecto.

Verifica que se instalo:

```bash
node --version
```

Debe mostrar algo como `v18.x.x` o superior.

### 3.2 Instalar Firebase CLI

```bash
npm install -g firebase-tools
```

Verifica:

```bash
firebase --version
```

Debe mostrar algo como `13.x.x`.

### 3.3 Iniciar sesion en Firebase

```bash
firebase login
```

Se abrira tu navegador. Inicia sesion con la **misma cuenta de Google**
que usaste para crear el proyecto Firebase.

---

## PASO 4: Descargar y preparar el codigo

### 4.1 Descargar el repositorio

```bash
git clone https://github.com/TU-USUARIO/message-hub.git
cd message-hub
```

> Si no tienes git, descarga el ZIP del repositorio y descomprimelo.

### 4.2 Conectar con tu proyecto Firebase

```bash
firebase use --add
```

Te mostrara una lista de proyectos. Selecciona el que creaste (por ejemplo
`mi-messagehub`). Si te pide un alias, escribe `default`.

Si ya sabes tu Project ID:

```bash
firebase use mi-messagehub
```

### 4.3 Instalar las dependencias de las Cloud Functions

```bash
cd functions
npm install
cd ..
```

---

## PASO 5: Desplegar (subir) las Cloud Functions a Firebase

Este es el paso mas importante. Aqui subes el codigo a Firebase.

### 5.1 Desplegar todo

Ejecuta TODOS estos comandos, uno por uno:

```bash
# 1. Subir las reglas de seguridad de la base de datos
firebase deploy --only firestore:rules

# 2. Subir los indices de la base de datos
firebase deploy --only firestore:indexes

# 3. Subir las Cloud Functions (el codigo que procesa mensajes)
firebase deploy --only functions
```

### 5.2 Obtener tu URL del webhook

Despues del ultimo comando, Firebase te mostrara las URLs. Busca la linea que dice:

```
Function URL (whatsappEvolutionWebhook): https://us-central1-mi-messagehub.cloudfunctions.net/whatsappEvolutionWebhook
```

**COPIA ESTA URL COMPLETA.** La necesitaras en el siguiente paso.

> **Ejemplo de como se ve tu URL:**
> `https://us-central1-mi-messagehub.cloudfunctions.net/whatsappEvolutionWebhook`
>
> Donde `mi-messagehub` es el ID de tu proyecto Firebase.

Si no la anotaste, puedes volver a verla con:

```bash
firebase functions:list
```

---

## PASO 6: Conectar Evolution API con Firebase

Ahora necesitas decirle a Evolution API que envie los mensajes a tu
Cloud Function de Firebase.

### 6.1 Crear la instancia de WhatsApp

Desde tu computadora, ejecuta este comando (reemplaza los valores):

```bash
curl -X POST "http://TU-IP-SERVIDOR:8080/instance/create" \
  -H "apikey: TU-API-KEY-DE-EVOLUTION" \
  -H "Content-Type: application/json" \
  -d '{
    "instanceName": "mi-negocio-wa",
    "integration": "WHATSAPP-BAILEYS",
    "qrcode": true
  }'
```

**Reemplaza:**
- `TU-IP-SERVIDOR` = La IP de tu servidor donde instalaste Evolution API
- `TU-API-KEY-DE-EVOLUTION` = La clave que pusiste en `AUTHENTICATION_API_KEY`
- `mi-negocio-wa` = Un nombre para tu instancia (sin espacios, sin acentos)

### 6.2 Configurar el webhook (conectar Evolution → Firebase)

```bash
curl -X POST "http://TU-IP-SERVIDOR:8080/webhook/set/mi-negocio-wa" \
  -H "apikey: TU-API-KEY-DE-EVOLUTION" \
  -H "Content-Type: application/json" \
  -d '{
    "webhook": {
      "enabled": true,
      "url": "https://us-central1-mi-messagehub.cloudfunctions.net/whatsappEvolutionWebhook",
      "webhookByEvents": false,
      "webhookBase64": false,
      "events": ["MESSAGES_UPSERT"]
    }
  }'
```

**IMPORTANTE:** Reemplaza la URL del webhook con LA TUYA (la que copiaste
en el Paso 5.2).

### 6.3 Obtener el codigo QR para conectar WhatsApp

```bash
curl "http://TU-IP-SERVIDOR:8080/instance/connect/mi-negocio-wa" \
  -H "apikey: TU-API-KEY-DE-EVOLUTION"
```

Esto te devolvera un codigo QR. Opciones para escanearlo:

**Opcion A**: Si la respuesta incluye un `base64`, copia el texto base64 y
pegalo en **https://base64.guru/converter/decode/image** para ver el QR.

**Opcion B**: Abre en tu navegador:
`http://TU-IP-SERVIDOR:8080/instance/connect/mi-negocio-wa`
(con header apikey, o usa una extension como ModHeader en Chrome).

### 6.4 Escanear el QR con tu telefono

1. Abre **WhatsApp** en tu telefono
2. Ve a **Configuracion** → **Dispositivos vinculados** → **Vincular un dispositivo**
3. **Escanea el codigo QR**
4. Espera unos segundos hasta que diga "conectado"

### 6.5 Verificar que esta conectado

```bash
curl "http://TU-IP-SERVIDOR:8080/instance/connectionState/mi-negocio-wa" \
  -H "apikey: TU-API-KEY-DE-EVOLUTION"
```

Debe responder con `"state": "open"`. Eso significa que esta conectado.

---

## PASO 7: Configurar la integracion en Firestore

Para que el webhook de Firebase sepa a que organizacion enviar los mensajes,
necesitas guardar la configuracion en Firestore.

### Opcion A: Desde la UI de MessageHub (si ya la tienes funcionando)

1. Ve a **Configuracion → Integraciones**
2. En la tarjeta de WhatsApp, haz clic en **"QR (Evolution)"**
3. Ingresa:
   - URL del servidor: `http://TU-IP-SERVIDOR:8080`
   - API Key: Tu clave de Evolution
   - Nombre de instancia: `mi-negocio-wa`
4. La UI guardara todo en Firestore automaticamente

### Opcion B: Manualmente en la consola de Firebase

Si aun no tienes la UI funcionando, hazlo manualmente:

1. Ve a **https://console.firebase.google.com/** → Tu proyecto → **Firestore**
2. Busca la coleccion `organizations` → Tu organizacion
3. Dentro de tu organizacion, crea una sub-coleccion llamada `integrations`
4. Agrega un nuevo documento con estos campos:

| Campo | Tipo | Valor |
|-------|------|-------|
| `platform` | string | `whatsapp` |
| `method` | string | `evolution` |
| `connected` | boolean | `true` |
| `evolutionApiUrl` | string | `http://TU-IP-SERVIDOR:8080` |
| `evolutionApiKey` | string | `tu-api-key-de-evolution` |
| `evolutionInstanceName` | string | `mi-negocio-wa` |
| `orgId` | string | `(el ID de tu organizacion)` |
| `updatedAt` | timestamp | (haz clic en el reloj para fecha actual) |

---

## PASO 8: Probar que todo funciona

### 8.1 Enviar un mensaje de prueba

Desde **otro telefono** (no el que conectaste), envia un mensaje de WhatsApp
al numero que conectaste. Ejemplo: "Hola, quiero informacion".

### 8.2 Verificar en los logs de Firebase

```bash
firebase functions:log --only whatsappEvolutionWebhook
```

Deberias ver algo como:

```
[Evolution] Mensaje guardado. instance="mi-negocio-wa" org="abc123" conv="xyz789" from="5215512345678"
```

### 8.3 Verificar en Firestore

1. Ve a la **consola de Firebase** → **Firestore**
2. Navega a `organizations → (tu-org) → conversations`
3. Deberia aparecer una **nueva conversacion** con el mensaje

### 8.4 Ver los logs del auto-responder (si tienes IA configurada)

```bash
firebase functions:log --only autoResponder
```

---

## PASO 9 (Opcional): Configurar el Agente de IA

Para que la IA responda automaticamente, necesitas crear un agente en Firestore.

En **Firestore**, dentro de tu organizacion, crea la sub-coleccion `aiAgents`
con un documento que tenga estos campos:

| Campo | Tipo | Valor |
|-------|------|-------|
| `name` | string | `Asistente de Ventas` |
| `active` | boolean | `true` |
| `channels` | array | `["whatsapp"]` |
| `provider` | string | `openai` (o `anthropic`) |
| `model` | string | `gpt-4o-mini` (o `claude-sonnet-4-20250514`) |
| `apiKey` | string | `tu-api-key-de-openai-o-anthropic` |
| `systemPrompt` | string | `Eres un asistente de ventas amable...` |
| `knowledgeBases` | array | `[]` (vacio por ahora) |

> **Para obtener una API Key de IA:**
> - OpenAI: https://platform.openai.com/api-keys
> - Anthropic: https://console.anthropic.com/settings/keys

---

## Resumen Visual del Flujo

```
Cliente envia mensaje por WhatsApp
         |
         v
Evolution API (tu servidor VPS)
    recibe el mensaje via Baileys
         |
         v
    POST webhook →
         |
         v
Firebase Cloud Function: whatsappEvolutionWebhook
    (tu URL: https://us-central1-PROYECTO.cloudfunctions.net/whatsappEvolutionWebhook)
         |
         v
    Guarda mensaje en Firestore
    organizations/{orgId}/conversations/{convId}/messages/{msgId}
         |
         v
Firebase Cloud Function: autoResponder  ← (se activa automaticamente)
    1. Lee el mensaje del cliente
    2. Busca agente IA activo
    3. Llama a OpenAI/Anthropic
    4. Guarda respuesta en Firestore
    5. Envia respuesta por WhatsApp via Evolution API
         |
         v
Cliente recibe la respuesta en WhatsApp
```

---

## El Codigo que ya esta incluido

Tu repositorio ya tiene TODO el codigo necesario. Aqui esta lo que hace
cada archivo:

### `functions/index.js` - Punto de entrada
Exporta todas las funciones de Firebase. No necesitas modificar nada.

### `functions/src/webhooks/whatsappEvolution.js` - Webhook de Evolution API
Esta es la funcion HTTP que recibe los mensajes de WhatsApp via Evolution API.

**Que hace:**
1. Recibe el POST de Evolution API cuando llega un mensaje
2. Identifica de que organizacion es (buscando por `evolutionInstanceName`)
3. Crea o busca la conversacion del contacto
4. Guarda el mensaje en Firestore

### `functions/src/ai/autoResponder.js` - Agente IA automatico
Se activa automaticamente cada vez que se guarda un nuevo mensaje.

**Que hace:**
1. Detecta si la conversacion tiene IA habilitada
2. Busca el agente IA configurado para WhatsApp
3. Construye el contexto con el historial de chat
4. Llama a OpenAI o Anthropic
5. Guarda la respuesta y la envia de vuelta por WhatsApp

### `functions/src/utils/firestore.js` - Utilidades de base de datos
Funciones auxiliares para buscar organizaciones, conversaciones, contactos, etc.

---

## Solucion de Problemas Comunes

### "El webhook no recibe mensajes"

1. Verifica que el webhook esta configurado:
   ```bash
   curl "http://TU-IP:8080/webhook/find/mi-negocio-wa" \
     -H "apikey: TU-API-KEY"
   ```
2. Verifica que la URL del webhook es correcta
3. Revisa los logs de Evolution API:
   ```bash
   docker logs evolution-api --tail 50
   ```

### "Error: Org no encontrada para instance"

La funcion de Firebase no encuentra tu organizacion. Verifica:
1. Que creaste el documento de integracion en Firestore (Paso 7)
2. Que el campo `evolutionInstanceName` coincide EXACTAMENTE con el nombre
   de tu instancia (ejemplo: `mi-negocio-wa`)
3. Que `connected` es `true`
4. Despliega los indices: `firebase deploy --only firestore:indexes`

### "El auto-responder no responde"

1. Verifica que hay un agente IA con `active: true` y `channels: ["whatsapp"]`
2. Verifica que la conversacion tiene `aiEnabled: true`
3. Verifica que el agente tiene una API key valida
4. Revisa logs: `firebase functions:log --only autoResponder`

### "QR no aparece o la conexion falla"

1. Verifica que Evolution API esta corriendo:
   ```bash
   curl http://TU-IP:8080/
   ```
2. Verifica que el puerto 8080 esta abierto en tu servidor
3. Si usas firewall, abre el puerto:
   ```bash
   sudo ufw allow 8080
   ```

### "Error 403 o 500 al hacer deploy"

1. Verifica que estas logueado: `firebase login`
2. Verifica que seleccionaste el proyecto: `firebase use`
3. Verifica que tienes el plan Blaze activo

---

## Costos Estimados

| Servicio | Costo | Notas |
|----------|-------|-------|
| Firebase (Functions + Firestore) | $0-2 USD/mes | Gratis hasta 2M invocaciones/mes |
| Servidor VPS (Evolution API) | $3-6 USD/mes | Hetzner, Contabo, DigitalOcean |
| OpenAI API (si usas IA) | $1-10 USD/mes | Depende del volumen de mensajes |
| **Total estimado** | **$4-18 USD/mes** | Para un negocio pequeno |

---

## Comandos Utiles de Referencia

```bash
# Ver estado de las funciones
firebase functions:list

# Ver logs en tiempo real
firebase functions:log --only whatsappEvolutionWebhook
firebase functions:log --only autoResponder

# Redesplegar solo las funciones (despues de hacer cambios)
firebase deploy --only functions

# Redesplegar una funcion especifica
firebase deploy --only functions:whatsappEvolutionWebhook

# Ver estado de la instancia de WhatsApp
curl "http://TU-IP:8080/instance/connectionState/mi-negocio-wa" \
  -H "apikey: TU-API-KEY"

# Ver webhook configurado
curl "http://TU-IP:8080/webhook/find/mi-negocio-wa" \
  -H "apikey: TU-API-KEY"

# Enviar un mensaje de prueba via Evolution API
curl -X POST "http://TU-IP:8080/message/sendText/mi-negocio-wa" \
  -H "apikey: TU-API-KEY" \
  -H "Content-Type: application/json" \
  -d '{"number": "5215512345678", "text": "Hola, este es un mensaje de prueba"}'
```
