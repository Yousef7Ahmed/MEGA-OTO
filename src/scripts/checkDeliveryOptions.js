/**
 * Run: node src/scripts/checkDeliveryOptions.js
 *
 * getDeliveryOptions requires a paid OTO plan (Starter/Scale/Enterprise/
 * Marketplaces) - confirmed NOT available on the Free package (this
 * account's current plan), hence the earlier 404.
 *
 * Instead, use checkOTODeliveryFee (already confirmed working on Free)
 * and scan the returned companies for Barq. Testing SAME city as both
 * origin and destination, since Barq specializes in intra-city instant
 * delivery, not inter-city.
 */
const otoClient = require('../services/otoClient');

async function main() {
  const result = await otoClient.checkDeliveryFee({
    originCity: 'Riyadh',
    destinationCity: 'Riyadh',
    weight: 1,
  });

  console.log('Full response:\n', JSON.stringify(result, null, 2));

  const companies = result.deliveryCompany || [];
  const barq = companies.find((c) => JSON.stringify(c).toLowerCase().includes('barq'));

  console.log('\n--- Summary ---');
  console.log(`Total delivery options found for Riyadh -> Riyadh: ${companies.length}`);
  console.log(barq ? '✅ BARQ found and activated:' : '❌ BARQ NOT found in the activated list.');
  if (barq) console.log(JSON.stringify(barq, null, 2));
}

main().catch((err) => {
  console.error('Request failed:');
  console.error(`HTTP status: ${err.response?.status}`);
  console.error('Body:', JSON.stringify(err.response?.data, null, 2));
});
