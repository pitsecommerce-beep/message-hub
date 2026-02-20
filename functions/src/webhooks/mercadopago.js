/**
 * MercadoPago Webhook Handler
 *
 * Handles payment notifications from MercadoPago and automatically confirms
 * orders/payment links when a payment is approved.
 *
 * Supports both notification formats:
 *   - IPN v1: GET/POST ?topic=payment&id={paymentId}
 *   - Webhooks v2: POST body.type=payment, body.data.id={paymentId}
 *
 * Flow:
 *   1. Extract paymentId from request
 *   2. Iterate all orgs with MP configured
 *   3. For each org, fetch payment from MP API using org's accessToken
 *   4. If payment found and approved, match by external_reference (trackingRef)
 *   5. Update paymentLink → 'paid', linked order → 'confirmado'
 */
const { onRequest } = require('firebase-functions/v2/https');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const https = require('https');

const db = getFirestore();

// ---------------------------------------------------------------------------
// HTTP helper
// ---------------------------------------------------------------------------
function httpsGet(url, accessToken) {
    return new Promise((resolve, reject) => {
        const options = {
            method: 'GET',
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
            },
        };
        const req = https.get(url, options, res => {
            let body = '';
            res.on('data', chunk => { body += chunk; });
            res.on('end', () => {
                try { resolve({ status: res.statusCode, data: JSON.parse(body) }); }
                catch (e) { resolve({ status: res.statusCode, data: null }); }
            });
        });
        req.on('error', reject);
        req.end();
    });
}

// ---------------------------------------------------------------------------
// Find all orgs with MercadoPago configured
// ---------------------------------------------------------------------------
async function findOrgsWithMP() {
    const snapshot = await db
        .collectionGroup('integrations')
        .where('platform', '==', 'mercadopago')
        .get();

    const orgs = [];
    for (const doc of snapshot.docs) {
        const data = doc.data();
        if (!data.accessToken) continue;
        const orgId = doc.ref.parent.parent.id;
        orgs.push({ orgId, accessToken: data.accessToken });
    }
    return orgs;
}

// ---------------------------------------------------------------------------
// Fetch payment from MP API
// ---------------------------------------------------------------------------
async function fetchMPPayment(paymentId, accessToken) {
    const url = `https://api.mercadopago.com/v1/payments/${paymentId}`;
    const result = await httpsGet(url, accessToken);
    if (result.status !== 200 || !result.data) return null;
    return result.data;
}

// ---------------------------------------------------------------------------
// Update paymentLink + order + conversation funnel on confirmed payment
// ---------------------------------------------------------------------------
async function confirmPayment(orgId, trackingRef, mpPaymentId, mpData) {
    // Find the payment link by trackingRef
    const plSnapshot = await db
        .collection('organizations').doc(orgId)
        .collection('paymentLinks')
        .where('trackingRef', '==', trackingRef)
        .limit(1)
        .get();

    if (plSnapshot.empty) {
        console.log(`[MP] No paymentLink found for trackingRef=${trackingRef} in org=${orgId}`);
        return false;
    }

    const plDoc  = plSnapshot.docs[0];
    const plData = plDoc.data();

    // Idempotency: skip if already paid
    if (plData.status === 'paid') {
        console.log(`[MP] PaymentLink ${plDoc.id} already marked as paid, skipping.`);
        return true;
    }

    const batch = db.batch();

    // 1. Update paymentLink
    batch.update(plDoc.ref, {
        status:        'paid',
        paidAt:        FieldValue.serverTimestamp(),
        mpPaymentId:   String(mpPaymentId),
        mpStatus:      mpData.status,
        mpStatusDetail: mpData.status_detail || '',
        updatedAt:     FieldValue.serverTimestamp(),
    });

    // 2. Update linked order if present
    const orderId = plData.orderId || null;
    if (orderId) {
        const orderRef = db
            .collection('organizations').doc(orgId)
            .collection('orders').doc(orderId);
        batch.update(orderRef, {
            status:    'confirmado',
            paidAt:    FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        });
    }

    // 3. Move conversation funnel to 'entregado' if present
    const conversationId = plData.conversationId || null;
    if (conversationId) {
        const convRef = db
            .collection('organizations').doc(orgId)
            .collection('conversations').doc(conversationId);
        batch.update(convRef, {
            funnelStage: 'entregado',
            updatedAt:   FieldValue.serverTimestamp(),
        });
    }

    await batch.commit();
    console.log(`[MP] Payment confirmed for org=${orgId} trackingRef=${trackingRef} orderId=${orderId}`);
    return true;
}

// ---------------------------------------------------------------------------
// Main webhook handler
// ---------------------------------------------------------------------------
exports.mercadopagoWebhook = onRequest(
    { region: 'us-central1', cors: false },
    async (req, res) => {
        // MercadoPago requires a quick 200 response to avoid retries
        // We respond immediately and process async

        // Extract payment ID from either format
        let paymentId = null;

        // IPN v1: query params
        const topic = req.query.topic || req.query.type;
        if (topic === 'payment' && req.query.id) {
            paymentId = req.query.id;
        }

        // Webhooks v2: body
        if (!paymentId && req.body && req.body.type === 'payment' && req.body.data && req.body.data.id) {
            paymentId = String(req.body.data.id);
        }

        // Also handle body.id directly
        if (!paymentId && req.body && req.body.id && topic === 'payment') {
            paymentId = String(req.body.id);
        }

        if (!paymentId) {
            // Not a payment notification — acknowledge silently
            return res.status(200).json({ received: true });
        }

        console.log(`[MP] Received payment notification: paymentId=${paymentId}`);
        res.status(200).json({ received: true }); // Respond immediately

        try {
            const orgs = await findOrgsWithMP();
            if (orgs.length === 0) {
                console.log('[MP] No orgs with MercadoPago configured.');
                return;
            }

            for (const { orgId, accessToken } of orgs) {
                const payment = await fetchMPPayment(paymentId, accessToken);
                if (!payment) continue; // This org doesn't have this payment

                const status = payment.status; // approved, pending, rejected, etc.
                if (status !== 'approved') {
                    console.log(`[MP] Payment ${paymentId} status=${status}, not confirming.`);
                    continue;
                }

                const trackingRef = payment.external_reference;
                if (!trackingRef) {
                    console.log(`[MP] Payment ${paymentId} has no external_reference.`);
                    continue;
                }

                await confirmPayment(orgId, trackingRef, paymentId, payment);
                break; // Payment confirmed for the right org, stop iterating
            }
        } catch (err) {
            console.error('[MP] Error processing payment webhook:', err);
        }
    }
);
