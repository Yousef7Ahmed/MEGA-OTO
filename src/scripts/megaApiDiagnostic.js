/**
 * Run: node src/scripts/megaApiDiagnostic.js
 *
 * Hits several megaa-tons-external-api-docs.md endpoints in one go and
 * prints a clean status report for each - so we get a full picture in one
 * run instead of testing endpoints one at a time by hand.
 *
 * Deliberately excludes endpoints that would mutate a REAL order on a live
 * store (PUT /orders/{id}/status, PUT /orders/{id}/tracking,
 * POST /webhooks). Those have real customer-facing side effects (status
 * change, tracking emails, etc.) and should only be run deliberately on a
 * disposable test order, not as part of a blind diagnostic sweep.
 */
const axios = require('axios');
const config = require('../config');

const client = axios.create({
  baseURL: config.mega.baseUrl,
  headers: {
    'X-API-Key': config.mega.apiKey,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  },
  validateStatus: () => true, // we want to inspect every status ourselves
});

const tests = [
  {
    name: 'List orders (no filters)',
    method: 'get',
    url: '/orders',
  },
  {
    name: 'List orders (per_page=1)',
    method: 'get',
    url: '/orders',
    params: { per_page: 1 },
  },
  {
    name: 'List orders (status=confirmed)',
    method: 'get',
    url: '/orders',
    params: { status: 'confirmed' },
  },
  {
    name: 'Get order #1',
    method: 'get',
    url: '/orders/1',
  },
  {
    name: 'Get order that almost certainly does not exist (#999999)',
    method: 'get',
    url: '/orders/999999',
  },
  {
    name: 'Generate API key (repeat of earlier manual test)',
    method: 'post',
    url: '/generate-key',
    data: { name: 'diagnostic-test', store_id: 45, permissions: ['*'] },
  },
  {
    name: 'Calculate shipping rates (minimal payload)',
    method: 'post',
    url: '/shipping-rates',
    data: { country_id: 1 },
  },
  {
    name: 'Register a throwaway shipping provider',
    method: 'post',
    url: '/shipping-providers',
    data: { name: 'diagnostic-test-provider', callback_url: 'https://example.com/rates', priority: 99 },
  },
];

function summarize(data) {
  const str = typeof data === 'string' ? data : JSON.stringify(data);
  if (str.trim().startsWith('<!DOCTYPE') || str.trim().startsWith('<html')) {
    return '(HTML error page, not JSON)';
  }
  return str.length > 200 ? str.slice(0, 200) + '...' : str;
}

async function main() {
  if (!config.mega.apiKey) {
    console.error('MEGA_API_KEY is not set in .env - nothing to test.');
    process.exit(1);
  }

  console.log(`Base URL: ${config.mega.baseUrl}`);
  console.log(`API key: ${config.mega.apiKey.slice(0, 8)}...`);
  console.log('='.repeat(70));

  const results = [];

  for (const test of tests) {
    try {
      const response = await client.request({
        method: test.method,
        url: test.url,
        params: test.params,
        data: test.data,
      });
      results.push({ name: test.name, status: response.status });
      console.log(`\n[${response.status}] ${test.name}`);
      console.log(`  ${test.method.toUpperCase()} ${test.url}`);
      console.log(`  -> ${summarize(response.data)}`);
    } catch (err) {
      results.push({ name: test.name, status: 'NETWORK_ERROR' });
      console.log(`\n[NETWORK ERROR] ${test.name}`);
      console.log(`  ${err.message}`);
    }
  }

  console.log('\n' + '='.repeat(70));
  console.log('SUMMARY:');
  const byStatus = {};
  results.forEach((r) => {
    byStatus[r.status] = (byStatus[r.status] || 0) + 1;
  });
  Object.entries(byStatus).forEach(([status, count]) => {
    console.log(`  ${status}: ${count} endpoint(s)`);
  });
}

main();
