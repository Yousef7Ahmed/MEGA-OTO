const express = require("express");
const otoClient = require("../services/otoClient");
const megaClient = require("../services/megaClient");
const orderStore = require("../store/orderStore");
const { resolveDestinationCity } = require("../services/megaLocationMap");
const shipmentNotifier = require("../services/shipmentNotifier");

const router = express.Router();

async function mapMegaOrderToOtoOrder(order) {
  const address = order.delivery_address || {};

  let destinationCity = "Riyadh";
  try {
    const resolved = await resolveDestinationCity({
      cityId: address.city_id,
      stateId: address.state_id,
    });
    if (resolved?.name) destinationCity = resolved.name;
  } catch (err) {
    console.warn(
      "[mega-webhook] Failed to resolve city, fallback to default:",
      err.message,
    );
  }

  const items = Array.isArray(order.items) ? order.items : [];
  const totalQty = items.reduce((sum, item) => sum + (Number(item.qty) || 1), 0) || 1;
  let totalWeight = items.reduce(
    (sum, item) => sum + (Number(item.weight) || 0) * (Number(item.qty) || 1),
    0,
  );
  // منتجات من غير وزن متسجّل — تقدير بعدد القطع (نفس حساب أسعار الشحن)
  if (!totalWeight || totalWeight <= 0) {
    totalWeight = totalQty * (Number(process.env.SHIPPING_FALLBACK_ITEM_WEIGHT) || 0.5);
  }

  const customerName =
    `${address.first_name ?? ""} ${address.last_name ?? ""}`.trim() ||
    "Customer";
  const customerPhone = address.phone || order.customer_phone || "";
  const customerAddress = address.address || address.street || destinationCity;

  if (!customerPhone) {
    throw new Error(
      `Order ${order.id} missing mandatory customer phone number.`,
    );
  }

  // ميجا بتحط payment_status = "Paid" لكل الطلبات حتى الدفع عند الاستلام،
  // فالمرجع الصح هو payment_type ("cod" = دفع عند الاستلام).
  const paymentType = String(order.payment_type || "").toLowerCase();
  const isCod =
    paymentType === "cod" ||
    paymentType.includes("cash") ||
    (!paymentType && order.payment_status !== "Paid");
  const finalPrice = Number(order.final_price ?? 0);

  return {
    orderId: String(order.id ?? order.order_id ?? ""),
    payment_method: isCod ? "cod" : "paid",
    amount: finalPrice,
    amount_due: isCod ? finalPrice : 0,
    currency: "SAR",
    shippingAmount: Number(order.delivery_price ?? 0),
    subtotal: Number(order.product_price ?? 0),
    // اسم الحقل عند أوتو packageWeight (كنا بنبعت weight بس فكان بيوصل من غير وزن)
    packageWeight: Math.round(totalWeight * 1000) / 1000,
    weight: Math.round(totalWeight * 1000) / 1000,
    packageCount: 1,
    createShipment: process.env.OTO_CREATE_SHIPMENT === "true",
    // كود عنوان الاستلام (المخزن/المتجر) من لوحة أوتو — لو فاضي أوتو بيختار تلقائي
    ...(process.env.OTO_PICKUP_LOCATION_CODE
      ? { pickupLocationCode: process.env.OTO_PICKUP_LOCATION_CODE }
      : {}),
    customer: {
      name: customerName,
      mobile: customerPhone,
      email: address.email || "customer@example.com",
      address: customerAddress,
      city: destinationCity,
      country: "SA",
    },
    items: items.map((item) => ({
      name: item.name || "Product",
      price: Number(item.final_price ?? item.original_price ?? 0),
      rowTotal: Number(item.final_price ?? 0) * Number(item.qty ?? 1),
      quantity: Number(item.qty ?? 1),
      sku: String(item.product_id ?? item.sku ?? "SKU-UNKNOWN"),
    })),
  };
}

// المسار الكامل النهائي: POST /webhooks/megaai/order
router.post("/megaai/order", async (req, res) => {
  let webhookPayload;

  try {
    webhookPayload =
      typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  } catch (err) {
    console.error("[mega-webhook] Body parsing failed:", err.message);
    return res
      .status(400)
      .json({ success: false, error: "Invalid JSON payload format" });
  }

  const orderId = String(webhookPayload?.id ?? webhookPayload?.order_id ?? "");
  if (!orderId) {
    console.error("[mega-webhook] Webhook payload missing order ID.");
    return res
      .status(422)
      .json({ success: false, error: "No order id in payload" });
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
      throw new Error(
        `Failed to retrieve valid order details from Mega API for ID: ${orderId}`,
      );
    }

    const otoOrderPayload = await mapMegaOrderToOtoOrder(fullOrder);
    console.log(
      `[mega-webhook] Sending order ${orderId} to OTO — city=${otoOrderPayload.customer.city}, ` +
        `weight=${otoOrderPayload.packageWeight}kg, payment=${otoOrderPayload.payment_method}, ` +
        `pickupLocation=${otoOrderPayload.pickupLocationCode || "(auto)"}, createShipment=${otoOrderPayload.createShipment}`,
    );
    const otoResponse = await otoClient.createOrder(otoOrderPayload);
    console.log(`[mega-webhook] OTO createOrder response for ${orderId}:`, JSON.stringify(otoResponse));

    orderStore.saveOrder(orderId, {
      megaFullOrder: fullOrder,
      // نحتفظ بالويب هوك الأصلي كمان — أحياناً بيكون فيه أرقام
      // المشتري والبائع اللي مش موجودة في رد الـ API.
      megaWebhookPayload: webhookPayload,
      otoOrderPayload,
      otoResponse,
      status: "sent_to_oto",
    });

    // إشعار واتساب: الشحنة اتجهّزت
    shipmentNotifier
      .notifyStatusChange(orderId, { status: "created" })
      .catch((err) => console.error("[whatsapp] إشعار الإنشاء فشل:", err.message));

    console.log(
      `[mega-webhook] Order ${orderId} successfully dispatched to OTO.`,
    );
    return res.status(200).json({ success: true, otoResponse });
  } catch (err) {
    const errorDetails = err.response?.data || err.message;
    console.error(
      `[mega-webhook] Processing failed for order ${orderId}:`,
      errorDetails,
    );

    return res.status(500).json({
      success: false,
      error: "Failed to process order",
      details:
        typeof errorDetails === "object"
          ? errorDetails
          : { message: errorDetails },
    });
  }
});

module.exports = router;
