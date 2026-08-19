const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { auditTree } = require('../scripts/release-audit');

test('release audit rejects personal Windows paths and credential-like values', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sigil-audit-'));
  const windowsPath = ['C:', 'Users', 'PrivatePerson', 'OneDrive'].join('\\');
  const providerKey = ['s', 'k-example-secret-value'].join('');
  fs.writeFileSync(path.join(root, 'bad.txt'), `home=${windowsPath}\\backup\napi_key="${providerKey}"`);
  const findings = auditTree(root);
  assert.equal(findings.some(item => item.includes('personal Windows path')), true);
  assert.equal(findings.some(item => item.includes('credential-like value')), true);
  fs.rmSync(root, { recursive: true, force: true });
});

test('release audit accepts ordinary source and documentation', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sigil-audit-'));
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src', 'main.js'), "console.log('Hermes Sigil')\n");
  fs.writeFileSync(path.join(root, 'README.md'), 'No API keys or credentials are collected.\n');
  assert.deepEqual(auditTree(root), []);
  fs.rmSync(root, { recursive: true, force: true });
});
