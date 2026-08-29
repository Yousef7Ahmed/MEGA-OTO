const express = require('express');
const crypto = require('crypto');
const config = require('../config');
const orderStore = require('../store/orderStore');
const megaClient = require('../services/megaClient');

const router = express.Router();

/**
 * !! BEST-EFFORT / UNCONFIRMED !!
 * Maps an OTO status onto Mega Ai's documented status enum
 * (pending, confirmed, picked, shipped, delivered, cancelled).
 * We have NOT seen OTO's real list of status strings yet - these are
 * reasonable guesses. Adjust once real payloads come in (see the
 * console.log below, which prints the raw status every time).
 */
function mapOtoStatusToMega(otoStatus) {
  const s = String(otoStatus || '').toLowerCase();
  if (s.includes('deliver')) return 'delivered';
  if (s.includes('pick')) return 'picked';
  if (s.includes('cancel') || s.includes('return')) return 'cancelled';
  if (s.includes('ship') || s.includes('transit') || s.includes('out_for')) return 'shipped';
  return null; // unknown - don't guess, just skip the status push
}

/**
 * Tries to push the status/tracking update into Mega Ai. Never throws -
 * this is the part we're not sure exists, so a failure here must NOT
 * break the OTO webhook response (OTO doesn't care whether Mega Ai worked).
 */
async function tryPushToMega(orderId, payload) {
  if (!config.mega.apiKey) {
    console.log('[mega-push] Skipped - MEGA_API_KEY not set yet.');
    return;
  }

  try {
    if (payload.trackingNumber) {
      const result = await megaClient.updateTracking(orderId, {
        trackingNumber: payload.trackingNumber,
        trackingUrl: payload.trackingUrl,
        shippingCarrier: payload.deliveryCompany,
      });
      console.log('[mega-push] updateTracking succeeded:', JSON.stringify(result));
    }

    const mappedStatus = mapOtoStatusToMega(payload.status || payload.dcStatus);
    if (mappedStatus) {
      const result = await megaClient.updateOrderStatus(orderId, mappedStatus);
      console.log(`[mega-push] updateOrderStatus('${mappedStatus}') succeeded:`, JSON.stringify(result));
    } else {
      console.log(`[mega-push] Could not map OTO status "${payload.status}" to a Mega Ai status - skipped.`);
    }
  } catch (err) {
    const details = err.response ? `HTTP ${err.response.status}: ${JSON.stringify(err.response.data)}` : err.message;
    console.error('[mega-push] FAILED (this is the unconfirmed part - doc may be wrong):', details);
  }
}

/**
 * Verifies OTO's HMAC-SHA256 signature for an orderStatus payload.
 * Per OTO docs: sign "orderId:status:timestamp" with our webhook secretKey,
 * HmacSHA256, Base64-encoded, and compare against payload.signature.
 */
function verifyOrderStatusSignature(payload) {
  if (!config.oto.webhookSecret) return true; // nothing to check against yet
  const { orderId, status, timestamp, signature } = payload;
  const expected = crypto
    .createHmac('sha256', config.oto.webhookSecret)
    .update(`${orderId}:${status}:${timestamp}`)
    .digest('base64');
  return expected === signature;
}

router.post('/oto/status', (req, res) => {
  const payload = req.body;
  console.log('[oto-webhook] status update received:', JSON.stringify(payload));

  if (!verifyOrderStatusSignature(payload)) {
    console.warn('[oto-webhook] signature mismatch - rejecting payload.');
    return res.status(401).json({ success: false, error: 'invalid signature' });
  }

  orderStore.saveOrder(String(payload.orderId), {
    otoStatus: payload.status,
    dcStatus: payload.dcStatus,
    trackingNumber: payload.trackingNumber,
    trackingUrl: payload.trackingUrl,
    deliveryCompany: payload.deliveryCompany,
    driverName: payload.driverName,
    driverPhone: payload.driverPhone,
    status: 'status_updated',
  });

  // Fire-and-log: try pushing to Mega Ai, but always answer OTO with 200
  // regardless of whether that push succeeds.
  tryPushToMega(String(payload.orderId), payload);

  return res.status(200).json({ success: true });
});

router.post('/oto/shipment-error', (req, res) => {
  console.error('[oto-webhook] shipment error:', JSON.stringify(req.body));
  const { orderId, errorMessage, deliveryCompanyResponse } = req.body;

  orderStore.saveOrder(String(orderId), {
    status: 'shipment_error',
    errorMessage,
    deliveryCompanyResponse,
  });

  return res.status(200).json({ success: true });
});

module.exports = router;
