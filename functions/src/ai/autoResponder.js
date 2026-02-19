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
    FieldValue,
    findAgentForPlatform,
    loadKBMeta,
    loadKBRows,
    saveOrUpdateContact,
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

            // Filtrar y ordenar por relevancia semántica (máximo 7 filas)
            let rowsToInclude;
            if (terms.size > 0 || years.length > 0) {
                const scored = allRows
                    .map(row => ({ row, score: scoreRow(row, terms, years) }))
                    .filter(({ score }) => score > 0)
                    .sort((a, b) => b.score - a.score);
                rowsToInclude = scored.length > 0
                    ? scored.slice(0, 7).map(({ row }) => row)
                    : allRows.slice(0, 7);
            } else {
                rowsToInclude = allRows.slice(0, 7);
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

// ---------------------------------------------------------------------------
// Definición de herramientas para el agente IA
// ---------------------------------------------------------------------------

/** Devuelve las tool definitions disponibles en el autoResponder. */
function buildToolDefinitions() {
    return [{
        type: 'function',
        function: {
            name: 'save_contact',
            description: 'Guarda o actualiza los datos del contacto cuando el cliente proporciona su nombre, dirección, nombre del taller o empresa, RFC u otros datos personales. Úsala SIEMPRE que el cliente comparta cualquiera de estos datos.',
            parameters: {
                type: 'object',
                properties: {
                    name:    { type: 'string', description: 'Nombre completo del cliente o responsable' },
                    company: { type: 'string', description: 'Nombre del taller, empresa o negocio' },
                    phone:   { type: 'string', description: 'Número de teléfono' },
                    email:   { type: 'string', description: 'Correo electrónico' },
                    address: { type: 'string', description: 'Dirección completa' },
                    rfc:     { type: 'string', description: 'RFC para facturación fiscal' },
                    notes:   { type: 'string', description: 'Notas adicionales' },
                },
                required: ['name'],
            },
        },
    }];
}

// ---------------------------------------------------------------------------
// Llamadas a proveedores de IA (con soporte de herramientas)
// ---------------------------------------------------------------------------

/**
 * Llama a OpenAI. Si el modelo invoca save_contact, ejecuta la herramienta
 * y hace una segunda llamada para obtener el mensaje final al cliente.
 *
 * @param {object} agent
 * @param {string} systemPrompt
 * @param {object[]} messages
 * @param {object[]} tools
 * @param {string} orgId
 * @param {string} convId
 * @returns {Promise<string>}
 */
async function callOpenAI(agent, systemPrompt, messages, tools, orgId, convId) {
    const endpoint = (agent.provider === 'custom' && agent.endpoint)
        ? agent.endpoint
        : 'https://api.openai.com/v1/chat/completions';

    const body = {
        model:       agent.model,
        messages:    [{ role: 'system', content: systemPrompt }, ...messages],
        max_tokens:  1024,
        temperature: 0.7,
    };
    if (tools.length > 0) body.tools = tools;

    const res = await fetch(endpoint, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${agent.apiKey}` },
        body:    JSON.stringify(body),
    });

    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error?.message || `OpenAI error ${res.status}`);
    }

    const data   = await res.json();
    const choice = data.choices?.[0];

    // Manejar llamadas a herramientas
    if (choice?.finish_reason === 'tool_calls' || choice?.message?.tool_calls) {
        const toolResults = [];
        for (const tc of (choice.message.tool_calls || [])) {
            if (tc.function.name === 'save_contact') {
                const args   = JSON.parse(tc.function.arguments);
                const result = await saveOrUpdateContact(orgId, convId, args);
                toolResults.push({
                    role:         'tool',
                    tool_call_id: tc.id,
                    content: result.success
                        ? `Contacto ${result.action === 'created' ? 'creado' : 'actualizado'} correctamente: ${result.name}`
                        : `Error al guardar contacto: ${result.message}`,
                });
            }
        }
        if (toolResults.length > 0) {
            const res2 = await fetch(endpoint, {
                method:  'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${agent.apiKey}` },
                body: JSON.stringify({
                    model:    agent.model,
                    messages: [{ role: 'system', content: systemPrompt }, ...messages, choice.message, ...toolResults],
                    max_tokens:  1024,
                    temperature: 0.7,
                }),
            });
            if (!res2.ok) {
                const err2 = await res2.json().catch(() => ({}));
                throw new Error(err2.error?.message || `OpenAI error ${res2.status}`);
            }
            const data2 = await res2.json();
            return data2.choices?.[0]?.message?.content || '';
        }
    }

    return choice?.message?.content || '';
}

/**
 * Llama a Anthropic. Si el modelo invoca save_contact, ejecuta la herramienta
 * y hace una segunda llamada para obtener el mensaje final al cliente.
 *
 * @param {object} agent
 * @param {string} systemPrompt
 * @param {object[]} messages
 * @param {object[]} tools
 * @param {string} orgId
 * @param {string} convId
 * @returns {Promise<string>}
 */
async function callAnthropic(agent, systemPrompt, messages, tools, orgId, convId) {
    const anthropicMessages = messages.map(m => ({
        role:    m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content,
    }));

    const anthropicTools = tools.map(t => ({
        name:         t.function.name,
        description:  t.function.description,
        input_schema: t.function.parameters,
    }));

    const body = {
        model:       agent.model,
        max_tokens:  1024,
        system:      systemPrompt,
        messages:    anthropicMessages,
        ...(anthropicTools.length > 0 ? { tools: anthropicTools } : {}),
    };

    const res = await fetch('https://api.anthropic.com/v1/messages', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': agent.apiKey, 'anthropic-version': '2023-06-01' },
        body:    JSON.stringify(body),
    });

    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error?.message || `Anthropic error ${res.status}`);
    }

    const data          = await res.json();
    const toolUseBlocks = (data.content || []).filter(b => b.type === 'tool_use');

    if (toolUseBlocks.length > 0) {
        const toolResultContents = [];
        for (const tb of toolUseBlocks) {
            if (tb.name === 'save_contact') {
                const result = await saveOrUpdateContact(orgId, convId, tb.input);
                toolResultContents.push({
                    type:        'tool_result',
                    tool_use_id: tb.id,
                    content: result.success
                        ? `Contacto ${result.action === 'created' ? 'creado' : 'actualizado'} correctamente: ${result.name}`
                        : `Error al guardar contacto: ${result.message}`,
                });
            }
        }
        if (toolResultContents.length > 0) {
            const res2 = await fetch('https://api.anthropic.com/v1/messages', {
                method:  'POST',
                headers: { 'Content-Type': 'application/json', 'x-api-key': agent.apiKey, 'anthropic-version': '2023-06-01' },
                body: JSON.stringify({
                    model:    agent.model,
                    max_tokens: 1024,
                    system:   systemPrompt,
                    messages: [
                        ...anthropicMessages,
                        { role: 'assistant', content: data.content },
                        { role: 'user',      content: toolResultContents },
                    ],
                    ...(anthropicTools.length > 0 ? { tools: anthropicTools } : {}),
                }),
            });
            if (!res2.ok) {
                const err2 = await res2.json().catch(() => ({}));
                throw new Error(err2.error?.message || `Anthropic error ${res2.status}`);
            }
            const data2     = await res2.json();
            const textBlock = (data2.content || []).find(b => b.type === 'text');
            return textBlock?.text || '';
        }
    }

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

            // Herramientas disponibles para el agente
            const tools = buildToolDefinitions();

            // Llamar al proveedor de IA (la API key viene de Firestore)
            let aiResponse;
            if (agent.provider === 'anthropic') {
                aiResponse = await callAnthropic(agent, systemPrompt, history, tools, orgId, convId);
            } else {
                aiResponse = await callOpenAI(agent, systemPrompt, history, tools, orgId, convId);
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
