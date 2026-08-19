const { app, BrowserWindow, globalShortcut, ipcMain, screen, Tray, Menu, nativeImage, dialog } = require('electron');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { createBridgeToken } = require('./bridge-security');
const { createBridgeRequestHandler } = require('./bridge-server');
const { discoverHermesHomes, installPluginForHomes, removePluginFromHomes } = require('./plugin-installer');

const BRIDGE_PORT = 8765;
const MAX_SIGIL_OPACITY = 255; // 100%.
const MIN_SIGIL_OPACITY = 10; // Approximately 4%.
const DEFAULTS = { x: null, y: null, size: 720, opacity: MAX_SIGIL_OPACITY, showLabels: false, clickThrough: false, animation: true, animationSpeed: 2.0, adaptiveContrast: false, rotatingHermesRing: true };
let win = null;
let bridgeServer = null;
let bridgeToken = '';
let installedPluginPaths = [];
let lastBridgeSeenAt = 0;
let bridgeConnected = false;
let bridgeEverConnected = false;
let bridgeStatusTimer = null;
let settings = { ...DEFAULTS };
let saveTimer = null;
let dragTimer = null;
let dragStart = null;
let tray = null;

const settingsPath = () => path.join(app.getPath('userData'), 'overlay-settings.json');

const bridgeTokenPath = () => path.join(app.getPath('userData'), 'bridge-token');

function validateBridgePort() {
  if (!Number.isInteger(BRIDGE_PORT) || BRIDGE_PORT < 1024 || BRIDGE_PORT > 65535) {
    throw new Error(`Invalid Hermes Sigil bridge port: ${BRIDGE_PORT}`);
  }
}

function loadOrCreateBridgeToken() {
  const tokenPath = bridgeTokenPath();
  try {
    const existing = fs.readFileSync(tokenPath, 'utf8').trim();
    if (/^[A-Za-z0-9_-]{43}$/.test(existing)) return existing;
  } catch (_) {}
  const token = createBridgeToken();
  fs.mkdirSync(path.dirname(tokenPath), { recursive: true });
  fs.writeFileSync(tokenPath, token, { encoding: 'utf8', mode: 0o600 });
  return token;
}

function bundledPluginPath() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'hermes-bridge', 'plugin.js')
    : path.join(__dirname, '..', 'hermes-bridge', 'plugin.js');
}

function installHermesBridge() {
  if (process.env.HERMES_SIGIL_SKIP_PLUGIN_INSTALL === '1') return { installed: [], failed: [] };
  const result = installPluginForHomes({
    templatePath: bundledPluginPath(),
    token: bridgeToken,
    homes: discoverHermesHomes()
  });
  installedPluginPaths = result.installed;
  for (const failure of result.failed) console.warn('[bridge install failed]', failure.home, failure.error);
  return result;
}

function uninstallHermesBridge() {
  const result = removePluginFromHomes({ homes: discoverHermesHomes() });
  installedPluginPaths = [];
  setBridgeConnected(false);
  announce(result.removed.length ? 'HERMES BRIDGE REMOVED' : 'HERMES BRIDGE NOT INSTALLED');
  for (const failure of result.failed) console.warn('[bridge removal failed]', failure.home, failure.error);
  refreshTrayMenu();
}

function loadSettings() {
  try { settings = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(settingsPath(), 'utf8')) }; } catch (_) {}
  settings.clickThrough = false;
  settings.size = Math.max(180, Math.min(1400, Number(settings.size) || 720));
  settings.opacity = Math.max(MIN_SIGIL_OPACITY, Math.min(MAX_SIGIL_OPACITY, Number(settings.opacity) || MAX_SIGIL_OPACITY));
  delete settings.nodeOpacityBoost;
  settings.animationSpeed = Math.max(0.2, Math.min(3, Number(settings.animationSpeed) || 1));
}

function saveSettings() {
  if (win && !win.isDestroyed()) {
    const bounds = win.getBounds();
    Object.assign(settings, { x: bounds.x, y: bounds.y, size: bounds.width });
  }
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
      fs.writeFileSync(settingsPath(), JSON.stringify(settings, null, 2));
    } catch (err) { console.error('[settings]', err.message); }
  }, 120);
}

function broadcast(evt) {
  if (win && !win.isDestroyed()) win.webContents.send('sigil-event', evt);
}

function announce(label) { broadcast({ type: 'ui', action: 'status', label }); }

function toggleOverlay() {
  if (!win || win.isDestroyed()) return;
  if (win.isVisible()) win.hide(); else win.showInactive();
  refreshTrayMenu();
}

function toggleSetting(key, onLabel, offLabel) {
  settings[key] = !settings[key];
  applySettings();
  announce(settings[key] ? onLabel : offLabel);
  saveSettings();
}

function resetWindow() {
  if (!win || win.isDestroyed()) return;
  const work = screen.getPrimaryDisplay().workArea;
  const size = DEFAULTS.size;
  win.setBounds({
    x: Math.floor(work.x + (work.width - size) / 2),
    y: Math.floor(work.y + (work.height - size) / 2),
    width: size,
    height: size
  });
  settings.size = size;
  announce('POSITION AND SIZE RESET');
  saveSettings();
}

function refreshTrayMenu() {
  if (!tray) return;
  tray.setToolTip(`Hermes Sigil Overlay — ${bridgeConnected ? 'Hermes Connected' : 'Hermes Offline'}`);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: win?.isVisible() ? 'Hide Overlay' : 'Show Overlay', click: toggleOverlay },
    { label: settings.clickThrough ? 'Switch to Interactive' : 'Enable Click-Through', click: toggleClickThrough },
    { type: 'separator' },
    { label: `Opacity: ${Math.round(settings.opacity / 255 * 100)}%`, enabled: false },
    { label: 'Increase Opacity (+2%)', click: () => adjustOpacity(2) },
    { label: 'Decrease Opacity (-2%)', click: () => adjustOpacity(-2) },
    { type: 'separator' },
    { label: `Animation Speed: ${settings.animationSpeed.toFixed(1)}x`, enabled: false },
    { label: 'Increase Animation Speed', click: () => adjustMotionSpeed(1) },
    { label: 'Decrease Animation Speed', click: () => adjustMotionSpeed(-1) },
    { label: 'Animations Enabled', type: 'checkbox', checked: settings.animation !== false, click: () => toggleSetting('animation', 'ANIMATION ON', 'ANIMATION OFF') },
    { label: 'Node Labels', type: 'checkbox', checked: Boolean(settings.showLabels), click: () => toggleSetting('showLabels', 'NODE LABELS ON', 'NODE LABELS OFF') },
    { label: 'Universal Contrast', type: 'checkbox', checked: Boolean(settings.adaptiveContrast), click: () => toggleSetting('adaptiveContrast', 'UNIVERSAL CONTRAST ON', 'UNIVERSAL CONTRAST OFF') },
    { label: 'Rotating Center Rings', type: 'checkbox', checked: Boolean(settings.rotatingHermesRing), click: () => toggleSetting('rotatingHermesRing', 'HERMES RING MOTION ON', 'HERMES RING MOTION OFF') },
    { type: 'separator' },
    { label: 'Start / Cancel Three-Phase Node Test', click: () => broadcast({ type: 'demo' }) },
    { label: 'Clear Activity Effects', click: () => broadcast({ type: 'idle' }) },
    { label: `Connection: ${bridgeConnected ? 'Hermes Connected' : 'Hermes Offline'}`, click: () => announce(bridgeConnected ? 'HERMES CONNECTED' : 'HERMES OFFLINE') },
    { label: `Bridge installed for ${installedPluginPaths.length} Hermes profile${installedPluginPaths.length === 1 ? '' : 's'}`, enabled: false },
    { label: 'Install / Repair Hermes Bridge', click: () => {
      try {
        const result = installHermesBridge();
        announce(result.installed.length ? 'HERMES BRIDGE INSTALLED' : 'BRIDGE INSTALL FAILED');
      } catch (error) {
        console.error('[bridge install]', error.message);
        announce('BRIDGE INSTALL FAILED');
      }
      refreshTrayMenu();
    } },
    { label: 'Uninstall Hermes Bridge', click: uninstallHermesBridge },
    { label: 'Reset Position and Size', click: resetWindow },
    { type: 'separator' },
    { label: 'Quit Hermes Sigil', click: () => app.quit() }
  ]));
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, '..', 'assets', 'hermes-sigil.png')).resize({ width: 32, height: 32, quality: 'best' });
  tray = new Tray(icon);
  tray.on('click', toggleOverlay);
  refreshTrayMenu();
}

function setBridgeConnected(connected) {
  connected = Boolean(connected);
  if (connected === bridgeConnected) return;
  const restored = connected && bridgeEverConnected;
  bridgeConnected = connected;
  if (connected) bridgeEverConnected = true;
  broadcast({ type: 'bridge-status', connected, restored });
  refreshTrayMenu();
}

function applySettings() {
  if (!win || win.isDestroyed()) return;
  // Keep the transparent window fully composited so activity effects can be
  // brighter than the user's base artwork opacity. Renderer layers apply opacity.
  win.setOpacity(1);
  win.setIgnoreMouseEvents(settings.clickThrough, { forward: true });
  broadcast({ type: 'settings', settings });
  refreshTrayMenu();
}

function toggleClickThrough() {
  settings.clickThrough = !settings.clickThrough;
  applySettings();
  announce(settings.clickThrough ? 'CLICK-THROUGH' : 'INTERACTIVE');
  saveSettings();
}

function adjustOpacity(deltaPercent) {
  const currentPercent = Math.round(settings.opacity / 255 * 100);
  const nextPercent = Math.max(4, Math.min(100, currentPercent + deltaPercent));
  settings.opacity = Math.max(MIN_SIGIL_OPACITY, Math.min(MAX_SIGIL_OPACITY, Math.round(nextPercent / 100 * 255)));
  applySettings();
  announce(`OPACITY ${nextPercent}%`);
  saveSettings();
}

function adjustMotionSpeed(direction) {
  settings.animationSpeed = Math.round(Math.max(0.2, Math.min(3, settings.animationSpeed + direction * 0.2)) * 10) / 10;
  applySettings();
  broadcast({ type: 'motion-preview', duration: 4000 });
  announce(`SPEED ${settings.animationSpeed.toFixed(1)}x • MOTION PREVIEW`);
  saveSettings();
}

function createWindow() {
  const work = screen.getPrimaryDisplay().workArea;
  const size = settings.size;
  const x = Number.isFinite(settings.x) ? settings.x : Math.floor(work.x + (work.width - size) / 2);
  const y = Number.isFinite(settings.y) ? settings.y : Math.floor(work.y + (work.height - size) / 2);
  win = new BrowserWindow({
    width: size, height: size, x, y, minWidth: 180, minHeight: 180,
    transparent: true, frame: false, resizable: false, alwaysOnTop: true,
    skipTaskbar: true, hasShadow: false, backgroundColor: '#00000000',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', event => event.preventDefault());
  win.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.loadFile(path.join(__dirname, 'index.html'));
  win.webContents.once('did-finish-load', () => {
    applySettings();
    broadcast({ type: 'bridge-status', connected: bridgeConnected, restored: false });
  });
  win.on('move', saveSettings);
}

function startHermesBridgeServer() {
  bridgeServer = http.createServer(createBridgeRequestHandler({
    token: bridgeToken,
    onSnapshot: safe => {
      lastBridgeSeenAt = Date.now();
      setBridgeConnected(true);
      broadcast(safe);
    }
  }));
  return new Promise((resolve, reject) => {
    const startupError = error => reject(error);
    bridgeServer.once('error', startupError);
    bridgeServer.listen(BRIDGE_PORT, '127.0.0.1', () => {
      bridgeServer.off('error', startupError);
      bridgeServer.on('error', error => console.error('[hermes bridge]', error.message));
      bridgeStatusTimer = setInterval(() => {
        if (bridgeConnected && Date.now() - lastBridgeSeenAt > 2800) setBridgeConnected(false);
      }, 750);
      resolve();
    });
  });
}

function registerShortcuts() {
  const bind = (key, fn) => { if (!globalShortcut.register(key, fn)) console.warn('[hotkey unavailable]', key); };
  bind('CommandOrControl+Shift+F', toggleClickThrough);
  bind('CommandOrControl+Alt+H', toggleClickThrough);
  bind('CommandOrControl+Shift+Up', () => adjustOpacity(2));
  bind('CommandOrControl+Shift+Down', () => adjustOpacity(-2));
  bind('CommandOrControl+Shift+Right', () => adjustMotionSpeed(1));
  bind('CommandOrControl+Shift+Left', () => adjustMotionSpeed(-1));
  bind('CommandOrControl+Shift+C', () => toggleSetting('showLabels', 'NODE LABELS ON', 'NODE LABELS OFF'));
  bind('CommandOrControl+Shift+X', () => toggleSetting('adaptiveContrast', 'UNIVERSAL CONTRAST ON', 'UNIVERSAL CONTRAST OFF'));
  bind('CommandOrControl+Shift+D', () => announce(bridgeConnected ? 'HERMES CONNECTED' : 'HERMES OFFLINE'));
  bind('CommandOrControl+Shift+T', () => broadcast({ type: 'demo' }));
  bind('CommandOrControl+Shift+S', toggleOverlay);
  bind('CommandOrControl+Shift+Q', () => app.quit());
}

const removeBridgeMode = process.argv.includes('--remove-bridge');

if (removeBridgeMode) {
  app.whenReady().then(() => {
    removePluginFromHomes({ homes: discoverHermesHomes() });
    app.exit(0);
  }).catch(() => app.exit(1));
} else {
  const singleInstance = app.requestSingleInstanceLock();
  if (!singleInstance) app.quit();
  else {
    app.on('second-instance', () => { if (win) { win.showInactive(); win.setAlwaysOnTop(true, 'screen-saver'); } });
    app.whenReady().then(async () => {
      validateBridgePort();
      bridgeToken = loadOrCreateBridgeToken();
      try { installHermesBridge(); } catch (error) { console.warn('[bridge install unavailable]', error.message); }
      loadSettings();
      await startHermesBridgeServer();
      createWindow();
      createTray();
      registerShortcuts();
    }).catch(error => {
      console.error('[startup]', error);
      const detail = error.code === 'EADDRINUSE'
        ? 'Local port 8765 is already in use by another process. Close the other program or Hermes Sigil instance, then try again.'
        : error.message;
      dialog.showErrorBox(
        'Hermes Sigil could not start',
        detail
      );
      app.quit();
    });
  }
}

ipcMain.handle('set-click-through', (_, value) => {
  settings.clickThrough = Boolean(value); applySettings(); saveSettings(); return settings.clickThrough;
});
ipcMain.handle('begin-drag', () => {
  if (!win || dragTimer) return;
  const cursor = screen.getCursorScreenPoint();
  const bounds = win.getBounds();
  dragStart = { cursorX: cursor.x, cursorY: cursor.y, x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
  dragTimer = setInterval(() => {
    if (!win || win.isDestroyed() || !dragStart) return;
    const point = screen.getCursorScreenPoint();
    win.setBounds({
      x: dragStart.x + point.x - dragStart.cursorX,
      y: dragStart.y + point.y - dragStart.cursorY,
      width: dragStart.width,
      height: dragStart.height
    }, false);
  }, 16);
});
ipcMain.handle('end-drag', () => {
  if (dragTimer) clearInterval(dragTimer);
  dragTimer = null;
  dragStart = null;
  saveSettings();
});
ipcMain.handle('resize-window', (_, delta) => {
  if (!win) return settings.size;
  const b = win.getBounds();
  const next = Math.max(180, Math.min(1400, b.width + (delta > 0 ? 40 : -40)));
  const x = Math.round(b.x - (next - b.width) / 2);
  const y = Math.round(b.y - (next - b.height) / 2);
  win.setBounds({ x, y, width: next, height: next });
  settings.size = next; saveSettings(); announce(`SIZE ${next}px`); return next;
});
ipcMain.handle('get-settings', () => settings);

app.on('will-quit', () => { if (dragTimer) clearInterval(dragTimer); if (bridgeStatusTimer) clearInterval(bridgeStatusTimer); globalShortcut.unregisterAll(); if (tray) tray.destroy(); if (bridgeServer) bridgeServer.close(); });
app.on('window-all-closed', () => app.quit());
