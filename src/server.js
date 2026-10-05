const express = require("express");
const config = require("./config");
const otoClient = require("./services/otoClient");
const orderStore = require("./store/orderStore");
const megaWebhookRouter = require("./routes/megaWebhook");
const otoWebhookRouter = require("./routes/otoWebhook");
const shippingRateCallbackRouter = require("./routes/shippingRateCallback");
const labelRouter = require("./routes/label");
const shippingDebugRouter = require("./routes/shippingDebug");
const path = require("path");

const app = express();

app.use(
  express.static(path.join(__dirname, "..", "public"), {
    maxAge: "5m",
    setHeaders: (res) => res.setHeader("Access-Control-Allow-Origin", "*"),
  }),
);

// التقاط الـ Body كنص خام لمسار Mega Ai قبل أي parser آخر
app.use(
  "/webhooks/megaai/order",
  express.text({ type: () => true, limit: "2mb" }),
);

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true, limit: "2mb" }));

// ربط الموديولات بالبادئات المناسبة
app.use("/webhooks", megaWebhookRouter);
app.use("/webhooks", otoWebhookRouter);
app.use("/shipping", shippingRateCallbackRouter);
app.use("/api", labelRouter);
app.use("/debug", shippingDebugRouter);

app.get("/health", async (req, res) => {
  try {
    const oto = await otoClient.healthCheck();
    res.json({ server: "ok", oto });
  } catch (err) {
    res
      .status(500)
      .json({ server: "ok", oto: "unreachable", error: err.message });
  }
});

app.get("/health/oto-auth", async (req, res) => {
  try {
    const tokenManager = require("./services/otoTokenManager");
    await tokenManager.getAccessToken();
    res.json({
      success: true,
      message: "OTO refresh_token is valid and access_token was obtained.",
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// فيها بيانات العملاء (أسامي وأرقام) — محمية بمفتاح:
//   /debug/orders?key=OTO_WEBHOOK_SECRET            ← كل الطلبات
//   /debug/orders?key=OTO_WEBHOOK_SECRET&id=88      ← طلب واحد (وسبب فشل الشحنة لو فيه)
app.get("/debug/orders", (req, res) => {
  const secret = config.oto.webhookSecret;
  if (!secret || req.query.key !== secret) {
    return res.status(401).json({ success: false, error: "unauthorized" });
  }
  if (req.query.id) {
    const order = orderStore.getOrder(String(req.query.id));
    if (!order) return res.status(404).json({ success: false, error: "order not found" });
    return res.json({
      id: String(req.query.id),
      status: order.status,
      otoStatus: order.otoStatus,
      shipmentError: order.errorMessage || null,
      deliveryCompanyResponse: order.deliveryCompanyResponse || null,
      shipmentErrorAt: order.shipmentErrorAt || null,
      notifiedStatuses: order.notifiedStatuses || [],
    });
  }
  res.json(orderStore.getAllOrders());
});

app.get("/", (req, res) =>
  res.json({ status: "ok", service: "mega-oto-integration" }),
);

app.listen(config.port, "0.0.0.0", () => {
  console.log(`Integration backend listening on port ${config.port}`);
});
