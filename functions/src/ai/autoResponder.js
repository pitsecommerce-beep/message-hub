/**
 * autoResponder — Trigger Firestore (2ª gen)
 *
 * Se activa cada vez que se crea un documento en:
 *   organizations/{orgId}/conversations/{convId}/messages/{msgId}
 *
 * Si el mensaje es entrante (del cliente) y la conversación tiene
 * aiEnabled: true, busca el agente IA asignado al canal, construye
 * el system prompt con datos filtrados de la knowledge base y llama
 * al proveedor de IA (OpenAI o Anthropic).
 *
 * La respuesta se guarda como nuevo mensaje con direction: 'outgoing'.
 */
const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { FieldValue } = require('firebase-admin/firestore');
const fetch = require('node-fetch');

const {
    db,
    findAgentForPlatform,
    loadKBMeta,
    loadKBRows,
    expandSearchTerms,
    scoreRow,
} = require('../utils/firestore');

// ---------------------------------------------------------------------------
// Construcción del system prompt con datos filtrados de KB
// ---------------------------------------------------------------------------

/**
 * Construye el system prompt del agente enriquecido con filas relevantes
 * de sus knowledge bases (máximo 30 filas por KB, filtradas por palabras
 * clave del mensaje del usuario; fallback a primeros 20 si no hay match).
 *
 * @param {{ systemPrompt: string, knowledgeBases: string[] }} agent
 * @param {string} orgId
 * @param {string} userMessage - Texto del mensaje del usuario
 * @returns {Promise<string>}
 */
async function buildSystemPrompt(agent, orgId, userMessage) {
    let prompt = agent.systemPrompt || '';

    const kbIds = agent.knowledgeBases || [];
    if (kbIds.length === 0) return prompt;

    const { terms, years } = expandSearchTerms(userMessage);

    prompt += '\n\n=== DATOS DE REFERENCIA ===\n';
    prompt += 'A continuación tienes los datos reales de tus bases de datos. '
        + 'SIEMPRE usa estos datos para responder preguntas sobre productos, '
        + 'precios, disponibilidad, etc.\n';
    prompt += 'NUNCA inventes datos. Si el cliente pregunta algo que no está '
        + 'en estos datos, dile que no tienes esa información disponible.\n\n';

    for (const kbId of kbIds) {
        try {
            const kb = await loadKBMeta(orgId, kbId);
            if (!kb) continue;

            prompt += `--- ${kb.name.toUpperCase()} ---\n`;
            if (kb.description) prompt += `(${kb.description})\n`;
            prompt += `Columnas: ${(kb.columns || []).join(' | ')}\n\n`;

            const allRows = await loadKBRows(orgId, kbId);

            if (allRows.length === 0) {
                prompt += '(Sin datos cargados en esta base)\n\n';
                continue;
            }

            const columns = kb.columns
                || Object.keys(allRows[0]).filter(k => k !== 'id');

            // Filtrar y ordenar por relevancia semántica (máximo 30 filas)
            let rowsToInclude;
            if (terms.size > 0 || years.length > 0) {
                const scored = allRows
                    .map(row => ({ row, score: scoreRow(row, terms, years) }))
                    .filter(({ score }) => score > 0)
                    .sort((a, b) => b.score - a.score);
                rowsToInclude = scored.length > 0
                    ? scored.slice(0, 30).map(({ row }) => row)
                    : allRows.slice(0, 20);
            } else {
                rowsToInclude = allRows.slice(0, 20);
            }

            prompt += `Total en base: ${allRows.length} registros `
                + `(mostrando ${rowsToInclude.length} relevantes)\n\n`;

            rowsToInclude.forEach((row, i) => {
                const parts = columns.map(col => `${col}: ${row[col] ?? ''}`);
                prompt += `${i + 1}. ${parts.join(' | ')}\n`;
            });

            prompt += '\n';
        } catch (err) {
            console.error(`[autoResponder] Error cargando KB ${kbId}:`, err);
        }
    }

    prompt += '=== FIN DE DATOS ===\n\n';
    prompt += 'INSTRUCCIONES IMPORTANTES:\n';
    prompt += '- Responde SIEMPRE basándote en los datos anteriores.\n';
    prompt += '- Si te preguntan precios, da el precio exacto de los datos.\n';
    prompt += '- Si un producto no está en los datos, dile al cliente que no '
        + 'lo tienes disponible.\n';
    prompt += '- Puedes mencionar productos similares que sí estén en los datos.\n';

    return prompt;
}

// ---------------------------------------------------------------------------
// Historial de conversación
// ---------------------------------------------------------------------------

/**
 * Carga los últimos N mensajes de la conversación para darle contexto a la IA.
 * El trigger ya escribió el mensaje entrante, por lo que está incluido en
 * el resultado y no es necesario añadirlo de nuevo.
 *
 * @param {string} orgId
 * @param {string} convId
 * @param {number} limit
 * @returns {Promise<{ role: 'user'|'assistant', content: string }[]>}
 */
async function loadConversationHistory(orgId, convId, limit = 10) {
    const snapshot = await db
        .collection('organizations').doc(orgId)
        .collection('conversations').doc(convId)
        .collection('messages')
        .orderBy('timestamp', 'asc')
        .limitToLast(limit)
        .get();

    const messages = [];
    snapshot.forEach(doc => {
        const d = doc.data();
        messages.push({
            role:    d.sender === 'agent' ? 'assistant' : 'user',
            content: d.text || '',
        });
    });
    return messages;
}

// ---------------------------------------------------------------------------
// Llamadas a proveedores de IA
// ---------------------------------------------------------------------------

/**
 * Llama a OpenAI (o endpoint compatible) y devuelve el texto de la respuesta.
 *
 * @param {{ apiKey: string, model: string, provider: string, endpoint?: string }} agent
 * @param {string} systemPrompt
 * @param {{ role: string, content: string }[]} messages
 * @returns {Promise<string>}
 */
async function callOpenAI(agent, systemPrompt, messages) {
    const endpoint = (agent.provider === 'custom' && agent.endpoint)
        ? agent.endpoint
        : 'https://api.openai.com/v1/chat/completions';

    const res = await fetch(endpoint, {
        method:  'POST',
        headers: {
            'Content-Type':  'application/json',
            'Authorization': `Bearer ${agent.apiKey}`,
        },
        body: JSON.stringify({
            model:       agent.model,
            messages:    [{ role: 'system', content: systemPrompt }, ...messages],
            max_tokens:  1024,
            temperature: 0.7,
        }),
    });

    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error?.message || `OpenAI error ${res.status}`);
    }

    const data = await res.json();
    return data.choices?.[0]?.message?.content || '';
}

/**
 * Llama a Anthropic y devuelve el texto de la respuesta.
 *
 * @param {{ apiKey: string, model: string }} agent
 * @param {string} systemPrompt
 * @param {{ role: string, content: string }[]} messages
 * @returns {Promise<string>}
 */
async function callAnthropic(agent, systemPrompt, messages) {
    const anthropicMessages = messages.map(m => ({
        role:    m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content,
    }));

    const res = await fetch('https://api.anthropic.com/v1/messages', {
        method:  'POST',
        headers: {
            'Content-Type':      'application/json',
            'x-api-key':         agent.apiKey,
            'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
            model:       agent.model,
            max_tokens:  1024,
            system:      systemPrompt,
            messages:    anthropicMessages,
        }),
    });

    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error?.message || `Anthropic error ${res.status}`);
    }

    const data = await res.json();
    const textBlock = (data.content || []).find(b => b.type === 'text');
    return textBlock?.text || '';
}

// ---------------------------------------------------------------------------
// Trigger principal
// ---------------------------------------------------------------------------

exports.autoResponder = onDocumentCreated(
    'organizations/{orgId}/conversations/{convId}/messages/{msgId}',
    async (event) => {
        const { orgId, convId, msgId } = event.params;
        const messageData = event.data?.data();

        if (!messageData) return null;

        // Solo mensajes entrantes (del cliente, no del agente)
        if (messageData.direction !== 'incoming' || messageData.sender === 'agent') {
            return null;
        }

        try {
            // Verificar que la conversación tenga IA habilitada
            const convDoc = await db
                .collection('organizations').doc(orgId)
                .collection('conversations').doc(convId)
                .get();

            if (!convDoc.exists) return null;

            const conv = convDoc.data();
            if (!conv.aiEnabled) return null;

            const platform = conv.platform;
            if (!platform) return null;

            // Buscar agente IA activo asignado a este canal
            const agent = await findAgentForPlatform(orgId, platform);
            if (!agent) {
                console.log(
                    `[autoResponder] Sin agente activo para platform="${platform}" `
                    + `en org="${orgId}"`
                );
                return null;
            }

            // Cargar historial (incluye el mensaje que acaba de llegar)
            const history = await loadConversationHistory(orgId, convId, 10);

            // Construir system prompt con KB filtrada por palabras clave
            const userText = messageData.text || '';
            const systemPrompt = await buildSystemPrompt(agent, orgId, userText);

            // Llamar al proveedor de IA (la API key viene de Firestore)
            let aiResponse;
            if (agent.provider === 'anthropic') {
                aiResponse = await callAnthropic(agent, systemPrompt, history);
            } else {
                aiResponse = await callOpenAI(agent, systemPrompt, history);
            }

            if (!aiResponse) {
                console.log(`[autoResponder] Respuesta vacía del proveedor para msg="${msgId}"`);
                return null;
            }

            // Guardar respuesta de la IA como mensaje saliente
            await db
                .collection('organizations').doc(orgId)
                .collection('conversations').doc(convId)
                .collection('messages')
                .add({
                    text:        aiResponse,
                    sender:      'agent',
                    senderName:  agent.name || 'Agente IA',
                    platform,
                    direction:   'outgoing',
                    timestamp:   FieldValue.serverTimestamp(),
                    status:      'sent',
                    generatedBy: 'ai',
                    agentId:     agent.id,
                });

            // Actualizar lastMessage en la conversación
            await db
                .collection('organizations').doc(orgId)
                .collection('conversations').doc(convId)
                .update({
                    lastMessage:   aiResponse.substring(0, 200),
                    lastMessageAt: FieldValue.serverTimestamp(),
                });

            console.log(
                `[autoResponder] Respuesta guardada para msg="${msgId}" `
                + `en conv="${convId}"`
            );
        } catch (err) {
            // Capturar todos los errores para no bloquear el trigger
            console.error(`[autoResponder] Error procesando msg="${msgId}":`, err);
        }

        return null;
    }
);
