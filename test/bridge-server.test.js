const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const { createBridgeRequestHandler } = require('../src/bridge-server');

async function withServer(handler, run) {
  const server = http.createServer(handler);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  try {
    const { port } = server.address();
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

function validSnapshot(token) {
  return {
    auth_token: token,
    protocol: 'hermes-sigil/2',
    session_active: true,
    nodes: ['think'],
    status: 'working',
    error_node: null,
    event: null
  };
}

test('event endpoint rejects callers without the per-install token', async () => {
  await withServer(createBridgeRequestHandler({ token: 'correct_token', onSnapshot() {} }), async base => {
    const response = await fetch(`${base}/event`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify(validSnapshot('wrong_token'))
    });
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { ok: false, error: 'unauthorized' });
  });
});

test('event endpoint emits only the sanitized snapshot', async () => {
  let received = null;
  await withServer(createBridgeRequestHandler({ token: 'correct_token', onSnapshot(value) { received = value; } }), async base => {
    const payload = validSnapshot('correct_token');
    payload.active_session_id = 'private-id';
    payload.prompt = 'private prompt';
    const response = await fetch(`${base}/event`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify(payload)
    });
    assert.equal(response.status, 200);
    assert.equal(received.session_active, true);
    assert.equal(JSON.stringify(received).includes('private'), false);
  });
});

test('event endpoint bounds request bodies', async () => {
  await withServer(createBridgeRequestHandler({ token: 'correct_token', onSnapshot() {}, maxPayloadBytes: 128 }), async base => {
    const response = await fetch(`${base}/event`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify({ ...validSnapshot('correct_token'), padding: 'x'.repeat(512) })
    });
    assert.equal(response.status, 413);
  });
});

test('public health endpoint reveals no Hermes activity or profile state', async () => {
  await withServer(createBridgeRequestHandler({
    token: 'correct_token',
    onSnapshot() {},
    getHealth: () => ({ connected: true, installed_profiles: 7 })
  }), async base => {
    const response = await fetch(`${base}/health`, { headers: { Origin: 'https://attacker.example' } });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      ok: true,
      service: 'hermes-sigil-overlay',
      protocol: 'hermes-sigil/2'
    });
  });
});
