const express = require("express");
const crypto = require("crypto");
const config = require("../config");
const otoClient = require("../services/otoClient");
const orderStore = require("../store/orderStore");

const router = express.Router();

/**
 * رابط بوليصة الشحن (AWB) لطلب.
 *
 *   GET /api/label/:orderId        Header: X-Label-Key: <LABEL_API_KEY أو OTO_WEBHOOK_SECRET>
 *
 * الرد:
 *   { success:true,  url, trackingNumber, carrier, status }
 *   { success:false, reason:"not_ready"|"shipment_error"|"not_found"|"oto_error", message, status }
 *
 * الذاكرة هنا بتتمسح مع كل إعادة تشغيل، فالمرجع الحقيقي هو أوتو نفسه:
 * بنسأله مباشرة لو الرابط مش محفوظ عندنا.
 */

function keyOk(req) {
  const expected = String(config.labelApiKey || "");
  const got = String(req.get("X-Label-Key") || req.query.key || "");
  if (!expected || got.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(got), Buffer.from(expected));
}

function isUrl(v) {
  return typeof v === "string" && /^https?:\/\//i.test(v.trim());
}

// شكل رد أوتو مش موثّق بالتفصيل، فبندوّر على الرابط بأي اسم معروف وبأي عمق
const URL_KEYS = ["printAWBURL", "printAwbUrl", "printAWBUrl", "awbUrl", "awbURL", "printUrl", "printURL", "labelUrl", "url", "link"];

function findLabelUrl(obj, depth = 0) {
  if (!obj || depth > 4) return null;
  if (isUrl(obj)) return obj.trim();
  if (typeof obj !== "object") return null;
  for (const k of URL_KEYS) {
    if (isUrl(obj[k])) return obj[k].trim();
  }
  for (const v of Object.values(obj)) {
    if (v && typeof v === "object") {
      const found = findLabelUrl(v, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

function pick(obj, keys) {
  if (!obj || typeof obj !== "object") return null;
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null && obj[k] !== "") return obj[k];
  }
  return null;
}

function otoErr(err) {
  const d = err.response?.data;
  const msg = (d && (d.message || d.errorMsg || d.error || d.otoErrorMessage)) || err.message;
  return { http: err.response?.status || null, message: String(typeof msg === "object" ? JSON.stringify(msg) : msg).slice(0, 300) };
}

router.get("/label/:orderId", async (req, res) => {
  if (!keyOk(req)) {
    return res.status(401).json({ success: false, reason: "unauthorized" });
  }

  const orderId = String(req.params.orderId || "").trim();
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(orderId)) {
    return res.status(422).json({ success: false, reason: "bad_order_id" });
  }

  const local = orderStore.getOrder(orderId) || {};
  let url = isUrl(local.printAWBURL) ? local.printAWBURL : null;
  let trackingNumber = local.trackingNumber || null;
  let carrier = local.deliveryCompany || null;
  let status = local.otoStatus || null;
  const errors = [];

  // 1) رابط الطباعة مباشرة من أوتو
  if (!url) {
    try {
      const r = await otoClient.getPrintAwb(orderId);
      url = findLabelUrl(r);
      if (!url) console.log(`[label] /print/${orderId} رد من غير رابط:`, JSON.stringify(r).slice(0, 500));
    } catch (err) {
      const e = otoErr(err);
      errors.push({ step: "print", ...e });
      console.warn(`[label] /print/${orderId} فشل:`, e.http, e.message);
    }
  }

  // 2) تفاصيل الطلب (الحالة + رقم التتبّع + الرابط لو موجود فيها)
  let detailsFound = false;
  if (!url || !trackingNumber || !status) {
    try {
      const d = await otoClient.getOrderDetails(orderId);
      const o = (d && (d.order || d.data || d.orderDetails)) || d || {};
      detailsFound = !!(o && typeof o === "object" && Object.keys(o).length > 0 && d.success !== false);
      if (!url) url = pick(o, URL_KEYS.slice(0, 8).filter((k) => isUrl(o[k])));
      trackingNumber = trackingNumber || pick(o, ["trackingNumber", "dcTrackingNumber", "awbNumber"]);
      carrier = carrier || pick(o, ["deliveryCompany", "deliveryCompanyName", "dcName"]);
      status = status || pick(o, ["status", "orderStatus"]);
    } catch (err) {
      const e = otoErr(err);
      errors.push({ step: "orderDetails", ...e });
      console.warn(`[label] orderDetails ${orderId} فشل:`, e.http, e.message);
    }
  }

  if (url) {
    orderStore.saveOrder(orderId, { printAWBURL: url });
    return res.json({ success: true, url, trackingNumber, carrier, status });
  }

  // مفيش رابط — نقول ليه
  if (local.status === "shipment_error") {
    return res.json({
      success: false,
      reason: "shipment_error",
      message: String(local.errorMessage || local.deliveryCompanyResponse || "").slice(0, 300),
      status,
    });
  }
  const notFound = errors.some((e) => e.http === 404) && !detailsFound && !local.status;
  const allFailed = errors.length >= 2 && !errors.some((e) => e.http === 404 || e.http === 400);
  return res.json({
    success: false,
    reason: allFailed ? "oto_error" : notFound ? "not_found" : "not_ready",
    message: errors.map((e) => `${e.step}: ${e.message}`).join(" | ").slice(0, 300),
    status,
  });
});

module.exports = router;
module.exports.findLabelUrl = findLabelUrl;
