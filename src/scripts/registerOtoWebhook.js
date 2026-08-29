/**
 * Run once (and again any time your public URL changes):
 *   npm run register-oto-webhook
 *
 * Registers PUBLIC_BASE_URL + /webhooks/oto/status with OTO so it calls us
 * back whenever an order's status changes.
 */
const config = require('../config');
const otoClient = require('../services/otoClient');

async function main() {
  if (!config.publicBaseUrl || config.publicBaseUrl.includes('your-public-url')) {
    console.error('Set PUBLIC_BASE_URL in .env to your real public URL first (e.g. an ngrok https URL while testing).');
    process.exit(1);
  }

  const url = `${config.publicBaseUrl}/webhooks/oto/status`;
  console.log(`Registering OTO webhook -> ${url}`);

  const result = await otoClient.registerWebhook({ url, webhookType: 'orderStatus' });
  console.log('Result:', result);

  console.log('\nAlso registering the shipment-error webhook...');
  const errorUrl = `${config.publicBaseUrl}/webhooks/oto/shipment-error`;
  const errorResult = await otoClient.registerWebhook({ url: errorUrl, webhookType: 'shipmentError' });
  console.log('Result:', errorResult);
}

main().catch((err) => {
  console.error('Failed to register webhook:', err.response?.data || err.message);
  process.exit(1);
});
