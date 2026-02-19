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
// Motor de búsqueda semántica para autopartes
// ---------------------------------------------------------------------------

// Diccionario bidireccional: términos del usuario ↔ abreviaturas de la KB.
const AUTOPARTE_EXPANSIONS = {
    'electrico':     ['elec', 'elect'],
    'eléctrico':     ['elec', 'elect'],
    'electrica':     ['elec', 'elect'],
    'eléctrica':     ['elec', 'elect'],
    'electric':      ['elec', 'elect'],
    'manual':        ['man'],
    'derecho':       ['r', 'der', 'dcho', 'dere'],
    'derecha':       ['r', 'der', 'dcha', 'dere'],
    'right':         ['r', 'der'],
    'izquierdo':     ['l', 'izq', 'izqdo'],
    'izquierda':     ['l', 'izq', 'izqda'],
    'left':          ['l', 'izq'],
    'delantero':     ['del', 'front', 'frt', 'delan'],
    'delantera':     ['del', 'front', 'frt', 'delan'],
    'delanteros':    ['del'],
    'delanteras':    ['del'],
    'trasero':       ['tras', 'tra', 'rear', 'post'],
    'trasera':       ['tras', 'tra', 'rear', 'post'],
    'traseros':      ['tras'],
    'traseras':      ['tras'],
    'front':         ['del', 'frt'],
    'rear':          ['tras', 'tra'],
    'direccional':   ['direcc', 'direc', 'c/direcc', 'c/direc'],
    'direccionales': ['direcc', 'c/direcc'],
    'pintar':        ['p/pintar', 'p/p'],
    'pintada':       ['p/pintar', 'p/p'],
    'pintura':       ['p/pintar', 'p/p'],
    'texturizado':   ['text', 'textu'],
    'texturizada':   ['text', 'textu'],
    'textured':      ['text'],
    'autoabatible':  ['autoab', 'e/abatible'],
    'autofold':      ['autoab', 'e/abatible'],
    'abatible':      ['autoab', 'e/abatible', 'abatible'],
    'control':       ['c/cont', 'cont'],
    'controlable':   ['c/cont'],
    // Expansión inversa
    'elec':          ['electrico', 'eléctrico'],
    'elect':         ['electrico', 'eléctrico'],
    'man':           ['manual'],
    'der':           ['derecho', 'derecha'],
    'izq':           ['izquierdo', 'izquierda'],
    'tras':          ['trasero', 'trasera'],
    'text':          ['texturizado', 'texturizada'],
    'autoab':        ['autoabatible', 'abatible'],
    'direcc':        ['direccional'],
    'cont':          ['control'],
};

/** Normaliza año de 2 dígitos a 4 dígitos. 00-29→2000s, 30-99→1900s */
function normalizeYear(twoDigitStr) {
    const n = parseInt(twoDigitStr, 10);
    return n <= 29 ? 2000 + n : 1900 + n;
}

/**
 * Extrae rangos de años (XX-XX o XXXX-XXXX) del texto de una fila.
 * @returns {{ from: number, to: number }[]}
 */
function extractYearRanges(text) {
    const ranges = [];
    const re = /(?<!\d)(\d{2}|\d{4})-(\d{2}|\d{4})(?!\d)/g;
    let m;
    while ((m = re.exec(text)) !== null) {
        let from = parseInt(m[1], 10);
        let to   = parseInt(m[2], 10);
        if (from < 100) from = normalizeYear(m[1]);
        if (to   < 100) to   = normalizeYear(m[2]);
        if (from >= 1930 && to <= 2030 && from <= to) ranges.push({ from, to });
    }
    return ranges;
}

/**
 * Detecta años en la consulta del usuario (4 dígitos o 2 dígitos solos).
 * NO interpreta rangos XX-XX como años separados.
 * @returns {number[]}
 */
function extractQueryYears(text) {
    const years = new Set();
    const re4 = /\b(19[3-9]\d|20[0-2]\d)\b/g;
    let m;
    while ((m = re4.exec(text)) !== null) years.add(parseInt(m[1], 10));
    const re2 = /(?:^|[\s,\/])(\d{2})(?:[\s,\/]|$)/g;
    while ((m = re2.exec(text)) !== null) years.add(normalizeYear(m[1]));
    return [...years];
}

/**
 * Expande los términos del usuario con el diccionario de abreviaturas.
 * @returns {{ terms: Set<string>, years: number[] }}
 */
function expandSearchTerms(text) {
    if (!text) return { terms: new Set(), years: [] };

    const stopwords = new Set([
        'el','la','los','las','un','una','unos','unas','en',
        'con','por','para','que','qué','es','son','hay','tiene','tienen',
        'me','te','se','le','lo','y','o','a','e','i','u',
        'como','cómo','si','no','sí','más','muy','también','ya','mi','tu',
        'su','this','the','is','are','do','does','what','how','have','has',
        'al','de',
    ]);

    const years  = extractQueryYears(text);
    const tokens = text
        .toLowerCase()
        .split(/[\s,;.!?]+/)
        .map(t => t.trim())
        .filter(t => t.length > 0 && !stopwords.has(t));

    const terms = new Set();
    for (const token of tokens) {
        if (/^\d{4}$/.test(token) && parseInt(token) >= 1930 && parseInt(token) <= 2030) continue;
        if (/^\d{2}$/.test(token)) continue;
        if (/[a-záéíóúüñ]/i.test(token)) terms.add(token);
        for (const exp of (AUTOPARTE_EXPANSIONS[token] || [])) terms.add(exp.toLowerCase());
    }
    return { terms, years };
}

/**
 * Calcula la relevancia de una fila.
 * - Tokens cortos (≤2 chars): token exacto para evitar falsos positivos
 *   ("R" no debe matchear "SIERRA" o "CORSA").
 * - Tokens largos (≥3 chars): subcadena.
 * - Años: verifica rangos XX-XX en la descripción.
 *
 * @param {object}      row
 * @param {Set<string>} terms
 * @param {number[]}    years
 * @returns {number}
 */
function scoreRow(row, terms, years) {
    const rowText = Object.values(row).map(v => String(v ?? '')).join(' ').toLowerCase();
    const rowTokens = new Set(
        rowText.split(/\s+/).map(t => t.replace(/^[.,;:()\[\]]+|[.,;:()\[\]]+$/g, ''))
    );

    let score = 0;
    for (const term of terms) {
        if (term.length <= 2) {
            if (rowTokens.has(term)) score += (term.length === 1 ? 4 : 2);
        } else {
            if (rowText.includes(term)) score += 1;
        }
    }

    if (years.length > 0) {
        const ranges = extractYearRanges(rowText);
        const anyMatch = years.some(y => ranges.some(r => y >= r.from && y <= r.to));
        if (anyMatch) {
            score += 5;
        } else if (score > 0 && ranges.length > 0) {
            score = Math.max(0, score - 1);
        }
    }
    return score;
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
    expandSearchTerms,
    scoreRow,
};
