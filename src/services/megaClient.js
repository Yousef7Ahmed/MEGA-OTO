const axios = require('axios');
const config = require('../config');

/**
 * !! UNCONFIRMED API - BUILT TO TEST, NOT TRUSTED YET !!
 *
 * Everything in this file is based on `megaa-tons-external-api-docs.md`,
 * a document whose authenticity we have NOT verified against the real
 * platform (unlike otoClient.js, which is built from OTO's own published
 * help-center articles).
 *
 * The whole point of this file is to find out, with one real API key,
 * whether the endpoints below actually exist and behave as described.
 * See scripts/testMegaApi.js for the quickest way to check.
 *
 * If a call here returns 404, or HTML instead of JSON, or a shape that
 * doesn't match what's expected - that's the answer: the doc was wrong,
 * and we say so plainly instead of pretending it works.
 */

function client() {
  if (!config.mega.apiKey) {
    throw new Error(
      'MEGA_API_KEY is not set. Ask the store owner for a real API key from Mega Ai before testing this.'
    );
  }

  return axios.create({
    baseURL: config.mega.baseUrl,
    headers: {
      'X-API-Key': config.mega.apiKey,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
  });
}

/** GET /orders - list orders for the authenticated store. */
async function listOrders({ status, since, perPage = 10, page = 1 } = {}) {
  const response = await client().get('/orders', {
    params: { status, since, per_page: perPage, page },
  });
  return response.data;
}

/** GET /orders/{id} - full details for one order. */
async function getOrder(orderId) {
  const response = await client().get(`/orders/${orderId}`);
  return response.data;
}

/** PUT /orders/{id}/status - update an order's status. */
async function updateOrderStatus(orderId, status) {
  const response = await client().put(`/orders/${orderId}/status`, { status });
  return response.data;
}

/**
 * PUT /orders/{id}/tracking - update tracking info.
 * Per the doc, this also auto-sets status to "shipped" on Mega Ai's side.
 */
async function updateTracking(orderId, { trackingNumber, trackingUrl, shippingCarrier }) {
  const response = await client().put(`/orders/${orderId}/tracking`, {
    tracking_number: trackingNumber,
    tracking_url: trackingUrl,
    shipping_carrier: shippingCarrier,
  });
  return response.data;
}

/**
 * POST /shipping-rates - ask Mega Ai to fetch rates from all registered
 * shipping providers. Only useful once registerShippingProvider() below
 * has been called successfully AND Mega Ai's checkout actually calls this.
 */
async function calculateShippingRates(payload) {
  const response = await client().post('/shipping-rates', payload);
  return response.data;
}

/**
 * POST /shipping-providers - register OUR backend as a shipping-rate
 * provider so Mega Ai's checkout can query us for live OTO/Mrsool rates.
 * `callbackUrl` should point at our own /shipping/rate-callback route
 * (see routes/shippingRateCallback.js).
 */
async function registerShippingProvider({ name, callbackUrl, apiKey, priority = 0 }) {
  const response = await client().post('/shipping-providers', {
    name,
    callback_url: callbackUrl,
    api_key: apiKey,
    priority,
  });
  return response.data;
}

/**
 * GET /states - list Mega Ai's regions for a country.
 * CONFIRMED REAL (2026-08-26) - returns [{id, name, country_id}].
 */
async function getStates(countryId = 194) {
  const response = await client().get('/states', { params: { country_id: countryId } });
  return response.data;
}

/**
 * GET /cities - list cities under a state, or all cities for a country.
 * CONFIRMED REAL (2026-08-26) - returns [{id, name, state_id, country_id}].
 */
async function getCities({ stateId, countryId } = {}) {
  const response = await client().get('/cities', {
    params: { state_id: stateId, country_id: countryId },
  });
  return response.data;
}

module.exports = {
  listOrders,
  getOrder,
  updateOrderStatus,
  updateTracking,
  calculateShippingRates,
  registerShippingProvider,
  getStates,
  getCities,
};
