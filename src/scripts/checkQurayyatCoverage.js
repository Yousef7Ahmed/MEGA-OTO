/**
 * Run: node src/scripts/checkQurayyatCoverage.js
 *
 * Lists exactly which delivery companies (from checkOTODeliveryFee)
 * actually serve "Qurayyat" as a destination city, and compares against
 * the full Riyadh list to spot which companies genuinely cover a small
 * city vs only major hubs.
 */
const otoClient = require('../services/otoClient');

async function listFor(city) {
  const result = await otoClient.checkDeliveryFee({
    originCity: 'Riyadh',
    destinationCity: city,
    weight: 1,
  });
  return result.deliveryCompany || [];
}

async function main() {
  console.log('--- Checking Qurayyat coverage ---');
  const qurayyat = await listFor('Qurayyat');
  console.log(`Found ${qurayyat.length} option(s) for Qurayyat:\n`);
  qurayyat.forEach((c) => console.log(`- ${c.deliveryOptionName} (${c.deliveryCompanyName}) - ${c.price} SAR - ${c.avgDeliveryTime}`));

  console.log('\n--- Checking Riyadh coverage (for comparison) ---');
  const riyadh = await listFor('Riyadh');
  console.log(`Found ${riyadh.length} option(s) for Riyadh.\n`);

  const qurayyatCompanies = new Set(qurayyat.map((c) => c.deliveryCompanyName));
  const riyadhCompanies = new Set(riyadh.map((c) => c.deliveryCompanyName));
  const onlyInRiyadh = [...riyadhCompanies].filter((c) => !qurayyatCompanies.has(c));

  console.log('--- Summary ---');
  console.log(`Companies covering Qurayyat: ${[...qurayyatCompanies].join(', ') || '(none)'}`);
  console.log(`Companies that DON'T reach Qurayyat (but do reach Riyadh): ${onlyInRiyadh.join(', ') || '(none)'}`);
}

main().catch((err) => {
  console.error('Request failed:');
  console.error(`HTTP status: ${err.response?.status}`);
  console.error('Body:', JSON.stringify(err.response?.data, null, 2));
});
