const express = require('express');
const config = require('./config');
const otoClient = require('./services/otoClient');
const orderStore = require('./store/orderStore');
const megaWebhookRouter = require('./routes/megaWebhook');
const otoWebhookRouter = require('./routes/otoWebhook');
const shippingRateCallbackRouter = require('./routes/shippingRateCallback');

const path = require('path');

const app = express();

// Serve static files from /public (includes checkout-fix.js)
// Available at: https://YOUR-RENDER-URL/checkout-fix.js
app.use(express.static(path.join(__dirname, '..', 'public'), {
  maxAge: '5m',
  setHeaders: (res) => res.setHeader('Access-Control-Allow-Origin', '*'),
}));

// IMPORTANT: Mega Ai's "Status Change" webhook mislabels its Content-Type
// as x-www-form-urlencoded, but the body is actually a raw JSON string
// (confirmed 2026-08-27). Capture it as plain text on this exact path,
// BEFORE any other body parser gets a chance to misinterpret it, then
// JSON.parse it ourselves inside the route handler.
app.use('/webhooks/megaai/order', express.text({ type: () => true, limit: '2mb' }));

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

// Incoming: Mega Ai -> us (new order)
app.use('/webhooks', megaWebhookRouter);

// Incoming: OTO -> us (status updates / shipment errors)
app.use('/webhooks', otoWebhookRouter);

// Incoming: Mega Ai checkout -> us (live shipping rate quote)
app.use('/shipping', shippingRateCallbackRouter);

// Quick sanity check that the server + OTO auth are both working.
app.get('/health', async (req, res) => {
  try {
    const oto = await otoClient.healthCheck();
    res.json({ server: 'ok', oto });
  } catch (err) {
    res.status(500).json({ server: 'ok', oto: 'unreachable', error: err.message });
  }
});

// Confirms the refresh_token -> access_token exchange actually works.
app.get('/health/oto-auth', async (req, res) => {
  try {
    const tokenManager = require('./services/otoTokenManager');
    await tokenManager.getAccessToken();
    res.json({ success: true, message: 'OTO refresh_token is valid and access_token was obtained.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Inspect what's been recorded locally so far (debugging aid).
app.get('/debug/orders', (req, res) => {
  res.json(orderStore.getAllOrders());
});

// Render.com pings the root path to keep the service alive on the free plan.
app.get('/', (req, res) => res.json({ status: 'ok', service: 'mega-oto-integration' }));

app.listen(config.port, '0.0.0.0', () => {
  console.log(`Integration backend listening on port ${config.port}`);
  console.log(`Try: curl http://localhost:${config.port}/health`);
});
