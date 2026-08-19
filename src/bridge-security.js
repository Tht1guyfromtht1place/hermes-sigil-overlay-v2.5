const crypto = require('node:crypto');

const PROTOCOL = 'hermes-sigil/2';
const ACTIVITY_NODES = Object.freeze([
  'think', 'reason', 'vision', 'web', 'search', 'read', 'network', 'execute', 'tools', 'create',
  'cloud', 'voice', 'respond', 'image', 'video', 'data', 'security', 'device', 'monitor', 'power'
]);
const NODE_SET = new Set(ACTIVITY_NODES);
const STATUS_SET = new Set(['idle', 'working', 'complete', 'waiting', 'error']);

function createBridgeToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function verifyBridgeToken(candidate, expected) {
  if (typeof candidate !== 'string' || typeof expected !== 'string' || !candidate || !expected) return false;
  const candidateBuffer = Buffer.from(candidate);
  const expectedBuffer = Buffer.from(expected);
  return candidateBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(candidateBuffer, expectedBuffer);
}

function safeNodes(values) {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.map(value => String(value).toLowerCase()).filter(value => NODE_SET.has(value)))];
}

function sanitizeSnapshot(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Invalid snapshot payload');
  if (payload.protocol !== PROTOCOL) throw new Error('Unsupported protocol');
  const status = String(payload.status || 'idle').toLowerCase();
  if (!STATUS_SET.has(status)) throw new Error('Invalid status');

  const requestedErrorNode = String(payload.error_node || '').toLowerCase();
  return {
    type: 'hermes-snapshot',
    protocol: PROTOCOL,
    session_active: Boolean(payload.session_active),
    nodes: safeNodes(payload.nodes),
    status,
    error_node: NODE_SET.has(requestedErrorNode) ? requestedErrorNode : null,
    source: 'hermes-desktop-sigil'
  };
}

module.exports = {
  ACTIVITY_NODES,
  PROTOCOL,
  createBridgeToken,
  sanitizeSnapshot,
  verifyBridgeToken
};
