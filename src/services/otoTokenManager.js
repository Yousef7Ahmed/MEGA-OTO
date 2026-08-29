const axios = require('axios');
const config = require('../config');

// OTO access_token is valid for 1 hour (per OTO's own docs).
// We refresh a bit early (5 minutes of margin) so a request never gets caught
// mid-flight with an expired token.
const EXPIRY_MARGIN_MS = 5 * 60 * 1000;

let cachedToken = null; // { accessToken, expiresAt }

async function fetchNewAccessToken() {
  if (!config.oto.refreshToken || config.oto.refreshToken === 'REPLACE_ME') {
    throw new Error(
      'OTO_REFRESH_TOKEN is not set. Put the refresh token from app.tryoto.com (Settings > Developers > API integrations) into your .env file.'
    );
  }

  const url = `${config.oto.baseUrl}/refreshToken`;

  const response = await axios.post(url, {
    refresh_token: config.oto.refreshToken,
  });

  // OTO's documented response is expected to include an access_token with a
  // 1 hour lifespan. We defensively check a couple of likely field names in
  // case the exact response key differs slightly - log the raw response once
  // if none match, so this is easy to fix without guessing blind.
  const data = response.data || {};
  const accessToken =
    data.access_token || data.accessToken || data.token || null;

  if (!accessToken) {
    console.error('[oto] Unexpected refreshToken response shape:', JSON.stringify(data));
    throw new Error('Could not find access_token in OTO refreshToken response - check the log above and adjust otoTokenManager.js.');
  }

  return accessToken;
}

/**
 * Returns a valid OTO access_token, refreshing it automatically if the
 * cached one is missing or close to expiry.
 */
async function getAccessToken() {
  const now = Date.now();

  if (cachedToken && cachedToken.expiresAt - EXPIRY_MARGIN_MS > now) {
    return cachedToken.accessToken;
  }

  const accessToken = await fetchNewAccessToken();

  cachedToken = {
    accessToken,
    // 1 hour lifespan per OTO docs
    expiresAt: now + 60 * 60 * 1000,
  };

  return accessToken;
}

/** Forces the next call to getAccessToken() to fetch a fresh token. */
function invalidate() {
  cachedToken = null;
}

module.exports = { getAccessToken, invalidate };
