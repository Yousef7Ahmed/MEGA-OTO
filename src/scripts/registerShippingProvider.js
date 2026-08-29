/**
 * Run once (and again if PUBLIC_BASE_URL or the secret changes):
 *   node src/scripts/registerShippingProvider.js
 *
 * Registers our real /shipping/rate-callback endpoint with Mega Ai so its
 * checkout can request live OTO rates. This uses the SAME provider name
 * ("OTO") every time, so re-running it safely updates the existing entry
 * instead of creating duplicates (per the doc: "unique per store; updates
 * if exists").
 *
 * Note: this does NOT remove the earlier "diagnostic-test-provider" entry
 * created while testing - there's no documented delete endpoint. It's
 * harmless (fake callback_url, low priority) but worth mentioning to
 * Mega Ai support if you want it cleaned up.
 */
const config = require('../config');
const megaClient = require('../services/megaClient');

async function main() {
  if (!config.publicBaseUrl || config.publicBaseUrl.includes('your-public-url')) {
    console.error('Set PUBLIC_BASE_URL in .env to your real public URL first (e.g. an ngrok https URL while testing).');
    process.exit(1);
  }
  if (!config.shipping.callbackSecret || config.shipping.callbackSecret.includes('choose-another')) {
    console.error('Set SHIPPING_CALLBACK_SECRET in .env to a real random string first.');
    process.exit(1);
  }

  const callbackUrl = `${config.publicBaseUrl}/shipping/rate-callback`;
  console.log(`Registering shipping provider -> ${callbackUrl}`);

  const result = await megaClient.registerShippingProvider({
    name: 'OTO',
    callbackUrl,
    apiKey: config.shipping.callbackSecret,
    priority: 1,
  });

  console.log('Result:', result);
}

main().catch((err) => {
  console.error('Failed to register shipping provider:', err.response?.data || err.message);
  process.exit(1);
});
