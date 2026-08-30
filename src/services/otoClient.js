const axios = require("axios");
const config = require("../config");
const tokenManager = require("./otoTokenManager");

async function authedRequest({ method, path, data, params }) {
  const doRequest = async (accessToken) => {
    return axios({
      method,
      url: `${config.oto.baseUrl}${path}`,
      data,
      params,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        "Content-Type": "application/json",
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

    if (err.response?.data) {
      err.otoErrorPayload = err.response.data;
    }
    throw err;
  }
}

async function healthCheck() {
  const response = await axios.get(`${config.oto.baseUrl}/healthCheck`);
  return response.data;
}

async function createOrder(orderPayload) {
  return authedRequest({
    method: "post",
    path: "/createOrder",
    data: orderPayload,
  });
}

async function registerWebhook({
  url,
  webhookType = "orderStatus",
  method = "post",
}) {
  return authedRequest({
    method: "post",
    path: "/webhook",
    data: {
      method,
      url,
      webhookType,
      secretKey: config.oto.webhookSecret,
    },
  });
}

async function listWebhooks() {
  return authedRequest({ method: "get", path: "/webhook" });
}

async function checkDeliveryFee(payload) {
  return authedRequest({
    method: "post",
    path: "/checkOTODeliveryFee",
    data: payload,
  });
}

module.exports = {
  healthCheck,
  createOrder,
  registerWebhook,
  listWebhooks,
  checkDeliveryFee,
};
