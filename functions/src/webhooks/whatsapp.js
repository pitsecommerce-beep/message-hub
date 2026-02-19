/**
 * whatsappWebhook — HTTP Function (2ª gen)
 *
 * Maneja los webhooks de WhatsApp Cloud API de Meta.
 *
 * GET  /whatsappWebhook  — Verificación del webhook (hub.challenge)
 * POST /whatsappWebhook  — Recepción de mensajes entrantes
 *
 * Al guardar el mensaje en Firestore, el trigger autoResponder se
 * activa automáticamente si la conversación tiene aiEnabled: true.
 */
const { onRequest } = require('firebase-functions/v2/https');
const { defineString } = require('firebase-functions/params');
const {
    findOrgByIntegrationField,
    findOpenConversation,
    createConversation,
    saveIncomingMessage,
} = require('../utils/firestore');

// Token de verificación configurado en Meta for Developers.
// Se establece con: firebase functions:config:set meta.verify_token="TU_TOKEN"
// O con la nueva sintaxis de params (recomendada para 2ª gen):
const VERIFY_TOKEN = defineString('META_VERIFY_TOKEN', {
    description: 'Token de verificación del webhook de Meta',
    default:     'messagehub_verify_token',
});

exports.whatsappWebhook = onRequest(async (req, res) => {
    // -----------------------------------------------------------------------
    // GET: Verificación del webhook
    // -----------------------------------------------------------------------
    if (req.method === 'GET') {
        const mode      = req.query['hub.mode'];
        const token     = req.query['hub.verify_token'];
        const challenge = req.query['hub.challenge'];

        if (mode === 'subscribe' && token === VERIFY_TOKEN.value()) {
            console.log('[WhatsApp] Webhook verificado correctamente');
            return res.status(200).send(challenge);
        }

        console.warn('[WhatsApp] Verificación fallida: token incorrecto');
        return res.sendStatus(403);
    }

    // -----------------------------------------------------------------------
    // POST: Mensaje entrante
    // -----------------------------------------------------------------------
    if (req.method === 'POST') {
        try {
            const body = req.body;

            // Validar que sea un evento de WhatsApp
            if (body.object !== 'whatsapp_business_account') {
                return res.sendStatus(404);
            }

            // Procesar cada entry (normalmente solo una)
            for (const entry of body.entry || []) {
                for (const change of entry.changes || []) {
                    if (change.field !== 'messages') continue;

                    const value = change.value;
                    const phoneNumberId = value?.metadata?.phone_number_id;
                    const messages      = value?.messages || [];
                    const contacts      = value?.contacts || [];

                    if (!phoneNumberId || messages.length === 0) continue;

                    // Buscar organización que tenga este phoneNumberId
                    const org = await findOrgByIntegrationField('phoneNumberId', phoneNumberId);
                    if (!org) {
                        console.warn(`[WhatsApp] Org no encontrada para phoneNumberId="${phoneNumberId}"`);
                        continue;
                    }

                    // Procesar cada mensaje (normalmente uno)
                    for (const msg of messages) {
                        // Solo mensajes de texto por ahora
                        if (msg.type !== 'text') continue;

                        const from     = msg.from; // Número del remitente
                        const text     = msg.text?.body || '';
                        const contact  = contacts.find(c => c.wa_id === from);
                        const name     = contact?.profile?.name || from;

                        // Buscar conversación abierta o crear una nueva
                        let conv = await findOpenConversation(org.id, 'whatsapp', from);
                        if (!conv) {
                            conv = await createConversation(org.id, 'whatsapp', {
                                id:    from,
                                name,
                                phone: from,
                            });
                            console.log(`[WhatsApp] Nueva conversación creada: ${conv.id}`);
                        }

                        // Guardar el mensaje (esto dispara autoResponder)
                        await saveIncomingMessage(org.id, conv.id, {
                            text,
                            sender:     from,
                            senderName: name,
                            platform:   'whatsapp',
                        });

                        console.log(
                            `[WhatsApp] Mensaje guardado. org="${org.id}" `
                            + `conv="${conv.id}" from="${from}"`
                        );
                    }
                }
            }

            // Meta espera un 200 rápido; la lógica de respuesta es asíncrona
            return res.sendStatus(200);
        } catch (err) {
            console.error('[WhatsApp] Error procesando webhook:', err);
            return res.sendStatus(500);
        }
    }

    return res.sendStatus(405);
});
