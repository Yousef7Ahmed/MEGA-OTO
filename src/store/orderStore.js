/**
 * In-memory order store — replaces the old JSON-file version.
 *
 * Render.com (and most PaaS platforms) reset the filesystem on every
 * deploy or restart, so writing to disk was unreliable. In-memory is
 * fine for development and short-lived staging; for production with
 * persistence you'd replace this with a real DB (e.g. Render's managed
 * Postgres or Redis add-on).
 *
 * Interface is identical to the old file-based version — no other files
 * need to change.
 */

const store = {};

function saveOrder(orderId, record) {
  store[orderId] = {
    ...(store[orderId] || {}),
    ...record,
    updatedAt: new Date().toISOString(),
  };
  return store[orderId];
}

function getOrder(orderId) {
  return store[orderId] || null;
}

function getAllOrders() {
  return store;
}

module.exports = { saveOrder, getOrder, getAllOrders };
