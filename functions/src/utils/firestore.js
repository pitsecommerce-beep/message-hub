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
    // Las integraciones viven dentro de organizations/{orgId}/integrations.
    // Extraemos el orgId del path del documento (parent es la colección
    // "integrations", parent.parent es el doc de la organización).
    const orgId = integDoc.ref.parent.parent?.id;
    if (!orgId) return null;

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
 * Los agentes se guardan dentro de organizations/{orgId}/aiAgents.
 * El campo de activación es "active" (boolean) y los canales son un array.
 *
 * @param {string} orgId
 * @param {string} platform
 * @returns {{ id: string, ...agentData } | null}
 */
async function findAgentForPlatform(orgId, platform) {
    const snapshot = await db
        .collection('organizations').doc(orgId)
        .collection('aiAgents')
        .where('active', '==', true)
        .get();

    const agent = snapshot.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .find(a => Array.isArray(a.channels) && a.channels.includes(platform));

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
    const rowsRef = db
        .collection('organizations').doc(orgId)
        .collection('knowledgeBases').doc(kbId)
        .collection('rows');

    const snapshot = await rowsRef.get();
    const rows = [];
    snapshot.forEach(doc => rows.push({ id: doc.id, ...doc.data() }));
    return rows;
}

// ---------------------------------------------------------------------------
// Contactos
// ---------------------------------------------------------------------------

/**
 * Crea o actualiza un contacto cuando la IA recibe datos del cliente.
 *
 * Si el contactId de la conversación apunta a un documento real de Firestore,
 * lo actualiza. Si no (o si era un ID externo como número de teléfono),
 * crea un nuevo contacto y vincula la conversación al nuevo documento.
 *
 * @param {string} orgId
 * @param {string} convId
 * @param {{ name: string, company?: string, phone?: string, email?: string,
 *           address?: string, rfc?: string, notes?: string }} contactData
 * @returns {{ success: boolean, action?: 'created'|'updated', name?: string, message?: string }}
 */
async function saveOrUpdateContact(orgId, convId, contactData) {
    const convDoc = await db
        .collection('organizations').doc(orgId)
        .collection('conversations').doc(convId)
        .get();

    if (!convDoc.exists) return { success: false, message: 'Conversación no encontrada' };

    const conv = convDoc.data();
    const data = { ...contactData };
    if (data.rfc) data.rfc = data.rfc.toUpperCase();

    // Verificar si el contactId ya apunta a un documento real de Firestore
    const existingContactId = conv.contactId;
    let isRealContact = false;
    if (existingContactId) {
        const contactDoc = await db
            .collection('organizations').doc(orgId)
            .collection('contacts').doc(existingContactId)
            .get();
        isRealContact = contactDoc.exists;
    }

    if (isRealContact) {
        await db
            .collection('organizations').doc(orgId)
            .collection('contacts').doc(existingContactId)
            .update({ ...data, updatedAt: FieldValue.serverTimestamp() });
        return { success: true, action: 'updated', name: data.name, contactId: existingContactId };
    }

    // ── Deduplicación por teléfono ──────────────────────────────────────────
    // Antes de crear un contacto nuevo, verificar si ya existe uno con el
    // mismo número de teléfono en la organización.
    const phone = data.phone || conv.contactPhone || '';
    if (phone) {
        const phoneSnap = await db
            .collection('organizations').doc(orgId)
            .collection('contacts')
            .where('phone', '==', phone)
            .limit(1)
            .get();

        if (!phoneSnap.empty) {
            const existingDoc = phoneSnap.docs[0];
            await existingDoc.ref.update({ ...data, updatedAt: FieldValue.serverTimestamp() });
            // Vincular la conversación al contacto existente
            await db
                .collection('organizations').doc(orgId)
                .collection('conversations').doc(convId)
                .update({
                    contactId:    existingDoc.id,
                    contactName:  data.name || existingDoc.data().name,
                    contactPhone: phone,
                });
            return { success: true, action: 'updated', name: data.name, contactId: existingDoc.id };
        }
    }

    // ── Crear contacto nuevo ────────────────────────────────────────────────
    const docRef = await db
        .collection('organizations').doc(orgId)
        .collection('contacts')
        .add({
            ...data,
            phone,
            funnelStage: 'curioso',
            createdAt:   FieldValue.serverTimestamp(),
            updatedAt:   FieldValue.serverTimestamp(),
        });
    await db
        .collection('organizations').doc(orgId)
        .collection('conversations').doc(convId)
        .update({
            contactId:    docRef.id,
            contactName:  data.name,
            contactPhone: phone,
        });
    return { success: true, action: 'created', name: data.name, contactId: docRef.id };
}

// ---------------------------------------------------------------------------
// Detección de categoría "parte" a partir del mensaje del cliente
// ---------------------------------------------------------------------------

/**
 * Mapa de valores exactos de la columna "parte" → keywords que el cliente
 * podría usar para referirse a esa categoría.
 * Las frases más largas (multi-palabra) puntúan más alto en detectParte().
 */
const PARTE_KEYWORDS = {
    'ALERONES':                           ['aleron', 'alerón', 'wing'],
    'ANTIMPACTOS':                        ['antimpacto', 'anti impacto'],
    'BANDAS DEFENSA':                     ['banda defensa', 'tira defensa'],
    'BASE FARO':                          ['base faro', 'soporte faro', 'bracket faro'],
    'BISAGRAS':                           ['bisagra', 'gozne', 'hinge'],
    'BISEL FARO':                         ['bisel faro', 'aro faro', 'marco faro'],
    'BISEL FARO NIEBLA':                  ['bisel faro niebla', 'bisel niebla'],
    'BISEL MANIJA':                       ['bisel manija'],
    'BRACKS':                             ['brack', 'bracket', 'soporte'],
    'CALAVERAS':                          ['calavera', 'stop', 'luz trasera', 'faro trasero'],
    'CARCASA DE ESPEJO':                  ['carcasa espejo', 'concha espejo', 'tapa espejo', 'carcasa retrovisor'],
    'CHAPAS':                             ['chapa', 'cerradura', 'lock'],
    'CHICOTE TAPA BATEA':                 ['chicote', 'cable batea', 'jalador batea'],
    'COFRES':                             ['cofre', 'capo', 'capó', 'hood', 'cofre motor'],
    'CORAZAS':                            ['coraza', 'protector puerta'],
    'COSTADOS':                           ['costado'],
    'CUARTOS FRONTAL':                    ['cuarto frontal', 'cuarto delantero frontal'],
    'CUARTOS LATERALES':                  ['cuarto lateral'],
    'CUARTOS PUNTA':                      ['cuarto punta'],
    'CUARTOS TRASEROS':                   ['cuarto trasero'],
    'DEFENSAS DELANTERAS':                ['defensa delantera', 'defensa frontal', 'bumper delantero', 'defensa del frente'],
    'DEFENSAS TRASERAS':                  ['defensa trasera', 'bumper trasero', 'defensa posterior'],
    'DEPOSITO LIMPIA PARABRISAS':         ['deposito limpia', 'deposito limpiaparabrisas', 'botella agua limpia', 'tanque limpia'],
    'DEPOSITO RECUPERADOR':               ['deposito recuperador', 'tanque recuperador'],
    'ELEVADORES':                         ['elevador', 'elevavidrio', 'regulador vidrio', 'motor vidrio', 'sube baja vidrio'],
    'ESPEJOS':                            ['espejo', 'retrovisor', 'mirror'],
    'FAROS':                              ['faro delantero', 'faro frontal', 'faro principal', 'optico', 'headlight'],
    'FAROS NIEBLA':                       ['faro niebla', 'luz niebla', 'neblinero', 'fog light', 'antiniebla', 'niebla'],
    'FASCIAS DELANTERAS':                 ['fascia delantera', 'fascia frontal', 'fascia del'],
    'FASCIAS TRASERAS':                   ['fascia trasera', 'fascia pos', 'fascia posterior'],
    'FOCOS':                              ['foco', 'bombilla', 'bulbo', 'bulb', 'lamp', 'ampolleta'],
    'FILTROS':                            ['filtro', 'filter'],
    'GUIAS FASCIA':                       ['guia fascia', 'guía fascia', 'guia de fascia'],
    'LUNA ESPEJO':                        ['luna espejo', 'cristal espejo', 'vidrio espejo', 'luna retrovisor'],
    'MANIJAS ELEVADOR':                   ['manija elevador', 'tirador ventana', 'manija sube vidrio'],
    'MANIJAS EXTERIORES':                 ['manija exterior', 'jaladera exterior', 'handle exterior', 'tirador puerta exterior'],
    'MANIJAS INTERIORES':                 ['manija interior', 'jaladera interior', 'handle interior', 'tirador interior'],
    'MANIJAS TAPA BATEA':                 ['manija batea', 'jaladera batea', 'manija tapa batea'],
    'MARCOS PARRILLA':                    ['marco parrilla', 'marco de parrilla'],
    'MARCOS RADIADOR':                    ['marco radiador', 'marco de radiador'],
    'MOLDURAS ARCO':                      ['moldura arco', 'moldura rueda', 'arco rueda', 'moldura guardalodo'],
    'MOLDURAS FARO':                      ['moldura faro', 'moldura de faro'],
    'MOLDURAS FASCIA':                    ['moldura fascia', 'moldura de fascia'],
    'MOLDURAS PARRILLA':                  ['moldura parrilla', 'moldura de parrilla'],
    'MOLDURAS PARRILLA FASCIA':           ['moldura parrilla fascia'],
    'MOLDURA PUERTA':                     ['moldura puerta', 'moldura lateral puerta', 'moldura de puerta'],
    'MOTOVENTILADORES':                   ['motoventilador', 'electroventilador', 'ventilador motor', 'fan motor', 'electroventi'],
    'PARRILLAS':                          ['parrilla', 'grille', 'rejilla frontal'],
    'PARRILLAS DE FASCIA':                ['parrilla fascia', 'rejilla fascia', 'parrilla de fascia'],
    'PORTA PLACAS':                       ['porta placa', 'portaplaca', 'marco placa', 'porta placa'],
    'PRODUCTOS SPORT':                    ['sport', 'deportivo', 'tuning'],
    'PRODUCTOS TRACTOCAMION':             ['tractocamion', 'tractocamión', 'tracto camion', 'trailer', 'camion pesado'],
    'PUERTAS':                            ['puerta', 'door', 'panel puerta'],
    'RADIADORES':                         ['radiador', 'radiator'],
    'REFUERZOS DEFENSA DELANTEROS':       ['refuerzo defensa delantera', 'refuerzo delantero', 'reinforcement delantero'],
    'REFUERZOS DEFENSA TRASEROS':         ['refuerzo defensa trasera', 'refuerzo trasero', 'reinforcement trasero'],
    'SALPICADERAS':                       ['salpicadera', 'fender', 'aleta', 'guardafango'],
    'SETS':                               ['set de', 'kit de', 'juego de', 'par de'],
    'SPOILERS':                           ['spoiler', 'alerón trasero', 'aleron trasero'],
    'TANQUES DE GASOLINA':                ['tanque gasolina', 'deposito gasolina', 'tanque combustible', 'tanque de gasolina'],
    'TAPAS DE BATEA / TAPAS  CAJUELA':    ['tapa batea', 'tapa cajuela', 'tapa maletero', 'cajuela', 'batea'],
    'TAPA DEFENSA DELANTERA':             ['tapa defensa delantera'],
    'TAPA FASCIA DELANTERA':              ['tapa fascia delantera'],
    'TAPA GUANTERA':                      ['tapa guantera', 'guantera'],
    'TAPON DE LLANTA':                    ['tapon llanta', 'tapa llanta', 'embellecedor', 'wheel cover', 'tapon rueda'],
    'TOLVAS DE COSTADO':                  ['tolva costado', 'tolva de costado'],
    'TOLVAS SALPICADERA':                 ['tolva salpicadera'],
    'TOLVAS CALAVERAS':                   ['tolva calavera', 'tolva stop'],
    'TOLVA INFERIOR MOTOR':               ['tolva inferior motor', 'tolva inferior', 'protector inferior motor', 'under cover'],
    'TOLVAS SUPERIOR DEFENSA':            ['tolva superior defensa'],
    'TOLVAS RADIADOR':                    ['tolva radiador'],
};

/**
 * Detecta la categoría "parte" más probable a partir del texto del usuario.
 * Usa matching de subcadena; las frases multi-palabra puntúan más alto.
 * Costo: cero tokens de IA — se ejecuta localmente antes de llamar a Firestore.
 *
 * @param {string} text  - Mensaje del usuario
 * @returns {string|null} - Valor exacto de la columna "parte", o null si no detectado
 */
function detectParte(text) {
    if (!text) return null;
    const norm = text.toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, ''); // strip accents

    let bestParte = null;
    let bestScore = 0;

    for (const [parte, keywords] of Object.entries(PARTE_KEYWORDS)) {
        let score = 0;
        for (const kw of keywords) {
            const normKw = kw.toLowerCase()
                .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
            if (norm.includes(normKw)) {
                // Multi-word phrases score higher → better specificity
                score += normKw.split(/\s+/).length;
            }
        }
        if (score > bestScore) {
            bestScore = score;
            bestParte = parte;
        }
    }

    return bestScore > 0 ? bestParte : null;
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
    'copiloto':      ['r', 'der', 'dcho', 'dere'],
    'izquierdo':     ['l', 'izq', 'izqdo'],
    'izquierda':     ['l', 'izq', 'izqda'],
    'left':          ['l', 'izq'],
    'piloto':        ['l', 'izq', 'izqdo'],
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

    // Normalización de plurales: "faros"→"faro", "espejos"→"espejo"
    const singulars = [];
    for (const term of terms) {
        if (term.length >= 4 && term.endsWith('s') && /[a-záéíóúüñ]/.test(term)) {
            singulars.push(term.slice(0, -1));
        }
    }
    for (const s of singulars) terms.add(s);

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
        const rangeMatch = years.some(y => ranges.some(r => y >= r.from && y <= r.to));
        const exactMatch = years.some(y => new RegExp(`(?<!\\d)${y}(?!\\d)`).test(rowText));
        if (rangeMatch || exactMatch) {
            score += 5;
        }
        // Eliminada la penalización: causaba falsos negativos cuando la KB
        // usa año distinto pero la pieza puede ser compatible.
    }
    return score;
}

// ---------------------------------------------------------------------------
// Pedidos (Orders)
// ---------------------------------------------------------------------------

/**
 * Genera un número de pedido secuencial para la organización.
 * @param {string} orgId
 * @returns {Promise<string>} e.g. "PED-00042"
 */
async function generateOrderNumber(orgId) {
    const snap = await db
        .collection('organizations').doc(orgId)
        .collection('orders')
        .count()
        .get();
    const count = snap.data().count || 0;
    return 'PED-' + String(count + 1).padStart(5, '0');
}

/**
 * Crea un pedido a partir de los datos enviados por el agente IA.
 *
 * @param {string} orgId
 * @param {string} convId     - ID de la conversación que originó el pedido
 * @param {object} orderData  - { items, notes, contactName? }
 * @returns {Promise<{ success: boolean, orderNumber?: string, total?: number, message?: string }>}
 */
async function createOrder(orgId, convId, orderData) {
    try {
        // ── Validar campos obligatorios del pedido ────────────────────────────
        const shippingAddress = (orderData.shippingAddress || '').trim();
        const workshopName    = (orderData.workshopName || '').trim();
        const requiresInvoice = orderData.requiresInvoice === true;
        const rfc             = (orderData.rfc || '').trim().toUpperCase();

        if (!shippingAddress) {
            return {
                success: false,
                message: 'Falta la dirección de envío. Pregunta al cliente su dirección completa antes de crear el pedido.',
            };
        }
        if (!workshopName) {
            return {
                success: false,
                message: 'Falta el nombre de taller o empresa. Pregunta al cliente el nombre de su taller antes de crear el pedido.',
            };
        }
        if (requiresInvoice && !rfc) {
            return {
                success: false,
                message: 'El cliente requiere factura pero falta el RFC. Pregunta al cliente su RFC antes de crear el pedido.',
            };
        }

        const convDoc = await db
            .collection('organizations').doc(orgId)
            .collection('conversations').doc(convId)
            .get();

        const conv = convDoc.exists ? convDoc.data() : {};

        // ── KB price lookup fallback ────────────────────────────────────────
        // If the agent didn't provide a unitPrice, try to look it up from KB
        // by matching the SKU against knowledge base rows.
        let kbPriceMap = null; // sku → { unitPrice, description }
        const rawItems = orderData.items || [];
        const needsLookup = rawItems.some(item => !item.unitPrice && item.sku);
        if (needsLookup) {
            try {
                // Find the agent's KB to look up prices
                const agentSnap = await db
                    .collection('organizations').doc(orgId)
                    .collection('aiAgents')
                    .where('active', '==', true)
                    .limit(1)
                    .get();

                if (!agentSnap.empty) {
                    const agent = agentSnap.docs[0].data();
                    const kbIds = agent.knowledgeBases || [];
                    if (kbIds.length > 0) {
                        const rows = await loadKBRows(orgId, kbIds[0]);
                        const kb = await loadKBMeta(orgId, kbIds[0]);
                        if (kb && rows.length > 0) {
                            const cols = kb.columns || [];
                            const colsLower = cols.map(c => c.toLowerCase());

                            // Detect price column
                            let priceCol = null;
                            for (const kw of ['precio_venta', 'precio venta', 'price', 'precio', 'pvp', 'venta', 'costo_venta']) {
                                const idx = colsLower.findIndex(c => c.includes(kw));
                                if (idx >= 0) { priceCol = cols[idx]; break; }
                            }
                            // Detect SKU column
                            let skuCol = null;
                            for (const kw of ['sku', 'codigo', 'código', 'code', 'clave', 'num_parte', 'parte_no']) {
                                const idx = colsLower.findIndex(c => c.includes(kw));
                                if (idx >= 0) { skuCol = cols[idx]; break; }
                            }
                            // Detect description column
                            let descCol = null;
                            for (const kw of ['descripcion', 'descripción', 'description', 'nombre', 'producto', 'product', 'name']) {
                                const idx = colsLower.findIndex(c => c.includes(kw));
                                if (idx >= 0) { descCol = cols[idx]; break; }
                            }

                            if (priceCol && skuCol) {
                                kbPriceMap = {};
                                for (const row of rows) {
                                    const sku = String(row[skuCol] || '').trim().toUpperCase();
                                    if (sku) {
                                        kbPriceMap[sku] = {
                                            unitPrice: Number(row[priceCol]) || 0,
                                            description: descCol ? String(row[descCol] || '') : '',
                                        };
                                    }
                                }
                            }
                        }
                    }
                }
            } catch (kbErr) {
                console.warn('[createOrder] KB price lookup failed:', kbErr.message);
            }
        }

        const items = rawItems.map(item => {
            let unitPrice = Number(item.unitPrice) || 0;
            let description = String(item.product || item.description || '');
            const sku = String(item.sku || '').trim();

            // Fallback: look up price/description from KB if not provided
            if (kbPriceMap && sku) {
                const kbEntry = kbPriceMap[sku.toUpperCase()];
                if (kbEntry) {
                    if (!unitPrice && kbEntry.unitPrice) unitPrice = kbEntry.unitPrice;
                    if (!description && kbEntry.description) description = kbEntry.description;
                }
            }

            const quantity = Number(item.quantity) || 1;
            return {
                sku,
                description,
                quantity,
                unitPrice,
                total: quantity * unitPrice,
                notes: String(item.notes || ''),
            };
        });

        const total = items.reduce((sum, i) => sum + i.total, 0);
        const orderNumber = await generateOrderNumber(orgId);

        // ── Resolve real contact ID ────────────────────────────────────────
        // Try conversation's contactId first; if it doesn't point to a real
        // contact document, fall back to a phone-based lookup.
        let contactId = conv.contactId || null;
        let contactName = orderData.contactName || conv.contactName || 'Cliente';
        let contactCompany = null;

        let contactDoc = null;
        if (contactId) {
            const ref = await db
                .collection('organizations').doc(orgId)
                .collection('contacts').doc(contactId)
                .get();
            if (ref.exists) contactDoc = ref;
        }

        // Fallback: search contact by phone if contactId wasn't a real doc
        if (!contactDoc && conv.contactPhone) {
            const phoneSnap = await db
                .collection('organizations').doc(orgId)
                .collection('contacts')
                .where('phone', '==', conv.contactPhone)
                .limit(1)
                .get();
            if (!phoneSnap.empty) {
                contactDoc = phoneSnap.docs[0];
                contactId = contactDoc.id;
                // Also fix the conversation reference for future operations
                await db
                    .collection('organizations').doc(orgId)
                    .collection('conversations').doc(convId)
                    .update({ contactId: contactDoc.id, contactName: contactDoc.data().name || contactName });
            }
        }

        if (contactDoc) {
            const cData = contactDoc.data();
            contactId = contactDoc.id;
            contactName = cData.name || contactName;
            contactCompany = cData.company || null;
        }

        if (!contactDoc) {
            return {
                success: false,
                message: 'No se encontró un contacto vinculado. Llama save_contact primero antes de crear el pedido.',
            };
        }

        await db
            .collection('organizations').doc(orgId)
            .collection('orders')
            .add({
                orderNumber,
                contactId,
                contactName,
                contactCompany,
                conversationId:  convId,
                platform:        conv.platform    || 'manual',
                items,
                total,
                shippingAddress,
                workshopName,
                requiresInvoice,
                rfc:             requiresInvoice ? rfc : '',
                status:    'pendiente',
                notes:     orderData.notes || '',
                createdAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp(),
                createdBy: 'ai'
            });

        return { success: true, orderNumber, total };
    } catch (err) {
        console.error('[createOrder] Error:', err);
        return { success: false, message: err.message };
    }
}

// ---------------------------------------------------------------------------
// Configuración de Evolution API
// ---------------------------------------------------------------------------

/**
 * Devuelve la configuración de Evolution API activa para una organización,
 * o null si no hay ninguna conectada.
 *
 * @param {string} orgId
 * @returns {Promise<{ evolutionApiUrl: string, evolutionApiKey: string, evolutionInstanceName: string } | null>}
 */
async function getEvolutionConfig(orgId) {
    const snap = await db
        .collection('organizations').doc(orgId)
        .collection('integrations')
        .where('platform', '==', 'whatsapp')
        .where('method', '==', 'evolution')
        .where('connected', '==', true)
        .limit(1)
        .get();

    if (snap.empty) return null;

    const data = snap.docs[0].data();
    if (!data.evolutionApiUrl || !data.evolutionApiKey || !data.evolutionInstanceName) {
        return null;
    }
    return {
        evolutionApiUrl:      data.evolutionApiUrl,
        evolutionApiKey:      data.evolutionApiKey,
        evolutionInstanceName: data.evolutionInstanceName,
    };
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
    saveOrUpdateContact,
    createOrder,
    getEvolutionConfig,
    detectParte,
    PARTE_KEYWORDS,
    expandSearchTerms,
    scoreRow,
};
