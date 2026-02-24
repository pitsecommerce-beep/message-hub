/**
 * whatsappEvolutionWebhook — HTTP Function (2ª gen)
 *
 * Recibe los eventos enviados por Evolution API (Baileys) cuando un
 * mensaje de WhatsApp llega a una instancia conectada.
 *
 * POST /whatsappEvolutionWebhook
 *
 * Payload esperado (evento MESSAGES_UPSERT de Evolution API v2):
 * {
 *   "event": "messages.upsert",
 *   "instance": "nombre-de-instancia",
 *   "data": {
 *     "key": { "remoteJid": "521234567890@s.whatsapp.net", "fromMe": false, "id": "..." },
 *     "pushName": "Nombre Contacto",
 *     "message": { "conversation": "Hola!" },
 *     "messageType": "conversation",
 *     "messageTimestamp": 1700000000
 *   }
 * }
 */
const { onRequest } = require('firebase-functions/v2/https');
const {
    findOrgByIntegrationField,
    findOpenConversation,
    createConversation,
    saveIncomingMessage,
} = require('../utils/firestore');

exports.whatsappEvolutionWebhook = onRequest(async (req, res) => {
    // Sólo aceptamos POST
    if (req.method !== 'POST') {
        return res.sendStatus(405);
    }

    try {
        const body = req.body;

        // Ignorar eventos que no sean mensajes entrantes
        if (body.event !== 'messages.upsert') {
            return res.sendStatus(200);
        }

        const instanceName = body.instance;
        const messageData  = body.data;

        if (!instanceName || !messageData) {
            return res.sendStatus(200);
        }

        // Ignorar mensajes propios (enviados desde el dispositivo)
        if (messageData.key?.fromMe === true) {
            return res.sendStatus(200);
        }

        const remoteJid = messageData.key?.remoteJid ?? '';

        // Ignorar grupos (@g.us) — solo chats individuales por ahora
        if (!remoteJid || remoteJid.endsWith('@g.us')) {
            return res.sendStatus(200);
        }

        // Extraer número de teléfono limpio
        const phone = remoteJid.split('@')[0];
        const pushName = messageData.pushName || phone;

        // Extraer texto del mensaje (distintos tipos)
        const text =
            messageData.message?.conversation ??
            messageData.message?.extendedTextMessage?.text ??
            messageData.message?.imageMessage?.caption ??
            messageData.message?.videoMessage?.caption ??
            '';

        if (!text) {
            // Ignorar mensajes sin texto (stickers, audio, etc.) por ahora
            return res.sendStatus(200);
        }

        // Buscar la organización que tiene esta instancia configurada
        const org = await findOrgByIntegrationField('evolutionInstanceName', instanceName);
        if (!org) {
            console.warn(`[Evolution] Org no encontrada para instance="${instanceName}"`);
            return res.sendStatus(200);
        }

        // Buscar conversación abierta o crear una nueva
        let conv = await findOpenConversation(org.id, 'whatsapp', phone);
        if (!conv) {
            conv = await createConversation(org.id, 'whatsapp', {
                id:    phone,
                name:  pushName,
                phone,
            });
            console.log(`[Evolution] Nueva conversación creada: conv="${conv.id}" org="${org.id}"`);
        }

        // Guardar el mensaje (dispara autoResponder de IA si aiEnabled: true)
        await saveIncomingMessage(org.id, conv.id, {
            text,
            sender:     phone,
            senderName: pushName,
            platform:   'whatsapp',
        });

        console.log(
            `[Evolution] Mensaje guardado. instance="${instanceName}" `
            + `org="${org.id}" conv="${conv.id}" from="${phone}"`
        );

        return res.sendStatus(200);
    } catch (err) {
        console.error('[Evolution] Error procesando webhook:', err);
        return res.sendStatus(500);
    }
});
