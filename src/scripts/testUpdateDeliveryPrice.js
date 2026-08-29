/**
 * Run: node src/scripts/testUpdateDeliveryPrice.js <order_id>
 * Example: node src/scripts/testUpdateDeliveryPrice.js 45
 *
 * Tests whether Mega Ai's External API supports updating delivery_price
 * on an existing order. We try three approaches since we don't know
 * which one (if any) is supported:
 *
 * 1. PUT /orders/{id}/status  — include delivery_price in the body
 * 2. PUT /orders/{id}/tracking — include delivery_price in the body
 * 3. PATCH /orders/{id}       — direct field update (undocumented, worth trying)
 *
 * For each attempt we print the full response so we know exactly what
 * Mega Ai accepts and what it ignores.
 */
const megaClient = require('../services/megaClient');
const config = require('../config');
const axios = require('axios');

const ORDER_ID = process.argv[2];
if (!ORDER_ID) {
  console.error('Usage: node src/scripts/testUpdateDeliveryPrice.js <order_id>');
  process.exit(1);
}

async function client() {
  return axios.create({
    baseURL: config.mega.baseUrl,
    headers: {
      'X-API-Key': config.mega.apiKey,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    validateStatus: () => true,
  });
}

async function main() {
  console.log('Testing delivery_price update on order', ORDER_ID);
  console.log('='.repeat(60));

  const http = await client();

  // Step 0: get current state
  console.log('\n[0] Current order state:');
  const current = await megaClient.getOrder(ORDER_ID);
  console.log('  delivery_price:', current.data?.delivery_price);
  console.log('  status:', current.data?.status);

  const TEST_PRICE = 99.99;

  // Attempt 1: PUT /orders/{id}/status with delivery_price in body
  console.log('\n[1] PUT /orders/' + ORDER_ID + '/status + delivery_price in body:');
  const r1 = await http.put('/orders/' + ORDER_ID + '/status', {
    status: current.data?.status || 'confirmed',
    delivery_price: TEST_PRICE,
  });
  console.log('  HTTP', r1.status, JSON.stringify(r1.data));

  // Attempt 2: PUT /orders/{id}/tracking with delivery_price in body
  console.log('\n[2] PUT /orders/' + ORDER_ID + '/tracking + delivery_price in body:');
  const r2 = await http.put('/orders/' + ORDER_ID + '/tracking', {
    tracking_number: current.data?.tracking_number || 'TEST-TRACKING',
    shipping_carrier: current.data?.shipping_carrier || 'TEST',
    delivery_price: TEST_PRICE,
  });
  console.log('  HTTP', r2.status, JSON.stringify(r2.data));

  // Attempt 3: PATCH /orders/{id} — undocumented but common in Laravel APIs
  console.log('\n[3] PATCH /orders/' + ORDER_ID + ' (undocumented):');
  const r3 = await http.patch('/orders/' + ORDER_ID, {
    delivery_price: TEST_PRICE,
  });
  console.log('  HTTP', r3.status, JSON.stringify(r3.data));

  // Attempt 4: PUT /orders/{id} — full update
  console.log('\n[4] PUT /orders/' + ORDER_ID + ' (full update):');
  const r4 = await http.put('/orders/' + ORDER_ID, {
    delivery_price: TEST_PRICE,
  });
  console.log('  HTTP', r4.status, JSON.stringify(r4.data));

  // Step 5: check if delivery_price actually changed
  console.log('\n[5] Order state AFTER all attempts:');
  const after = await megaClient.getOrder(ORDER_ID);
  console.log('  delivery_price:', after.data?.delivery_price);

  console.log('\n' + '='.repeat(60));
  if (String(after.data?.delivery_price) === String(TEST_PRICE)) {
    console.log('✅ SUCCESS: delivery_price was updated to', TEST_PRICE);
    console.log('   Check which attempt above returned success to know which endpoint works.');
  } else {
    console.log('❌ FAILED: delivery_price is still', after.data?.delivery_price);
    console.log('   Mega Ai does not expose an endpoint to update delivery_price after order creation.');
    console.log('   The checkout-fix.js approach (client-side JS) remains the only option.');
  }
}

main().catch((err) => {
  console.error('Request failed:', err.response?.data || err.message);
});
