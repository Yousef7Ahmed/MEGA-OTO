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

  whatsapp: {
    // WaFinal — نفس نظام واتساب اللي بيشغّل بوت المبيعات على المنصّة.
    // اطلعهم بالأمر: php artisan whatsapp:wafinal-creds --slug=hujj
    wafinalBaseUrl:    required('WAFINAL_BASE_URL', ''),
    wafinalApiToken:   required('WAFINAL_API_TOKEN', ''),
    wafinalInstanceId: required('WAFINAL_INSTANCE_ID', ''),

    enabled:      required('WHATSAPP_ENABLED', 'true') === 'true',
    notifyVendor: required('WHATSAPP_NOTIFY_VENDOR', 'true') === 'true',

    defaultCountryCode: required('WHATSAPP_COUNTRY_CODE', '966'),
    storeName:          required('WHATSAPP_STORE_NAME', 'القريات'),
  },

  shipping: {
    // City OTO should treat as the pickup point for rate quotes.
    originCity: required('SHIPPING_ORIGIN_CITY', 'Riyadh'),
    // Shared secret Mega Ai must send back in the Authorization header
    // when it calls our /shipping/rate-callback route.
    callbackSecret: required('SHIPPING_CALLBACK_SECRET', ''),
    // وزن تقديري للقطعة لما المنتج ما يكونش متسجّل له وزن
    fallbackItemWeight: Number(required('SHIPPING_FALLBACK_ITEM_WEIGHT', '0.5')),
  },
};
