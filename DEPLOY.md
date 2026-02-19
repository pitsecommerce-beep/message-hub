# MessageHub — Guía de Deploy de Cloud Functions

Esta guía cubre el deploy de las Firebase Cloud Functions que permiten que el agente IA responda mensajes 24/7 aunque el navegador esté cerrado.

---

## Requisitos previos

- Node.js 18+
- Cuenta en Firebase con plan **Blaze** (pago por uso). Las Cloud Functions requieren este plan incluso para el tier gratuito de uso.
- Proyecto Firebase existente con Firestore habilitado.

---

## 1. Instalar Firebase CLI

```bash
npm install -g firebase-tools
```

Verifica la instalación:

```bash
firebase --version
# Debe mostrar 13.x o superior
```

---

## 2. Iniciar sesión en Firebase

```bash
firebase login
```

Se abrirá una ventana del navegador. Inicia sesión con la cuenta que tiene acceso al proyecto.

---

## 3. Vincular el proyecto

Desde la raíz del repositorio:

```bash
firebase use --add
```

Selecciona el proyecto Firebase de MessageHub en la lista interactiva.

O si ya conoces el Project ID:

```bash
firebase use TU_PROJECT_ID
```

---

## 4. Instalar dependencias de las functions

```bash
cd functions
npm install
cd ..
```

---

## 5. Configurar variables de entorno (parámetros)

Las Cloud Functions de 2ª generación usan **parámetros de entorno** en lugar de `functions:config`. Establece el token de verificación del webhook de Meta:

```bash
# Opción A: variable de entorno en tiempo de deploy
firebase functions:params:set META_VERIFY_TOKEN="tu_token_secreto_aqui"
```

> **Importante:** El `META_VERIFY_TOKEN` es un string que tú eliges libremente. Lo configurarás en el panel de Meta for Developers más adelante (paso 8). Debe ser el mismo valor en ambos lugares.

> **Nota sobre API keys de IA:** Las claves de OpenAI/Anthropic se leen directamente desde Firestore (`organizations/{orgId}/aiAgents/{agentId}.apiKey`), no desde variables de entorno. Cada organización administra sus propias claves desde la interfaz de MessageHub.

---

## 6. Crear índices de Firestore para los webhooks

Los webhooks necesitan buscar organizaciones por `phoneNumberId` (WhatsApp) o `pageId` (Instagram/Messenger) usando una `collectionGroup` query. Esto requiere índices de grupo de colección.

### Opción A: Automático con Firebase CLI

Agrega el archivo `firestore.indexes.json` en la raíz del proyecto con el siguiente contenido:

```json
{
  "indexes": [],
  "fieldOverrides": [
    {
      "collectionGroup": "integrations",
      "fieldPath": "phoneNumberId",
      "indexes": [
        { "order": "ASCENDING", "queryScope": "COLLECTION_GROUP" }
      ]
    },
    {
      "collectionGroup": "integrations",
      "fieldPath": "pageId",
      "indexes": [
        { "order": "ASCENDING", "queryScope": "COLLECTION_GROUP" }
      ]
    }
  ]
}
```

Luego despliega los índices:

```bash
firebase deploy --only firestore:indexes
```

### Opción B: Manual en la consola de Firebase

1. Ve a **Firebase Console → Firestore → Índices → Índices de grupo de colección**
2. Crea un índice para la colección `integrations`:
   - Campo: `phoneNumberId` | Orden: Ascendente | Alcance: Grupo de colección
3. Crea otro índice:
   - Campo: `pageId` | Orden: Ascendente | Alcance: Grupo de colección

---

## 7. Hacer deploy de las Cloud Functions

```bash
firebase deploy --only functions
```

Al finalizar, la CLI mostrará las URLs de cada función. Anota las URLs de los webhooks:

```
Function URL (whatsappWebhook): https://REGION-PROJECT_ID.cloudfunctions.net/whatsappWebhook
Function URL (instagramWebhook): https://REGION-PROJECT_ID.cloudfunctions.net/instagramWebhook
Function URL (messengerWebhook): https://REGION-PROJECT_ID.cloudfunctions.net/messengerWebhook
```

---

## 8. Configurar los webhooks en Meta for Developers

### WhatsApp

1. Ve a [Meta for Developers](https://developers.facebook.com) → Tu app → WhatsApp → Configuración.
2. En **Webhook**, haz clic en **Editar**.
3. Pega la URL: `https://REGION-PROJECT_ID.cloudfunctions.net/whatsappWebhook`
4. En **Verify token**, escribe el mismo valor que usaste en el paso 5 (`tu_token_secreto_aqui`).
5. Haz clic en **Verify and save**.
6. Suscríbete al campo **messages**.

### Instagram

1. Ve a tu app de Meta → Instagram → Configuración de Messenger.
2. En **Webhooks**, agrega:
   - URL: `https://REGION-PROJECT_ID.cloudfunctions.net/instagramWebhook`
   - Verify token: mismo valor del paso 5.
3. Suscríbete al campo **messages**.

### Messenger (Facebook)

1. Ve a tu app de Meta → Messenger → Configuración.
2. En **Webhooks**, haz clic en **Agregar URL de devolución de llamada**:
   - URL: `https://REGION-PROJECT_ID.cloudfunctions.net/messengerWebhook`
   - Verify token: mismo valor del paso 5.
3. Suscríbete al campo **messages**.

---

## 9. Verificar el despliegue

### Comprobar que las funciones están activas

```bash
firebase functions:list
```

### Ver logs en tiempo real

```bash
firebase functions:log --only autoResponder
firebase functions:log --only whatsappWebhook
```

### Prueba manual del webhook de verificación

```bash
curl "https://REGION-PROJECT_ID.cloudfunctions.net/whatsappWebhook\
?hub.mode=subscribe\
&hub.verify_token=tu_token_secreto_aqui\
&hub.challenge=test123"
# Debe responder: test123
```

---

## 10. Actualizar solo las functions (re-deploy parcial)

Después de cualquier cambio en la carpeta `functions/`:

```bash
firebase deploy --only functions
```

Para desplegar solo una función específica:

```bash
firebase deploy --only functions:autoResponder
firebase deploy --only functions:whatsappWebhook
```

---

## Resumen de la arquitectura

```
Meta (WhatsApp/Instagram/Messenger)
    │  POST mensaje entrante
    ▼
[Cloud Function: whatsappWebhook / instagramWebhook / messengerWebhook]
    │  Guarda mensaje en Firestore
    │  organizations/{orgId}/conversations/{convId}/messages/{msgId}
    │  direction: 'incoming'
    ▼
[Cloud Function: autoResponder]  ← Firestore trigger
    │  Verifica aiEnabled en la conversación
    │  Busca agente IA activo para el canal
    │  Carga knowledge base (filtrada por palabras clave, máx 30 filas)
    │  Llama a OpenAI / Anthropic con API key de Firestore
    │  Guarda respuesta en messages (direction: 'outgoing')
    ▼
Firestore  →  Frontend (app.js, onSnapshot)  →  UI del agente en tiempo real
```

---

## Notas importantes

- **Admin SDK y reglas de Firestore:** Las Cloud Functions usan el Admin SDK, que omite las reglas de seguridad de Firestore. Las reglas en `firestore.rules` solo aplican al frontend (SDK del navegador).
- **API keys de IA:** Se almacenan en `organizations/{orgId}/aiAgents/{agentId}.apiKey` en Firestore. Cada organización gestiona sus propias claves desde la sección "Agentes IA" de la interfaz.
- **Plan Blaze:** Obligatorio para ejecutar Cloud Functions. Firebase no cobra por las invocaciones hasta cierto volumen gratuito mensual, pero el plan de pago es un requisito.
- **Región:** Las funciones se despliegan en `us-central1` por defecto. Para cambiarla, edita `functions/index.js` y especifica la región en cada función con la opción `region`.
