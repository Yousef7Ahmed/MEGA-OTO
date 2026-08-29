/**
 * Run: npm run test-mega-api
 *
 * The one test that actually answers the question: is
 * megaa-tons-external-api-docs.md real, or not?
 *
 * We call the simplest possible endpoint (list 1 order) and report plainly
 * what came back. No spin either way - if it fails, it fails.
 */
const config = require('../config');
const megaClient = require('../services/megaClient');

async function main() {
  console.log(`Testing against: ${config.mega.baseUrl}/orders`);
  console.log(`Using API key: ${config.mega.apiKey ? config.mega.apiKey.slice(0, 8) + '...' : '(none set)'}`);
  console.log('---');

  try {
    const result = await megaClient.listOrders({ perPage: 1 });
    console.log('✅ GOT A RESPONSE. Raw result:\n');
    console.log(JSON.stringify(result, null, 2));

    if (result && result.success === true && Array.isArray(result.data)) {
      console.log('\n👉 Shape matches the doc (success: true, data: [...]). Looks real.');
    } else {
      console.log('\n👉 Got a response, but the SHAPE does not match the doc exactly.');
      console.log('   The API might exist but differ from what was documented - compare the raw result above field by field.');
    }
  } catch (err) {
    console.log('❌ REQUEST FAILED.\n');
    if (err.response) {
      console.log(`HTTP status: ${err.response.status}`);
      console.log('Response body (first 500 chars):');
      const body = typeof err.response.data === 'string' ? err.response.data : JSON.stringify(err.response.data);
      console.log(body.slice(0, 500));
      console.log('\n👉 If this looks like an HTML page (starts with <!DOCTYPE or <html), the endpoint');
      console.log('   almost certainly does not exist - the doc was not accurate.');
    } else {
      console.log('Network-level error (no response at all):', err.message);
    }
  }
}

main();
