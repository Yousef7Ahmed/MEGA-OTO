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
  const body = req.body || {};

  /**
   * ميجا بقت بتبعت بيانات أغنى (ship_to / items / totals / vendors).
   * بنقرا الجديد الأول وبنرجع للقديم لو مش موجود — عشان الاتنين
   * يشتغلوا من غير ما نكسر أي حاجة.
   */
  const shipTo = body.ship_to || {};
  const totals = body.totals || {};

  const cityId  = shipTo.city_id  ?? body.city_id;
  const stateId = shipTo.state_id ?? body.state_id;

  // الوزن: totals.total_weight (كيلو) هو المصدر الجديد
  let weight = Number(totals.total_weight ?? body.weight ?? 0);

  // لو الوزن صفر (منتجات مستوردة من غير product_weight) نحسب تقدير
  // من عدد القطع بدل ما نبعت صفر ويطلع سعر شحن غلط.
  if (!weight || weight <= 0) {
    const qty = Number(totals.total_qty ?? (body.items || []).length ?? 1) || 1;
    weight = qty * Number(config.shipping.fallbackItemWeight);
    console.warn(
      `[shipping-rate-callback] مفيش أوزان للمنتجات — استخدمنا تقدير ${weight}kg لـ ${qty} قطعة.`,
    );
  }

  const dimensions = body.dimensions;

  console.log(
    `[shipping-rate-callback] طلب من ميجا (متجر ${storeId}) — ` +
      `${totals.items_count ?? '?'} منتج، ${totals.total_qty ?? '?'} قطعة، ` +
      `وزن ${weight}kg، إجمالي ${totals.sub_total ?? body.total ?? '?'}، ` +
      `مدينة ${shipTo.city_name || cityId || '-'}`,
  );
  console.log('[shipping-rate-callback] البيانات الكاملة:', JSON.stringify(body));

  try {
    const { name: destinationCity, precise } = await resolveDestinationCity({ cityId, stateId });
    if (!precise) {
      console.warn('[shipping-rate-callback] used an imprecise city fallback - Mega Ai did not send a matching city_id.');
    }

    const otoResponse = await otoClient.checkDeliveryFee({
      originCity: config.shipping.originCity,
      destinationCity,
      weight,
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
