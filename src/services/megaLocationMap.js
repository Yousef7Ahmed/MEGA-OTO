const megaClient = require('./megaClient');

/**
 * TWO-TIER CITY RESOLUTION.
 *
 * Tier 1 (precise): when Mega Ai sends a real city_id, look it up exactly
 * via the confirmed /cities endpoint. This is 100% accurate.
 *
 * Tier 2 (safe fallback): when Mega Ai does NOT send city_id (confirmed
 * to happen at some checkout stages - e.g. state selected but city not
 * yet chosen), do NOT just grab the first city Mega Ai's API happens to
 * return - that can be an obscure small town with special characters
 * (e.g. "Ad Dawādimī") that OTO's own city database rejects outright
 * (confirmed via real error: "OTO1009 - city could not be found").
 *
 * Instead, fall back to a hand-picked, ASCII-safe major city per region -
 * the same table that worked in our very first successful rate test
 * (20 real rates returned using "Riyadh" alone, before city_id existed
 * in our code at all).
 */
const FALLBACK_CITY_BY_STATE = {
  2849: 'Riyadh',
  2850: 'Jeddah',
  2851: 'Madinah',
  2852: 'Tabuk',
  2853: 'Abha',
  2854: 'Arar',
  2855: 'Hail',
  2856: 'Dammam',
  2857: 'Sakaka',
  2858: 'Jizan',
  2859: 'Al Bahah',
  2860: 'Najran',
  2861: 'Buraidah',
};

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours - city lists rarely change
const cityCacheByState = new Map(); // state_id -> { cities: [...], fetchedAt }

async function getCitiesForState(stateId) {
  const cached = cityCacheByState.get(String(stateId));
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.cities;
  }

  const response = await megaClient.getCities({ stateId });
  const cities = response.data || [];
  cityCacheByState.set(String(stateId), { cities, fetchedAt: Date.now() });
  return cities;
}

/**
 * Resolves a city name for OTO, given Mega Ai's city_id and/or state_id.
 * Returns { name, precise: boolean }.
 */
async function resolveDestinationCity({ cityId, stateId }) {
  if (!stateId) {
    throw new Error('resolveDestinationCity: stateId is required (Mega Ai always sends it).');
  }

  if (cityId) {
    const cities = await getCitiesForState(stateId);
    const exact = cities.find((c) => String(c.id) === String(cityId));
    if (exact) return { name: exact.name, precise: true };
    console.warn(`[megaLocationMap] city_id "${cityId}" not found in state ${stateId}'s city list - using safe fallback instead.`);
  }

  const fallback = FALLBACK_CITY_BY_STATE[String(stateId)] || FALLBACK_CITY_BY_STATE[Number(stateId)];
  if (fallback) {
    console.warn(`[megaLocationMap] No city_id given/matched for state ${stateId} - using known-safe fallback "${fallback}" (imprecise, but OTO-compatible).`);
    return { name: fallback, precise: false };
  }

  // Unknown state_id (e.g. non-Saudi region) - fall back to Riyadh as a
  // last resort instead of hard-stopping the request entirely.
  // This lets us test end-to-end flow for non-Saudi addresses without
  // the shipping rate callback throwing and returning empty rates.
  // The returned rate will be inaccurate (Riyadh pricing for a different
  // region) but the flow will complete, which is what we want right now.
  console.warn(`[megaLocationMap] state_id "${stateId}" is not in our known list (country_id may not be Saudi Arabia) - using Riyadh as last-resort fallback. Rate will be inaccurate.`);
  return { name: 'Riyadh', precise: false };
}

module.exports = { resolveDestinationCity };
