const axios = require('axios');
const config = require('../config');
const tokenManager = require('./otoTokenManager');

/**
 * Makes an authenticated request to OTO. Automatically retries once with a
 * freshly fetched access_token if the first attempt comes back 401
 * (covers the case where our cached token expired slightly early/late).
 */
async function authedRequest({ method, path, data, params }) {
  const doRequest = async (accessToken) => {
    return axios({
      method,
      url: `${config.oto.baseUrl}${path}`,
      data,
      params,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
    });
  };

  const accessToken = await tokenManager.getAccessToken();

  try {
    const response = await doRequest(accessToken);
    return response.data;
  } catch (err) {
    if (err.response && err.response.status === 401) {
      tokenManager.invalidate();
      const freshToken = await tokenManager.getAccessToken();
      const response = await doRequest(freshToken);
      return response.data;
    }
    throw err;
  }
}

/**
 * Health check - no authentication required per OTO docs.
 * Good first call to confirm network + base URL are correct.
 */
async function healthCheck() {
  const response = await axios.get(`${config.oto.baseUrl}/healthCheck`);
  return response.data;
}

/**
 * Creates an order in OTO.
 * `orderPayload` should already match OTO's createOrder body shape -
 * see mapMegaOrderToOtoOrder() in the megaWebhook route for the mapping
 * from a Mega Ai order into this shape.
 *
 * Response on success: { success: true, otoId: <number> }
 */
async function createOrder(orderPayload) {
  return authedRequest({
    method: 'post',
    path: '/createOrder',
    data: orderPayload,
  });
}

/**
 * Registers (or re-registers) our webhook URL with OTO so it calls us back
 * when an order's status changes, or when a shipment creation error happens.
 *
 * webhookType: 'orderStatus' (default) | 'shipmentError' | 'newOrders'
 */
async function registerWebhook({ url, webhookType = 'orderStatus', method = 'post' }) {
  return authedRequest({
    method: 'post',
    path: '/webhook',
    data: {
      method,
      url,
      webhookType,
      secretKey: config.oto.webhookSecret,
    },
  });
}

async function listWebhooks() {
  return authedRequest({ method: 'get', path: '/webhook' });
}

/**
 * POST /checkOTODeliveryFee - real-time delivery fee quote from all of
 * OTO's pre-integrated carriers, before any order/shipment exists yet.
 * This is the piece that powers dynamic shipping rates at checkout.
 *
 * Required by OTO: originCity, destinationCity, weight.
 */
async function checkDeliveryFee({
  originCity,
  destinationCity,
  weight,
  originCountry,
  destinationCountry,
  currency,
  packageCount,
  totalDue,
  length,
  width,
  height,
  serviceType,
}) {
  return authedRequest({
    method: 'post',
    path: '/checkOTODeliveryFee',
    data: {
      originCity,
      destinationCity,
      weight,
      originCountry,
      destinationCountry,
      currency,
      packageCount,
      totalDue,
      length,
      width,
      height,
      serviceType,
    },
  });
}

module.exports = {
  healthCheck,
  createOrder,
  registerWebhook,
  listWebhooks,
  checkDeliveryFee,
};
