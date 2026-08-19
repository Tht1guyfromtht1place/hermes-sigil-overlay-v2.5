const test = require('node:test');
const assert = require('node:assert/strict');

const {
  ACTIVITY_NODES,
  createBridgeToken,
  sanitizeSnapshot,
  verifyBridgeToken
} = require('../src/bridge-security');

test('creates an opaque per-install token without user data', () => {
  const first = createBridgeToken();
  const second = createBridgeToken();
  assert.match(first, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(first, second);
});

test('accepts the matching bridge token and rejects all others', () => {
  const token = createBridgeToken();
  assert.equal(verifyBridgeToken(token, token), true);
  assert.equal(verifyBridgeToken('wrong', token), false);
  assert.equal(verifyBridgeToken('', token), false);
});

test('snapshot sanitizer keeps only visual activity metadata', () => {
  const safe = sanitizeSnapshot({
    protocol: 'hermes-sigil/2',
    auth_token: 'must-not-survive',
    active_session_id: 'private-session-id',
    session_active: true,
    capabilities: ['activity-nodes', 'untrusted-capability'],
    nodes: ['think', 'execute', 'not-a-node'],
    status: 'working',
    error_node: null,
    source: 'spoofed-source',
    event: {
      sequence: 7,
      timestamp_ms: 123456,
      type: 'tool.start',
      stage: 'start',
      tool_name: 'customer_project_secret_tool',
      tool_categories: ['tools', 'execute', 'not-a-node'],
      progress: 42,
      attention_kind: null,
      is_subagent: false,
      message: 'private response text'
    },
    prompt: 'private prompt text',
    credentials: 'never copy this'
  });

  assert.deepEqual(safe, {
    type: 'hermes-snapshot',
    protocol: 'hermes-sigil/2',
    session_active: true,
    nodes: ['think', 'execute'],
    status: 'working',
    error_node: null,
    source: 'hermes-desktop-sigil'
  });
  assert.equal(JSON.stringify(safe).includes('private'), false);
  assert.equal(JSON.stringify(safe).includes('customer_project'), false);
});

test('snapshot sanitizer rejects unsupported protocol and invalid status', () => {
  assert.throws(() => sanitizeSnapshot({ protocol: 'other', nodes: [], status: 'idle' }), /protocol/i);
  assert.throws(() => sanitizeSnapshot({ protocol: 'hermes-sigil/2', nodes: [], status: 'hacked' }), /status/i);
});

test('activity vocabulary is fixed and contains no user-defined values', () => {
  assert.equal(ACTIVITY_NODES.length, 20);
  assert.equal(ACTIVITY_NODES.includes('execute'), true);
});
