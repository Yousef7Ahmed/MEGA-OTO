const express = require('express');
const otoClient = require('../services/otoClient');
const megaClient = require('../services/megaClient');
const orderStore = require('../store/orderStore');
const { resolveDestinationCity } = require('../services/megaLocationMap');

const router = express.Router();

/**
 * CONFIRMED REAL (2026-08-27): the "Status Change" webhook's body is a
 * flat JSON object (mislabeled as x-www-form-urlencoded - see server.js)
 * shaped like:
 *   { id, order_id, order_status, order_status_text, payment_status,
 *     product: [{ product_id, name, qty, final_price, ... }], ... }
 *
 * CRITICALLY: this payload does NOT include delivery_address at all.
 * "New Order" as a trigger never fired in testing - "Status Change" is
 * the only webhook event confirmed to actually work, and it only tells
 * us "something changed on order {id}". So we treat it as a lightweight
 * ping and fetch the full order (which DOES include delivery_address)
 * ourselves via GET /orders/{id} before doing anything else.
 */

/**
 * Builds the OTO createOrder payload from a FULL order object, i.e. the
 * `data` field of a GET /orders/{id} response - not the thin webhook body.
 */
async function mapMegaOrderToOtoOrder(order) {
  const address = order.delivery_address || {};

  const { name: destinationCity } = await resolveDestinationCity({
    cityId: address.city_id,
    stateId: address.state_id,
  });

  const items = order.items || [];
  const totalWeight = items.reduce((sum, item) => sum + (Number(item.weight) || 0) * (Number(item.qty) || 1), 0);

  return {
    orderId: String(order.id ?? order.order_id ?? ''),
    payment_method: order.payment_status === 'Paid' ? 'paid' : 'cod',
    amount: Number(order.final_price ?? 0),
    amount_due: order.payment_status === 'Paid' ? 0 : Number(order.final_price ?? 0),
    currency: 'SAR',
    shippingAmount: Number(order.delivery_price ?? 0),
    subtotal: Number(order.product_price ?? 0),
    weight: totalWeight || undefined,
    createShipment: false, // keep false until OTO pickup locations are confirmed set up
    customer: {
      name: `${address.first_name ?? ''} ${address.last_name ?? ''}`.trim(),
      mobile: address.phone ?? '',
      email: address.email ?? '',
      address: address.address ?? '',
      city: destinationCity,
      country: 'SA',
    },
    items: items.map((item) => ({
      name: item.name,
      price: Number(item.final_price ?? item.original_price ?? 0),
      rowTotal: Number(item.final_price ?? 0) * Number(item.qty ?? 1),
      quantity: Number(item.qty ?? 1),
      sku: String(item.product_id ?? ''),
    })),
  };
}

router.post('/megaai/order', async (req, res) => {
  // req.body is raw text here (see server.js) because Mega Ai mislabels
  // its Content-Type - parse it ourselves.
  let webhookPayload;
  try {
    webhookPayload = JSON.parse(req.body);
  } catch (err) {
    console.error('[mega-webhook] Body was not valid JSON:', String(req.body).slice(0, 300));
    return res.status(400).json({ success: false, error: 'Payload was not valid JSON' });
  }

  console.log('[mega-webhook] Webhook ping received for order id:', webhookPayload.id, '- status:', webhookPayload.order_status_text);

  const orderId = String(webhookPayload.id ?? webhookPayload.order_id ?? '');
  if (!orderId) {
    console.error('[mega-webhook] Webhook payload has no order id - cannot proceed.');
    return res.status(422).json({ success: false, error: 'No order id in webhook payload' });
  }

  // Idempotency guard: don't recreate an OTO shipment every time the
  // order's status changes again later (e.g. confirmed -> shipped -> delivered
  // would otherwise fire this webhook multiple times for the same order).
  const existing = orderStore.getOrder(orderId);
  if (existing && existing.status === 'sent_to_oto') {
    console.log(`[mega-webhook] Order ${orderId} was already sent to OTO earlier - skipping re-creation.`);
    return res.status(200).json({ success: true, note: 'already processed' });
  }

  try {
    const fullOrderResponse = await megaClient.getOrder(orderId);
    const fullOrder = fullOrderResponse.data || fullOrderResponse;
    console.log('[mega-webhook] Fetched full order details:', JSON.stringify(fullOrder));

    const otoOrderPayload = await mapMegaOrderToOtoOrder(fullOrder);
    const otoResponse = await otoClient.createOrder(otoOrderPayload);

    orderStore.saveOrder(orderId, {
      megaFullOrder: fullOrder,
      otoOrderPayload,
      otoResponse,
      status: 'sent_to_oto',
    });

    console.log('[mega-webhook] Order sent to OTO successfully:', otoResponse);
    return res.status(200).json({ success: true });
  } catch (err) {
    const details = err.response?.data || err.message;
    console.error('[mega-webhook] Failed to process order:', details);
    return res.status(500).json({ success: false, error: 'Failed to process order', details });
  }
});

module.exports = router;
