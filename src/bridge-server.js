const { sanitizeSnapshot, verifyBridgeToken } = require('./bridge-security');

function sendJson(response, status, value) {
  if (response.writableEnded) return;
  const body = JSON.stringify(value);
  response.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
  });
  response.end(body);
}

function createBridgeRequestHandler({ token, onSnapshot, maxPayloadBytes = 16384 }) {
  if (typeof token !== 'string' || !token) throw new Error('Bridge token is required');
  if (typeof onSnapshot !== 'function') throw new Error('Snapshot callback is required');

  return (request, response) => {
    if (request.method === 'OPTIONS') return sendJson(response, 204, {});
    if (request.method === 'GET' && request.url === '/health') {
      return sendJson(response, 200, {
        ok: true,
        service: 'hermes-sigil-overlay',
        protocol: 'hermes-sigil/2'
      });
    }
    if (request.method !== 'POST' || request.url !== '/event') {
      return sendJson(response, 404, { ok: false, error: 'not_found' });
    }

    const chunks = [];
    let length = 0;
    let rejected = false;
    request.on('data', chunk => {
      if (rejected) return;
      length += chunk.length;
      if (length > maxPayloadBytes) {
        rejected = true;
        chunks.length = 0;
        sendJson(response, 413, { ok: false, error: 'payload_too_large' });
      } else {
        chunks.push(chunk);
      }
    });
    request.on('end', () => {
      if (rejected) return;
      try {
        const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!verifyBridgeToken(payload?.auth_token, token)) {
          return sendJson(response, 401, { ok: false, error: 'unauthorized' });
        }
        const safe = sanitizeSnapshot(payload);
        onSnapshot(safe);
        sendJson(response, 200, { ok: true });
      } catch (_) {
        sendJson(response, 400, { ok: false, error: 'invalid_event' });
      }
    });
    request.on('error', () => {
      if (!response.writableEnded) sendJson(response, 400, { ok: false, error: 'request_error' });
    });
  };
}

module.exports = { createBridgeRequestHandler, sendJson };
