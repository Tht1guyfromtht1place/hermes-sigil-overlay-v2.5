const indicators = {
  // Calibrated against the 1312x1199 master artwork after object-fit scaling.
  think:[37.65,18.5], reason:[50,18.1], vision:[62.5,18.5], web:[71.85,24.65], search:[79.1,32.5],
  read:[83.6,40.8], network:[86.6,50.3], execute:[83.7,59.7], tools:[78.9,67.6], create:[71.7,75.2],
  cloud:[62.5,80.9], voice:[50,83.8], respond:[37.5,80.9], image:[28.4,75.2], video:[21.1,67.6],
  data:[16.2,59.7], security:[13.4,50.3], device:[16.2,40.7], monitor:[20.7,32.4], power:[27.75,24.5]
};

const nodeInfo = {
  think:['THINK','Process'], reason:['REASON','Plan & reason'], vision:['VISION','See visuals'],
  web:['WEB','Browse'], search:['SEARCH','Find info'], read:['READ','Read content'],
  network:['NETWORK','Agents'], execute:['EXECUTE','Run code'], tools:['TOOLS','Tool calls'],
  create:['CREATE','Create files'], cloud:['CLOUD','Remote'], voice:['VOICE','Speech/audio'],
  respond:['RESPOND','Write reply'], image:['IMAGE','Make images'], video:['VIDEO','Make video'],
  data:['DATA','Structured data'], security:['SECURITY','Permissions'], device:['DEVICE','Control apps'],
  monitor:['MONITOR','Wait/watch'], power:['POWER','System']
};

const guidePositions = {
  think:[35,5], reason:[50,3.5], vision:[65,5],
  web:[94,23], search:[94,32], read:[94,41], network:[94,50], execute:[94,59], tools:[94,68], create:[94,77],
  cloud:[65,95], voice:[50,96.5], respond:[35,95],
  image:[6,77], video:[6,68], data:[6,59], security:[6,50], device:[6,41], monitor:[6,32], power:[6,23]
};

const GUIDE_SCALE = 0.78;

const aliases = {
  thinking:'think', reasoning:'reason', inspect:'vision', browse:'web', browsing:'web', reading:'read',
  searching:'search', tool:'tools', tool_call:'tools', terminal:'execute', command:'execute',
  file_create:'create', file_write:'create', write:'create', memory:'data', files:'data', file:'data',
  speech:'voice', microphone:'voice', response:'respond', responding:'respond', chat:'respond',
  watch:'monitor', waiting:'monitor'
};

const stage = document.getElementById('stage');
const layer = document.getElementById('indicatorLayer');
const pathLayer = document.getElementById('pathLayer');
const guideLayer = document.getElementById('guideLayer');
const status = document.getElementById('status');
const core = document.getElementById('coreGlow');
const nodes = new Map();
const paths = new Map();
const guides = new Map();
let statusTimer = null;
let dragging = false;
let resizeUnlockAt = 0;
let liveNodes = new Set();
let bridgeHasConnected = false;
let bridgeWaitingTimer = null;
let motionPreviewTimer = null;
let demoRunning = false;
let demoGeneration = 0;
let completionTimer = null;
let taskMotionStopTimer = null;

const hermesNodeMap = {
  listen:'voice', read:'read', search:'search', browse:'web', think:'think',
  delegate:'network', execute:'execute', monitor:'monitor', create:'create', respond:'respond'
};

for (const [name, [x, y]] of Object.entries(indicators)) {
  const path = document.createElement('div');
  const dx = 50 - x, dy = 50 - y;
  const distance = Math.hypot(dx, dy);
  path.className = 'energyPath';
  path.style.left = `${x}%`; path.style.top = `${y}%`;
  path.style.width = `${distance}%`;
  path.style.transform = `rotate(${Math.atan2(dy, dx) * 180 / Math.PI}deg)`;
  pathLayer.appendChild(path); paths.set(name, path);

  const node = document.createElement('div');
  node.className = 'indicator'; node.dataset.name = name;
  node.style.left = `${x}%`; node.style.top = `${y}%`;
  layer.appendChild(node); nodes.set(name, node);

  const guideLine = document.createElement('div');
  guideLine.className = 'guideLine';
  guideLayer.appendChild(guideLine);
  const guide = document.createElement('div');
  guide.className = 'nodeGuide';
  guide.innerHTML = `<strong>${nodeInfo[name][0]}</strong><span>${nodeInfo[name][1]}</span>`;
  guideLayer.appendChild(guide);
  guides.set(name, { guide, line:guideLine });
}

function positionLine(element, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  element.style.left = `${x1}%`; element.style.top = `${y1}%`;
  element.style.width = `${Math.hypot(dx, dy)}%`;
  element.style.transform = `rotate(${Math.atan2(dy, dx) * 180 / Math.PI}deg)`;
}

function layoutActivityGeometry(showLabels) {
  stage.classList.toggle('labels-visible', showLabels);
  for (const [name, [originalX, originalY]] of Object.entries(indicators)) {
    const scale = showLabels ? GUIDE_SCALE : 1;
    const x = 50 + (originalX - 50) * scale;
    const y = 50 + (originalY - 50) * scale;
    const node = nodes.get(name), path = paths.get(name), guide = guides.get(name);
    node.style.left = `${x}%`; node.style.top = `${y}%`;
    positionLine(path, x, y, 50, 50);
    const [labelX, labelY] = guidePositions[name];
    guide.guide.style.left = `${labelX}%`; guide.guide.style.top = `${labelY}%`;
    positionLine(guide.line, x, y, labelX, labelY);
  }
}

function normalize(name='') {
  name = String(name).trim().toLowerCase().replace(/[\s-]+/g, '_');
  return aliases[name] || name;
}

function showStatus(text, ms=1500) {
  clearTimeout(statusTimer); status.textContent = text; status.classList.add('show');
  statusTimer = setTimeout(() => status.classList.remove('show'), ms);
}

function setState(name, state='active', duration=0) {
  name = normalize(name);
  const node = nodes.get(name), path = paths.get(name);
  if (!node) return;
  const stateClass = state === 'error' ? 'error' : state === 'attention' ? 'attention' : 'active';
  node.classList.remove('active', 'attention', 'error');
  path.classList.remove('active', 'attention', 'error');
  const guide = guides.get(name);
  guide.guide.classList.remove('active', 'attention', 'error');
  guide.line.classList.remove('active', 'attention', 'error');
  if (state !== 'off' && state !== 'idle') { node.classList.add(stateClass); path.classList.add(stateClass); }
  if (state !== 'off' && state !== 'idle') { guide.guide.classList.add(stateClass); guide.line.classList.add(stateClass); }
  if (duration > 0) setTimeout(() => { node.classList.remove(stateClass); path.classList.remove(stateClass); guide.guide.classList.remove(stateClass); guide.line.classList.remove(stateClass); refreshCore(); }, duration);
  refreshCore();
}

function refreshCore() {
  const active = [...nodes.values()].some(node => node.matches('.active,.attention,.error'));
  stage.classList.toggle('working', active); core.classList.toggle('active', active);
}

function clearAll() {
  for (const node of nodes.values()) node.classList.remove('active', 'attention', 'error');
  for (const path of paths.values()) path.classList.remove('active', 'attention', 'error');
  for (const { guide, line } of guides.values()) { guide.classList.remove('active', 'attention', 'error'); line.classList.remove('active', 'attention', 'error'); }
  refreshCore();
}

function applySettings(settings={}) {
  const speed = Math.max(0.2, Number(settings.animationSpeed) || 1);
  const baseOpacity = Math.max(10, Math.min(255, Number(settings.opacity) || 255)) / 255;
  const nodeBoost = 1;
  const activityOpacity = Math.min(1, Math.max(baseOpacity * (1 + nodeBoost), baseOpacity + 0.18));
  const activityBrightness = 1 + nodeBoost;
  document.documentElement.style.setProperty('--speed', speed);
  document.documentElement.style.setProperty('--base-opacity', baseOpacity.toFixed(3));
  document.documentElement.style.setProperty('--activity-opacity', activityOpacity.toFixed(3));
  document.documentElement.style.setProperty('--activity-brightness', activityBrightness.toFixed(2));
  stage.classList.toggle('paused', settings.animation === false);
  stage.classList.toggle('adaptive-contrast', Boolean(settings.adaptiveContrast));
  stage.classList.toggle('hermes-ring-enabled', Boolean(settings.rotatingHermesRing));
  layoutActivityGeometry(Boolean(settings.showLabels));
}

function handleEvent(evt={}) {
  if (evt.type === 'demo') return toggleDemo();
  if (evt.type === 'settings') return applySettings(evt.settings);
  if (evt.type === 'bridge-status') return handleBridgeStatus(evt);
  if (evt.type === 'motion-preview') {
    clearTimeout(motionPreviewTimer);
    stage.classList.add('motion-preview');
    motionPreviewTimer = setTimeout(() => stage.classList.remove('motion-preview'), Number(evt.duration) || 4000);
    return;
  }
  if (evt.type === 'ui') { showStatus(evt.label || (evt.value ? 'CLICK-THROUGH' : 'INTERACTIVE')); return; }
  if (evt.type === 'reset' || evt.type === 'idle') {
    if (demoRunning) cancelDemo('ACTIVITY CLEARED'); else clearAll();
    return;
  }
  if (evt.type === 'hermes-snapshot') return handleHermesSnapshot(evt);
  const activity = normalize(evt.activity || evt.node || evt.name || evt.type);
  const state = evt.state || (evt.error ? 'error' : evt.attention ? 'attention' : 'active');
  const duration = Number(evt.duration || evt.durationMs || 0);
  if (nodes.has(activity)) {
    setState(activity, state, duration);
    if (evt.label) showStatus(evt.label, Math.max(800, duration || 1200));
  }
  if (evt.done || evt.complete) setTimeout(clearAll, 520);
}

function handleBridgeStatus(evt) {
  const connected = Boolean(evt.connected);
  clearTimeout(bridgeWaitingTimer);
  stage.classList.toggle('bridge-connected', connected);
  stage.classList.toggle('bridge-offline', !connected);
  if (connected) {
    if (bridgeHasConnected || evt.restored) {
      stage.classList.remove('bridge-restored');
      void stage.offsetWidth;
      stage.classList.add('bridge-restored');
      setTimeout(() => stage.classList.remove('bridge-restored'), 1500);
      showStatus('HERMES CONNECTED', 1200);
    }
    bridgeHasConnected = true;
  } else if (bridgeHasConnected) {
    showStatus('HERMES OFFLINE', 1600);
  } else {
    bridgeWaitingTimer = setTimeout(() => showStatus('HERMES WAITING', 1800), 3000);
  }
}

function handleHermesSnapshot(snapshot) {
  const completing = snapshot.status === 'complete';
  const reported = new Set((snapshot.nodes || []).map(name => hermesNodeMap[name] || normalize(name)).filter(name => nodes.has(name)));
  const next = completing ? new Set() : reported;
  const errorNode = hermesNodeMap[snapshot.error_node] || normalize(snapshot.error_node || '');
  updateTaskMotion(snapshot, reported);
  if (!completing) {
    clearTimeout(completionTimer);
    stage.classList.remove('completing');
  }
  for (const name of liveNodes) {
    if (!next.has(name)) {
      nodes.get(name)?.classList.remove('active', 'attention', 'error');
      paths.get(name)?.classList.remove('active', 'attention', 'error');
      guides.get(name)?.guide.classList.remove('active', 'attention', 'error');
      guides.get(name)?.line.classList.remove('active', 'attention', 'error');
    }
  }
  for (const name of next) {
    let state = 'active';
    if (snapshot.status === 'waiting' && (name === 'monitor' || name === 'security')) state = 'attention';
    if (snapshot.status === 'error' && name === (errorNode || 'monitor')) state = 'error';
    setState(name, state);
  }
  if (snapshot.status === 'error' && errorNode && !next.has(errorNode)) setState(errorNode, 'error', 4200);
  if (completing) {
    clearTimeout(completionTimer);
    stage.classList.remove('completing');
    void stage.offsetWidth;
    stage.classList.add('completing');
    core.classList.add('active');
    showStatus('COMPLETE', 1200);
    completionTimer = setTimeout(() => {
      stage.classList.remove('completing');
      clearAll();
      liveNodes.clear();
    }, 1750);
  } else if (snapshot.status === 'waiting') showStatus('AWAITING INPUT', 1200);
  liveNodes = next;
  refreshCore();
}

function updateTaskMotion(snapshot, reportedNodes) {
  const status = String(snapshot.status || 'idle');
  const taskEnded = status === 'complete' || status === 'error';
  const taskEvidence = Boolean(snapshot.session_active) || reportedNodes.size > 0 || status === 'active' || status === 'working' || status === 'waiting';
  clearTimeout(taskMotionStopTimer);
  if (taskEnded) {
    stage.classList.remove('task-active');
  } else if (taskEvidence) {
    stage.classList.add('task-active');
  } else {
    // Ignore short idle gaps between successive Hermes events so CSS animation
    // keeps its phase instead of restarting for every node transition.
    taskMotionStopTimer = setTimeout(() => stage.classList.remove('task-active'), 1800);
  }
}

function cancelDemo(label='TEST CANCELLED') {
  demoGeneration += 1;
  demoRunning = false;
  stage.classList.remove('task-active');
  clearAll();
  showStatus(label, 1200);
}

function toggleDemo() {
  if (demoRunning) cancelDemo(); else void demo();
}

async function demo() {
  const generation = ++demoGeneration;
  demoRunning = true;
  stage.classList.add('task-active');
  clearAll();
  // Clockwise from the top-center medallion, covering every node once.
  const sequence = [
    'reason', 'vision', 'web', 'search', 'read', 'network', 'execute', 'tools', 'create', 'cloud',
    'voice', 'respond', 'image', 'video', 'data', 'security', 'device', 'monitor', 'power', 'think'
  ];
  const phases = [
    { state:'active', label:'NORMAL ACTIVITY TEST' },
    { state:'attention', label:'ATTENTION TEST' },
    { state:'error', label:'ERROR TEST' }
  ];
  for (const phase of phases) {
    clearAll(); showStatus(phase.label, 1000);
    await new Promise(resolve => setTimeout(resolve, 1050));
    if (generation !== demoGeneration) return;
    for (const name of sequence) {
      clearAll(); setState(name, phase.state); showStatus(`${phase.label.split(' ')[0]} • ${name.toUpperCase()}`, 560);
      await new Promise(resolve => setTimeout(resolve, 620));
      if (generation !== demoGeneration) return;
    }
    clearAll();
    await new Promise(resolve => setTimeout(resolve, 420));
    if (generation !== demoGeneration) return;
  }
  clearAll();
  demoRunning = false;
  stage.classList.remove('task-active');
  showStatus('TEST COMPLETE', 1200);
}

stage.addEventListener('pointerdown', event => {
  if (event.button !== 0) return;
  dragging = true;
  resizeUnlockAt = Number.POSITIVE_INFINITY;
  stage.setPointerCapture(event.pointerId);
  window.hermesSigil.beginDrag();
});
function finishDrag(event) {
  if (!dragging) return;
  dragging = false;
  resizeUnlockAt = performance.now() + 250;
  if (event && stage.hasPointerCapture(event.pointerId)) stage.releasePointerCapture(event.pointerId);
  window.hermesSigil.endDrag();
}
stage.addEventListener('pointerup', finishDrag);
stage.addEventListener('pointercancel', finishDrag);
window.addEventListener('blur', () => {
  if (dragging) finishDrag();
});
stage.addEventListener('wheel', event => {
  event.preventDefault();
  if (dragging || performance.now() < resizeUnlockAt) return;
  window.hermesSigil.resizeWindow(event.deltaY < 0 ? 1 : -1);
}, { passive:false });
stage.addEventListener('contextmenu', event => { event.preventDefault(); window.hermesSigil.setClickThrough(true); showStatus('CLICK-THROUGH'); });

window.hermesSigil.onEvent(handleEvent);
window.hermesSigil.getSettings().then(applySettings);
