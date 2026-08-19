import { atom, host, useValue } from '@hermes/plugin-sdk'
import { jsx } from 'react/jsx-runtime'
import { useEffect } from 'react'

const BRIDGE_URL = 'http://127.0.0.1:8765/event'
const PROTOCOL = 'hermes-sigil/2'
const AUTH_TOKEN = '__HERMES_SIGIL_AUTH_TOKEN__'
const $connected = atom(false)
const sessions = new Map()
let streamSessionId = null
let lastSnapshot = ''
const globalActivity = { networkUntil: 0 }

const emptyState = () => ({
  listenUntil: 0,
  monitor: false,
  respondUntil: 0,
  thinkUntil: 0,
  phase: 'idle',
  phaseUntil: 0,
  lastNode: null,
  errorNode: null,
  lastSeenAt: Date.now(),
  transientNodes: new Map(),
  tools: new Map()
})

const sessionState = id => {
  if (!sessions.has(id)) sessions.set(id, emptyState())
  return sessions.get(id)
}

function pruneSessions() {
  const active = host.state.activeSessionId.get()
  const cutoff = Date.now() - 60 * 60 * 1000
  for (const [id, state] of sessions) {
    if (id !== active && state.lastSeenAt < cutoff) sessions.delete(id)
  }
}

function classifyTool(rawName) {
  const name = String(rawName || '').toLowerCase().replaceAll('-', '_')
  const nodes = new Set(['tools'])
  const has = (...parts) => parts.some(part => name.includes(part))

  if (has('vision_analyze', 'browser_vision', 'video_analyze', 'ocr')) nodes.add('vision')
  if (has('vision_analyze', 'video_analyze', 'ocr', 'read_file', 'web_extract', 'read_preview', 'read_terminal', 'read_window_below', 'get_file', 'document', 'transcript')) nodes.add('read')
  if (has('web_search', 'x_search', 'search_files', 'session_search', 'grep', 'ripgrep', 'find_file')) nodes.add('search')
  if (has('browser_', 'web_extract', 'web_fetch', 'open_url', 'webpage')) nodes.add('web')
  if (has('delegate_task', 'delegate', 'subagent', 'spawn_agent', 'task_create', 'handoff', 'send_message', 'discord', 'feishu_', 'yb_')) nodes.add('network')
  if (has('terminal', 'execute_code', 'process', 'shell', 'python', 'run_code', 'browser_exec')) nodes.add('execute')
  if (has('write_file', 'patch', 'kanban_create', 'project_create', 'create_file', 'file_write', 'replace', 'notebook', 'skill_manage', 'image_generate', 'video_generate')) nodes.add('create')
  if (has('feishu_drive', 'cloud', 'upload', 'download', 'remote_service')) nodes.add('cloud')
  if (has('text_to_speech', 'tts_', 'transcri', 'speech', 'audio_input', 'microphone', 'react_to_message')) nodes.add('voice')
  if (has('image_generate', 'image_edit', 'browser_get_images')) nodes.add('image')
  if (has('video_generate', 'video_analyze', 'text_to_video', 'image_to_video', 'keyframes_to_video', 'video_continuation', 'xai_video_', 'bfl_flux3_')) nodes.add('video')
  if (has('memory', 'spreadsheet', 'excel', 'sheets', 'database', 'sql', 'kanban_', 'dataframe', 'dataset')) nodes.add('data')
  if (has('setup_mcp', 'approval', 'permission', 'authenticate', 'security', 'secret', 'sudo')) nodes.add('security')
  if (has('computer_use', 'focus_pane', 'open_preview', 'read_preview', 'read_terminal', 'read_window_below', 'close_terminal', 'ha_')) nodes.add('device')
  if (has('process', 'poll', 'wait', 'monitor', 'cronjob', 'get_result', 'heartbeat')) nodes.add('monitor')
  if (has('setup_mcp', 'install', 'build', 'startup', 'shutdown', 'power')) nodes.add('power')
  return [...nodes]
}

function pulseNode(state, node, duration = 1400) {
  state.transientNodes.set(node, Date.now() + duration)
  state.lastNode = node
}

function pulseNodes(state, nodes, duration = 1400) {
  for (const node of nodes) pulseNode(state, node, duration)
}

function payloadRecord(event) {
  return event?.payload && typeof event.payload === 'object' ? event.payload : {}
}

function eventSessionId(event) {
  const active = host.state.activeSessionId.get()
  const explicit = typeof event?.session_id === 'string' ? event.session_id : ''
  if (event?.type === 'message.start') {
    // Pin subsequent ID-less stream events only when this turn starts in the
    // focused session. Explicit background turns must not steal that stream.
    if (!explicit || explicit === active) streamSessionId = explicit || active
    return explicit || streamSessionId || active
  }
  if (explicit) return explicit
  if (String(event?.type || '').startsWith('subagent.')) return null
  return streamSessionId || active
}

function toolKey(payload) {
  return String(payload.tool_id || payload.id || payload.tool_call_id || payload.name || payload.tool_name || 'tool')
}

function activeNodes() {
  const active = host.state.activeSessionId.get()
  const now = Date.now()
  const nodes = new Set()
  if (globalActivity.networkUntil > now) nodes.add('network')
  if (!active) return [...nodes]
  const state = sessions.get(active)
  if (!state) return [...nodes]
  if (state.listenUntil > now) nodes.add('listen')
  if (state.thinkUntil > now) nodes.add('think')
  if (state.respondUntil > now) nodes.add('respond')
  if (state.monitor) nodes.add('monitor')
  for (const [node, until] of state.transientNodes) {
    if (until > now) nodes.add(node)
    else state.transientNodes.delete(node)
  }
  for (const categories of state.tools.values()) for (const node of categories) nodes.add(node)
  return [...nodes]
}

function activeStatus() {
  const active = host.state.activeSessionId.get()
  const state = active ? sessions.get(active) : null
  if (!state) return { status: 'idle', error_node: null }
  const now = Date.now()
  if (state.phaseUntil && state.phaseUntil <= now) {
    state.phase = 'idle'
    state.phaseUntil = 0
    state.errorNode = null
  }
  const nodes = activeNodes()
  const status = state.phase === 'waiting' || state.phase === 'error' || state.phase === 'complete'
    ? state.phase
    : nodes.length ? 'working' : 'idle'
  return { status, error_node: state.errorNode }
}

let publishQueue = Promise.resolve()

function publish(force = false) {
  const run = () => publishNow(force)
  publishQueue = publishQueue.then(run, run)
  return publishQueue
}

async function publishNow(force = false) {
  const activity = activeStatus()
  const activeSessionId = host.state.activeSessionId.get()
  const body = {
    auth_token: AUTH_TOKEN,
    protocol: PROTOCOL,
    session_active: Boolean(activeSessionId),
    nodes: activeNodes(),
    status: activity.status,
    error_node: activity.error_node,
    source: 'hermes-desktop-sigil'
  }
  const snapshot = JSON.stringify(body)
  if (!force && snapshot === lastSnapshot) return
  lastSnapshot = snapshot
  try {
    const response = await fetch(BRIDGE_URL, {
      body: snapshot,
      cache: 'no-store',
      method: 'POST',
      mode: 'cors',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' }
    })
    $connected.set(response.ok)
  } catch {
    $connected.set(false)
  }
}

function receive(event) {
  const eventType = String(event?.type || '')
  const explicitSessionId = typeof event?.session_id === 'string' ? event.session_id : ''
  if (eventType.startsWith('subagent.') && !explicitSessionId) {
    globalActivity.networkUntil = Date.now() + (eventType.endsWith('.complete') ? 900 : 1800)
    void publish()
    return
  }
  const sid = eventSessionId(event)
  if (!sid) return
  const state = sessionState(sid)
  const payload = payloadRecord(event)
  const now = Date.now()
  state.lastSeenAt = now

  if (event.type === 'message.start') {
    state.tools.clear()
    state.transientNodes.clear()
    state.monitor = false
    // A typed message is not microphone activity. VOICE is driven only by
    // verified wake, speech, transcription, microphone, or TTS signals.
    state.listenUntil = 0
    state.thinkUntil = now + 1800
    state.phase = 'working'
    state.phaseUntil = 0
    state.errorNode = null
  } else if (event.type === 'thinking.delta') {
    state.thinkUntil = now + 1400
  } else if (event.type === 'reasoning.available' || event.type === 'reasoning.delta') {
    state.thinkUntil = 0
    pulseNode(state, 'reason', 1400)
  } else if (event.type === 'tool.generating' || event.type === 'tool.start' || event.type === 'tool.progress') {
    const name = payload.name || payload.tool_name
    const categories = classifyTool(name)
    state.tools.set(toolKey(payload), categories)
    state.lastNode = categories[0] || state.lastNode
    state.phase = 'working'
    state.phaseUntil = 0
    state.thinkUntil = 0
  } else if (event.type === 'tool.complete') {
    const categories = classifyTool(payload.name || payload.tool_name)
    pulseNodes(state, categories, 850)
    const key = toolKey(payload)
    state.tools.delete(key)
    if (!payload.tool_id && !payload.id && payload.name) {
      for (const existing of [...state.tools.keys()]) if (existing === String(payload.name)) state.tools.delete(existing)
    }
    state.monitor = false
  } else if (event.type === 'message.delta' || event.type === 'message.interim') {
    state.respondUntil = now + 750
    state.lastNode = 'respond'
    state.phase = 'working'
    state.phaseUntil = 0
  } else if (event.type === 'approval.request' || event.type === 'clarify.request' || event.type === 'sudo.request' || event.type === 'secret.request') {
    state.monitor = true
    pulseNode(state, 'security', 5000)
    state.lastNode = 'security'
    state.phase = 'waiting'
    state.phaseUntil = 0
  } else if (String(event.type).startsWith('subagent.')) {
    pulseNode(state, 'network', 1800)
    if (!event.type.endsWith('.complete')) state.tools.set('subagent', ['network'])
    else state.tools.delete('subagent')
  } else if (event.type === 'delegate.complete') {
    state.tools.delete('subagent')
    pulseNode(state, 'network', 900)
  } else if (String(event.type).startsWith('wake.')) {
    pulseNode(state, 'voice', event.type === 'wake.stop' ? 500 : 1800)
  } else if (event.type === 'status.update') {
    if (String(payload.kind || '').toLowerCase() === 'process') pulseNodes(state, ['monitor', 'power'], 1800)
  } else if (event.type === 'gateway.ready' || event.type === 'boot.ready' || event.type === 'renderer.ready' || event.type === 'session.reclaimed') {
    pulseNode(state, 'power', 1600)
  } else if (event.type === 'mcp.setup.request' || event.type === 'approval.pending') {
    state.monitor = true
    pulseNodes(state, ['security', 'power'], 5000)
    state.phase = 'waiting'
    state.phaseUntil = 0
  } else if (event.type === 'approval.received') {
    state.monitor = false
    pulseNode(state, 'security', 900)
    state.phase = 'working'
  } else if (event.type === 'message.complete' || event.type === 'error') {
    state.tools.clear()
    state.monitor = false
    state.thinkUntil = 0
    state.transientNodes.clear()
    state.respondUntil = event.type === 'message.complete' ? now + 900 : 0
    state.phase = event.type === 'message.complete' ? 'complete' : 'error'
    state.phaseUntil = now + (event.type === 'message.complete' ? 2200 : 4200)
    state.errorNode = event.type === 'error' ? state.lastNode : null
    if (sid === streamSessionId) streamSessionId = null
  }
  void publish()
}

function BridgeStatus() {
  const connected = useValue($connected)
  return jsx('button', {
    type: 'button',
    title: connected ? 'Hermes Sigil overlay connected' : 'Start the Hermes Sigil overlay to connect',
    className: 'px-1.5 text-[0.6875rem] text-(--ui-text-tertiary)',
    onClick: () => host.notify({
      kind: connected ? 'success' : 'info',
      message: connected ? 'Sigil overlay is receiving live events.' : 'Launch Hermes Sigil Overlay, then wait a few seconds.'
    }),
    children: connected ? 'sigil *' : 'sigil o'
  })
}

function BridgeRuntime() {
  useEffect(() => {
    globalThis.__hermesSigilBridgeStop?.()
    const stopEvents = host.onEvent('*', receive)
    const timer = setInterval(() => void publish(), 250)
    const heartbeat = setInterval(() => void publish(true), 1000)
    const pruneTimer = setInterval(pruneSessions, 60 * 1000)
    const stop = () => {
      stopEvents()
      clearInterval(timer)
      clearInterval(heartbeat)
      clearInterval(pruneTimer)
    }
    globalThis.__hermesSigilBridgeStop = stop
    void publish(true)
    return () => {
      stop()
      if (globalThis.__hermesSigilBridgeStop === stop) delete globalThis.__hermesSigilBridgeStop
    }
  }, [])
  return jsx(BridgeStatus, {})
}

export default {
  id: 'hermes-sigil-bridge',
  name: 'Hermes Sigil Bridge',
  register(ctx) {
    ctx.register({
      id: 'status',
      area: 'statusBar.right',
      order: 125,
      render: () => jsx(BridgeRuntime, {})
    })
  }
}
