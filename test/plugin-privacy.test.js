const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const pluginPath = path.join(__dirname, '..', 'hermes-bridge', 'plugin.js');
const source = fs.readFileSync(pluginPath, 'utf8');

test('published plugin is an unpaired template with exactly one token placeholder', () => {
  assert.equal(source.split('__HERMES_SIGIL_AUTH_TOKEN__').length - 1, 1);
  assert.equal(source.includes('http://127.0.0.1:8765/event'), true);
});

test('published plugin does not transmit raw session or tool identifiers', () => {
  assert.equal(source.includes('active_session_id'), false);
  assert.equal(/tool_name\s*:/.test(source), false);
  assert.equal(/timestamp_ms\s*:/.test(source), false);
  assert.equal(/event\s*:/.test(source), false);
  assert.equal(/session_active\s*:/.test(source), true);
});

test('published plugin has no external network destination', () => {
  const urls = source.match(/https?:\/\/[^'"\s]+/g) || [];
  assert.deepEqual(urls, ['http://127.0.0.1:8765/event']);
});
