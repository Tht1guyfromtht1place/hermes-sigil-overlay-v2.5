const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  PLUGIN_ID,
  PLUGIN_TOKEN_PLACEHOLDER,
  discoverHermesHomes,
  installPluginForHomes,
  removePluginFromHomes,
  renderPluginSource
} = require('../src/plugin-installer');

test('renders a plugin with only the generated local token substituted', () => {
  const template = `const TOKEN = '${PLUGIN_TOKEN_PLACEHOLDER}'\nconst label = 'public'`;
  const rendered = renderPluginSource(template, 'abc_DEF-123');
  assert.equal(rendered.includes(PLUGIN_TOKEN_PLACEHOLDER), false);
  assert.equal(rendered.includes("const TOKEN = 'abc_DEF-123'"), true);
  assert.throws(() => renderPluginSource(template, "bad'token"), /token/i);
});

test('discovers default and named-profile Hermes homes without personal paths in source', () => {
  const local = path.join('C:', 'Users', 'Example', 'AppData', 'Local');
  const fakeFs = {
    existsSync(value) {
      return value === path.join(local, 'hermes', 'profiles');
    },
    readdirSync() {
      return [
        { name: 'work', isDirectory: () => true },
        { name: 'notes.txt', isDirectory: () => false }
      ];
    }
  };
  assert.deepEqual(discoverHermesHomes({ LOCALAPPDATA: local }, fakeFs), [
    path.join(local, 'hermes'),
    path.join(local, 'hermes', 'profiles', 'work')
  ]);
});

test('explicit HERMES_HOME installs only into that isolated profile', () => {
  const fakeFs = { existsSync: () => false, readdirSync: () => [] };
  assert.deepEqual(discoverHermesHomes({ HERMES_HOME: 'D:/Hermes/ProfileA', LOCALAPPDATA: 'C:/Local' }, fakeFs), [path.normalize('D:/Hermes/ProfileA')]);
});

test('installs a paired plugin atomically and removes it cleanly', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sigil-plugin-'));
  const home = path.join(root, 'hermes-home');
  const templatePath = path.join(root, 'plugin-template.js');
  fs.writeFileSync(templatePath, `const TOKEN = '${PLUGIN_TOKEN_PLACEHOLDER}'\n`);

  const result = installPluginForHomes({ templatePath, token: 'paired_token_123', homes: [home] });
  const expected = path.join(home, 'desktop-plugins', PLUGIN_ID, 'plugin.js');
  assert.deepEqual(result, { installed: [expected], failed: [] });
  assert.equal(fs.readFileSync(expected, 'utf8'), "const TOKEN = 'paired_token_123'\n");
  assert.equal(fs.existsSync(`${expected}.tmp`), false);

  const removed = removePluginFromHomes({ homes: [home] });
  assert.deepEqual(removed, { removed: [path.dirname(expected)], failed: [] });
  assert.equal(fs.existsSync(path.dirname(expected)), false);
  fs.rmSync(root, { recursive: true, force: true });
});

test('continues installing when one Hermes profile is inaccessible', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sigil-plugin-'));
  const templatePath = path.join(root, 'plugin-template.js');
  const goodHome = path.join(root, 'good-home');
  fs.writeFileSync(templatePath, `const TOKEN = '${PLUGIN_TOKEN_PLACEHOLDER}'\n`);
  const fakeFs = {
    ...fs,
    mkdirSync(directory, options) {
      if (String(directory).includes('bad-home')) throw new Error('access denied');
      return fs.mkdirSync(directory, options);
    }
  };

  const result = installPluginForHomes({
    templatePath,
    token: 'paired_token_123',
    homes: [path.join(root, 'bad-home'), goodHome],
    fileSystem: fakeFs
  });
  assert.equal(result.installed.length, 1);
  assert.equal(result.failed.length, 1);
  assert.equal(result.failed[0].home.endsWith('bad-home'), true);
  assert.equal(result.failed[0].error, 'access denied');
  fs.rmSync(root, { recursive: true, force: true });
});

test('continues removing when one Hermes profile is inaccessible', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sigil-plugin-'));
  const badHome = path.join(root, 'bad-home');
  const goodHome = path.join(root, 'good-home');
  const goodPlugin = path.join(goodHome, 'desktop-plugins', PLUGIN_ID);
  fs.mkdirSync(goodPlugin, { recursive: true });
  fs.writeFileSync(path.join(goodPlugin, 'plugin.js'), 'owned');
  const fakeFs = {
    ...fs,
    existsSync: value => String(value).includes('bad-home') || fs.existsSync(value),
    rmSync(directory, options) {
      if (String(directory).includes('bad-home')) throw new Error('access denied');
      return fs.rmSync(directory, options);
    }
  };

  const result = removePluginFromHomes({ homes: [badHome, goodHome], fileSystem: fakeFs });
  assert.equal(result.removed.length, 1);
  assert.equal(result.failed.length, 1);
  assert.equal(result.failed[0].home, badHome);
  assert.equal(result.failed[0].error, 'access denied');
  assert.equal(fs.existsSync(goodPlugin), false);
  fs.rmSync(root, { recursive: true, force: true });
});
