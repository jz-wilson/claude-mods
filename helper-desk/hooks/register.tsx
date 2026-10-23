import type { EngineInterface, Register, ThemeKey } from 'claude-code'

import type { BandPlan, Helper, HelperPhase, JevCall, PlanStatus, Step, StepKind } from '../types'
import { connectorName, splitTool } from './connectors'

const NAME = 'helper-desk'
const PANE = 'helpers'
// The name a person reads; the plugin and its /helpers command keep their old names.
const TITLE = 'Helper Desk'
const HELPERS = { plugin: 'helper-desk', key: 'helpers' } as const
const CLOCK = { plugin: 'helper-desk', key: 'clock' } as const
const VIEW = { plugin: 'helper-desk', key: 'view' } as const
const COST = { plugin: 'helper-desk', key: 'cost' } as const
const OFF = { plugin: 'helper-desk', key: 'off' } as const
const HIDDEN = { plugin: 'helper-desk', key: 'hidden' } as const
const PLAN = { plugin: 'helper-desk', key: 'plan' } as const
const SHIM = { plugin: 'helper-desk', key: 'shimmer' } as const
const JEV = { plugin: 'helper-desk', key: 'jev' } as const
const FOCUS = { plugin: 'helper-desk', key: 'focus' } as const
const MOTION = { plugin: 'helper-desk', key: 'motion' } as const

const TICK_MS = 300
const POLL_MS = 2000
const SWITCH_MS = 3000
const HISTORY = 3
const MAX_STEPS = 200
const TAG_W = 11
// Columns the pet takes beside a card; the Svg is 48 by 36 CSS pixels.
const PET_W = 8
const PET_PX_W = 48
const PET_PX_H = 36
// The terminal pet is a Raster of half-block cells drawn from the same pixel grid as the Svg pet:
// wide (18 by 7 cells) from this body width up, else half that size.
const PET_WIDE_FROM = 80
const PET_COLS_WIDE = 18
const PET_ROWS_WIDE = 7
const PET_COLS_SMALL = 9
const PET_ROWS_SMALL = 4
// One cell of gap between the pet and the card text.
const PET_GAP = 1
// One timer repaints every running terminal pet.
const FRAME_MS = 40
const MOTION_KEY = 'motion'
// How long a card stays lit after a peer button scrolls to it.
const FOCUS_MS = 2000
// Jev's live log, written by the jev-lab mod.
const JEV_GRACE_MS = 6000

// Functional colour follows the person's theme. Only the Svg drawings below keep hex.
const ACCENT: ThemeKey = 'claude'
const GOOD: ThemeKey = 'success'
const BAD: ThemeKey = 'error'
const WARN: ThemeKey = 'warning'
// Text on a filled group heading.
const INK: ThemeKey = 'inverseText'
// The task list is purple (the theme's "merged"): the step in progress flashes between bright and dim.
const PURPLE: ThemeKey = 'merged'
// The red inside the Svg bar of a stopped card.
const SVG_BAD = '#dc2626'
// Quarter circles read clearly on desktop fonts and in the terminal.
const SPIN = ['◐', '◓', '◑', '◒']
const PULSE = ['●∙∙', '∙●∙', '∙∙●', '∙●∙']

const KIND_COLOR: Record<StepKind, ThemeKey> = {
  Command: 'warning',
  Connector: 'suggestion',
  'File read': 'success',
  'File write': 'claude',
  Skill: 'merged',
  Web: 'planMode',
  Subagent: 'permission',
  Tool: 'subtle',
}

// ---------- Pets: a pixel Claude crab, one body colour per helper ----------

type Px = [x: number, y: number]

// Eight body colours that are easy to tell apart and read on light and dark. `color` paints the
// Svg pet and bar (which carry their own outline); `key` is the nearest theme colour, for the
// terminal glyph pet, bar and card border.
const HUES: { name: string; color: string; key: ThemeKey }[] = [
  { name: 'red', color: '#dc2626', key: 'error' },
  { name: 'orange', color: '#ea580c', key: 'claude' },
  { name: 'yellow', color: '#eab308', key: 'warning' },
  { name: 'green', color: '#16a34a', key: 'success' },
  { name: 'teal', color: '#0d9488', key: 'planMode' },
  { name: 'blue', color: '#2563eb', key: 'suggestion' },
  { name: 'purple', color: '#9333ea', key: 'merged' },
  { name: 'pink', color: '#db2777', key: 'diffRemovedWord' },
]
const hueOf = (hue: number) => HUES[((hue % HUES.length) + HUES.length) % HUES.length]!

// Eyes and outline are the same on every pet.
const EYE = '#2b1d16'
const OUTLINE = '#2b1d16'

const span = (y: number, from: number, to: number): Px[] => Array.from({ length: to - from + 1 }, (_, i) => [from + i, y] as Px)

// The crab on a 16 by 12 grid, in layers so a pose picks which show. It stands one pixel down;
// the bob lifts the whole of it by one.
const CORE: Px[] = [1, 2, 3, 4, 5, 6, 7].flatMap(y => span(y, 3, 12))
const ARMS_DOWN: Px[] = [...span(4, 1, 2), ...span(5, 1, 2), ...span(4, 13, 14), ...span(5, 13, 14)]
const ARMS_UP: Px[] = [[1, 2], [2, 2], [1, 3], [2, 3], [13, 2], [14, 2], [13, 3], [14, 3]]
// The four phases of the leg shuffle: each leg pair steps in and out in turn.
const LEG_X = [[4, 6, 9, 11], [3, 6, 10, 11], [3, 5, 10, 12], [4, 5, 9, 12]]
const legPixels = (phase: number): Px[] => LEG_X[phase % 4]!.flatMap(x => [[x, 8], [x, 9]] as Px[])
const EYES_LOW: Px[] = [[5, 4], [10, 4]]
const EYES_TOP: Px[] = [[5, 3], [10, 3]]

// The drawing grid: the crab at an offset of (1, 2), so its outline and its hop fit.
const GRID_W = 18
const GRID_H = 14

const BOB_MS = 1400
const LEG_MS = 120
const CLAW_MS = 2300
const BLINK_MS = 3300
const BLINK_HOLD_MS = 150
// Each pet starts this much later than the one before it in HUES order, so crabs don't move in lockstep.
const PHASE_MS = 370

const phaseOf = (hue: number) => (((hue % HUES.length) + HUES.length) % HUES.length) * PHASE_MS
const wrap = (n: number, m: number) => ((n % m) + m) % m

type Pose = { legs: number; up: boolean; blink: boolean; hop: number }
const STILL: Pose = { legs: 0, up: false, blink: false, hop: 0 }

/** The pose at `t` ms: an eased sine bob, a four-phase leg shuffle, claws on their own period, a blink now and then. */
function poseAt(t: number, hue: number): Pose {
  const u = t + phaseOf(hue)
  const wave = 0.5 - 0.5 * Math.cos((2 * Math.PI * u) / BOB_MS)
  const eased = wave * wave * (3 - 2 * wave)
  const f = wrap(u, CLAW_MS) / CLAW_MS
  return {
    legs: Math.floor(wrap(u, LEG_MS * 4) / LEG_MS),
    up: f < 0.1 || (f > 0.18 && f < 0.28),
    blink: wrap(u, BLINK_MS) < BLINK_HOLD_MS,
    hop: Math.round(eased),
  }
}

/** What each pixel of the grid holds for a pose: 1 outline, 2 body, 3 eye, 0 clear. */
function paint(pose: Pose): Uint8Array {
  const grid = new Uint8Array(GRID_W * GRID_H)
  const body: Px[] = [...CORE, ...(pose.up ? ARMS_UP : ARMS_DOWN), ...legPixels(pose.legs)]
  const at = (x: number, y: number) => (y + 2 - pose.hop) * GRID_W + x + 1
  for (const [x, y] of body) grid[at(x, y)] = 2
  for (const [x, y] of body) {
    for (const i of [at(x + 1, y), at(x - 1, y), at(x, y + 1), at(x, y - 1)]) if (i >= 0 && i < grid.length && !grid[i]) grid[i] = 1
  }
  for (const [x, y] of [...EYES_LOW, ...(pose.blink ? [] : EYES_TOP)]) grid[at(x, y)] = 3
  return grid
}

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const DEFAULT_COLOR = 0x01000000

// Uint8Array.toBase64 is outside the es2023 lib a mod's tsconfig names, so encode by hand.
function toBase64(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const triplet = ((bytes[i] ?? 0) << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0)
    out += BASE64[(triplet >> 18) & 0x3f]! + BASE64[(triplet >> 12) & 0x3f]!
    out += i + 1 < bytes.length ? BASE64[(triplet >> 6) & 0x3f]! : '='
    out += i + 2 < bytes.length ? BASE64[triplet & 0x3f]! : '='
  }
  return out
}

/**
 * The crab as `columns` by `rows` half-block cells (each cell two pixels tall), for a Raster or a
 * blit: the pose at `t` ms in the pet's body colour. `still` draws the standing pose.
 */
export function drawCrab(columns: number, rows: number, t: number, hue: number, still = false): string {
  const grid = paint(still ? STILL : poseAt(t, hue))
  const body = Number.parseInt(hueOf(hue).color.slice(1), 16)
  const ink = Number.parseInt(EYE.slice(1), 16)
  const pixels = rows * 2
  // A target pixel looks at the grid pixels it covers: an eye beats the body, the body the outline.
  const sample = (x: number, y: number) => {
    const x0 = Math.floor((x * GRID_W) / columns)
    const x1 = Math.max(x0 + 1, Math.ceil(((x + 1) * GRID_W) / columns))
    const y0 = Math.floor((y * GRID_H) / pixels)
    const y1 = Math.max(y0 + 1, Math.ceil(((y + 1) * GRID_H) / pixels))
    let best = 0
    for (let gy = y0; gy < y1; gy += 1) {
      for (let gx = x0; gx < x1; gx += 1) best = Math.max(best, grid[gy * GRID_W + gx] ?? 0)
    }
    return best === 2 ? body : best ? ink : DEFAULT_COLOR
  }
  // A DataView writes little-endian whatever the platform's byte order, as a Raster requires.
  const bytes = new Uint8Array(columns * rows * 12)
  const view = new DataView(bytes.buffer)
  let offset = 0
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < columns; col += 1) {
      const top = sample(col, row * 2)
      const bottom = sample(col, row * 2 + 1)
      let cell: [number, number, number]
      if (top === DEFAULT_COLOR && bottom === DEFAULT_COLOR) cell = [0x20, DEFAULT_COLOR, DEFAULT_COLOR]
      else if (top === DEFAULT_COLOR) cell = [0x2584, bottom, DEFAULT_COLOR]
      else cell = [0x2580, top, bottom]
      for (const word of cell) {
        view.setUint32(offset, word, true)
        offset += 4
      }
    }
  }
  return toBase64(bytes)
}

/** The pet's canvas for a body width: the cells its Raster asks for. */
export function petCanvas(bodyColumns: number): { columns: number; rows: number } {
  return bodyColumns >= PET_WIDE_FROM ? { columns: PET_COLS_WIDE, rows: PET_ROWS_WIDE } : { columns: PET_COLS_SMALL, rows: PET_ROWS_SMALL }
}

const petCache = new Map<string, string>()

/**
 * The Svg pet. A working one carries its motion as CSS keyframes (bob, four leg phases, claws,
 * blink), so it moves with no redraws; any other is the standing pose, with no keyframes.
 */
function petSvg(hue: number, moving: boolean) {
  const key = `${hue % HUES.length}:${moving}`
  const hit = petCache.get(key)
  if (hit) return hit
  const fill = hueOf(hue).color
  const rect = (x: number, y: number, c: string) => `<rect x="${x + 1}" y="${y + 2}" width="1" height="1" fill="${c}"/>`
  const keys = (list: Px[]) => new Set(list.map(([x, y]) => `${x},${y}`))
  const core = keys(CORE)
  // A layer is its pixels with a one-pixel outline round them, so every colour reads on light and dark.
  const layer = (cls: string, pixels: Px[], delay = 0) => {
    const own = keys(pixels)
    const ring = new Set<string>()
    for (const [x, y] of pixels) {
      for (const [ax, ay] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]] as Px[]) {
        const k = `${ax},${ay}`
        if (!own.has(k) && !core.has(k)) ring.add(k)
      }
    }
    const edge = [...ring].map(k => {
      const [x, y] = k.split(',').map(Number)
      return rect(x!, y!, OUTLINE)
    })
    const attrs = `${cls ? ` class="${cls}"` : ''}${delay ? ` style="animation-delay:-${delay.toFixed(3)}s"` : ''}`
    return `<g${attrs}>${edge.join('')}${pixels.map(([x, y]) => rect(x, y, fill)).join('')}</g>`
  }
  const eyes = (pixels: Px[], cls = '', delay = 0) =>
    `<g${cls ? ` class="${cls}"` : ''}${delay ? ` style="animation-delay:-${delay.toFixed(3)}s"` : ''}>${pixels.map(([x, y]) => rect(x, y, EYE)).join('')}</g>`
  let body: string
  let style = ''
  if (moving) {
    const phase = phaseOf(hue) / 1000
    const legSecs = (LEG_MS * 4) / 1000
    body =
      layer('', CORE) +
      layer('dn', ARMS_DOWN, phase) +
      layer('up', ARMS_UP, phase) +
      [0, 1, 2, 3].map(n => layer(`lg lg${n}`, legPixels(n), phase + (legSecs * ((4 - n) % 4)) / 4)).join('') +
      eyes(EYES_LOW) +
      eyes(EYES_TOP, 'ey', phase)
    style =
      `<style>` +
      `.bob{animation:bob ${BOB_MS / 1000}s ease-in-out infinite;animation-delay:-${phase.toFixed(3)}s}` +
      `@keyframes bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-1px)}}` +
      `.lg{opacity:0;animation:lg ${legSecs}s steps(1,end) infinite}@keyframes lg{0%{opacity:1}25%{opacity:0}100%{opacity:0}}` +
      `.up{opacity:0;animation:up ${CLAW_MS / 1000}s steps(1,end) infinite}@keyframes up{0%{opacity:1}10%{opacity:0}18%{opacity:1}28%{opacity:0}100%{opacity:0}}` +
      `.dn{animation:dn ${CLAW_MS / 1000}s steps(1,end) infinite}@keyframes dn{0%{opacity:0}10%{opacity:1}18%{opacity:0}28%{opacity:1}100%{opacity:1}}` +
      `.ey{animation:ey ${BLINK_MS / 1000}s steps(1,end) infinite}@keyframes ey{0%{opacity:0}${((BLINK_HOLD_MS / BLINK_MS) * 100).toFixed(1)}%{opacity:1}100%{opacity:1}}` +
      `@media (prefers-reduced-motion: reduce){.bob,.lg,.up,.dn,.ey{animation:none}.lg0,.dn,.ey{opacity:1}}` +
      `</style>`
  } else {
    body = layer('', [...CORE, ...ARMS_DOWN, ...legPixels(0)]) + eyes([...EYES_LOW, ...EYES_TOP])
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${GRID_W} ${GRID_H}" width="${PET_PX_W}" height="${PET_PX_H}" shape-rendering="crispEdges">${style}<g${moving ? ' class="bob"' : ''}>${body}</g></svg>`
  petCache.set(key, svg)
  return svg
}

// ---------- The desk itself; $.state carries a copy for the pane to draw ----------

let helpers: Helper[] = []
let seats = 0
// The next body colour to hand out, in HUES order.
let nextHue = 0
let tickN = 0
let home = ''
let sessionId = ''
let off = false
// "helper-desk:hidden": true in switches.json closes the pane and stops it opening by itself.
let hidden = false
let ticker: { cancel: () => void } | null = null
let poller: { cancel: () => void } | null = null
// The one timer that repaints every running terminal pet.
let crabber: { cancel: () => void } | null = null
let crabBusy = false
let focusTimer: { cancel: () => void } | null = null
// False while /helpers motion off holds the pets still; $.store keeps the choice.
let motion = true
// Each pet Raster the last draw mounted, by its key: what the frame timer blits.
const pets = new Map<string, { requestId: string; id: string; columns: number; rows: number; hue: number }>()
// Jev's calls as last read from its live file, and whether the poller still watches for changes.
let jev: JevCall[] = []
let jevRaw = ''
let jevLive = false
let jevGraceUntil = 0
let switcher: { cancel: () => void } | null = null
const strangers = new Set<string>()

function toolWords(tool: string, connector: string) {
  const words = tool
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map(w => w.toLowerCase())
  // "slack_search_public" from Slack reads "Slack · search public".
  if (words.length > 1 && words[0] === connector.split(' ')[0]!.toLowerCase()) words.shift()
  return words.join(' ')
}

const base = (p: string) => p.split('/').filter(Boolean).pop() ?? p
const cut = (t: string, n: number) => (n <= 0 ? '' : t.length > n ? `${t.slice(0, Math.max(0, n - 1))}…` : t)
const oneLine = (t: string) => t.replace(/\s+/g, ' ').trim()

function folder(p: string) {
  const parts = p.split('/')
  parts.pop()
  const dir = parts.join('/')
  return home && dir.startsWith(home) ? `~${dir.slice(home.length)}` : dir
}

/** One tool call: its kind, a short label for the list, and plain words for the live line. */
function describe(tool: string, args: Record<string, unknown>): Step {
  const s = (k: string) => (typeof args[k] === 'string' ? oneLine(args[k] as string) : '')
  const file = (verb: string, kind: StepKind, key = 'file_path'): Step => {
    const p = typeof args[key] === 'string' ? (args[key] as string) : ''
    const name = base(p) || 'a file'
    return { kind, label: name, dim: p ? folder(p) : '', live: `${verb} ${name}` }
  }
  if (tool.startsWith('mcp__')) {
    const { server, name: toolName } = splitTool(tool)
    const name = connectorName(server, toolName)
    const words = toolWords(toolName.replace(/__/g, '_'), name)
    return { kind: 'Connector', label: `${name} · ${words}`, dim: '', live: `${name}: ${words}` }
  }
  switch (tool) {
    case 'Read':
      return file('Reading', 'File read')
    case 'Write':
      return file('Writing', 'File write')
    case 'Edit':
    case 'MultiEdit':
      return file('Editing', 'File write')
    case 'NotebookEdit':
      return file('Editing', 'File write', 'notebook_path')
    case 'Grep':
    case 'Glob': {
      const pat = s('pattern')
      const p = s('path')
      return {
        kind: 'File read',
        label: pat ? `Search "${cut(pat, 60)}"` : 'Search files',
        dim: p ? (home && p.startsWith(home) ? `~${p.slice(home.length)}` : p) : '',
        live: pat ? `Searching files for "${cut(pat, 40)}"` : 'Searching files',
      }
    }
    case 'Bash': {
      const label = s('description') || cut(s('command'), 80) || 'a command'
      return { kind: 'Command', label, dim: '', live: `Running: ${label}` }
    }
    case 'WebSearch':
      return { kind: 'Web', label: s('query') || 'web search', dim: '', live: `Searching the web: ${s('query')}` }
    case 'WebFetch': {
      let host = 'a web page'
      try {
        host = new URL(s('url')).host
      } catch {
        // Not a URL: keep the plain words.
      }
      return { kind: 'Web', label: host, dim: '', live: `Opening ${host}` }
    }
    case 'Skill':
      return { kind: 'Skill', label: s('skill') || 'a skill', dim: '', live: `Using the ${s('skill') || 'a'} skill` }
    case 'Agent':
    case 'Task':
      return {
        kind: 'Subagent',
        label: s('description') || 'Start a subagent',
        dim: '',
        live: s('description') ? `Starting a subagent: ${s('description')}` : 'Starting a subagent',
      }
    case 'SendMessage':
      return { kind: 'Subagent', label: 'Send a message', dim: '', live: 'Sending a message' }
    case 'TodoWrite':
      return { kind: 'Tool', label: 'Update its to-do list', dim: '', live: 'Updating its to-do list' }
    case 'ToolSearch':
      return { kind: 'Tool', label: 'Load tools', dim: '', live: 'Loading tools' }
    default:
      return { kind: 'Tool', label: tool, dim: '', live: `Using ${tool}` }
  }
}

function clockTime(ms: number) {
  const t = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(t / 3600)
  const m = Math.floor((t % 3600) / 60)
  const sec = String(t % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`
}

function tokenText(n: number) {
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`
  return `${(n / 1_000_000).toFixed(1)}M`
}

/** "claude-opus-5-5" reads "Opus 5.5"; "haiku" reads "Haiku". */
function shortModel(model: string) {
  const hit = /(opus|sonnet|haiku|fable)(?:[-_ ](\d+))?(?:[-_.](\d+))?/i.exec(model)
  if (!hit) return model
  const fam = hit[1]![0]!.toUpperCase() + hit[1]!.slice(1).toLowerCase()
  return hit[2] ? `${fam} ${hit[2]}${hit[3] ? `.${hit[3]}` : ''}` : fam
}

type Usage = { input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number }
const usageTotal = (u: Usage) => u.input_tokens + u.output_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens

const working = () => helpers.filter(hp => hp.phase === 'working').length

/** The next colour in order that no running helper wears; with all 8 taken, the next in order. */
function pickHue() {
  const used = new Set(helpers.filter(hp => hp.phase === 'working').map(hp => hp.hue % HUES.length))
  let hue = nextHue % HUES.length
  for (let i = 0; i < HUES.length; i += 1) {
    const h = (nextHue + i) % HUES.length
    if (!used.has(h)) {
      hue = h
      break
    }
  }
  nextHue = hue + 1
  return hue
}
const copy = (hp: Helper): Helper => ({ ...hp, steps: hp.steps.map(st => ({ ...st })), sentTo: [...hp.sentTo], heardFrom: [...hp.heardFrom] })

async function log($: EngineInterface, line: string) {
  try {
    const dir = `${home}/.claude/mods-logs`
    const path = `${dir}/${NAME}.log`
    let old = ''
    if (await $.fs.exists(path).catch(() => false)) old = String(await $.fs.read(path))
    await $.fs.write(path, `${old}${new Date().toISOString()} ${line}\n`)
  } catch {
    // Logging must never break the session.
  }
}

async function tick($: EngineInterface) {
  tickN += 1
  await $.state.set(CLOCK, { tick: tickN, now: await $.clock.now() })
}

async function readCost($: EngineInterface) {
  try {
    const u = await $.session.usage()
    await $.state.set(COST, { usd: typeof u.cost?.usd === 'number' ? u.cost.usd : null })
  } catch {
    // No ledger here: the tile stays hidden.
  }
}

const MAIN = 'main'
const MAX_PEERS = 3
const jevPath = () => `${home}/.claude/logs/jev-live/${sessionId}.json`
const jevFinal = (c: JevCall) => c.phase === 'judged' || c.phase === 'skipped'
const JEV_PHASES: readonly string[] = ['asking', 'answered', 'skipped', 'judging', 'judged']

/** The calls in jev-lab's file; anything that is not a call is left out. */
function parseJev(text: string): JevCall[] {
  const json = JSON.parse(text) as { calls?: unknown }
  if (!json || !Array.isArray(json.calls)) return []
  return (json.calls as Record<string, unknown>[]).filter(c => c && typeof c.id === 'string' && JEV_PHASES.includes(String(c.phase))) as unknown as JevCall[]
}

/** Reads jev-lab's live file into the drawn copy; a missing or unreadable file is no cards. Stops the watch once every call is final. */
async function pollJev($: EngineInterface) {
  let calls: JevCall[] = []
  try {
    if (home && sessionId && (await $.fs.exists(jevPath()))) calls = parseJev(String(await $.fs.read(jevPath())))
  } catch {
    calls = []
  }
  const raw = JSON.stringify(calls)
  if (raw !== jevRaw) {
    jevRaw = raw
    jev = calls
    await $.state.set(JEV, calls)
  }
  const live = calls.some(c => !jevFinal(c)) || (await $.clock.now()) < jevGraceUntil
  if (live !== jevLive) {
    jevLive = live
    syncTimers($)
  }
}

/** A new Agent dispatch: watch the file again. Jev writes its first row a moment after the call, so the watch holds on for a few seconds. */
async function watchJev($: EngineInterface) {
  jevGraceUntil = (await $.clock.now()) + JEV_GRACE_MS
  jevLive = true
  syncTimers($)
  await pollJev($)
}

async function poll($: EngineInterface) {
  await pollJev($)
  if (!working()) return
  const list = await $.agent.list()
  const now = await $.clock.now()
  let changed = false
  for (const a of list) {
    const hp = helpers.find(x => x.id === a.id)
    if (!hp || hp.phase !== 'working') continue
    // The list may lag a turn's end; it only ever moves a card out of working.
    const next: HelperPhase | null =
      a.status === 'completed' || a.status === 'idle' ? 'done' : a.status === 'failed' || a.status === 'killed' ? 'failed' : null
    if (next) {
      hp.phase = next
      hp.endedAt = now
      changed = true
    }
    if (!hp.description && a.description) {
      hp.description = a.description
      changed = true
    }
  }
  if (changed) await publish($)
  else await readCost($)
}

const runningPets = () => [...pets.values()].some(p => helpers.find(hp => hp.id === p.id)?.phase === 'working')

/** One 40 ms frame for every running pet; a denied blit means that canvas is gone, so it is not painted again until the next draw. */
async function crabFrame($: EngineInterface) {
  if (crabBusy) return
  crabBusy = true
  try {
    const t = await $.clock.now()
    for (const [key, pet] of [...pets]) {
      if (helpers.find(hp => hp.id === pet.id)?.phase !== 'working') continue
      const { columns, rows } = pet
      const result = await $.ui.blit({ requestId: pet.requestId, key, cells: drawCrab(columns, rows, t, pet.hue), columns, rows })
      if (result.deny !== undefined) pets.delete(key)
    }
  } finally {
    crabBusy = false
  }
  syncTimers($)
}

function syncTimers($: EngineInterface) {
  if (working() && !off) {
    ticker ??= $.clock.every(TICK_MS, () => {
      void tick($).catch(() => undefined)
    })
  } else {
    ticker?.cancel()
    ticker = null
  }
  if ((working() || jevLive) && !off) {
    poller ??= $.clock.every(POLL_MS, () => {
      void poll($).catch(err => log($, `poll: ${String(err)}`))
    })
  } else {
    poller?.cancel()
    poller = null
  }
  // Pets move only while a helper works, motion is on, and a draw has mounted one.
  if (motion && !off && runningPets()) {
    crabber ??= $.clock.every(FRAME_MS, () => {
      void crabFrame($).catch(err => log($, `crab: ${String(err)}`))
    })
  } else {
    crabber?.cancel()
    crabber = null
  }
}

async function publish($: EngineInterface) {
  await $.state.set(HELPERS, helpers.map(copy))
  await $.state.set(CLOCK, { tick: tickN, now: await $.clock.now() })
  await readCost($)
  // No status line: on desktop it drew over Context Meter's footer bar. The pane shows the count.
  $.ui.status(undefined)
  syncTimers($)
}

async function addHelper($: EngineInterface, id: string, description: string, type: string, model: string, name = '') {
  const known = helpers.find(hp => hp.id === id)
  if (known) {
    // Found first through its own tool calls: fill in what the spawn knows.
    if (description) known.description = description
    if (type) known.type = type
    if (model && !known.model) known.model = model
    if (name && !known.name) known.name = name
    await publish($)
    return
  }
  const wasIdle = working() === 0
  const now = await $.clock.now()
  helpers.push({
    id,
    description: description || 'Subagent',
    type: type || 'subagent',
    name,
    sentTo: [],
    heardFrom: [],
    model,
    effort: '',
    phase: 'working',
    startedAt: now,
    endedAt: 0,
    count: 0,
    steps: [],
    tokens: 0,
    turnTokens: 0,
    hasUsage: false,
    seat: seats,
    hue: pickHue(),
  })
  seats += 1
  await publish($)
  // The pane opens by itself when a new round of helpers starts.
  if (wasIdle && !hidden) void $.ui.open({ id: PANE, title: TITLE }).catch(err => log($, `open: ${String(err)}`))
}

/** A loop whose spawn this mod missed (a reload, a race): take it from $.agent.list(). */
async function adopt($: EngineInterface, id: string) {
  if (helpers.some(hp => hp.id === id) || strangers.has(id)) return
  const a = (await $.agent.list()).find(x => x.id === id)
  if (!a) {
    // The engine's own forks carry ids no list names: leave them out.
    strangers.add(id)
    return
  }
  // A teammate's address reads <name>@<team>.
  await addHelper($, id, a.description, a.type, '', a.teammateId?.split('@')[0] ?? '')
}

async function noteTool($: EngineInterface, id: string, step: Step) {
  if (!helpers.some(x => x.id === id)) await adopt($, id)
  const hp = helpers.find(x => x.id === id)
  if (!hp) return
  hp.count += 1
  hp.steps = [...hp.steps, step].slice(-MAX_STEPS)
  // A teammate that finished a turn and picks up work again is working again.
  if (hp.phase !== 'working') {
    hp.phase = 'working'
    hp.endedAt = 0
  }
  await publish($)
}

async function noteStep($: EngineInterface, id: string, model: string, effort: string, usage: Usage | null) {
  if (!helpers.some(x => x.id === id)) await adopt($, id)
  const hp = helpers.find(x => x.id === id)
  if (!hp) return
  if (model) hp.model = shortModel(model)
  if (effort) hp.effort = effort
  if (usage) {
    hp.turnTokens += usageTotal(usage)
    hp.hasUsage = true
  }
  await publish($)
}

async function finish($: EngineInterface, id: string, phase: HelperPhase, usage: Usage | null) {
  const hp = helpers.find(x => x.id === id)
  if (!hp) return
  // The turn's own sum wins over the steps counted so far.
  hp.tokens += usage ? usageTotal(usage) : hp.turnTokens
  hp.turnTokens = 0
  if (usage) hp.hasUsage = true
  hp.phase = phase
  hp.endedAt = await $.clock.now()
  await publish($)
}

async function setOff($: EngineInterface, value: boolean) {
  if (value === off) return
  off = value
  await $.state.set(OFF, off)
  if (off) {
    $.ui.status(undefined)
    await $.ui.close({ id: PANE }).catch(() => undefined)
  }
  syncTimers($)
  syncShimmer($)
}

const HIDE_KEY = `${NAME}:hidden`
const switchesPath = () => `${home}/.claude/mods/switches.json`

async function readSwitches($: EngineInterface): Promise<Record<string, unknown>> {
  if (!(await $.fs.exists(switchesPath()))) return {}
  const json = JSON.parse(String(await $.fs.read(switchesPath()))) as unknown
  return json && typeof json === 'object' && !Array.isArray(json) ? (json as Record<string, unknown>) : {}
}

async function readSwitch($: EngineInterface) {
  try {
    const json = await readSwitches($)
    const nowHidden = json[`${NAME}:hidden`] === true
    if (nowHidden && !hidden) await $.ui.close({ id: PANE }).catch(() => undefined)
    if (nowHidden !== hidden) {
      hidden = nowHidden
      // The band reads this key, so a change redraws it.
      await $.state.set(HIDDEN, hidden)
      syncShimmer($)
    }
    await setOff($, json[NAME] === false)
  } catch {
    // A broken file never turns the mod off.
  }
}

// Read, change, write the whole file, so every chat sees the choice within 3 s.
async function setHidden($: EngineInterface, value: boolean) {
  try {
    const json = await readSwitches($)
    if (value) json[HIDE_KEY] = true
    else delete json[HIDE_KEY]
    await $.fs.write(switchesPath(), `${JSON.stringify(json, null, 2)}\n`)
  } catch (err) {
    await log($, `save hidden: ${String(err)}`)
  }
  hidden = value
  await $.state.set(HIDDEN, hidden)
  syncShimmer($)
  if (value) await $.ui.close({ id: PANE }).catch(() => undefined)
}

/** The helper an address names: its id, its name, or its `<name>@<team>` address. */
function helperNamed(address: string) {
  const q = address.trim().toLowerCase()
  const bare = q.split('@')[0]
  return helpers.find(hp => hp.id.toLowerCase() === q || (!!hp.name && [q, bare].includes(hp.name.toLowerCase())))
}

const remember = (list: string[], id: string) => [...list.filter(x => x !== id), id].slice(-MAX_PEERS)

/** A message left `from` (a helper id, or undefined for the main chat) for `to` (a name or id; one no helper carries is the main chat). */
async function noteSend($: EngineInterface, from: string | undefined, to: string) {
  const sender = from === undefined ? MAIN : helpers.find(hp => hp.id === from)?.id
  if (!sender) return
  const receiver = helperNamed(to)?.id ?? MAIN
  if (sender === receiver) return
  const a = helpers.find(hp => hp.id === sender)
  const b = helpers.find(hp => hp.id === receiver)
  if (a) a.sentTo = remember(a.sentTo, receiver)
  if (b) b.heardFrom = remember(b.heardFrom, sender)
  if (a || b) await publish($)
}

/** Scrolls the pane to a helper's card and lights its border for a moment. */
async function gotoHelper($: EngineInterface, id: string) {
  if (!helpers.some(hp => hp.id === id)) return false
  const now = await $.clock.now()
  focusTimer?.cancel()
  focusTimer = $.clock.after(FOCUS_MS, () => {
    focusTimer = null
    void $.state.set(FOCUS, null).catch(() => undefined)
  })
  await $.state.set(FOCUS, { id, until: now + FOCUS_MS })
  await $.ui.scroll({ to: { key: `card-${id}` }, in: PANE, block: 'center' }).catch(err => log($, `scroll: ${String(err)}`))
  return true
}

async function setMotion($: EngineInterface, value: boolean) {
  motion = value
  await $.store.set(MOTION_KEY, value)
  await $.state.set(MOTION, value)
  syncTimers($)
}

const GROUPS = ['running', 'finished', 'stopped']

/** The cards as the pane lists them, top to bottom: Running, then Finished, then Stopped. */
function byGroup(list: Helper[]) {
  const running = list.filter(hp => hp.phase === 'working')
  const finished = list.filter(hp => hp.phase === 'done')
  const stopped = list.filter(hp => hp.phase === 'failed')
  return { running, finished, stopped, ordered: [...running, ...finished, ...stopped] }
}

async function hidePane($: EngineInterface) {
  await setHidden($, true)
  say($, `${TITLE} hidden. Type /helpers or open /mods to show it.`)
}

async function openPane($: EngineInterface) {
  await $.ui.open({ id: PANE, title: TITLE })
}

// $.fs has no delete, and Windows has no rm outside Git Bash: del through cmd there.
async function removeFile($: EngineInterface, path: string) {
  const windows = (await $.env.get('OS')) === 'Windows_NT'
  await $.process.run(windows ? ['cmd', '/c', 'del', '/f', '/q', path.replace(/\//g, '\\')] : ['rm', '-f', path])
}

async function checkOpen($: EngineInterface) {
  if (!sessionId) return
  const path = `${home}/.claude/mods/.open-${NAME}-${sessionId}`
  if (!(await $.fs.exists(path).catch(() => false))) return
  await removeFile($, path)
  if (!off) await openPane($)
}

async function switchPoll($: EngineInterface) {
  await readSwitch($)
  await checkOpen($).catch(err => log($, `open request: ${String(err)}`))
}

// ---------- The plan: one list per chat, shared with chat-inventory through a file ----------

const PLAN_TOOL = 'mcp__helper-desk__plan'
const MIRRORED = new Set(['TodoWrite', 'TaskCreate', 'TaskUpdate'])
const PLAN_PROMPT =
  'Your to-do list is the mcp__helper-desk__plan tool (this app has no TodoWrite). The user watches it as a task list above the prompt. ' +
  'For any task that needs 2 or more steps or tool calls, call it first, before other tools, with every step in order and the first one in_progress. ' +
  'Call it again with the full list each time a step finishes or a new one starts. Mark the last step completed before your final answer. ' +
  'When you write a plan for the user to approve, save its steps with the tool too, all pending, so the plan shows in the task list and the Chat Inventory to-do list. ' +
  'A step that launches subagents is one step. Skip it only for a one-line answer with no tool calls.'
// Main-chat tool calls in a turn before the nudge to make a plan.
const NUDGE_AFTER = 1
// Tool calls since the last plan update before the nudge to tick it.
const STALE_AFTER = 8
const NUDGE_NEW =
  'Helper Desk: you have no plan for this task yet. Call mcp__helper-desk__plan now with every step in order, so the user sees your progress.'
const NUDGE_CONT =
  'Helper Desk: the plan has not changed this turn. If this is a new task, call mcp__helper-desk__plan with its steps. If it carries on the last one, send the updated list.'
const NUDGE_STALE =
  'Helper Desk: the plan has not changed in a while. If a step finished, call mcp__helper-desk__plan with the full list now.'
const STATUSES: readonly PlanStatus[] = ['pending', 'in_progress', 'completed']
const SHIMMER_MS = 350
// How long a finished plan stays at 100% before the band goes away.
const DONE_HOLD_MS = 20_000
const BAR_FALLBACK = 30

type PlanStep = { text: string; status: PlanStatus; doneAt?: string; id?: string }
type Plan = { title: string; steps: PlanStep[]; updatedAt: string }
type StepIn = { text: string; status: PlanStatus; id?: string }

let plan: Plan | null = null
// True once every step is done; a list with work left in it starts the next plan.
let planDone = false
let planShown = false
let shimmer: { cancel: () => void } | null = null
let holdTimer: { cancel: () => void } | null = null
let shimN = 0
// True while the main loop (not a subagent) runs a turn; the flash is idle otherwise.
let mainTurn = false
// The plan nudge: main-chat tool calls this turn, and whether a plan came in.
let turnCalls = 0
let turnPlanned = false
let nudged = false
let sincePlan = 0
let staleNudged = false

// A short reminder after a tool's result, read by the model only.
function withNudge<R>(r: R): R {
  turnCalls++
  sincePlan++
  const live = !!plan && !planDone && plan.steps.length > 0
  let note: string | null = null
  if (!turnPlanned && !nudged && turnCalls >= NUDGE_AFTER) {
    nudged = true
    note = live ? NUDGE_CONT : NUDGE_NEW
  } else if (live && !staleNudged && sincePlan >= STALE_AFTER) {
    staleNudged = true
    note = NUDGE_STALE
  }
  if (!note || !r || typeof r !== 'object' || 'deny' in (r as object)) return r
  const had = (r as { context?: readonly string[] }).context ?? []
  return { ...r, context: [...had, note] }
}

const planPath = () => `${home}/.claude/mods-state/plan-${sessionId}.json`
const doneCount = (steps: { status: PlanStatus }[]) => steps.filter(st => st.status === 'completed').length
const isStatus = (v: unknown): v is PlanStatus => typeof v === 'string' && (STATUSES as readonly string[]).includes(v)

async function writePlan($: EngineInterface) {
  if (!plan || !sessionId || !home) return
  try {
    const body = {
      title: plan.title,
      steps: plan.steps.map(st => ({ text: st.text, status: st.status, ...(st.doneAt ? { doneAt: st.doneAt } : {}) })),
      updatedAt: plan.updatedAt,
    }
    await $.fs.write(planPath(), `${JSON.stringify(body, null, 2)}\n`)
  } catch (err) {
    await log($, `write plan: ${String(err)}`)
  }
}

async function drawPlan($: EngineInterface) {
  const value: BandPlan | null = plan
    ? { title: plan.title, steps: plan.steps.map(st => ({ text: st.text, status: st.status })), shown: planShown }
    : null
  await $.state.set(PLAN, value)
  syncShimmer($)
}

/** The shimmer clock runs only while the main loop runs a turn and a shown plan has a step in progress. */
function syncShimmer($: EngineInterface) {
  const need = mainTurn && !off && !hidden && planShown && !!plan?.steps.some(st => st.status === 'in_progress')
  if (need) {
    shimmer ??= $.clock.every(SHIMMER_MS, () => {
      shimN += 1
      void $.state.set(SHIM, shimN).catch(() => undefined)
    })
  } else {
    shimmer?.cancel()
    shimmer = null
  }
}

function say($: EngineInterface, text: string) {
  try {
    $.ui.toast(cut(text, 140))
  } catch {
    // A toast is only a hint.
  }
}

/** Takes a whole new list, keeps done times, toasts what just finished, and saves. */
async function applyPlan($: EngineInterface, title: string | undefined, incoming: StepIn[]) {
  const now = new Date(await $.clock.now()).toISOString()
  const allDone = incoming.length > 0 && incoming.every(st => st.status === 'completed')
  // A list with work left in it after a finished plan is a new plan.
  const fresh = !plan || (planDone && !allDone)
  const old = fresh ? [] : plan!.steps
  const used = new Set<number>()
  const match = (st: StepIn) => {
    const i = old.findIndex((o, k) => !used.has(k) && (st.id ? o.id === st.id : o.text === st.text))
    if (i >= 0) used.add(i)
    return i >= 0 ? old[i] : undefined
  }
  const justDone: string[] = []
  const steps: PlanStep[] = incoming.map(st => {
    const was = match(st)
    const step: PlanStep = { text: st.text, status: st.status, ...(st.id ? { id: st.id } : {}) }
    if (st.status === 'completed') {
      step.doneAt = was?.status === 'completed' && was.doneAt ? was.doneAt : now
      if (was?.status !== 'completed' && !fresh) justDone.push(st.text)
    }
    return step
  })
  const wasDone = planDone && !fresh
  plan = { title: title?.trim() || (fresh ? 'Plan' : plan!.title), steps, updatedAt: now }
  planDone = allDone
  if (!steps.length) planShown = false
  else if (allDone && !wasDone) {
    planShown = true
    say($, steps.length === 1 ? 'All steps done.' : `All ${steps.length} steps done.`)
    holdTimer?.cancel()
    holdTimer = $.clock.after(DONE_HOLD_MS, () => {
      holdTimer = null
      planShown = false
      void drawPlan($).catch(err => log($, `hide plan: ${String(err)}`))
    })
  } else if (!allDone) {
    planShown = true
    holdTimer?.cancel()
    holdTimer = null
    if (justDone.length) say($, `Done: ${justDone.join(', ')}`)
  }
  await writePlan($)
  await drawPlan($)
}

/** The plan tool's own call: check the input, save it, answer in one line. */
async function planFromTool($: EngineInterface, args: Record<string, unknown>) {
  const raw = args.steps
  if (!Array.isArray(raw)) return 'Plan not saved: send steps as a list of { text, status }.'
  const steps: StepIn[] = []
  for (const st of raw as unknown[]) {
    const o = (st && typeof st === 'object' ? st : {}) as Record<string, unknown>
    const text = typeof o.text === 'string' ? oneLine(o.text) : ''
    if (!text) return 'Plan not saved: every step needs its text.'
    if (!isStatus(o.status)) return `Plan not saved: "${cut(text, 40)}" needs a status of pending, in_progress or completed.`
    steps.push({ text, status: o.status })
  }
  await applyPlan($, typeof args.title === 'string' ? oneLine(args.title) : undefined, steps)
  return `Plan saved: ${doneCount(steps)} of ${steps.length} steps done.`
}

/** TodoWrite, TaskCreate and TaskUpdate on the main chat feed the same plan. */
async function mirror($: EngineInterface, tool: string, args: Record<string, unknown>, r: unknown) {
  const res = (r as { result?: unknown; isError?: boolean; deny?: string } | undefined) ?? {}
  if (res.deny || res.isError) return
  if (tool === 'TodoWrite') {
    const todos = Array.isArray(args.todos) ? (args.todos as unknown[]) : []
    const steps: StepIn[] = []
    for (const t of todos) {
      const o = (t && typeof t === 'object' ? t : {}) as Record<string, unknown>
      const text = typeof o.content === 'string' ? oneLine(o.content) : ''
      if (text) steps.push({ text, status: isStatus(o.status) ? o.status : 'pending' })
    }
    await applyPlan($, undefined, steps)
    return
  }
  const current: StepIn[] = plan && !planDone ? plan.steps.map(st => ({ text: st.text, status: st.status, ...(st.id ? { id: st.id } : {}) })) : []
  if (tool === 'TaskCreate') {
    const text = typeof args.subject === 'string' ? oneLine(args.subject) : ''
    if (!text) return
    const out = (res.result ?? {}) as { task?: { id?: unknown } }
    const id = typeof out.task?.id === 'string' ? out.task.id : undefined
    await applyPlan($, undefined, [...current, { text, status: 'pending', ...(id ? { id } : {}) }])
    return
  }
  // TaskUpdate: find the task by its id; an unknown one with a subject joins the list.
  const id = typeof args.taskId === 'string' ? args.taskId : ''
  const all: StepIn[] = plan ? plan.steps.map(st => ({ text: st.text, status: st.status, ...(st.id ? { id: st.id } : {}) })) : []
  const i = all.findIndex(st => st.id === id)
  const subject = typeof args.subject === 'string' ? oneLine(args.subject) : ''
  if (args.status === 'deleted') {
    if (i >= 0) await applyPlan($, undefined, all.filter((_, k) => k !== i))
    return
  }
  const status = isStatus(args.status) ? args.status : undefined
  if (i < 0) {
    if (subject) await applyPlan($, undefined, [...current, { text: subject, status: status ?? 'pending', id }])
    return
  }
  all[i] = { ...all[i]!, ...(subject ? { text: subject } : {}), ...(status ? { status } : {}) }
  await applyPlan($, undefined, all)
}

/** A reload or resume carries on with the plan this chat already saved. */
async function loadPlan($: EngineInterface) {
  if (plan || !sessionId || !home) return
  try {
    if (!(await $.fs.exists(planPath()))) return
    const json = JSON.parse(String(await $.fs.read(planPath()))) as { title?: unknown; steps?: unknown; updatedAt?: unknown }
    const steps: PlanStep[] = (Array.isArray(json.steps) ? (json.steps as Record<string, unknown>[]) : [])
      .filter(st => st && typeof st.text === 'string' && isStatus(st.status))
      .map(st => ({ text: String(st.text), status: st.status as PlanStatus, ...(typeof st.doneAt === 'string' ? { doneAt: st.doneAt } : {}) }))
    plan = {
      title: typeof json.title === 'string' && json.title ? json.title : 'Plan',
      steps,
      updatedAt: typeof json.updatedAt === 'string' ? json.updatedAt : '',
    }
    planDone = steps.length > 0 && steps.every(st => st.status === 'completed')
    planShown = steps.length > 0 && !planDone
    await drawPlan($)
  } catch (err) {
    await log($, `load plan: ${String(err)}`)
  }
}

async function toggleIn($: EngineInterface, field: 'open' | 'folded', id: string) {
  const { value = { open: [], folded: [] } } = await $.state.get(VIEW)
  const list = value[field]
  const nextList = list.includes(id) ? list.filter(x => x !== id) : [...list, id]
  await $.state.set(VIEW, { ...value, [field]: nextList })
}

// ---------- Drawing ----------

/** A label then dim text, both cut to fit `w` cells; the folder gives way first. */
function fitRow(label: string, dim: string, w: number): [string, string] {
  if (label.length >= w || !dim) return [cut(label, w), '']
  const room = w - label.length - 2
  if (room < 4) return [label, '']
  return [label, dim.length > room ? `…${dim.slice(-(room - 1))}` : dim]
}

/** The terminal bar: one thin row of eighth-blocks, full when over, a sliding piece while working. */
function barParts(phase: HelperPhase, w: number, tick: number, seat: number): [string, string, string] {
  if (phase !== 'working') return ['', '▁'.repeat(w), '']
  const piece = Math.max(3, Math.floor(w / 4))
  const span = w + piece
  const head = ((tick + seat * 5 + piece) % span) - piece
  const from = Math.max(0, head)
  const to = Math.min(w, head + piece)
  return ['▁'.repeat(from), '▁'.repeat(Math.max(0, to - from)), '▁'.repeat(w - Math.max(from, to))]
}

// ---------- Sparkle bars: SVG for the desktop subagent cards ----------

const CELL = 3

// Fixed noise, so the sparkles sit still between redraws and only their CSS twinkle moves.
const noise = (x: number, y: number) => {
  const v = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453
  return v - Math.floor(v)
}
/** Twinkle classes s0 to s3, out of phase; `slow` for a finished bar. */
const twinkleCss = (slow: boolean) =>
  `.s0,.s1,.s2,.s3{animation:tw ${slow ? 3.2 : 2.1}s ease-in-out infinite}` +
  `.s1{animation-duration:${slow ? 3.8 : 2.7}s;animation-delay:-.7s}.s2{animation-duration:${slow ? 4.4 : 1.8}s;animation-delay:-1.3s}` +
  `.s3{animation-duration:${slow ? 3.5 : 3.1}s;animation-delay:-.4s}` +
  `@keyframes tw{0%,100%{opacity:.95}50%{opacity:${slow ? 0.55 : 0.15}}}`

/** Dither squares over `w` by `h` pixels: sparse at the left, dense at the right. */
function sparkles(w: number, h: number, size: number, base: number, rise: number, salt = 0): string {
  const cols = Math.floor(w / CELL)
  const rows = Math.max(1, Math.floor(h / CELL))
  const out: string[] = []
  for (let c = 0; c < cols; c++) {
    const density = base + rise * Math.pow(c / Math.max(1, cols), 1.3)
    for (let r = 0; r < rows; r++) {
      if (noise(c + salt, r) < density) {
        out.push(`<rect class="s${Math.floor(noise(r, c + salt) * 4)}" x="${c * CELL + 0.5}" y="${r * CELL + (h - rows * CELL) / 2 + 0.5}" width="${size}" height="${size}"/>`)
      }
    }
  }
  return out.join('')
}

const CARD_BAR_H = 3

/**
 * One thin sparkle bar per subagent card. While it works a bright piece sweeps the track
 * (its length is not known); once over the whole bar fills and glows slowly. The drawing
 * depends only on the phase, so CSS moves it and redraws do not restart it.
 */
function cardBarSvg(phase: HelperPhase, color: string, W: number, seat: number): string {
  const id = `hdc${seat}`
  const H = CARD_BAR_H
  const fill = phase === 'failed' ? SVG_BAD : color
  const piece = Math.max(30, Math.round(W * 0.35))
  const working = phase === 'working'
  const body = working
    ? `<g class="mv"><rect width="${piece}" height="${H}" fill="url(#${id}-p)"/><g fill="#ffffff">${sparkles(piece, H, 1.6, 0.1, 0.35, seat * 11)}</g></g>`
    : `<rect width="${W}" height="${H}" fill="url(#${id}-g)"/><g fill="#ffffff">${sparkles(W, H, 1.6, 0.18, 0.3, seat * 11)}</g>`
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<style>
${twinkleCss(!working)}
.mv{animation:mv${seat} 1.8s ease-in-out infinite;animation-delay:-${(seat * 0.37) % 1.8}s}
@keyframes mv${seat}{from{transform:translateX(-${piece}px)}to{transform:translateX(${W}px)}}
@media (prefers-reduced-motion: reduce){.s0,.s1,.s2,.s3,.mv{animation:none}}
</style>
<defs>
<linearGradient id="${id}-g" x1="0" x2="1"><stop offset="0" stop-color="${fill}" stop-opacity=".55"/><stop offset="1" stop-color="${fill}"/></linearGradient>
<linearGradient id="${id}-p" x1="0" x2="1"><stop offset="0" stop-color="${fill}" stop-opacity="0"/><stop offset=".7" stop-color="${fill}"/><stop offset="1" stop-color="${fill}" stop-opacity=".9"/></linearGradient>
<clipPath id="${id}-c"><rect width="${W}" height="${H}" rx="${H / 2}"/></clipPath>
</defs>
<g clip-path="url(#${id}-c)">
<rect width="${W}" height="${H}" fill="${fill}" opacity=".16"/>
${body}
</g>
</svg>`
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    home = $.plugin.root.replace(/\\/g, '/').split('/.claude/')[0] ?? ''
    sessionId = await $.session.id().catch(() => '')
    await $.command.register({ name: 'helpers', description: 'Show the Helper Desk: the task list and one live card per subagent', argumentHint: '[hide|fold|steps|goto|motion]', immediate: true })
    await $.tool.register({
      name: 'plan',
      description:
        'Save the plan for the job in front of you: the steps in order, each pending, in_progress or completed. ' +
        'It draws the task list above the prompt for the user, the step in progress flashing. Send the whole list every time, like TodoWrite.',
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'A short name for the job, a few words.' },
          steps: {
            type: 'array',
            description: 'Every step, in order.',
            items: {
              type: 'object',
              properties: {
                text: { type: 'string', description: 'The step in a few plain words.' },
                status: { type: 'string', enum: ['pending', 'in_progress', 'completed'] },
              },
              required: ['text', 'status'],
            },
          },
        },
        required: ['steps'],
      },
      // In front, not behind ToolSearch: a hidden tool never gets called.
      isDeferred: false,
    }).catch(err => log($, `register plan tool: ${String(err)}`))
    motion = (await $.store.get(MOTION_KEY).catch(() => undefined)) !== false
    await $.state.set(MOTION, motion)
    await readSwitch($)
    await loadPlan($)
    await pollJev($)
    switcher ??= $.clock.every(SWITCH_MS, () => {
      void switchPoll($).catch(err => log($, `switch: ${String(err)}`))
    })
    // A reload keeps the drawn copy: carry on from it.
    if (!helpers.length) {
      const { value } = await $.state.get(HELPERS)
      if (value?.length) {
        // A copy from before body colours has no hue: its seat picks one.
        helpers = value.map(hp => ({
          ...copy({ ...hp, sentTo: hp.sentTo ?? [], heardFrom: hp.heardFrom ?? [] }),
          name: hp.name ?? '',
          hue: typeof hp.hue === 'number' ? hp.hue : hp.seat % HUES.length,
        }))
        seats = Math.max(...helpers.map(hp => hp.seat)) + 1
        nextHue = (Math.max(...helpers.map(hp => hp.hue)) + 1) % HUES.length
        syncTimers($)
      }
    }
    return next(e)
  })

  on('command.run', { command: 'helpers' }, async ($, e) => {
    if (off) return { text: `${TITLE} is off. Turn it on with /mods.` }
    const [verb = '', arg = ''] = String((e as { args?: string }).args ?? '').trim().split(/\s+/)
    // Each pane button as a subcommand; the press handlers below call the same functions.
    if (verb === 'hide') {
      await hidePane($)
      return { text: `${TITLE} hidden. Type /helpers to show it.` }
    }
    if (verb === 'fold') {
      if (!GROUPS.includes(arg)) return { text: `Usage: /helpers fold ${GROUPS.join('|')}` }
      await toggleIn($, 'folded', arg)
      return { text: `Toggled the ${arg} group.` }
    }
    if (verb === 'goto') {
      const rest = String((e as { args?: string }).args ?? '').trim().slice(verb.length).trim()
      const hp = helperNamed(rest) ?? helpers.find(x => x.description.toLowerCase() === rest.toLowerCase())
      if (!hp || !(await gotoHelper($, hp.id))) return { text: 'Usage: /helpers goto <helper name or agent id>' }
      return { text: `Scrolled to ${hp.name || hp.description}.` }
    }
    if (verb === 'motion') {
      if (arg !== 'on' && arg !== 'off') return { text: 'Usage: /helpers motion on|off' }
      await setMotion($, arg === 'on')
      return { text: `Pet motion ${arg}.` }
    }
    if (verb === 'steps') {
      const { value: list = [] } = await $.state.get(HELPERS)
      const id = byGroup(list).ordered.find((hp, i) => hp.id === arg || String(i + 1) === arg)?.id
      if (!id) return { text: 'Usage: /helpers steps <card number, top to bottom, or agent id>' }
      await toggleIn($, 'open', id)
      return { text: `Toggled the steps of ${id}.` }
    }
    if (hidden) await setHidden($, false)
    await openPane($)
    return { text: helpers.length ? `${TITLE} opened.` : `${TITLE} opened. Cards show up when Claude starts a subagent.` }
  })

  on('ui.press', { plugin: NAME, element: 'hide' }, async ($, e) => {
    await hidePane($)
    return { element: e.element }
  })

  // ✕ on the task list hides it until the plan changes again.
  on('ui.press', { plugin: NAME, element: 'plan-dismiss' }, async ($, e) => {
    planShown = false
    holdTimer?.cancel()
    holdTimer = null
    await drawPlan($).catch(err => log($, `dismiss plan: ${String(err)}`))
    return { element: e.element }
  })

  on('ui.press', { plugin: NAME }, async ($, e, next) => {
    if (off) return next(e)
    if (e.element.startsWith('steps-')) {
      await toggleIn($, 'open', e.element.slice('steps-'.length))
      return { element: e.element }
    }
    // goto|<card>|<to or from>|<peer>: a peer chip on a card.
    if (e.element.startsWith('goto|')) {
      await gotoHelper($, e.element.split('|')[3] ?? '')
      return { element: e.element }
    }
    if (e.element.startsWith('group-')) {
      await toggleIn($, 'folded', e.element.slice('group-'.length))
      return { element: e.element }
    }
    return next(e)
  })

  on('agent.spawn', async ($, e, next) => {
    const r = await next(e)
    if (off) return r
    void watchJev($).catch(err => log($, `jev: ${String(err)}`))
    const id = (r as { agentId?: string }).agentId
    if (id) {
      void addHelper($, id, e.description || 'Subagent', e.subagentType || 'subagent', shortModel(e.model ?? r.model ?? ''), e.name ?? '').catch(err =>
        log($, `spawn: ${String(err)}`),
      )
    }
    return r
  })

  // Who talks to whom: never blocks, and a failure to note it never reaches the message.
  on('session.send', async ($, e, next) => {
    const r = await next(e)
    if (!off && r.isDelivered) void noteSend($, e.agentId, e.to).catch(err => log($, `send: ${String(err)}`))
    return r
  })

  // One unfiltered hook: a typed tool matcher makes tsc recurse through the connector types.
  on('tool.call', async ($, e, next) => {
    const tool = e.tool as string
    const args = e as unknown as Record<string, unknown>
    const id = e.agentId
    if (tool === PLAN_TOOL) {
      if (off) return { result: `${TITLE} is off, so no plan was saved. Carry on without it.` } as never
      if (id) return { result: 'Only the main chat keeps a plan. Carry on with your task.' } as never
      let said = 'Plan not saved: something went wrong. Carry on.'
      try {
        said = await planFromTool($, args)
      } catch (err) {
        await log($, `plan: ${String(err)}`)
      }
      turnPlanned = true
      sincePlan = 0
      staleNudged = false
      return { result: said } as never
    }
    if (off) return next(e)
    // Jev rates an Agent dispatch before it runs: watch its file again.
    if (!id && (tool === 'Agent' || tool === 'Task')) void watchJev($).catch(err => log($, `jev: ${String(err)}`))
    if (id) {
      void noteTool($, id, describe(tool, args)).catch(err => log($, `tool: ${String(err)}`))
      return next(e)
    }
    if (MIRRORED.has(tool)) {
      const r = await next(e)
      turnPlanned = true
      sincePlan = 0
      void mirror($, tool, args, r).catch(err => log($, `mirror ${tool}: ${String(err)}`))
      return r
    }
    const r = await next(e)
    return withNudge(r)
  })

  // A new prompt is a new task: the plan nudge counts from zero.
  on('prompt.submit', async ($, e, next) => {
    turnCalls = 0
    turnPlanned = false
    nudged = false
    sincePlan = 0
    staleNudged = false
    return next(e)
  })

  // A short system-prompt section, only while the mod is on.
  on('prompt.compose', async ($, e, next) => {
    const r = await next(e)
    if (off || e.traits.includes('teammate') || e.traits.includes('bare')) return r
    return { sections: [...r.sections, { id: 'helper-desk:plan', text: PLAN_PROMPT, scope: 'session' as const }] }
  })

  // Each model request of a helper: its model, effort and token counts.
  on('turn.step', async function* ($, e, next) {
    const r = yield* next(e)
    const id = e.agentId
    if (id && !off) {
      const effort = e.effort === undefined ? '' : String(e.effort)
      void noteStep($, id, e.model, effort, r.usage ?? null).catch(err => log($, `step: ${String(err)}`))
    }
    return r
  })

  on('turn.start', async ($, e, next) => {
    if (!e.agentId) {
      mainTurn = true
      syncShimmer($)
    }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const id = e.agentId
    let r: Awaited<ReturnType<typeof next>>
    try {
      r = await next(e)
    } finally {
      // Whatever the turn did, the main loop is idle now.
      if (!id) {
        mainTurn = false
        syncShimmer($)
      }
    }
    if (id && !off && helpers.some(hp => hp.id === id)) {
      const failed = e.reason === 'error' || e.reason === 'refusal' || e.isAborted
      void finish($, id, failed ? 'failed' : 'done', e.usage ?? null).catch(err => log($, `turn: ${String(err)}`))
    }
    return r
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    const { value: isOff = false } = await $.state.get(OFF)
    if (isOff || off) return next(e)
    const els = $.ui.resolve(e)
    const { Box, Text, Button } = els
    // Svg draws on desktop, the editor and mobile; the terminal gets a Raster.
    const Svg = e.surface !== 'terminal' && 'Svg' in els ? els.Svg : null
    const Raster = e.surface === 'terminal' && 'Raster' in els ? els.Raster : null
    const { value: list = [] } = await $.state.get(HELPERS)
    const { value: clk = { tick: 0, now: 0 } } = await $.state.get(CLOCK)
    const { value: calls = [] } = await $.state.get(JEV)
    const { value: focus = null } = await $.state.get(FOCUS)
    const { value: moves = true } = await $.state.get(MOTION)
    const now = await $.clock.now()
    const { value: view = { open: [], folded: [] } } = await $.state.get(VIEW)
    const { value: cost = { usd: null } } = await $.state.get(COST)
    const width = Math.max(32, e.props.bodyColumns)
    // Inside a card: its border and padding take 4 columns, the pet petW more.
    const canvas = petCanvas(e.props.bodyColumns)
    const petW = Svg ? PET_W : canvas.columns + PET_GAP
    const cw = width - 4 - petW

    const { running, finished, stopped } = byGroup(list)

    // Header tiles: only numbers the engine gave.
    const tiles: { label: string; value: string }[] = []
    if (cost.usd !== null) tiles.push({ label: 'Total chat cost', value: `$${cost.usd.toFixed(2)}` })
    if (list.some(hp => hp.hasUsage)) tiles.push({ label: 'Subagent tokens', value: tokenText(list.reduce((n, hp) => n + hp.tokens + hp.turnTokens, 0)) })
    if (list.length) {
      const start = Math.min(...list.map(hp => hp.startedAt))
      const end = running.length ? Math.max(clk.now, ...running.map(hp => hp.startedAt)) : Math.max(...list.map(hp => hp.endedAt))
      tiles.push({ label: 'Time', value: clockTime(end - start) })
    }
    const tileW = tiles.length ? Math.floor((width - (tiles.length - 1)) / tiles.length) : width

    // The frame timer repaints the Rasters this draw mounts; a stale mount's entries go.
    for (const [key, pet] of pets) if (pet.requestId === e.requestId) pets.delete(key)

    // Only a working pet moves, and only with motion on; any other is the standing pose.
    const pet = (hp: Helper) => {
      const hue = hueOf(hp.hue)
      const moving = moves && hp.phase === 'working'
      if (Svg) {
        return (
          <Box key={`pet-${hp.id}`} width={PET_W} flexShrink={0}>
            <Svg source={petSvg(hp.hue, moving)} alt={`Claude crab, ${hue.name}`} width={PET_PX_W} height={PET_PX_H} />
          </Box>
        )
      }
      if (!Raster) return null
      const { columns, rows } = canvas
      pets.set(`crab-${hp.id}`, { requestId: e.requestId, id: hp.id, columns, rows, hue: hp.hue })
      return (
        <Box key={`pet-${hp.id}`} width={petW} flexShrink={0}>
          <Raster key={`crab-${hp.id}`} columns={columns} rows={rows} cells={drawCrab(columns, rows, now, hp.hue, !moving)} />
        </Box>
      )
    }

    // A peer chip: a button that scrolls to that helper's card, or plain text for the main chat.
    const byId = new Map(list.map(hp => [hp.id, hp]))
    const chips = (hp: Helper, dir: 'to' | 'from', cw: number) => {
      const peers = (dir === 'to' ? hp.sentTo : hp.heardFrom).filter(id => id === MAIN || byId.has(id)).reverse()
      if (!peers.length) return null
      const arrow = dir === 'to' ? '→' : '←'
      const mainW = peers.includes(MAIN) ? `${arrow} main chat`.length : 0
      const others = peers.length - (mainW ? 1 : 0)
      const each = others ? Math.max(6, Math.floor((cw - mainW - (peers.length - 1)) / others)) : 0
      return (
        <Box key={`links-${dir}-${hp.id}`} flexDirection="row" gap={1} width={cw}>
          {peers.map(id => {
            if (id === MAIN) {
              return (
                <Text key={`peer-${dir}-${hp.id}-main`} dimColor wrap="truncate-end">
                  {`${arrow} main chat`}
                </Text>
              )
            }
            const peer = byId.get(id)!
            return (
              <Button key={`goto|${hp.id}|${dir}|${id}`} plain dimColor onPress={() => undefined}>
                {cut(`${arrow} ${peer.name || peer.description}`, each)}
              </Button>
            )
          })}
        </Box>
      )
    }

    const card = (hp: Helper) => {
      const hue = hueOf(hp.hue)
      const live = hp.phase === 'working'
      // A peer button just scrolled here: the border takes the accent for a moment.
      const lit = focus?.id === hp.id && focus.until > now
      const isOpen = view.open.includes(hp.id)
      const mark = live ? '●' : hp.phase === 'done' ? '✓' : '✗'
      const markColor = hp.phase === 'failed' ? BAD : GOOD
      const time = clockTime((live ? Math.max(clk.now, hp.startedAt) : hp.endedAt) - hp.startedAt)
      const meta = [hp.hasUsage ? `${tokenText(hp.tokens + hp.turnTokens)} tokens` : '', time].filter(Boolean).join(' · ')
      const who = [hp.type, hp.model, hp.effort].filter(Boolean).join(' · ')
      const current = hp.steps[hp.steps.length - 1]
      const spin = SPIN[clk.tick % SPIN.length]!
      const pulse = PULSE[clk.tick % PULSE.length]!
      const lead = live
        ? `Step ${hp.count} · ${current?.live ?? 'Getting started'}`
        : hp.phase === 'done'
          ? `Done · ${hp.count} step${hp.count === 1 ? '' : 's'}`
          : `Stopped before it finished · ${hp.count} step${hp.count === 1 ? '' : 's'}`
      // Room for the spinner and pulse on a live line.
      const leadW = Math.max(6, cw - (live ? 2 + pulse.length + 1 : 0))
      const history = (live ? hp.steps.slice(0, -1) : hp.steps).slice(-HISTORY)
      const [b1, b2, b3] = barParts(hp.phase, cw, clk.tick, hp.seat)
      const barColor = hp.phase === 'failed' ? BAD : hue.key
      const rowW = cw - TAG_W
      // About 6.5 CSS pixels a column, as the pet's 48 pixels fill its 8.
      const barPx = Math.max(60, Math.floor(cw * 6.5))

      return (
        <Box
          key={`card-${hp.id}`}
          flexDirection="row"
          width={width}
          marginBottom={1}
          borderStyle="round"
          borderColor={lit ? ACCENT : hp.phase === 'failed' ? BAD : hue.key}
          borderDimColor={!live && !lit}
          paddingX={1}
          gap={0}
        >
          {pet(hp)}
          <Box flexDirection="column" width={cw}>
            <Box flexDirection="row" justifyContent="space-between" width={cw}>
              <Box width={cw - 2}>
                <Text weight="bold" wrap="truncate-end">
                  {cut(hp.description, cw - 2)}
                </Text>
              </Box>
              <Text weight="bold" color={markColor}>{mark}</Text>
            </Box>
            <Box flexDirection="row" justifyContent="space-between" width={cw}>
              <Text dimColor wrap="truncate-end">
                {cut(who, Math.max(4, cw - meta.length - 1))}
              </Text>
              <Text dimColor wrap="truncate-end">
                {meta}
              </Text>
            </Box>
            <Box flexDirection="row" width={cw}>
              {live ? <Text weight="bold" color={ACCENT}>{`${spin} `}</Text> : null}
              <Box width={leadW}>
                <Text weight={live ? 'bold' : undefined} color={live ? ACCENT : hp.phase === 'done' ? GOOD : BAD} wrap="truncate-end">
                  {cut(lead, leadW)}
                </Text>
              </Box>
              {live ? <Text color={ACCENT}>{` ${pulse}`}</Text> : null}
            </Box>
            {!isOpen &&
              history.map((st, i) => (
                <Text key={`h-${hp.id}-${i}`} dimColor wrap="truncate-end">
                  {cut(`  ${st.live}`, cw)}
                </Text>
              ))}
            {chips(hp, 'to', cw)}
            {chips(hp, 'from', cw)}
            {Svg ? (
              <Box key={`bar-${hp.id}`} width={cw}>
                <Svg
                  source={cardBarSvg(hp.phase, hue.color, barPx, hp.seat)}
                  alt={live ? 'Working' : hp.phase === 'done' ? 'Done' : 'Stopped'}
                  width={barPx}
                  height={CARD_BAR_H}
                />
              </Box>
            ) : (
              <Text key={`bar-${hp.id}`} wrap="truncate-end">
                <Text dimColor>{b1}</Text>
                <Text color={barColor}>{b2}</Text>
                <Text dimColor>{b3}</Text>
              </Text>
            )}
            {hp.steps.length ? (
              <Button key={`steps-${hp.id}`} plain dimColor onPress={() => undefined}>
                {isOpen ? '▾ Hide steps' : `▸ All ${hp.count} step${hp.count === 1 ? '' : 's'}`}
              </Button>
            ) : null}
            {isOpen ? (
              <Box key={`list-${hp.id}`} flexDirection="column" width={cw}>
                {hp.count > hp.steps.length ? <Text dimColor>{`${hp.count - hp.steps.length} older steps not kept`}</Text> : null}
                {hp.steps.map((st, i) => {
                  const [label, dim] = fitRow(st.label, st.dim, rowW)
                  return (
                    <Box key={`s-${hp.id}-${i}`} flexDirection="row" width={cw}>
                      <Box width={TAG_W}>
                        <Text color={KIND_COLOR[st.kind]}>{st.kind}</Text>
                      </Box>
                      <Box width={rowW}>
                        <Text wrap="truncate-end">
                          {label}
                          {dim ? <Text dimColor>{`  ${dim}`}</Text> : null}
                        </Text>
                      </Box>
                    </Box>
                  )
                })}
              </Box>
            ) : null}
          </Box>
        </Box>
      )
    }

    // A heading per group: a filled bar the full width, its title and count in bold, and an
    // arrow that folds the group.
    const group = (id: string, title: string, members: Helper[], fill: ThemeKey, ink: ThemeKey) => {
      if (!members.length) return null
      const folded = view.folded.includes(id)
      const label = `${title} · ${members.length}`
      const room = Math.max(label.length, width - 6)
      return (
        <Box key={`grp-${id}`} flexDirection="column" width={width} marginTop={1}>
          <Box key={`head-${id}`} flexDirection="row" width={width} backgroundColor={fill} paddingX={1} marginBottom={1}>
            <Button key={`group-${id}`} plain onPress={() => undefined}>
              <Text weight="bold" color={ink} backgroundColor={fill}>
                {folded ? '▸ ' : '▾ '}
              </Text>
            </Button>
            <Text weight="bold" color={ink} backgroundColor={fill} wrap="truncate-end">
              {label.padEnd(room)}
            </Text>
          </Box>
          {folded ? null : members.map(card)}
        </Box>
      )
    }

    // One compact card per Jev call: the badge and its pick, what ran, and the judge's verdict.
    const jevCard = (c: JevCall) => {
      const live = c.phase === 'asking' || c.phase === 'judging'
      const jw = width - 4
      const pct = c.tier && c.probs ? ` ${Math.round((c.probs[c.tier] ?? 0) * 100)}%` : ''
      const head =
        c.phase === 'asking'
          ? 'asking…'
          : c.phase === 'skipped'
            ? `skipped${c.skipReason ? ` (${c.skipReason})` : ''}`
            : c.tier
              ? `${c.tier}${pct}${c.effort ? ` · ${c.effort}` : ''}`
              : 'no pick'
      const ran = `${c.phase === 'asking' ? 'chose' : 'ran'} ${c.chosen}${c.chosenEffort ? ` · ${c.chosenEffort}` : ''}`
      const verdict = c.phase === 'judging' ? 'judging…' : c.judge ? `judge (${c.judge.model}): ${c.judge.tier} · ${c.judge.effort} — ${c.judge.reason}` : ''
      const text = `${cut(c.description, Math.max(8, jw - 6 - head.length - 4))} → ${head}`
      return (
        <Box key={`jev-${c.id}`} flexDirection="column" width={width} borderStyle="round" borderColor="suggestion" borderDimColor={!live} paddingX={1} marginBottom={1}>
          <Box key={`jev-head-${c.id}`} flexDirection="row" gap={1} width={jw}>
            <Text weight="bold" color={INK} backgroundColor="suggestion">
              {' Jev '}
            </Text>
            <Text weight={live ? 'bold' : undefined} color={live ? 'suggestion' : undefined} wrap="truncate-end">
              {`· ${text}`}
            </Text>
          </Box>
          <Text key={`jev-ran-${c.id}`} dimColor wrap="truncate-end">
            {cut(ran, jw)}
          </Text>
          {verdict ? (
            <Text key={`jev-verdict-${c.id}`} color={c.phase === 'judging' ? 'suggestion' : undefined} dimColor={c.phase !== 'judging'} wrap="truncate-end">
              {cut(verdict, jw)}
            </Text>
          ) : null}
        </Box>
      )
    }

    // The groups build the cards, and the cards register their pets: draw them before the frame timer looks.
    const groups = [group('running', 'Running', running, GOOD, INK), group('finished', 'Finished', finished, WARN, INK), group('stopped', 'Stopped', stopped, BAD, INK)]
    // Starts the frame timer when this draw mounted the first running pet; a no-op otherwise.
    syncTimers($)

    return (
      <Box flexDirection="column" width={width}>
        <Box key="header" flexDirection="row" justifyContent="space-between" gap={1} width={width} marginBottom={1}>
          <Text weight="bold" color={running.length ? ACCENT : list.length ? GOOD : undefined} wrap="truncate-end">
            {list.length ? `${list.length} subagent${list.length === 1 ? '' : 's'} in this chat` : 'No subagents yet'}
          </Text>
          <Button key="hide" label="Hide" dimColor onPress={() => undefined} />
        </Box>
        {tiles.length ? (
          <Box key="tiles" flexDirection="row" gap={1} width={width} marginBottom={1}>
            {tiles.map(t => (
              <Box key={`tile-${t.label}`} flexDirection="column" borderStyle="round" paddingX={1} width={tileW}>
                <Text dimColor wrap="truncate-end">
                  {t.label}
                </Text>
                <Text weight="bold" color={ACCENT} wrap="truncate-end">
                  {t.value}
                </Text>
              </Box>
            ))}
          </Box>
        ) : null}
        {calls.map(jevCard)}
        {list.length ? null : <Text dimColor>Cards show up here when Claude starts a subagent.</Text>}
        {groups}
        {e.props.isFocused === false ? (
          <Text key="focus-hint" dimColor wrap="truncate-end">
            Focus this pane to press its buttons, or use /helpers hide, fold, steps, goto or motion.
          </Text>
        ) : null}
      </Box>
    )
  })

  // The task list above the prompt: every step, the ones in progress flashing.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (off || e.props.hasSurvey) return next(e)
    const { value: isOff = false } = await $.state.get(OFF)
    const { value: isHidden = false } = await $.state.get(HIDDEN)
    const { value: planned = null } = await $.state.get(PLAN)
    const { value: calls = [] } = await $.state.get(JEV)
    const asking = calls.filter(c => c.phase === 'asking')
    const showPlan = !!planned && planned.shown && planned.steps.length > 0
    if (isOff || isHidden || hidden || (!showPlan && !asking.length)) return next(e)
    const p: BandPlan = showPlan ? planned : { title: '', steps: [], shown: false }
    // The other mods' bands draw above this one. Claude Code's own placeholder is never nested.
    const drawn = await Promise.resolve(next(e)).catch(() => null)
    const rest = drawn && typeof drawn === 'object' && (drawn as { type?: string }).type !== 'engine' ? drawn : null
    const { Box, Text, Button } = $.ui.resolve(e)
    const cols = typeof e.props.bodyColumns === 'number' && e.props.bodyColumns > 0 ? Math.floor(e.props.bodyColumns) : 0
    const n = p.steps.length
    const done = doneCount(p.steps)
    const pct = `${Math.round((done / n) * 100)}%`
    const label = `Tasks ${done}/${n}`
    // The shimmer clock ticks only while a step is in progress; each tick flips the flash.
    const { value: tick = 0 } = await $.state.get(SHIM)
    const flash = tick % 2 === 0
    const w = cols || (e.surface === 'terminal' ? BAR_FALLBACK : 100)
    const titleW = Math.max(6, w - label.length - pct.length - 10)
    // Every step fits unless the band's row budget is smaller: then a window from just before the step in progress.
    // The window spends one row each on the header, "earlier done" and "more".
    const cap = typeof e.props.maxRows === 'number' && e.props.maxRows > 0 ? Math.floor(e.props.maxRows) : Infinity
    const room = n + 1 <= cap ? n : Math.max(1, cap - 3)
    const live = p.steps.findIndex(st => st.status === 'in_progress')
    const open = live >= 0 ? live : p.steps.findIndex(st => st.status !== 'completed')
    const from = n <= room ? 0 : Math.max(0, Math.min((open < 0 ? n : open) - (room > 1 ? 1 : 0), n - room))
    const shown = p.steps.slice(from, from + room)
    const more = n - from - shown.length
    return (
      <Box flexDirection="column">
        {rest as never}
        {asking.length ? (
          <Box key="jev-asking" flexDirection="row" gap={1}>
            <Text weight="bold" color={INK} backgroundColor="suggestion">
              {' Jev '}
            </Text>
            <Text color="suggestion" wrap="truncate-end">
              {cut(asking.length === 1 ? `asking about ${asking[0]!.description}…` : `asking about ${asking.length} calls…`, Math.max(8, w - 6))}
            </Text>
          </Box>
        ) : null}
        {showPlan ? (
        <Box key="plan-band" flexDirection="column">
          <Box key="plan-row" flexDirection="row" gap={1}>
            <Text color={PURPLE}>●</Text>
            <Text weight="bold" wrap="truncate-end">
              {cut(p.title, titleW)}
            </Text>
            <Text weight="bold" color={PURPLE} wrap="truncate-end">
              {label}
            </Text>
            <Text dimColor>{pct}</Text>
            <Button key="plan-dismiss" label="✕" plain dimColor role="dismiss" onPress={() => undefined} />
          </Box>
          {from ? (
            <Text key="plan-earlier" dimColor>
              {`✓ ${from} earlier done`}
            </Text>
          ) : null}
          {shown.map((st, k) => {
            const i = from + k
            return st.status === 'in_progress' ? (
              <Text key={`step-${i}`} weight="bold" color={PURPLE} dimColor={!flash} wrap="truncate-end">
                {cut(`▶ ${st.text}`, w)}
              </Text>
            ) : st.status === 'completed' ? (
              <Text key={`step-${i}`} color={GOOD} dimColor wrap="truncate-end">
                {cut(`✓ ${st.text}`, w)}
              </Text>
            ) : (
              <Text key={`step-${i}`} dimColor wrap="truncate-end">
                {cut(`○ ${st.text}`, w)}
              </Text>
            )
          })}
          {more > 0 ? (
            <Text key="plan-more" dimColor>
              {`○ ${more} more`}
            </Text>
          ) : null}
        </Box>
        ) : null}
      </Box>
    )
  })
}
