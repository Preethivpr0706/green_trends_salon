/**
 * Deduplicate inbound WhatsApp webhooks. Meta retries if ACK is slow; retries may
 * reuse the same wamid or (rarely) omit id — we use id, or fallback from+timestamp.
 */
const recentKeys = new Set();
const order = [];
const MAX = 2000;

function stableKey(msg) {
  if (msg?.id && typeof msg.id === "string") {
    return `id:${msg.id}`;
  }
  const from = msg?.from;
  const ts = msg?.timestamp;
  if (from && ts != null) {
    return `ft:${from}:${ts}`;
  }
  return null;
}

/**
 * @returns {boolean} true if this webhook should be skipped (already processed)
 */
export function isAlreadyProcessedInbound(msg) {
  const key = stableKey(msg);
  if (!key) return false;
  if (recentKeys.has(key)) return true;
  recentKeys.add(key);
  order.push(key);
  while (order.length > MAX) {
    const old = order.shift();
    recentKeys.delete(old);
  }
  return false;
}
