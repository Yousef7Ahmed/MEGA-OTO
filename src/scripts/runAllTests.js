/**
 * Run: npm run test-all
 *
 * Runs every meaningful health check in one go and prints a single clear
 * PASS/FAIL report at the end - instead of running many separate commands
 * by hand. Safe to run anytime: does NOT create real orders or touch
 * live customer data, only read-only / idempotent checks.
 */
const config = require('../config');
const otoClient = require('../services/otoClient');
const tokenManager = require('../services/otoTokenManager');
const megaClient = require('../services/megaClient');
const { resolveDestinationCity } = require('../services/megaLocationMap');

const results = [];

function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' - ' + detail : ''}`);
}

async function step(name, fn) {
  console.log(`\n--- ${name} ---`);
  try {
    await fn();
  } catch (err) {
    const detail = err.response?.data ? JSON.stringify(err.response.data) : err.message;
    record(name, false, detail);
  }
}

async function main() {
  console.log('='.repeat(70));
  console.log('FULL INTEGRATION HEALTH CHECK');
  console.log('='.repeat(70));

  // 1. OTO auth
  await step('OTO: refresh_token -> access_token', async () => {
    await tokenManager.getAccessToken();
    record('OTO auth', true);
  });

  // 2. OTO health check (public, no auth)
  await step('OTO: healthCheck endpoint', async () => {
    await otoClient.healthCheck();
    record('OTO healthCheck', true);
  });

  // 3. OTO delivery fee for a known-good city
  await step('OTO: checkDeliveryFee (Riyadh -> Riyadh)', async () => {
    const result = await otoClient.checkDeliveryFee({ originCity: 'Riyadh', destinationCity: 'Riyadh', weight: 1 });
    const count = (result.deliveryCompany || []).length;
    record('OTO checkDeliveryFee', count > 0, `${count} option(s) returned`);
  });

  // 4. Mega Ai API - basic read access
  if (!config.mega.apiKey) {
    record('Mega Ai: API key configured', false, 'MEGA_API_KEY is empty in .env');
  } else {
    await step('Mega Ai: list orders', async () => {
      const result = await megaClient.listOrders({ perPage: 1 });
      record('Mega Ai listOrders', result.success === true, `success=${result.success}`);
    });

    // 5. Mega Ai - states/cities (needed for accurate shipping rates)
    await step('Mega Ai: states + cities lookup', async () => {
      const states = await megaClient.getStates(194);
      const stateCount = (states.data || []).length;
      const cities = await megaClient.getCities({ stateId: 2857 }); // Al Jawf, includes Qurayyat
      const cityCount = (cities.data || []).length;
      record('Mega Ai states/cities', stateCount > 0 && cityCount > 0, `${stateCount} states, ${cityCount} cities checked (Al Jawf)`);
    });
  }

  // 6. City resolution logic (our own code, no network needed beyond Mega Ai cities call)
  if (config.mega.apiKey) {
    await step('megaLocationMap: resolve a known city_id (Qurayyat)', async () => {
      const result = await resolveDestinationCity({ cityId: '5930', stateId: '2857' });
      record('City resolution (precise)', result.precise === true && result.name === 'Qurayyat', JSON.stringify(result));
    });

    await step('megaLocationMap: safe fallback with no city_id', async () => {
      const result = await resolveDestinationCity({ cityId: null, stateId: '2849' });
      record('City resolution (fallback)', result.precise === false && result.name === 'Riyadh', JSON.stringify(result));
    });
  }

  // 7. Shipping provider registration status
  console.log('\n--- Shipping provider registration ---');
  if (!config.publicBaseUrl || config.publicBaseUrl.includes('your-public-url')) {
    record('PUBLIC_BASE_URL configured', false, 'Set a real ngrok/production URL in .env first');
  } else {
    record('PUBLIC_BASE_URL configured', true, config.publicBaseUrl);
    console.log('   (Run "npm run register-shipping-provider" separately to actually (re)register it with Mega Ai.)');
  }

  // Final report
  console.log('\n' + '='.repeat(70));
  console.log('SUMMARY');
  console.log('='.repeat(70));
  const passed = results.filter((r) => r.ok).length;
  results.forEach((r) => console.log(`${r.ok ? '✅' : '❌'} ${r.name}`));
  console.log(`\n${passed}/${results.length} checks passed.`);
  if (passed < results.length) {
    console.log('\n👉 Look at the ❌ lines above and their error detail to see exactly what to fix.');
  }
}

main();
