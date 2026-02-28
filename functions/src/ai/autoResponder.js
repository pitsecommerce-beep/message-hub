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
 * de sus knowledge bases.
 *
 * Arquitectura del prompt:
 *   1. System prompt del usuario (personalidad, reglas de negocio)
 *   2. Reglas de formato de respuesta (NO negociables)
 *   3. Datos de referencia de KBs (muestra filtrada)
 *   4. Instrucciones de uso de datos y herramientas
 *
 * @param {{ systemPrompt: string, knowledgeBases: string[] }} agent
 * @param {string} orgId
 * @param {string} userMessage - Texto del mensaje del usuario
 * @returns {Promise<string>}
 */
async function buildSystemPrompt(agent, orgId, userMessage) {
    // ── 1. Prompt base del usuario ──────────────────────────────────────────
    let prompt = agent.systemPrompt || '';

    // ── 2. Reglas compactas ─────────────────────────────────────────────────
    prompt += '\n\n---\nREGLAS:\n';
    prompt += '- Responde directo. No narres proceso interno ("déjame buscar...", "consultando...").\n';
    prompt += '- Sin XML/JSON/código/nombres de herramientas en respuestas al cliente.\n';
    prompt += '- No inventes precios, existencias ni números de pedido.\n';
    prompt += '- DEBES LLAMAR las herramientas para ejecutar acciones. NUNCA simules que ya lo hiciste. Si no llamaste save_contact, el contacto NO se guardó. Si no llamaste create_order, el pedido NO se creó.\n\n';

    // ── 3. Flujo de trabajo ─────────────────────────────────────────────────
    prompt += 'FLUJO:\n';
    const kbIds = agent.knowledgeBases || [];
    if (kbIds.length > 0) {
        prompt += '1. BUSCAR → Llama query_database con marca, modelo, parte, anio, lado. Nunca digas "no tenemos" sin buscar primero.\n';
    }
    prompt += '2. CONTACTO → Datos MÍNIMOS INDISPENSABLES: nombre, celular, dirección de entrega y nombre de empresa. Si quiere factura pide RFC. Llama save_contact con todos los datos.\n';
    prompt += '3. PEDIDO → Cuando confirme compra, llama create_order. OBLIGATORIO en cada artículo: product (descripción completa), sku, quantity Y unitPrice (precio de VENTA de la base de datos). NUNCA omitas el precio ni la descripción. Comparte al cliente el número de pedido que DEVUELVA la herramienta.\n';
    prompt += '- Orden obligatorio: save_contact ANTES de create_order.\n\n';

    // ── 4. Metadata de KBs (solo columnas — sin datos para ahorrar tokens) ─
    if (kbIds.length > 0) {
        for (const kbId of kbIds) {
            try {
                const kb = await loadKBMeta(orgId, kbId);
                if (!kb) continue;
                prompt += `Base "${kb.name}": columnas: ${(kb.columns || []).join(', ')}.\n`;
            } catch (err) {
                console.error(`[autoResponder] Error cargando KB meta ${kbId}:`, err);
            }
        }
        prompt += 'Usa query_database para buscar productos en estas bases.\n';
    }

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
async function loadConversationHistory(orgId, convId, limit = 6) {
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
                description: 'Guarda o actualiza contacto en CRM. OBLIGATORIO antes de create_order. Datos mínimos indispensables: nombre, celular, dirección y nombre de empresa. Si el cliente desea factura, pide también su RFC.',
                parameters: {
                    type: 'object',
                    properties: {
                        name:    { type: 'string', description: 'Nombre completo del cliente' },
                        phone:   { type: 'string', description: 'Número de celular (OBLIGATORIO para deduplicación)' },
                        address: { type: 'string', description: 'Dirección de entrega o domicilio del cliente' },
                        company: { type: 'string', description: 'Nombre de la empresa o taller del cliente' },
                        rfc:     { type: 'string', description: 'RFC del cliente (solo si requiere factura)' },
                        email:   { type: 'string', description: 'Correo electrónico' },
                        notes:   { type: 'string', description: 'Notas adicionales' },
                    },
                    required: ['name', 'phone', 'address', 'company'],
                },
            },
        },
        {
            type: 'function',
            function: {
                name: 'create_order',
                description: 'Crea pedido. REQUISITO: save_contact debe haberse llamado antes. OBLIGATORIO: cada artículo DEBE incluir product (descripción), sku, unitPrice (precio de la base de datos) y quantity. La herramienta devuelve el número de pedido — compártelo al cliente.',
                parameters: {
                    type: 'object',
                    properties: {
                        items: {
                            type: 'array',
                            description: 'Lista de productos del pedido. CADA producto DEBE tener: product, sku, quantity y unitPrice tomados de la base de datos.',
                            items: {
                                type: 'object',
                                properties: {
                                    product:   { type: 'string', description: 'Descripción completa del producto tal como aparece en la base de datos' },
                                    sku:       { type: 'string', description: 'SKU o código del producto tal como aparece en la base de datos. OBLIGATORIO.' },
                                    quantity:  { type: 'number', description: 'Cantidad solicitada' },
                                    unitPrice: { type: 'number', description: 'Precio unitario de VENTA de la base de datos (sin símbolo de moneda). OBLIGATORIO — nunca dejes este campo vacío.' },
                                    notes:     { type: 'string', description: 'Notas adicionales del producto' }
                                },
                                required: ['product', 'sku', 'quantity', 'unitPrice']
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
                description: 'Busca productos en inventario. Pasa los filtros que tengas. No inventes resultados.',
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
                        anio: {
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
            args.anio         ? String(args.anio) : '',
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
 * Elimina artefactos de herramientas que el modelo filtra en texto:
 *   - Bloques XML de function-calls (<function_calls>, <invoke>, etc.)
 *   - Bloques markdown de código que contienen llamadas a herramientas
 *   - Frases narrativas sobre consultas internas ("Déjame consultar...",
 *     "Consultando en sistema...", "Listo, déjame revisar...", etc.)
 *
 * @param {string} text
 * @returns {string}
 */
function cleanResponse(text) {
    if (!text) return text;

    let cleaned = text;

    // ── Bloques XML de function-calls ───────────────────────────────────────
    cleaned = cleaned.replace(/<function_calls>[\s\S]*?<\/function_calls>/gi, '');
    cleaned = cleaned.replace(/<invoke[\s\S]*?<\/invoke>/gi, '');
    cleaned = cleaned.replace(/<invoke[\s\S]*?<\/antml:invoke>/gi, '');
    cleaned = cleaned.replace(/<parameter[\s\S]*?<\/parameter>/gi, '');
    // Stray opening/closing tags
    cleaned = cleaned.replace(/<\/?(function_calls|invoke|parameter|antml:invoke)[^>]*>/gi, '');

    // ── Bloques markdown de código con tool calls ───────────────────────────
    cleaned = cleaned.replace(/```[a-z]*\n?[\s\S]*?```/g, (match) => {
        if (/invoke|function_call|query_database|save_contact|create_order|<parameter/i.test(match)) {
            return '';
        }
        return match;
    });

    // ── Narrativa de consultas internas (artefactos de tool-call fallido) ───
    // Solo se eliminan frases que narran el proceso de consulta interna.
    const narrativePatterns = [
        // "Déjame consultar/verificar/revisar/buscar/buscarlo/consultarlo..."
        /[Dd]éjame\s+(consultar|verificar|revisar|buscar|checar)\w*\s*[^.!?\n]*[.…]{0,3}\s*/g,
        // "Voy a consultar/verificar..."
        /[Vv]oy\s+a\s+(consultar|verificar|revisar|buscar|checar)\w*\s*[^.!?\n]*[.…]{0,3}\s*/g,
        // "Permíteme consultar..."
        /[Pp]ermíteme\s+(consultar|verificar|revisar|buscar|checar)\w*\s*[^.!?\n]*[.…]{0,3}\s*/g,
        // "Consultando en sistema/inventario..." / "Buscando en base de datos..."
        /[Cc]onsultando\s+(en\s+)?(el\s+)?(sistema|inventario|base\s+de\s+datos)[^.!?\n]*[.…]{0,3}\s*/g,
        /[Bb]uscando\s+(en\s+)?(el\s+)?(sistema|inventario|base\s+de\s+datos|catálogo)[^.!?\n]*[.…*]{0,5}\s*/g,
        // "Listo, déjame revisar los resultados..."
        /[Ll]isto,?\s*déjame\s+revisar\s+[^.!?\n]*[.…]{0,3}\s*/g,
        // "Un momento mientras consulto..."
        /[Uu]n\s+momento\s+(mientras|que)\s+(consulto|verifico|reviso|busco)[^.!?\n]*[.…]{0,3}\s*/g,
        // Emoji search decorators: "🔍 *Buscando...*"
        /🔍[^.!?\n]*[.…*]{0,5}\s*/g,
    ];
    for (const pattern of narrativePatterns) {
        cleaned = cleaned.replace(pattern, '');
    }

    // ── Normalizar espacios ─────────────────────────────────────────────────
    cleaned = cleaned.replace(/\n{3,}/g, '\n\n').trim();

    return cleaned;
}

// ---------------------------------------------------------------------------
// Recuperación de tool calls basados en texto (fallback)
// ---------------------------------------------------------------------------

/**
 * Intenta parsear llamadas a herramientas que el modelo incluyó como XML
 * en el texto de respuesta (en vez de usar la API nativa de tool_use).
 *
 * Soporta dos formatos:
 *   - <invoke name="xxx"><parameter name="y">val</parameter></invoke>
 *   - <function_calls><invoke ...>...</invoke></function_calls>
 *
 * @param {string} text
 * @returns {{ name: string, params: object }[]}
 */
function parseTextToolCalls(text) {
    if (!text) return [];

    const calls = [];
    const invokeRegex = /<invoke\s+name="([^"]+)">([\s\S]*?)<\/invoke>/gi;
    let match;
    while ((match = invokeRegex.exec(text)) !== null) {
        const name = match[1];
        const body = match[2];
        const params = {};
        const paramRegex = /<parameter\s+name="([^"]+)">([\s\S]*?)<\/parameter>/gi;
        let pm;
        while ((pm = paramRegex.exec(body)) !== null) {
            let val = pm[2].trim();
            // Parsear números
            if (/^\d+(\.\d+)?$/.test(val)) val = Number(val);
            params[pm[1]] = val;
        }
        calls.push({ name, params });
    }
    return calls;
}

/**
 * Si el modelo generó tool calls como texto XML en vez de usar la API
 * nativa, esta función los detecta, ejecuta las herramientas
 * correspondientes y devuelve los resultados.
 *
 * @param {string} rawText - Texto crudo de la respuesta del modelo
 * @param {string} orgId
 * @param {string} convId
 * @param {string[]} kbIds
 * @returns {Promise<{ name: string, content: string }[] | null>}
 */
async function recoverTextToolCalls(rawText, orgId, convId, kbIds) {
    const calls = parseTextToolCalls(rawText);
    if (calls.length === 0) return null;

    console.log(`[autoResponder] Recuperando ${calls.length} tool call(s) desde texto XML`);

    const results = [];
    for (const call of calls) {
        let content;
        try {
            if (call.name === 'query_database') {
                content = await executeQueryDatabase(orgId, call.params, kbIds);
            } else if (call.name === 'save_contact') {
                const r = await saveOrUpdateContact(orgId, convId, call.params);
                content = r.success
                    ? `Contacto ${r.action === 'created' ? 'creado' : 'actualizado'}: ${r.name}`
                    : `Error: ${r.message}`;
            } else if (call.name === 'create_order') {
                const r = await createOrder(orgId, convId, call.params);
                content = r.success
                    ? `Pedido creado. Número: ${r.orderNumber}. Total: $${(r.total || 0).toFixed(2)}.`
                    : `Error: ${r.message}`;
            } else {
                continue;
            }
        } catch (err) {
            console.error(`[autoResponder] Error ejecutando ${call.name} recuperado:`, err);
            content = `Error al ejecutar ${call.name}.`;
        }
        results.push({ name: call.name, content });
    }

    return results.length > 0 ? results : null;
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
 * Incluye mecanismo de recuperación: si el modelo genera tool calls como
 * XML en texto (en vez de usar la API nativa), los detecta, ejecuta las
 * herramientas y hace una ronda adicional para obtener una respuesta limpia.
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

        // ── Ruta nativa: el modelo usó tool_calls correctamente ─────────
        if (choice?.finish_reason === 'tool_calls' || choice?.message?.tool_calls?.length) {
            const toolResults = await executeToolCallsOpenAI(
                choice.message.tool_calls || [], orgId, convId, kbIds
            );
            history.push(choice.message);
            history.push(...toolResults);
            continue;
        }

        // ── Respuesta final (texto) ─────────────────────────────────────
        const rawText = choice?.message?.content || '';

        // ── Recuperación: detectar tool calls XML en el texto ───────────
        // Si el modelo puso tool calls como XML en vez de usar la API,
        // los ejecutamos y pedimos una respuesta limpia.
        if (round < MAX_ROUNDS - 1) {
            const recoveredResults = await recoverTextToolCalls(rawText, orgId, convId, kbIds);
            if (recoveredResults) {
                const resultsText = recoveredResults
                    .map(r => `[Resultado de ${r.name}]:\n${r.content}`)
                    .join('\n\n');

                // Inyectar resultados como contexto para la siguiente ronda
                history.push({
                    role: 'assistant',
                    content: cleanResponse(rawText) || 'Consulté el inventario.',
                });
                history.push({
                    role: 'user',
                    content: '[SISTEMA] Los resultados de la consulta al inventario son:\n\n'
                        + resultsText + '\n\n'
                        + 'Responde al cliente directamente con esta información. '
                        + 'Presenta producto, precio, disponibilidad y tiempo de entrega. '
                        + 'NO narres que hiciste una consulta. NO incluyas XML ni etiquetas.',
                });
                continue;
            }
        }

        return cleanResponse(rawText);
    }

    return '';
}

/**
 * Llama a la API de Anthropic con soporte de herramientas (multi-turno: hasta 5 rondas).
 *
 * Incluye mecanismo de recuperación: si el modelo genera tool calls como
 * XML en texto (en vez de usar tool_use nativo), los detecta, ejecuta las
 * herramientas y hace una ronda adicional para obtener una respuesta limpia.
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

        // ── Ruta nativa: el modelo usó tool_use correctamente ───────────
        if (toolUseBlocks.length > 0) {
            const toolResults = await executeToolCallsAnthropic(toolUseBlocks, orgId, convId, kbIds);
            anthropicHistory.push({ role: 'assistant', content: data.content });
            anthropicHistory.push({ role: 'user',      content: toolResults });
            continue;
        }

        // ── Respuesta final (texto) ─────────────────────────────────────
        const textBlock = (data.content || []).find(b => b.type === 'text');
        const rawText   = textBlock?.text || '';

        // ── Recuperación: detectar tool calls XML en el texto ───────────
        if (round < MAX_ROUNDS - 1) {
            const recoveredResults = await recoverTextToolCalls(rawText, orgId, convId, kbIds);
            if (recoveredResults) {
                const resultsText = recoveredResults
                    .map(r => `[Resultado de ${r.name}]:\n${r.content}`)
                    .join('\n\n');

                anthropicHistory.push({
                    role: 'assistant',
                    content: cleanResponse(rawText) || 'Consulté el inventario.',
                });
                anthropicHistory.push({
                    role: 'user',
                    content: '[SISTEMA] Los resultados de la consulta al inventario son:\n\n'
                        + resultsText + '\n\n'
                        + 'Responde al cliente directamente con esta información. '
                        + 'Presenta producto, precio, disponibilidad y tiempo de entrega. '
                        + 'NO narres que hiciste una consulta. NO incluyas XML ni etiquetas.',
                });
                continue;
            }
        }

        return cleanResponse(rawText);
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
