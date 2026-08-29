const express = require('express');
const config = require('../config');
const otoClient = require('../services/otoClient');
const { resolveDestinationCity } = require('../services/megaLocationMap');

const router = express.Router();

/**
 * Confirmed by inspecting real traffic from Mega Ai: it sends our secret
 * in an `X-API-Key` header (not `Authorization`, despite the doc's
 * wording), alongside an `X-Store-Id` header.
 */
function verifyCallbackAuth(req) {
  if (!config.shipping.callbackSecret) return true; // nothing configured yet
  const providedKey = req.headers['x-api-key'] || '';
  return providedKey === config.shipping.callbackSecret;
}

router.post('/rate-callback', async (req, res) => {
  if (!verifyCallbackAuth(req)) {
    console.warn('[shipping-rate-callback] rejected - bad/missing X-API-Key header');
    return res.status(401).json({ rates: [] });
  }

  const storeId = req.headers['x-store-id'];
  const { weight, dimensions, state_id: stateId, city_id: cityId } = req.body;
  console.log(`[shipping-rate-callback] request from Mega Ai (store ${storeId}):`, JSON.stringify(req.body));

  try {
    const { name: destinationCity, precise } = await resolveDestinationCity({ cityId, stateId });
    if (!precise) {
      console.warn('[shipping-rate-callback] used an imprecise city fallback - Mega Ai did not send a matching city_id.');
    }

    const otoResponse = await otoClient.checkDeliveryFee({
      originCity: config.shipping.originCity,
      destinationCity,
      weight: weight || 1,
      length: dimensions?.length,
      width: dimensions?.width,
      height: dimensions?.height,
    });

    const rates = (otoResponse.deliveryCompany || []).map((option) => ({
      service: `${option.deliveryCompanyName} - ${option.deliveryOptionName}`,
      price: option.price,
      currency: 'SAR',
      estimated_days: option.avgDeliveryTime,
    }));

    console.log(`[shipping-rate-callback] returning ${rates.length} rate(s) to Mega Ai`);
    return res.status(200).json({ rates });
  } catch (err) {
    // Per the doc, Mega Ai treats this provider as having no rates on
    // failure - so we return an empty array rather than an error status,
    // to avoid breaking checkout for the customer. We still log loudly.
    const details = err.response?.data || err.message;
    console.error('[shipping-rate-callback] FAILED, returning empty rates:', details);
    return res.status(200).json({ rates: [] });
  }
});

module.exports = router;
