require('dotenv').config();

function required(name, fallback = undefined) {
  const value = process.env[name] ?? fallback;
  return value;
}

module.exports = {
  port: Number(process.env.PORT || 3000),

  oto: {
    refreshToken: required('OTO_REFRESH_TOKEN'),
    baseUrl: required('OTO_BASE_URL', 'https://api.tryoto.com/rest/v2'),
    webhookSecret: required('OTO_WEBHOOK_SECRET'),
  },

  publicBaseUrl: required('PUBLIC_BASE_URL'),

  mega: {
    webhookSharedSecret: required('MEGA_WEBHOOK_SHARED_SECRET', ''),
    // UNCONFIRMED - see services/megaClient.js for why.
    apiKey: required('MEGA_API_KEY', ''),
    baseUrl: required('MEGA_BASE_URL', 'https://megaa-tons.net/api/external'),
  },

  mrsool: {
    apiKey: required('MRSOOL_API_KEY', ''),
    baseUrl: required('MRSOOL_BASE_URL', ''),
  },

  shipping: {
    // City OTO should treat as the pickup point for rate quotes.
    originCity: required('SHIPPING_ORIGIN_CITY', 'Riyadh'),
    // Shared secret Mega Ai must send back in the Authorization header
    // when it calls our /shipping/rate-callback route.
    callbackSecret: required('SHIPPING_CALLBACK_SECRET', ''),
  },
};
