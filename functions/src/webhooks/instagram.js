/**
 * instagramWebhook — HTTP Function (2ª gen)
 *
 * Maneja los webhooks de Instagram Messaging de Meta.
 *
 * GET  /instagramWebhook  — Verificación del webhook (hub.challenge)
 * POST /instagramWebhook  — Recepción de mensajes directos de Instagram
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

const VERIFY_TOKEN = defineString('META_VERIFY_TOKEN', {
    description: 'Token de verificación del webhook de Meta',
    default:     'messagehub_verify_token',
});

exports.instagramWebhook = onRequest(async (req, res) => {
    // -----------------------------------------------------------------------
    // GET: Verificación del webhook
    // -----------------------------------------------------------------------
    if (req.method === 'GET') {
        const mode      = req.query['hub.mode'];
        const token     = req.query['hub.verify_token'];
        const challenge = req.query['hub.challenge'];

        if (mode === 'subscribe' && token === VERIFY_TOKEN.value()) {
            console.log('[Instagram] Webhook verificado correctamente');
            return res.status(200).send(challenge);
        }

        console.warn('[Instagram] Verificación fallida: token incorrecto');
        return res.sendStatus(403);
    }

    // -----------------------------------------------------------------------
    // POST: Mensaje entrante
    // -----------------------------------------------------------------------
    if (req.method === 'POST') {
        try {
            const body = req.body;

            if (body.object !== 'instagram') {
                return res.sendStatus(404);
            }

            for (const entry of body.entry || []) {
                const pageId = entry.id; // ID de la página de Facebook vinculada

                // Buscar organización que tenga este pageId de Instagram
                const org = await findOrgByIntegrationField('pageId', pageId);
                if (!org) {
                    console.warn(`[Instagram] Org no encontrada para pageId="${pageId}"`);
                    continue;
                }

                for (const event of entry.messaging || []) {
                    // Ignorar mensajes propios (echo del agente)
                    if (event.message?.is_echo) continue;
                    // Solo mensajes de texto por ahora
                    if (!event.message?.text) continue;

                    const senderId = event.sender?.id;
                    const text     = event.message.text;

                    if (!senderId || !text) continue;

                    // Buscar o crear conversación
                    let conv = await findOpenConversation(org.id, 'instagram', senderId);
                    if (!conv) {
                        conv = await createConversation(org.id, 'instagram', {
                            id:   senderId,
                            name: senderId, // Instagram no provee nombre en el webhook
                        });
                        console.log(`[Instagram] Nueva conversación creada: ${conv.id}`);
                    }

                    // Guardar el mensaje (dispara autoResponder)
                    await saveIncomingMessage(org.id, conv.id, {
                        text,
                        sender:     senderId,
                        senderName: senderId,
                        platform:   'instagram',
                    });

                    console.log(
                        `[Instagram] Mensaje guardado. org="${org.id}" `
                        + `conv="${conv.id}" sender="${senderId}"`
                    );
                }
            }

            return res.sendStatus(200);
        } catch (err) {
            console.error('[Instagram] Error procesando webhook:', err);
            return res.sendStatus(500);
        }
    }

    return res.sendStatus(405);
});
