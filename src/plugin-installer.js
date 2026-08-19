const fs = require('node:fs');
const path = require('node:path');

const PLUGIN_TOKEN_PLACEHOLDER = '__HERMES_SIGIL_AUTH_TOKEN__';
const PLUGIN_ID = 'hermes-sigil-bridge';

function discoverHermesHomes(env = process.env, fileSystem = fs) {
  if (env.HERMES_HOME) return [path.normalize(env.HERMES_HOME)];
  if (!env.LOCALAPPDATA) return [];

  const base = path.join(env.LOCALAPPDATA, 'hermes');
  const homes = [base];
  const profiles = path.join(base, 'profiles');
  if (fileSystem.existsSync(profiles)) {
    for (const entry of fileSystem.readdirSync(profiles, { withFileTypes: true })) {
      if (entry.isDirectory()) homes.push(path.join(profiles, entry.name));
    }
  }
  return homes;
}

function renderPluginSource(template, token) {
  if (typeof template !== 'string' || !template.includes(PLUGIN_TOKEN_PLACEHOLDER)) {
    throw new Error('Plugin template token placeholder is missing');
  }
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(token)) {
    throw new Error('Invalid bridge token');
  }
  return template.split(PLUGIN_TOKEN_PLACEHOLDER).join(token);
}

function installPluginForHomes({ templatePath, token, homes = discoverHermesHomes(), fileSystem = fs }) {
  const template = fileSystem.readFileSync(templatePath, 'utf8');
  const rendered = renderPluginSource(template, token);
  const installed = [];
  const failed = [];
  for (const home of homes) {
    try {
      const pluginDirectory = path.join(home, 'desktop-plugins', PLUGIN_ID);
      const pluginPath = path.join(pluginDirectory, 'plugin.js');
      fileSystem.mkdirSync(pluginDirectory, { recursive: true });
      const temporaryPath = `${pluginPath}.tmp`;
      fileSystem.writeFileSync(temporaryPath, rendered, { encoding: 'utf8', mode: 0o600 });
      fileSystem.renameSync(temporaryPath, pluginPath);
      installed.push(pluginPath);
    } catch (error) {
      failed.push({ home, error: error.message });
    }
  }
  return { installed, failed };
}

function removePluginFromHomes({ homes = discoverHermesHomes(), fileSystem = fs } = {}) {
  const removed = [];
  const failed = [];
  for (const home of homes) {
    try {
      const pluginDirectory = path.join(home, 'desktop-plugins', PLUGIN_ID);
      if (fileSystem.existsSync(pluginDirectory)) {
        fileSystem.rmSync(pluginDirectory, { recursive: true, force: true });
        removed.push(pluginDirectory);
      }
    } catch (error) {
      failed.push({ home, error: error.message });
    }
  }
  return { removed, failed };
}

module.exports = {
  PLUGIN_ID,
  PLUGIN_TOKEN_PLACEHOLDER,
  discoverHermesHomes,
  installPluginForHomes,
  removePluginFromHomes,
  renderPluginSource
};
