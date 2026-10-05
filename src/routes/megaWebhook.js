const express = require("express");
const config = require("../config");
const otoClient = require("../services/otoClient");
const megaClient = require("../services/megaClient");
const orderStore = require("../store/orderStore");
const { resolveDestinationCity } = require("../services/megaLocationMap");
const shipmentNotifier = require("../services/shipmentNotifier");
const { ensureVendorPickup } = require("../services/vendorPickup");
const { pickDeliveryOption } = require("../services/deliveryOptionPicker");

const router = express.Router();

/**
 * كل طلب في ميجا بيتقسّم لشحنة لكل بائع — كل شحنة بتطلع من عنوان البائع نفسه.
 *
 *   منتجات البائع 41  → طلب أوتو "88-V41"  ← مكان الاستلام V41 (عنوان متجره)
 *   منتجات البائع 52  → طلب أوتو "88-V52"  ← مكان الاستلام V52
 *   منتجات المتجر الرئيسي (من غير بائع) → طلب أوتو "88" ← OTO_PICKUP_LOCATION_CODE
 */

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function otoOrderIdFor(megaId, vendorId) {
  return vendorId ? `${megaId}-V${vendorId}` : String(megaId);
}

/** بيقسّم منتجات الطلب حسب البائع */
function splitByVendor(order) {
  const items = Array.isArray(order.items) ? order.items : [];
  const groups = new Map();
  for (const item of items) {
    const vendor = item && item.vendor && item.vendor.id ? item.vendor : null;
    const key = vendor ? String(vendor.id) : "main";
    if (!groups.has(key)) groups.set(key, { vendor, items: [] });
    groups.get(key).items.push(item);
  }
  return [...groups.values()];
}

function itemsSubtotal(items) {
  return items.reduce((sum, i) => sum + (Number(i.final_price) || 0) * (Number(i.qty) || 1), 0);
}

function itemsWeight(items) {
  const qty = items.reduce((sum, i) => sum + (Number(i.qty) || 1), 0) || 1;
  let weight = items.reduce((sum, i) => sum + (Number(i.weight) || 0) * (Number(i.qty) || 1), 0);
  // منتجات من غير وزن متسجّل — تقدير بعدد القطع (نفس حساب أسعار الشحن)
  if (!weight || weight <= 0) weight = qty * (config.shipping.fallbackItemWeight || 0.5);
  return Math.round(weight * 1000) / 1000;
}

/**
 * بيوزّع إجمالي الطلب (بعد الخصم والضريبة والشحن) على الشحنات بنسبة قيمة منتجاتها،
 * بحيث مجموع اللي المندوبين هيحصّلوه (في الدفع عند الاستلام) = إجمالي الطلب بالظبط.
 */
function allocateAmounts(groups, order) {
  const total = round2(order.final_price);
  const subtotals = groups.map((g) => itemsSubtotal(g.items));
  const sum = subtotals.reduce((a, b) => a + b, 0);
  let left = total;
  return groups.map((g, idx) => {
    const isLast = idx === groups.length - 1;
    const share = isLast ? round2(left) : round2(sum > 0 ? (total * subtotals[idx]) / sum : total / groups.length);
    left -= share;
    return { amount: share, subtotal: round2(subtotals[idx]) };
  });
}

function isCodOrder(order) {
  // ميجا بتحط payment_status = "Paid" لكل الطلبات حتى الدفع عند الاستلام،
  // فالمرجع الصح هو payment_type ("cod" = دفع عند الاستلام).
  const paymentType = String(order.payment_type || "").toLowerCase();
  return paymentType === "cod" || paymentType.includes("cash") || (!paymentType && order.payment_status !== "Paid");
}

async function destinationCityOf(order) {
  const address = order.delivery_address || {};
  try {
    const resolved = await resolveDestinationCity({ cityId: address.city_id, stateId: address.state_id });
    if (resolved?.name) return resolved.name;
  } catch (err) {
    console.warn("[mega-webhook] Failed to resolve city, fallback to default:", err.message);
  }
  return "Riyadh";
}

function buildOtoOrder({ order, group, amounts, otoOrderId, destinationCity, isCod, pickupCode, deliveryOptionId, shippingAmount }) {
  const address = order.delivery_address || {};
  const customerName = `${address.first_name ?? ""} ${address.last_name ?? ""}`.trim() || "Customer";
  const customerPhone = address.phone || order.customer_phone || "";
  if (!customerPhone) {
    throw new Error(`Order ${order.id} missing mandatory customer phone number.`);
  }
  const weight = itemsWeight(group.items);
  const canShip = Boolean(pickupCode);

  return {
    orderId: otoOrderId,
    ref1: String(order.order_id || order.id || ""),
    payment_method: isCod ? "cod" : "paid",
    amount: amounts.amount,
    amount_due: isCod ? amounts.amount : 0,
    currency: "SAR",
    shippingAmount: round2(shippingAmount),
    subtotal: amounts.subtotal,
    // اسم الحقل عند أوتو packageWeight
    packageWeight: weight,
    weight,
    packageCount: 1,
    // الحجز التلقائي محتاج مكان استلام — من غيره أوتو بيسيب الطلب "new"
    createShipment: canShip && process.env.OTO_CREATE_SHIPMENT === "true",
    ...(pickupCode ? { pickupLocationCode: pickupCode } : {}),
    ...(deliveryOptionId ? { deliveryOptionId: String(deliveryOptionId) } : {}),
    ...(group.vendor?.name ? { storeName: group.vendor.name, senderName: group.vendor.name } : {}),
    customer: {
      name: customerName,
      mobile: customerPhone,
      email: address.email || "customer@example.com",
      address: address.address || address.street || destinationCity,
      city: destinationCity,
      country: "SA",
    },
    items: group.items.map((item) => ({
      name: item.name || "Product",
      price: Number(item.final_price ?? item.original_price ?? 0),
      rowTotal: Number(item.final_price ?? 0) * Number(item.qty ?? 1),
      quantity: Number(item.qty ?? 1),
      sku: String(item.product_id ?? item.sku ?? "SKU-UNKNOWN"),
    })),
  };
}

function otoErrText(err) {
  const d = err.response?.data;
  const m = (d && (d.otoErrorMessage || d.errorMsg || d.message || d.error)) || err.message;
  return String(typeof m === "object" ? JSON.stringify(m) : m).slice(0, 300);
}

/** بيبعت شحنة بائع واحد لأوتو. ما بيرميش — بيرجّع ملخّص. */
async function dispatchGroup({ order, group, amounts, megaId, destinationCity, isCod, shippingAmount, webhookPayload }) {
  const vendorId = group.vendor?.id || null;
  const otoOrderId = otoOrderIdFor(megaId, vendorId);
  const summary = { otoOrderId, vendorId, vendorName: group.vendor?.name || null, ok: false, warnings: [] };

  // 1) مكان الاستلام
  let pickupCode = null;
  let originCity = config.shipping.originCity;
  if (group.vendor) {
    const pickup = await ensureVendorPickup(group.vendor);
    if (pickup.ok) {
      pickupCode = pickup.code;
      originCity = pickup.city || originCity;
    } else {
      summary.warnings.push(`مكان استلام البائع "${group.vendor.name || vendorId}" ما اتسجّلش: ${pickup.error}`);
    }
  } else if (process.env.OTO_PICKUP_LOCATION_CODE) {
    pickupCode = process.env.OTO_PICKUP_LOCATION_CODE;
  } else {
    summary.warnings.push("منتجات المتجر الرئيسي: مفيش OTO_PICKUP_LOCATION_CODE");
  }

  // 2) شركة الشحن
  let option = null;
  if (pickupCode) {
    try {
      option = await pickDeliveryOption({ originCity, destinationCity, weight: itemsWeight(group.items), isCod });
      if (!option) summary.warnings.push(`مفيش شركة شحن بتغطي ${originCity} ← ${destinationCity}`);
    } catch (err) {
      summary.warnings.push(`تعذّر جلب شركات الشحن: ${otoErrText(err)}`);
    }
  }

  // 3) الطلب عند أوتو
  try {
    const payload = buildOtoOrder({
      order, group, amounts, otoOrderId, destinationCity, isCod,
      pickupCode, deliveryOptionId: option?.id, shippingAmount,
    });
    console.log(
      `[mega-webhook] → OTO ${otoOrderId}: ${originCity} → ${destinationCity}, weight=${payload.packageWeight}kg, ` +
        `payment=${payload.payment_method}, amount=${payload.amount}, pickup=${pickupCode || "(none)"}, ` +
        `carrier=${option ? option.label : "(none)"}, createShipment=${payload.createShipment}`,
    );

    let otoResponse;
    try {
      otoResponse = await otoClient.createOrder(payload);
    } catch (err) {
      // الطلب موجود عند أوتو من قبل (السيرفر اتعمله restart)؟ نحاول نحجز الشحنة بس
      const text = otoErrText(err).toLowerCase();
      if (payload.createShipment && (text.includes("exist") || text.includes("duplicate") || text.includes("already"))) {
        console.warn(`[mega-webhook] ${otoOrderId} موجود عند أوتو — بنحاول نحجز الشحنة بس.`);
        otoResponse = await otoClient.createShipment(otoOrderId, option?.id);
      } else {
        throw err;
      }
    }
    console.log(`[mega-webhook] OTO response for ${otoOrderId}:`, JSON.stringify(otoResponse));

    if (vendorId) {
      orderStore.saveOrder(otoOrderId, {
        megaOrderId: String(megaId),
        vendorId,
        // بيانات الطلب بمنتجات البائع ده بس — عشان إشعارات الواتساب تروح له هو
        megaFullOrder: { ...order, items: group.items },
        otoOrderPayload: payload,
        otoResponse,
        pickupLocationCode: pickupCode,
        deliveryOption: option,
        status: "sent_to_oto",
      });
    }
    summary.ok = true;
    summary.carrier = option?.label || null;
    summary.shipmentRequested = payload.createShipment;
    summary.otoResponse = otoResponse;
  } catch (err) {
    summary.error = otoErrText(err);
    console.error(`[mega-webhook] ${otoOrderId} FAILED:`, err.response?.data || err.message);
  }

  return summary;
}

// المسار الكامل النهائي: POST /webhooks/megaai/order
router.post("/megaai/order", async (req, res) => {
  let webhookPayload;

  try {
    webhookPayload = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  } catch (err) {
    console.error("[mega-webhook] Body parsing failed:", err.message);
    return res.status(400).json({ success: false, error: "Invalid JSON payload format" });
  }

  const orderId = String(webhookPayload?.id ?? webhookPayload?.order_id ?? "");
  if (!orderId) {
    console.error("[mega-webhook] Webhook payload missing order ID.");
    return res.status(422).json({ success: false, error: "No order id in payload" });
  }

  const existing = orderStore.getOrder(orderId);
  if (existing && existing.status === "sent_to_oto") {
    console.log(`[mega-webhook] Order ${orderId} already processed. Skipping.`);
    return res.status(200).json({ success: true, note: "already processed" });
  }

  try {
    const fullOrderResponse = await megaClient.getOrder(orderId);
    const fullOrder = fullOrderResponse.data || fullOrderResponse;

    if (!fullOrder || (!fullOrder.id && !fullOrder.order_id)) {
      throw new Error(`Failed to retrieve valid order details from Mega API for ID: ${orderId}`);
    }

    const groups = splitByVendor(fullOrder);
    if (groups.length === 0) {
      throw new Error(`Order ${orderId} has no items.`);
    }
    const amounts = allocateAmounts(groups, fullOrder);
    const destinationCity = await destinationCityOf(fullOrder);
    const isCod = isCodOrder(fullOrder);

    const shipments = [];
    for (let i = 0; i < groups.length; i++) {
      shipments.push(await dispatchGroup({
        order: fullOrder,
        group: groups[i],
        amounts: amounts[i],
        megaId: orderId,
        destinationCity,
        isCod,
        // رسوم الشحن اللي دفعها العميل بتتسجّل على أول شحنة بس
        shippingAmount: i === 0 ? Number(fullOrder.delivery_price ?? 0) : 0,
        webhookPayload,
      }));
    }

    const okCount = shipments.filter((s) => s.ok).length;
    const problems = shipments.flatMap((s) => [
      ...(s.error ? [`${s.otoOrderId}: ${s.error}`] : []),
      ...s.warnings.map((w) => `${s.otoOrderId}: ${w}`),
    ]);

    // سجل الطلب الأصلي (للمنع من التكرار + إشعار "تم التجهيز")
    orderStore.saveOrder(orderId, {
      megaOrderId: orderId,
      megaFullOrder: fullOrder,
      megaWebhookPayload: webhookPayload,
      shipments: shipments.map((s) => ({ otoOrderId: s.otoOrderId, vendorId: s.vendorId, ok: s.ok })),
      status: okCount > 0 ? "sent_to_oto" : "failed",
    });

    if (problems.length) {
      shipmentNotifier
        .notifyAdminShipmentError(orderId, { errorMessage: problems.join("\n") })
        .catch((err) => console.error("[whatsapp] تنبيه الأدمن فشل:", err.message));
    }

    if (okCount === 0) {
      return res.status(500).json({ success: false, error: "Failed to process order", shipments });
    }

    // إشعار واتساب: الشحنة اتجهّزت (مرة واحدة للطلب كله)
    shipmentNotifier
      .notifyStatusChange(orderId, { status: "created" })
      .catch((err) => console.error("[whatsapp] إشعار الإنشاء فشل:", err.message));

    console.log(`[mega-webhook] Order ${orderId}: ${okCount}/${shipments.length} shipment(s) dispatched to OTO.`);
    return res.status(200).json({ success: true, shipments });
  } catch (err) {
    const errorDetails = err.response?.data || err.message;
    console.error(`[mega-webhook] Processing failed for order ${orderId}:`, errorDetails);

    return res.status(500).json({
      success: false,
      error: "Failed to process order",
      details: typeof errorDetails === "object" ? errorDetails : { message: errorDetails },
    });
  }
});

module.exports = router;
module.exports._internal = { splitByVendor, allocateAmounts, otoOrderIdFor, itemsWeight, isCodOrder };
