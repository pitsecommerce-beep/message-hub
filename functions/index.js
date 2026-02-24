/**
 * MessageHub - Firebase Cloud Functions
 * Punto de entrada: exporta todos los triggers y webhooks.
 *
 * Se inicializa firebase-admin una sola vez aquí antes de importar
 * cualquier módulo que use Firestore o Admin SDK.
 */
const { initializeApp } = require('firebase-admin/app');
initializeApp();

// Webhooks HTTP de Meta (WhatsApp / Instagram / Messenger)
const { whatsappWebhook } = require('./src/webhooks/whatsapp');
const { instagramWebhook } = require('./src/webhooks/instagram');
const { messengerWebhook } = require('./src/webhooks/messenger');

// Webhook de WhatsApp vía Evolution API (QR, sin aprobación Meta)
const { whatsappEvolutionWebhook } = require('./src/webhooks/whatsappEvolution');

// Webhook de pagos MercadoPago
const { mercadopagoWebhook } = require('./src/webhooks/mercadopago');

// Trigger Firestore: auto-responder de IA
const { autoResponder } = require('./src/ai/autoResponder');

module.exports = {
    whatsappWebhook,
    instagramWebhook,
    messengerWebhook,
    whatsappEvolutionWebhook,
    mercadopagoWebhook,
    autoResponder,
};
