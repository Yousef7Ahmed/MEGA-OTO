/**
 * MRSOOL CLIENT - NOT YET IMPLEMENTED.
 *
 * Unlike OTO, we have not found a public, documented REST API for creating
 * a delivery order on Mrsool from an external store. "Mrsool for Business"
 * (business.mrsool.co) appears to be about listing your shop/menu inside
 * the Mrsool app, which is a different thing from a merchant-initiated
 * delivery-order API.
 *
 * Before wiring this up for real, we need from Mrsool directly (not just
 * the client):
 *   1. Confirmation that a merchant-initiated order/delivery API exists.
 *   2. Official API documentation (base URL, auth method, endpoints).
 *   3. A real API key / credential scoped to this store.
 *
 * Once that's confirmed, implement createDelivery() below the same way
 * otoClient.createOrder() is implemented, and wire it into
 * routes/megaWebhook.js next to the OTO call.
 */

async function createDelivery(/* orderPayload */) {
  throw new Error(
    'Mrsool integration is not implemented yet - pending official API docs and credentials from Mrsool.'
  );
}

module.exports = { createDelivery };
