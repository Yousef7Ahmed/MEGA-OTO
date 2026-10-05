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

// رابط طباعة بوليصة الشحن (AWB) — GET /print/:orderId
async function getPrintAwb(orderId) {
  return authedRequest({
    method: "get",
    path: `/print/${encodeURIComponent(orderId)}`,
  });
}

// تفاصيل الطلب عند أوتو (الحالة، رقم التتبّع، رابط البوليصة لو اتعملت)
async function getOrderDetails(orderId) {
  return authedRequest({
    method: "get",
    path: "/orderDetails",
    params: { orderId },
  });
}

// حجز شحنة لطلب موجود عند أوتو (deliveryOptionId اختياري)
async function createShipment(orderId, deliveryOptionId) {
  return authedRequest({
    method: "post",
    path: "/createShipment",
    data: { orderId, ...(deliveryOptionId ? { deliveryOptionId: Number(deliveryOptionId) } : {}) },
  });
}

// شركات الشحن المفعّلة في الحساب
async function getDeliveryOptions() {
  return authedRequest({ method: "get", path: "/getDeliveryOptions" });
}

// حركات المحفظة (الرصيد)
async function creditTransactions(params = {}) {
  return authedRequest({ method: "get", path: "/creditTransactions", params });
}

// أماكن الاستلام (عنوان كل بائع)
async function createPickupLocation(payload) {
  return authedRequest({ method: "post", path: "/createPickupLocation", data: payload });
}

async function updatePickupLocation(payload) {
  return authedRequest({ method: "post", path: "/updatePickupLocation", data: payload });
}

async function getPickupLocationList(params = {}) {
  return authedRequest({ method: "get", path: "/getPickupLocationList", params });
}

module.exports = {
  healthCheck,
  createPickupLocation,
  updatePickupLocation,
  getPickupLocationList,
  createShipment,
  getDeliveryOptions,
  creditTransactions,
  getPrintAwb,
  getOrderDetails,
  createOrder,
  registerWebhook,
  listWebhooks,
  checkDeliveryFee,
};
