const express = require("express");
const config = require("../config");
const otoClient = require("../services/otoClient");
const orderStore = require("../store/orderStore");

const router = express.Router();

/**
 * تشخيص: ليه أوتو ما حجزش شحنة لطلب؟
 *
 *   GET /debug/shipping?key=OTO_WEBHOOK_SECRET&id=88
 *       ← قراءة بس: حالة الطلب، شركات الشحن المفعّلة، الأسعار للمدينة، حركات المحفظة.
 *
 *   GET /debug/shipping?key=...&id=88&try=1[&option=123]
 *       ← بيحاول يحجز الشحنة فعلاً ويرجّع رد أوتو زي ما هو.
 *         لو نجح: الشحنة اتحجزت بجد واتخصم تمنها من المحفظة.
 */

function cut(v, n = 1500) {
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s && s.length > n ? s.slice(0, n) + "…" : s;
}

async function step(fn) {
  try {
    return { ok: true, data: await fn() };
  } catch (err) {
    return { ok: false, http: err.response?.status || null, error: err.response?.data ?? err.message };
  }
}

router.get("/shipping", async (req, res) => {
  const secret = config.oto.webhookSecret;
  if (!secret || req.query.key !== secret) {
    return res.status(401).json({ success: false, error: "unauthorized" });
  }
  const orderId = String(req.query.id || "").trim();
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(orderId)) {
    return res.status(422).json({ success: false, error: "id مطلوب" });
  }

  const out = { orderId, settings: {
    createShipmentOnOrder: process.env.OTO_CREATE_SHIPMENT === "true",
    pickupLocationCode: process.env.OTO_PICKUP_LOCATION_CODE || null,
    originCity: config.shipping.originCity,
  } };

  // 1) الطلب عند أوتو
  const details = await step(() => otoClient.getOrderDetails(orderId));
  const o = details.ok ? (details.data.order || details.data.data || details.data) : {};
  out.order = details.ok
    ? {
        status: o.status ?? null,
        city: o.customer?.city ?? o.city ?? o.customerCity ?? null,
        weight: o.packageWeight ?? o.weight ?? null,
        paymentMethod: o.payment_method ?? o.paymentMethod ?? null,
        amountDue: o.amount_due ?? o.amountDue ?? null,
        pickupLocationCode: o.pickupLocationCode ?? null,
        deliveryCompany: o.deliveryCompany ?? o.deliveryCompanyName ?? null,
        trackingNumber: o.trackingNumber ?? null,
        raw: cut(details.data, 2500),
      }
    : details;

  // 2) آخر خطأ حجز وصل بالويب هوك (لو السيرفر ما اتعملوش restart من ساعتها)
  const local = orderStore.getOrder(orderId) || {};
  out.lastShipmentError = local.errorMessage || local.deliveryCompanyResponse
    ? { message: local.errorMessage || null, carrierResponse: cut(local.deliveryCompanyResponse || null, 600), at: local.shipmentErrorAt || null }
    : null;

  // 3) شركات الشحن المفعّلة في الحساب
  const options = await step(() => otoClient.getDeliveryOptions());
  if (options.ok) {
    const list = options.data.options || options.data.deliveryOptions || options.data.deliveryCompany || options.data.data || [];
    out.activatedCarriers = Array.isArray(list)
      ? { count: list.length, list: list.slice(0, 30).map((x) => ({
          id: x.deliveryOptionId ?? x.id ?? null,
          company: x.deliveryCompanyName ?? x.deliveryCompany ?? x.name ?? null,
          option: x.deliveryOptionName ?? x.optionName ?? null,
          active: x.isActive ?? x.active ?? x.status ?? null,
        })) }
      : { raw: cut(options.data) };
  } else {
    out.activatedCarriers = options;
  }

  // 4) الأسعار المتاحة لمدينة الطلب (لو فاضية = مفيش شركة بتغطي المدينة دي)
  const city = out.order?.city || req.query.city || null;
  if (city) {
    const fee = await step(() => otoClient.checkDeliveryFee({
      originCity: config.shipping.originCity,
      destinationCity: city,
      weight: Number(out.order?.weight) || 1,
    }));
    out.ratesForCity = fee.ok
      ? { from: config.shipping.originCity, to: city, count: (fee.data.deliveryCompany || []).length,
          list: (fee.data.deliveryCompany || []).slice(0, 15).map((x) => ({
            id: x.deliveryOptionId ?? null, company: x.deliveryCompanyName, option: x.deliveryOptionName, price: x.price, cod: x.codCharge ?? null })) }
      : fee;
  } else {
    out.ratesForCity = { skipped: "مدينة الطلب مش معروفة — ضيف &city=Qurayyat" };
  }

  // 5) المحفظة
  const day = (d) => d.toISOString().slice(0, 10);
  const credit = await step(() => otoClient.creditTransactions({
    perPage: 5, page: 1,
    minDate: day(new Date(Date.now() - 60 * 24 * 3600 * 1000)), maxDate: day(new Date(Date.now() + 24 * 3600 * 1000)),
  }));
  out.wallet = credit.ok ? { raw: cut(credit.data, 1500) } : credit;

  // أماكن الاستلام المسجّلة عند أوتو (V{رقم البائع} = عنوان بائع)
  const pickups = await step(() => otoClient.getPickupLocationList({ status: "active" }));
  out.pickupLocations = pickups.ok
    ? [...(pickups.data.warehouses || []), ...(pickups.data.branches || [])].slice(0, 50).map((w) => ({ code: w.code, name: w.name, city: w.city }))
    : pickups;

  // 6) محاولة حجز فعلية (اختياري)
  if (req.query.try === "1") {
    const attempt = await step(() => otoClient.createShipment(orderId, req.query.option));
    out.createShipmentAttempt = attempt.ok ? { success: true, response: attempt.data } : { success: false, http: attempt.http, otoSays: attempt.error };
    console.log(`[debug-shipping] createShipment ${orderId}:`, cut(out.createShipmentAttempt, 800));
  } else {
    out.createShipmentAttempt = "ما اتجرّبش — ضيف &try=1 عشان نحاول نحجز فعلاً ونشوف رد أوتو";
  }

  res.json(out);
});

module.exports = router;
