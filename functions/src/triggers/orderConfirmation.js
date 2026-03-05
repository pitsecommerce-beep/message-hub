/**
 * Trigger: envía confirmación de pedido al cliente por WhatsApp
 * cuando se escribe un mensaje con generatedBy = 'order_confirmation'.
 */
const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { getEvolutionConfig, db } = require('../utils/firestore');

/**
 * Envía un mensaje de texto al número de WhatsApp usando Evolution API.
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

exports.orderConfirmationSender = onDocumentCreated(
    'organizations/{orgId}/conversations/{convId}/messages/{msgId}',
    async (event) => {
        const { orgId, convId } = event.params;
        const data = event.data?.data();

        if (!data) return null;

        // Only process order confirmation messages
        if (data.generatedBy !== 'order_confirmation') return null;
        if (data.direction !== 'outgoing') return null;

        try {
            // Get conversation to find the phone number
            const convDoc = await db
                .collection('organizations').doc(orgId)
                .collection('conversations').doc(convId)
                .get();

            if (!convDoc.exists) return null;
            const conv = convDoc.data();

            // Only send via WhatsApp for now
            if (conv.platform !== 'whatsapp') return null;

            const phone = conv.contactPhone;
            if (!phone) {
                console.log('[orderConfirmation] No phone number found for conversation');
                return null;
            }

            const evoConfig = await getEvolutionConfig(orgId);
            if (!evoConfig) {
                console.log('[orderConfirmation] No Evolution API config found');
                return null;
            }

            await sendEvolutionMessage(evoConfig, phone, data.text);
            console.log(`[orderConfirmation] Message sent to ${phone} via Evolution API`);
        } catch (err) {
            console.error('[orderConfirmation] Error sending confirmation:', err.message);
        }

        return null;
    }
);
