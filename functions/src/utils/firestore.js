/**
 * Utilidades de Firestore para Cloud Functions.
 * Centraliza consultas reutilizadas por webhooks y autoResponder.
 *
 * NOTA: Las Cloud Functions usan el Admin SDK, que omite las reglas de
 * seguridad de Firestore por diseño. No se requieren cambios en
 * firestore.rules para que estas funciones puedan leer/escribir.
 */
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const db = getFirestore();

// ---------------------------------------------------------------------------
// Búsqueda de organización por configuración de integración
// ---------------------------------------------------------------------------

/**
 * Busca qué organización tiene una integración con un valor específico.
 * Usa una collectionGroup query sobre la subcolección "integrations".
 *
 * Requiere un índice de grupo de colección en Firestore para el campo
 * buscado (phoneNumberId o pageId). Ver DEPLOY.md para crearlos.
 *
 * @param {string} fieldName  - Campo a buscar, p.ej. 'phoneNumberId' o 'pageId'
 * @param {string} fieldValue - Valor a buscar
 * @returns {{ id: string, ...orgData } | null}
 */
async function findOrgByIntegrationField(fieldName, fieldValue) {
    const snapshot = await db
        .collectionGroup('integrations')
        .where(fieldName, '==', fieldValue)
        .limit(1)
        .get();

    if (snapshot.empty) return null;

    const integDoc = snapshot.docs[0];
    // Ruta: organizations/{orgId}/integrations/{platform}
    const orgId = integDoc.ref.parent.parent.id;
    const orgDoc = await db.collection('organizations').doc(orgId).get();

    if (!orgDoc.exists) return null;
    return { id: orgId, ...orgDoc.data() };
}

// ---------------------------------------------------------------------------
// Conversaciones
// ---------------------------------------------------------------------------

/**
 * Busca una conversación abierta para un contacto en una plataforma.
 * Usa una sola condición de igualdad para evitar índices compuestos;
 * el filtro de platform y status se aplica en JavaScript.
 *
 * @param {string} orgId
 * @param {string} platform   - 'whatsapp' | 'instagram' | 'messenger'
 * @param {string} identifier - Teléfono (WA) o senderId (IG/MSG)
 * @returns {{ id: string, ...convData } | null}
 */
async function findOpenConversation(orgId, platform, identifier) {
    const field = platform === 'whatsapp' ? 'contactPhone' : 'contactId';

    const snapshot = await db
        .collection('organizations').doc(orgId)
        .collection('conversations')
        .where(field, '==', identifier)
        .get();

    const doc = snapshot.docs.find(d => {
        const data = d.data();
        return data.platform === platform && data.status === 'open';
    });

    return doc ? { id: doc.id, ...doc.data() } : null;
}

/**
 * Crea una nueva conversación con los datos del contacto entrante.
 *
 * @param {string} orgId
 * @param {string} platform
 * @param {{ id: string, name: string, phone?: string }} senderInfo
 * @returns {{ id: string, ...convData }}
 */
async function createConversation(orgId, platform, senderInfo) {
    const convData = {
        contactId:    senderInfo.id,
        contactName:  senderInfo.name || senderInfo.id,
        contactPhone: senderInfo.phone || '',
        contactEmail: '',
        platform,
        status:       'open',
        funnelStage:  'curioso',
        createdBy:    'webhook',
        createdAt:    FieldValue.serverTimestamp(),
        lastMessage:  '',
        lastMessageAt: FieldValue.serverTimestamp(),
        lastMessageBy: 'webhook',
        unreadCount:  1,
        aiEnabled:    true,
    };

    const convRef = await db
        .collection('organizations').doc(orgId)
        .collection('conversations')
        .add(convData);

    return { id: convRef.id, ...convData };
}

// ---------------------------------------------------------------------------
// Mensajes
// ---------------------------------------------------------------------------

/**
 * Guarda un mensaje entrante en la subcolección de mensajes y actualiza
 * los campos lastMessage / lastMessageAt de la conversación.
 *
 * @param {string} orgId
 * @param {string} convId
 * @param {{ text: string, sender: string, senderName: string, platform: string }} messageData
 * @returns {string} ID del nuevo documento de mensaje
 */
async function saveIncomingMessage(orgId, convId, messageData) {
    const msgRef = await db
        .collection('organizations').doc(orgId)
        .collection('conversations').doc(convId)
        .collection('messages')
        .add({
            text:       messageData.text,
            sender:     messageData.sender,
            senderName: messageData.senderName,
            platform:   messageData.platform,
            direction:  'incoming',
            timestamp:  FieldValue.serverTimestamp(),
            status:     'received',
        });

    await db
        .collection('organizations').doc(orgId)
        .collection('conversations').doc(convId)
        .update({
            lastMessage:   messageData.text,
            lastMessageAt: FieldValue.serverTimestamp(),
            unreadCount:   FieldValue.increment(1),
        });

    return msgRef.id;
}

// ---------------------------------------------------------------------------
// Agentes IA
// ---------------------------------------------------------------------------

/**
 * Busca el primer agente IA activo que tenga habilitado el canal indicado.
 *
 * @param {string} orgId
 * @param {string} platform
 * @returns {{ id: string, ...agentData } | null}
 */
async function findAgentForPlatform(orgId, platform) {
    const snapshot = await db
        .collection('organizations').doc(orgId)
        .collection('aiAgents')
        .where('isActive', '==', true)
        .get();

    const agent = snapshot.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .find(a => a.channels && a.channels[platform] === true);

    return agent || null;
}

// ---------------------------------------------------------------------------
// Knowledge Bases
// ---------------------------------------------------------------------------

/**
 * Carga los metadatos de una knowledge base.
 *
 * @param {string} orgId
 * @param {string} kbId
 * @returns {{ id: string, name: string, description: string, columns: string[] } | null}
 */
async function loadKBMeta(orgId, kbId) {
    const doc = await db
        .collection('organizations').doc(orgId)
        .collection('knowledgeBases').doc(kbId)
        .get();
    return doc.exists ? { id: doc.id, ...doc.data() } : null;
}

/**
 * Carga todas las filas de una knowledge base.
 *
 * @param {string} orgId
 * @param {string} kbId
 * @returns {object[]}
 */
async function loadKBRows(orgId, kbId) {
    const snapshot = await db
        .collection('organizations').doc(orgId)
        .collection('knowledgeBases').doc(kbId)
        .collection('rows')
        .get();

    const rows = [];
    snapshot.forEach(doc => rows.push({ id: doc.id, ...doc.data() }));
    return rows;
}

// ---------------------------------------------------------------------------
// Utilidades de texto
// ---------------------------------------------------------------------------

/**
 * Extrae palabras clave significativas de un texto (elimina stopwords comunes
 * en español e inglés).
 *
 * @param {string} text
 * @returns {string[]}
 */
function extractKeywords(text) {
    if (!text) return [];

    const stopwords = new Set([
        'el','la','los','las','un','una','unos','unas','de','del','al','en',
        'con','por','para','que','qué','es','son','hay','tiene','tienen',
        'cuánto','cuanto','me','te','se','le','lo','y','o','a','e','i','u',
        'como','cómo','si','no','sí','más','muy','también','ya','mi','tu',
        'su','this','the','is','are','do','does','what','how','have','has',
    ]);

    return text
        .toLowerCase()
        .replace(/[^a-záéíóúüñ0-9\s]/gi, ' ')
        .split(/\s+/)
        .filter(w => w.length > 2 && !stopwords.has(w));
}

module.exports = {
    db,
    FieldValue,
    findOrgByIntegrationField,
    findOpenConversation,
    createConversation,
    saveIncomingMessage,
    findAgentForPlatform,
    loadKBMeta,
    loadKBRows,
    extractKeywords,
};
