const axios = require("axios");
const config = require("../config");

const EXPIRY_MARGIN_MS = 5 * 60 * 1000;
let cachedToken = null;
let pendingRefreshTokenPromise = null;

async function fetchNewAccessToken() {
  if (!config.oto.refreshToken || config.oto.refreshToken === "REPLACE_ME") {
    throw new Error(
      "OTO_REFRESH_TOKEN is not configured in environment variables.",
    );
  }

  const url = `${config.oto.baseUrl}/refreshToken`;

  try {
    const response = await axios.post(url, {
      refresh_token: config.oto.refreshToken,
    });

    const data = response.data || {};
    const accessToken =
      data.access_token || data.accessToken || data.token || null;

    if (!accessToken) {
      console.error(
        "[oto-auth] Invalid token payload format:",
        JSON.stringify(data),
      );
      throw new Error("access_token field not found in OTO response");
    }

    return accessToken;
  } catch (err) {
    console.error(
      "[oto-auth] Refresh token request failed:",
      err.response?.data || err.message,
    );
    throw err;
  }
}

async function getAccessToken() {
  const now = Date.now();

  if (cachedToken && cachedToken.expiresAt - EXPIRY_MARGIN_MS > now) {
    return cachedToken.accessToken;
  }

  // Prevent multiple simultaneous token requests
  if (pendingRefreshTokenPromise) {
    return pendingRefreshTokenPromise;
  }

  pendingRefreshTokenPromise = (async () => {
    try {
      const accessToken = await fetchNewAccessToken();
      cachedToken = {
        accessToken,
        expiresAt: Date.now() + 60 * 60 * 1000,
      };
      return accessToken;
    } finally {
      pendingRefreshTokenPromise = null;
    }
  })();

  return pendingRefreshTokenPromise;
}

function invalidate() {
  cachedToken = null;
}

module.exports = { getAccessToken, invalidate };
