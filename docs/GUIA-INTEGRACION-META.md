# Guia de Integracion con Meta - MessageHub

## Resumen

Esta guia detalla los pasos necesarios para conectar **WhatsApp Business API**, **Instagram Direct** y **Messenger** a MessageHub, permitiendo visualizar y responder todos los chats desde un solo lugar.

---

## Arquitectura General

```
                    +------------------+
                    |   Meta Platform  |
                    |  (Graph API)     |
                    +--------+---------+
                             |
                    Webhooks (HTTPS POST)
                             |
                    +--------v---------+
                    |  Backend Server  |
                    |  (Node.js/Cloud  |
                    |   Functions)     |
                    +--------+---------+
                             |
                    Firestore (Real-time)
                             |
                    +--------v---------+
                    |   MessageHub     |
                    |   (Frontend)     |
                    +------------------+
```

---

## Requisitos Previos

### 1. Cuenta de Meta Business Suite
- Crear una cuenta en [Meta Business Suite](https://business.facebook.com/)
- Verificar la empresa (puede tomar dias)

### 2. App de Meta para Desarrolladores
- Crear una app en [Meta for Developers](https://developers.facebook.com/)
- Tipo de app: **Business**
- Agregar los productos necesarios:
  - **WhatsApp** (para WhatsApp Business API)
  - **Messenger** (para Messenger y Instagram)

### 3. Backend/Servidor
- Un servidor con HTTPS (requerido por Meta para webhooks)
- Opciones recomendadas:
  - **Firebase Cloud Functions** (se integra nativamente con Firestore)
  - **Vercel Serverless Functions**
  - **AWS Lambda**
  - **Servidor Node.js propio** (Express)

### 4. Dominio con SSL
- Meta requiere endpoints HTTPS para los webhooks
- Si usas Firebase Cloud Functions, ya tienes HTTPS automaticamente

---

## Paso 1: Configurar la App de Meta

### 1.1 Crear la App
1. Ve a https://developers.facebook.com/apps/
2. Clic en "Crear App"
3. Selecciona "Business" como tipo
4. Completa: Nombre de la app, correo de contacto
5. Asocia tu cuenta de Meta Business Suite

### 1.2 Agregar Productos
En el panel de la app, agrega:
- **WhatsApp** → Para recibir/enviar mensajes de WhatsApp
- **Messenger** → Para recibir/enviar mensajes de Messenger e Instagram Direct

### 1.3 Obtener Credenciales
Anota estas credenciales (las necesitaras mas adelante):
- **App ID**: Se encuentra en Configuracion > Basica
- **App Secret**: Se encuentra en Configuracion > Basica
- **Access Token**: Se genera en cada producto

---

## Paso 2: WhatsApp Business API

### 2.1 Configurar WhatsApp
1. En tu app de Meta, ve a WhatsApp > Primeros pasos
2. Agrega un numero de telefono de prueba (o usa el de sandbox)
3. Genera un **Token de acceso permanente**

### 2.2 Configurar Webhook de WhatsApp
1. Ve a WhatsApp > Configuracion > Webhook
2. URL del callback: `https://TU-SERVIDOR.com/webhook/whatsapp`
3. Token de verificacion: Una cadena secreta que tu elijas (ej: `messagehub_verify_token_2024`)
4. Suscribirse a: `messages`, `message_deliveries`, `message_reads`

### 2.3 Endpoint del Webhook (Backend)

```javascript
// webhook-whatsapp.js
const express = require('express');
const admin = require('firebase-admin');

// Verificacion del webhook (GET)
app.get('/webhook/whatsapp', (req, res) => {
    const VERIFY_TOKEN = process.env.WA_VERIFY_TOKEN;
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
        res.status(200).send(challenge);
    } else {
        res.sendStatus(403);
    }
});

// Recibir mensajes (POST)
app.post('/webhook/whatsapp', async (req, res) => {
    const body = req.body;

    if (body.object === 'whatsapp_business_account') {
        for (const entry of body.entry) {
            for (const change of entry.changes) {
                if (change.field === 'messages') {
                    const value = change.value;
                    if (value.messages) {
                        for (const message of value.messages) {
                            await saveMessage({
                                platform: 'whatsapp',
                                from: message.from,
                                text: message.text?.body || '',
                                type: message.type,
                                timestamp: new Date(parseInt(message.timestamp) * 1000),
                                contactName: value.contacts?.[0]?.profile?.name || message.from,
                                messageId: message.id,
                                orgId: getOrgIdForPhone(value.metadata.display_phone_number)
                            });
                        }
                    }
                }
            }
        }
    }
    res.sendStatus(200);
});

// Guardar en Firestore
async function saveMessage(data) {
    const db = admin.firestore();
    const convRef = db.collection('organizations').doc(data.orgId)
        .collection('conversations');

    // Buscar o crear conversacion
    let convQuery = await convRef
        .where('contactPhone', '==', data.from)
        .where('platform', '==', 'whatsapp')
        .limit(1).get();

    let convId;
    if (convQuery.empty) {
        const newConv = await convRef.add({
            contactPhone: data.from,
            contactName: data.contactName,
            platform: 'whatsapp',
            lastMessage: data.text,
            lastMessageTime: data.timestamp,
            unreadCount: 1,
            status: 'active',
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        });
        convId = newConv.id;
    } else {
        convId = convQuery.docs[0].id;
        await convRef.doc(convId).update({
            lastMessage: data.text,
            lastMessageTime: data.timestamp,
            unreadCount: admin.firestore.FieldValue.increment(1)
        });
    }

    // Guardar mensaje
    await convRef.doc(convId).collection('messages').add({
        text: data.text,
        type: data.type,
        direction: 'incoming',
        timestamp: data.timestamp,
        messageId: data.messageId,
        platform: 'whatsapp'
    });
}
```

### 2.4 Enviar Mensajes por WhatsApp

```javascript
// Enviar mensaje de texto
async function sendWhatsAppMessage(to, text, phoneNumberId) {
    const response = await fetch(
        `https://graph.facebook.com/v18.0/${phoneNumberId}/messages`,
        {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.WA_ACCESS_TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                messaging_product: 'whatsapp',
                to: to,
                type: 'text',
                text: { body: text }
            })
        }
    );
    return response.json();
}
```

---

## Paso 3: Instagram Direct

### 3.1 Requisitos de Instagram
- Una cuenta de Instagram **Professional** (Business o Creator)
- La cuenta debe estar conectada a una pagina de Facebook
- La pagina debe estar asociada a tu Meta Business Suite

### 3.2 Configurar Webhook de Instagram
1. En tu app de Meta, ve a Messenger > Configuracion > Webhooks
2. URL del callback: `https://TU-SERVIDOR.com/webhook/instagram`
3. Token de verificacion: `messagehub_verify_token_2024`
4. Suscribirse a: `messages`, `messaging_postbacks`

### 3.3 Obtener Token de Pagina
```bash
# 1. Obtener token de usuario de larga duracion
curl "https://graph.facebook.com/v18.0/oauth/access_token?grant_type=fb_exchange_token&client_id=APP_ID&client_secret=APP_SECRET&fb_exchange_token=SHORT_LIVED_TOKEN"

# 2. Obtener token de pagina
curl "https://graph.facebook.com/v18.0/me/accounts?access_token=LONG_LIVED_USER_TOKEN"
```

### 3.4 Endpoint del Webhook (Backend)

```javascript
// webhook-instagram.js
app.post('/webhook/instagram', async (req, res) => {
    const body = req.body;

    if (body.object === 'instagram') {
        for (const entry of body.entry) {
            if (entry.messaging) {
                for (const event of entry.messaging) {
                    if (event.message) {
                        await saveMessage({
                            platform: 'instagram',
                            from: event.sender.id,
                            text: event.message.text || '',
                            type: event.message.attachments ? 'attachment' : 'text',
                            timestamp: new Date(event.timestamp),
                            messageId: event.message.mid,
                            orgId: getOrgIdForIGAccount(entry.id)
                        });
                    }
                }
            }
        }
    }
    res.sendStatus(200);
});
```

### 3.5 Enviar Mensajes por Instagram

```javascript
async function sendInstagramMessage(recipientId, text, pageAccessToken) {
    const response = await fetch(
        `https://graph.facebook.com/v18.0/me/messages`,
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                recipient: { id: recipientId },
                message: { text: text },
                access_token: pageAccessToken
            })
        }
    );
    return response.json();
}
```

---

## Paso 4: Messenger

### 4.1 Configurar Messenger
1. En tu app de Meta, ve a Messenger > Configuracion
2. Conecta tu pagina de Facebook
3. Genera un Token de Pagina

### 4.2 Configurar Webhook de Messenger
1. URL del callback: `https://TU-SERVIDOR.com/webhook/messenger`
2. Token de verificacion: `messagehub_verify_token_2024`
3. Suscribirse a: `messages`, `messaging_postbacks`, `message_deliveries`, `message_reads`

### 4.3 Endpoint del Webhook (Backend)

```javascript
// webhook-messenger.js
app.post('/webhook/messenger', async (req, res) => {
    const body = req.body;

    if (body.object === 'page') {
        for (const entry of body.entry) {
            if (entry.messaging) {
                for (const event of entry.messaging) {
                    if (event.message && !event.message.is_echo) {
                        await saveMessage({
                            platform: 'messenger',
                            from: event.sender.id,
                            text: event.message.text || '',
                            type: event.message.attachments ? 'attachment' : 'text',
                            timestamp: new Date(event.timestamp),
                            messageId: event.message.mid,
                            orgId: getOrgIdForPage(entry.id)
                        });
                    }
                }
            }
        }
    }
    res.sendStatus(200);
});
```

### 4.4 Enviar Mensajes por Messenger

```javascript
async function sendMessengerMessage(recipientId, text, pageAccessToken) {
    const response = await fetch(
        `https://graph.facebook.com/v18.0/me/messages`,
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                recipient: { id: recipientId },
                message: { text: text },
                access_token: pageAccessToken
            })
        }
    );
    return response.json();
}
```

---

## Paso 5: Estructura de Firestore

### Colecciones necesarias

```
organizations/{orgId}/
    ├── conversations/{convId}
    │   ├── contactName: string
    │   ├── contactPhone: string (para WA)
    │   ├── contactId: string (para IG/MSG)
    │   ├── platform: 'whatsapp' | 'instagram' | 'messenger'
    │   ├── lastMessage: string
    │   ├── lastMessageTime: timestamp
    │   ├── unreadCount: number
    │   ├── status: 'active' | 'resolved' | 'pending'
    │   ├── assignedTo: string (userId del agente)
    │   ├── createdAt: timestamp
    │   │
    │   └── messages/{msgId}
    │       ├── text: string
    │       ├── type: 'text' | 'image' | 'video' | 'audio' | 'document'
    │       ├── direction: 'incoming' | 'outgoing'
    │       ├── timestamp: timestamp
    │       ├── messageId: string (ID de la plataforma)
    │       ├── platform: string
    │       ├── sentBy: string (userId si es outgoing)
    │       └── mediaUrl: string (si aplica)
    │
    └── integrations/
        ├── whatsapp
        │   ├── connected: boolean
        │   ├── phoneNumberId: string
        │   ├── businessAccountId: string
        │   └── accessToken: string (encriptado)
        ├── instagram
        │   ├── connected: boolean
        │   ├── igAccountId: string
        │   ├── pageId: string
        │   └── pageAccessToken: string (encriptado)
        └── messenger
            ├── connected: boolean
            ├── pageId: string
            └── pageAccessToken: string (encriptado)
```

---

## Paso 6: Implementar en el Frontend

### 6.1 Escuchar Conversaciones en Tiempo Real

```javascript
// En app.js - Cargar conversaciones con Firestore listener
function listenToConversations(orgId) {
    const convRef = collection(db, 'organizations', orgId, 'conversations');
    const q = query(convRef, orderBy('lastMessageTime', 'desc'));

    onSnapshot(q, (snapshot) => {
        const conversations = [];
        snapshot.forEach(doc => {
            conversations.push({ id: doc.id, ...doc.data() });
        });
        renderConversationsList(conversations);
    });
}
```

### 6.2 Escuchar Mensajes de una Conversacion

```javascript
function listenToMessages(orgId, convId) {
    const msgRef = collection(db, 'organizations', orgId,
        'conversations', convId, 'messages');
    const q = query(msgRef, orderBy('timestamp', 'asc'));

    onSnapshot(q, (snapshot) => {
        const messages = [];
        snapshot.forEach(doc => {
            messages.push({ id: doc.id, ...doc.data() });
        });
        renderMessages(messages);
    });
}
```

### 6.3 Enviar Respuesta

```javascript
async function sendReply(orgId, convId, text) {
    // 1. Obtener datos de la conversacion
    const convDoc = await getDoc(doc(db, 'organizations', orgId,
        'conversations', convId));
    const conv = convDoc.data();

    // 2. Llamar al backend para enviar via la plataforma
    const response = await fetch('/api/send-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            orgId,
            convId,
            platform: conv.platform,
            to: conv.contactPhone || conv.contactId,
            text
        })
    });

    // 3. El backend guardara el mensaje en Firestore
    // y el listener en tiempo real lo mostrara automaticamente
}
```

---

## Paso 7: Backend Completo (Firebase Cloud Functions)

### 7.1 Instalar dependencias

```bash
cd functions
npm install firebase-admin firebase-functions express cors
```

### 7.2 Estructura del backend

```
functions/
├── index.js          # Entry point
├── webhooks/
│   ├── whatsapp.js   # Webhook handler de WhatsApp
│   ├── instagram.js  # Webhook handler de Instagram
│   └── messenger.js  # Webhook handler de Messenger
├── api/
│   └── send-message.js  # API para enviar mensajes
└── utils/
    └── firestore.js     # Utilidades de Firestore
```

### 7.3 Deploy

```bash
firebase deploy --only functions
```

---

## Paso 8: Configurar Variables de Entorno

```bash
# En Firebase Cloud Functions
firebase functions:config:set \
  meta.app_id="TU_APP_ID" \
  meta.app_secret="TU_APP_SECRET" \
  meta.verify_token="messagehub_verify_token_2024" \
  whatsapp.access_token="TU_WA_ACCESS_TOKEN" \
  whatsapp.phone_number_id="TU_PHONE_NUMBER_ID" \
  instagram.page_access_token="TU_IG_PAGE_TOKEN" \
  messenger.page_access_token="TU_MSG_PAGE_TOKEN"
```

---

## Paso 9: Verificacion y Pruebas

### 9.1 Verificar Webhooks
1. Usa [Meta Webhook Tester](https://developers.facebook.com/tools/webhook/) para enviar eventos de prueba
2. Verifica que los mensajes llegan a Firestore
3. Verifica que la UI los muestra en tiempo real

### 9.2 Modo Sandbox
- WhatsApp: Usa el numero de sandbox proporcionado por Meta
- Instagram/Messenger: Usa cuentas de prueba

### 9.3 Produccion
1. Completa la verificacion de la app en Meta
2. Solicita los permisos necesarios:
   - `whatsapp_business_messaging`
   - `pages_messaging`
   - `instagram_basic`
   - `instagram_manage_messages`
3. Envia la app para revision de Meta

---

## Resumen de Endpoints Necesarios

| Endpoint | Metodo | Plataforma | Proposito |
|----------|--------|------------|-----------|
| `/webhook/whatsapp` | GET | WhatsApp | Verificacion |
| `/webhook/whatsapp` | POST | WhatsApp | Recibir mensajes |
| `/webhook/instagram` | GET | Instagram | Verificacion |
| `/webhook/instagram` | POST | Instagram | Recibir mensajes |
| `/webhook/messenger` | GET | Messenger | Verificacion |
| `/webhook/messenger` | POST | Messenger | Recibir mensajes |
| `/api/send-message` | POST | Todas | Enviar respuestas |

---

## Costos Estimados

- **WhatsApp Business API**: Las primeras 1,000 conversaciones/mes son gratis. Despues ~$0.05-0.15 USD por conversacion (varia por pais)
- **Instagram/Messenger API**: Gratis (sin limites de mensajes)
- **Firebase Cloud Functions**: El plan gratuito (Spark) incluye 125K invocaciones/mes
- **Firestore**: El plan gratuito incluye 50K lecturas y 20K escrituras/dia

---

## Proximos Pasos

1. [ ] Crear app en Meta for Developers
2. [ ] Configurar Firebase Cloud Functions como backend
3. [ ] Implementar endpoints de webhooks
4. [ ] Configurar webhooks en Meta
5. [ ] Probar con el sandbox de WhatsApp
6. [ ] Implementar listeners en tiempo real en el frontend
7. [ ] Agregar la UI de chat (enviar/recibir mensajes)
8. [ ] Solicitar verificacion de la app en Meta
9. [ ] Deploy a produccion
