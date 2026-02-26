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
const fetch = require('node-fetch');

const {
    db,
    FieldValue,
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
    // Instrucción de herramientas (aplica con o sin KB)
    prompt += '\n\nREGLAS OBLIGATORIAS DE HERRAMIENTAS:\n'
           + '1. CONTACTO: Si el cliente dice su nombre o empresa en CUALQUIER mensaje → llama a save_contact DE INMEDIATO, sin esperar.\n'
           + '2. CONTACTO: Si llevas 2+ mensajes sin saber el nombre del cliente → pregúntaselo ("¿Con quién tengo el gusto?" o similar).\n'
           + '3. PEDIDO: SIEMPRE llama primero a save_contact y después a create_order. Nunca al revés.\n'
           + '4. save_contact se puede llamar varias veces para ir actualizando datos del cliente.';

    const kbIds = agent.knowledgeBases || [];
    if (kbIds.length === 0) return prompt;

    const { terms, years } = expandSearchTerms(userMessage);

    prompt += '\n\n=== DATOS DE REFERENCIA ===\n';
    prompt += 'A continuación tienes UNA MUESTRA PARCIAL de tus bases de datos. '
        + 'SIEMPRE usa estos datos para responder preguntas sobre productos, '
        + 'precios, disponibilidad, etc.\n';
    prompt += 'IMPORTANTE: Estos datos son una muestra — NO representan el inventario completo. '
        + 'Si el cliente pregunta por un producto que no aparece aquí, NO asumas que no existe: '
        + 'DEBES llamar a query_database para verificarlo antes de responder.\n'
        + 'NUNCA inventes precios ni datos.\n\n';

    for (const kbId of kbIds) {
        try {
            const kb = await loadKBMeta(orgId, kbId);
            if (!kb) continue;

            prompt += `--- ${kb.name.toUpperCase()} ---\n`;
            if (kb.description) prompt += `(${kb.description})\n`;
            prompt += `Columnas: ${(kb.columns || []).join(' | ')}\n\n`;

            const rows = await loadKBRows(orgId, kbId);

            if (rows.length === 0) {
                prompt += '(Sin datos cargados en esta base)\n\n';
                continue;
            }

            const columns = kb.columns || Object.keys(rows[0]).filter(k => k !== 'id');

            const PROMPT_MAX_ROWS = 15;
            const FALLBACK_ROWS  = 15;
            let rowsToInclude;
            if (terms.size > 0 || years.length > 0) {
                const scored = rows
                    .map(row => ({ row, score: scoreRow(row, terms, years) }))
                    .sort((a, b) => b.score - a.score);
                // Only include rows that actually matched (score > 0) — reduces token waste.
                // If nothing matched fall back to the first FALLBACK_ROWS rows as context.
                const matched = scored.filter(({ score }) => score > 0).slice(0, PROMPT_MAX_ROWS);
                rowsToInclude = matched.length > 0
                    ? matched.map(({ row }) => row)
                    : rows.slice(0, FALLBACK_ROWS);
            } else {
                rowsToInclude = rows.slice(0, PROMPT_MAX_ROWS);
            }

            prompt += `Mostrando ${rowsToInclude.length} de ${rows.length} registros relevantes:\n\n`;

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
    prompt += '- OBLIGATORIO: Si el cliente pregunta por una pieza o producto y no lo ves en los datos de arriba, DEBES llamar a query_database de inmediato para buscarlo. NUNCA respondas "no contamos con esa pieza", "no la tenemos" o similar sin haber llamado primero a query_database y comprobado que realmente no existe.\n';
    prompt += '- Si el cliente no mencionó una categoría específica, puedes preguntar qué tipo de parte necesita.\n';
    prompt += '- Puedes mencionar productos similares que sí estén en los datos.\n';
    prompt += '- Si el cliente da su nombre o empresa en cualquier momento, llama a save_contact de inmediato.\n';

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

/**
 * Devuelve las tool definitions disponibles en el autoResponder.
 * @param {object} agent - Documento del agente (para obtener knowledgeBases)
 */
function buildToolDefinitions(agent) {

    const tools = [
        {
            type: 'function',
            function: {
                name: 'save_contact',
                description: 'Registra o actualiza los datos del cliente en el CRM. LLÁMALA INMEDIATAMENTE cuando el cliente mencione su nombre, empresa, taller o cualquier dato personal — no esperes a que haga un pedido. Si llevas varios mensajes sin saber el nombre del cliente, pregúntaselo y en cuanto lo dé, llama a esta función.',
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
        },
        {
            type: 'function',
            function: {
                name: 'create_order',
                description: 'Crea un nuevo pedido cuando el cliente confirma los productos que desea comprar. Úsala SIEMPRE que el cliente confirme su pedido indicando productos y/o cantidades. Incluye el precio si lo conoces.',
                parameters: {
                    type: 'object',
                    properties: {
                        items: {
                            type: 'array',
                            description: 'Lista de productos del pedido',
                            items: {
                                type: 'object',
                                properties: {
                                    product:   { type: 'string', description: 'Nombre del producto o servicio' },
                                    sku:       { type: 'string', description: 'SKU o código del producto tal como aparece en la base de datos' },
                                    quantity:  { type: 'number', description: 'Cantidad solicitada' },
                                    unitPrice: { type: 'number', description: 'Precio unitario (sin símbolo de moneda)' },
                                    notes:     { type: 'string', description: 'Notas adicionales del producto' }
                                },
                                required: ['product', 'quantity']
                            }
                        },
                        notes: { type: 'string', description: 'Notas generales del pedido' }
                    },
                    required: ['items']
                },
            },
        },
    ];

    // Herramienta de consulta a KB — solo si el agente tiene KBs configuradas
    const kbIds = (agent && agent.knowledgeBases) ? agent.knowledgeBases : [];
    if (kbIds.length > 0) {
        tools.push({
            type: 'function',
            function: {
                name: 'query_database',
                description: 'Consulta el inventario de productos. DEBES llamar a esta función SIEMPRE que el cliente pregunte por piezas, precios o disponibilidad. Pasa los datos que el cliente mencione: marca, modelo, año, tipo de pieza, lado, etc. No inventes resultados — si no encuentras, dilo honestamente.',
                parameters: {
                    type: 'object',
                    properties: {
                        searchQuery: {
                            type: 'string',
                            description: 'Búsqueda libre: cualquier término descriptivo del producto',
                        },
                        marca: {
                            type: 'string',
                            description: 'Marca del vehículo. Ej: TOYOTA, NISSAN, CHEVROLET, AUDI, HONDA',
                        },
                        modelo: {
                            type: 'string',
                            description: 'Modelo del vehículo. Ej: COROLLA, SENTRA, TRAX, A1, CIVIC',
                        },
                        parte: {
                            type: 'string',
                            description: 'Categoría de la pieza. Ej: ESPEJOS, FAROS, MANIJAS EXTERIORES, DEFENSAS DELANTERAS, CALAVERAS',
                        },
                        año: {
                            type: 'number',
                            description: 'Año del vehículo. Ej: 2015',
                        },
                        lado: {
                            type: 'string',
                            description: 'IZQUIERDA o DERECHA (conductor=IZQUIERDA, copiloto=DERECHA)',
                        },
                        del_tras: {
                            type: 'string',
                            description: 'DELANTERA o TRASERA',
                        },
                        int_ext: {
                            type: 'string',
                            description: 'INTERIOR o EXTERIOR',
                        },
                        limit: {
                            type: 'number',
                            description: 'Máximo de resultados a devolver (default: 25, máx: 50)',
                        },
                    },
                    required: [],
                },
            },
        });
    }

    return tools;
}

// ---------------------------------------------------------------------------
// Ejecución de la herramienta query_database
// ---------------------------------------------------------------------------

/**
 * Ejecuta una consulta a la KB con búsqueda en dos fases:
 *   Fase 1 — Filtro exacto por marca y parte (campos confiables, siempre presentes).
 *   Fase 2 — Scoring semántico por modelo, año, lado, del_tras, int_ext y searchQuery.
 *
 * Acepta parámetros estructurados (marca, modelo, parte, año, lado, del_tras, int_ext)
 * además del texto libre searchQuery. Si no se pasa knowledgeBaseId, usa la primera KB
 * del agente automáticamente.
 *
 * @param {string}   orgId
 * @param {object}   args    - Parámetros de la herramienta (ver buildToolDefinitions)
 * @param {string[]} kbIds   - IDs de KBs del agente (fallback si no viene knowledgeBaseId)
 * @returns {Promise<string>}
 */
async function executeQueryDatabase(orgId, args, kbIds) {
    try {
        // Auto-selección de KB: usa la que el modelo indique o la primera del agente
        const kbId = args.knowledgeBaseId || (Array.isArray(kbIds) && kbIds.length > 0 ? kbIds[0] : null);
        if (!kbId) return 'No hay base de datos configurada para esta consulta.';

        const limit = Math.min(Number(args.limit) || 25, 50);
        const rows  = await loadKBRows(orgId, kbId);

        if (rows.length === 0) {
            return 'No se encontraron productos en la base de datos.';
        }

        // ── Fase 1: filtro exacto (no-excluyente) por campos de alta confianza ──────
        // Solo aplica el filtro si reduce el conjunto; si elimina todo, lo ignora.
        let candidates = rows;

        if (args.marca) {
            const val      = String(args.marca).toUpperCase().trim();
            const filtered = candidates.filter(r => String(r.marca || '').toUpperCase().includes(val));
            if (filtered.length > 0) candidates = filtered;
        }

        if (args.parte) {
            const val      = String(args.parte).toUpperCase().trim();
            const filtered = candidates.filter(r => String(r.parte || '').toUpperCase().includes(val));
            if (filtered.length > 0) candidates = filtered;
        }

        // ── Fase 2: scoring semántico sobre los candidatos restantes ─────────────────
        // Combina todos los filtros opcionales en un único texto de búsqueda.
        const scoreParts = [
            args.searchQuery  || '',
            args.modelo       || '',
            args.año          ? String(args.año) : '',
            args.lado         || '',
            args.del_tras     || '',
            args.int_ext      || '',
        ].filter(Boolean).join(' ').trim();

        if (scoreParts) {
            const { terms, years } = expandSearchTerms(scoreParts);
            if (terms.size > 0 || years.length > 0) {
                const scored  = candidates.map(row => ({ row, score: scoreRow(row, terms, years) }))
                                          .sort((a, b) => b.score - a.score);
                const matched = scored.filter(s => s.score > 0);
                // Si hay matches con score > 0, úsalos; si no, mantén el orden filtrado
                if (matched.length > 0) candidates = matched.map(s => s.row);
            }
        }

        const results = candidates.slice(0, limit);
        if (results.length === 0) {
            return 'No se encontraron productos con los criterios especificados.';
        }

        const columns   = Object.keys(results[0]).filter(k => k !== 'id');
        const formatted = results.map((row, i) =>
            `${i + 1}. ${columns.map(col => `${col}: ${row[col] ?? ''}`).join(' | ')}`
        ).join('\n');

        const info = candidates.length > limit
            ? ` (top ${results.length} de ${candidates.length})`
            : ` (${results.length})`;
        return `Resultados${info}:\n${formatted}`;
    } catch (err) {
        console.error('[executeQueryDatabase] Error:', err);
        return 'Error al consultar la base de datos.';
    }
}

// ---------------------------------------------------------------------------
// Helper: limpia artefactos de herramientas que el modelo pudiera filtrar en texto
// ---------------------------------------------------------------------------

/**
 * Elimina bloques XML de function-calls que algunos modelos incluyen en el
 * texto de la respuesta (comportamiento legacy / modelos que no soportan
 * tool_use nativo). También normaliza espacios en blanco extra.
 *
 * @param {string} text
 * @returns {string}
 */
function cleanResponse(text) {
    if (!text) return text;
    return text
        .replace(/<function_calls>[\s\S]*?<\/function_calls>/gi, '')
        .replace(/<invoke[\s\S]*?<\/antml:invoke>/gi, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

// ---------------------------------------------------------------------------
// Llamadas a proveedores de IA (con soporte de herramientas)
// ---------------------------------------------------------------------------

/**
 * Ejecuta las herramientas solicitadas por el modelo (OpenAI format).
 * Devuelve el array de tool results para agregar al historial.
 */
async function executeToolCallsOpenAI(toolCalls, orgId, convId, kbIds) {
    const results = [];
    for (const tc of toolCalls) {
        let content;
        const args = JSON.parse(tc.function.arguments);

        if (tc.function.name === 'save_contact') {
            const r = await saveOrUpdateContact(orgId, convId, args);
            content = r.success
                ? `Contacto ${r.action === 'created' ? 'creado' : 'actualizado'} correctamente: ${r.name}`
                : `Error al guardar contacto: ${r.message}`;
        } else if (tc.function.name === 'create_order') {
            const r = await createOrder(orgId, convId, args);
            content = r.success
                ? `Pedido creado. Número: ${r.orderNumber}. Total: $${(r.total || 0).toFixed(2)}.`
                : `Error al crear pedido: ${r.message}`;
        } else if (tc.function.name === 'query_database') {
            content = await executeQueryDatabase(orgId, args, kbIds);
        } else {
            content = 'Herramienta no reconocida.';
        }

        results.push({ role: 'tool', tool_call_id: tc.id, content });
    }
    return results;
}

/**
 * Ejecuta las herramientas solicitadas por el modelo (Anthropic format).
 * Devuelve el array de tool_result contents para el siguiente turno.
 */
async function executeToolCallsAnthropic(toolUseBlocks, orgId, convId, kbIds) {
    const results = [];
    for (const tb of toolUseBlocks) {
        let content;

        if (tb.name === 'save_contact') {
            const r = await saveOrUpdateContact(orgId, convId, tb.input);
            content = r.success
                ? `Contacto ${r.action === 'created' ? 'creado' : 'actualizado'} correctamente: ${r.name}`
                : `Error al guardar contacto: ${r.message}`;
        } else if (tb.name === 'create_order') {
            const r = await createOrder(orgId, convId, tb.input);
            content = r.success
                ? `Pedido creado. Número: ${r.orderNumber}. Total: $${(r.total || 0).toFixed(2)}.`
                : `Error al crear pedido: ${r.message}`;
        } else if (tb.name === 'query_database') {
            content = await executeQueryDatabase(orgId, tb.input, kbIds);
        } else {
            content = 'Herramienta no reconocida.';
        }

        results.push({ type: 'tool_result', tool_use_id: tb.id, content });
    }
    return results;
}

/**
 * Llama a la API de OpenAI con soporte de herramientas (multi-turno: hasta 5 rondas).
 *
 * @param {object}   agent
 * @param {string}   systemPrompt
 * @param {object[]} messages
 * @param {object[]} tools
 * @param {string}   orgId
 * @param {string}   convId
 * @returns {Promise<string>}
 */
async function callOpenAI(agent, systemPrompt, messages, tools, orgId, convId) {
    const endpoint = (agent.provider === 'custom' && agent.endpoint)
        ? agent.endpoint
        : 'https://api.openai.com/v1/chat/completions';

    const kbIds    = agent.knowledgeBases || [];
    const history  = [{ role: 'system', content: systemPrompt }, ...messages];
    const MAX_ROUNDS = 5;

    for (let round = 0; round < MAX_ROUNDS; round++) {
        const body = {
            model:       agent.model,
            messages:    history,
            max_tokens:  2048,
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

        // Sin tool calls → respuesta final
        if (choice?.finish_reason !== 'tool_calls' && !choice?.message?.tool_calls?.length) {
            return cleanResponse(choice?.message?.content || '');
        }

        // Ejecutar las herramientas y continuar el ciclo
        const toolResults = await executeToolCallsOpenAI(
            choice.message.tool_calls || [], orgId, convId, kbIds
        );

        // Agregar la respuesta del asistente y los resultados al historial
        history.push(choice.message);
        history.push(...toolResults);
    }

    return '';
}

/**
 * Llama a la API de Anthropic con soporte de herramientas (multi-turno: hasta 5 rondas).
 *
 * @param {object}   agent
 * @param {string}   systemPrompt
 * @param {object[]} messages
 * @param {object[]} tools
 * @param {string}   orgId
 * @param {string}   convId
 * @returns {Promise<string>}
 */
async function callAnthropic(agent, systemPrompt, messages, tools, orgId, convId) {
    const kbIds = agent.knowledgeBases || [];

    // Anthropic necesita los mensajes sin el rol 'system'
    const anthropicHistory = messages.map(m => ({
        role:    m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content,
    }));

    const anthropicTools = tools.map(t => ({
        name:         t.function.name,
        description:  t.function.description,
        input_schema: t.function.parameters,
    }));

    const MAX_ROUNDS = 5;

    for (let round = 0; round < MAX_ROUNDS; round++) {
        const body = {
            model:      agent.model,
            max_tokens: 2048,
            system:     systemPrompt,
            messages:   anthropicHistory,
            ...(anthropicTools.length > 0 ? { tools: anthropicTools } : {}),
        };

        const res = await fetch('https://api.anthropic.com/v1/messages', {
            method:  'POST',
            headers: {
                'Content-Type':    'application/json',
                'x-api-key':       agent.apiKey,
                'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify(body),
        });

        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error?.message || `Anthropic error ${res.status}`);
        }

        const data          = await res.json();
        const toolUseBlocks = (data.content || []).filter(b => b.type === 'tool_use');

        // Sin tool_use → respuesta final: toma el primer bloque de texto
        if (toolUseBlocks.length === 0) {
            const textBlock = (data.content || []).find(b => b.type === 'text');
            return cleanResponse(textBlock?.text || '');
        }

        // Ejecutar las herramientas y continuar el ciclo
        const toolResults = await executeToolCallsAnthropic(toolUseBlocks, orgId, convId, kbIds);

        // Agregar la respuesta del asistente (con tool_use) y los resultados al historial
        anthropicHistory.push({ role: 'assistant', content: data.content });
        anthropicHistory.push({ role: 'user',      content: toolResults });
    }

    return '';
}

// ---------------------------------------------------------------------------
// Envío de respuesta via Evolution API
// ---------------------------------------------------------------------------

/**
 * Envía un mensaje de texto al número de WhatsApp usando Evolution API.
 *
 * @param {{ evolutionApiUrl: string, evolutionApiKey: string, evolutionInstanceName: string }} evoConfig
 * @param {string} phone  - Número destino, p.ej. "521234567890"
 * @param {string} text   - Texto del mensaje
 */
async function sendEvolutionMessage(evoConfig, phone, text) {
    const baseUrl      = evoConfig.evolutionApiUrl.replace(/\/$/, '');
    const instanceName = evoConfig.evolutionInstanceName;
    const apiKey       = evoConfig.evolutionApiKey;

    const res = await fetch(`${baseUrl}/message/sendText/${encodeURIComponent(instanceName)}`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', apikey: apiKey },
        body:    JSON.stringify({ number: phone, text }),
    });

    if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(`Evolution API ${res.status}: ${JSON.stringify(errBody)}`);
    }
    return res.json();
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

            // Herramientas disponibles para el agente (incluyendo query_database si tiene KBs)
            const tools = buildToolDefinitions(agent);

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

            // Si la integración de WhatsApp es Evolution API, enviar el
            // mensaje de vuelta al cliente directamente vía Evolution API.
            if (platform === 'whatsapp') {
                try {
                    const evoConfig = await getEvolutionConfig(orgId);
                    if (evoConfig) {
                        const recipientPhone = conv.contactPhone;
                        if (recipientPhone) {
                            await sendEvolutionMessage(evoConfig, recipientPhone, aiResponse);
                            console.log(
                                `[autoResponder] Mensaje enviado via Evolution API `
                                + `a phone="${recipientPhone}" instance="${evoConfig.evolutionInstanceName}"`
                            );
                        }
                    }
                } catch (evoErr) {
                    // No-fatal: el mensaje ya está guardado en Firestore aunque
                    // falle el envío a WhatsApp.
                    console.warn('[autoResponder] Error al enviar via Evolution API:', evoErr.message);
                }
            }
        } catch (err) {
            // Capturar todos los errores para no bloquear el trigger
            console.error(`[autoResponder] Error procesando msg="${msgId}":`, err);
        }

        return null;
    }
);
