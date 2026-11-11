// The terminal card's avatar, context bar and sparkline: Raster shaders, no engine calls.
//
// Everything here turns data into the base64 cell grid a `Raster` takes, so it is testable on
// its own. The avatar is the Claude crab, 18×5 pixels, drawn two by two pixels a cell in quadrant
// blocks with a one-cell prop beside it. The crab and the way it is packed follow
// pvjbuilds/crab-buddy (MIT, github.com/pvjbuilds/crab-buddy, hooks/term.tsx).

import { encodeWords } from './sprite'

export const DEFAULT_COLOR = 0x01000000
export const AVATAR_COLUMNS = 14
export const AVATAR_ROWS = 3

const FULL_BLOCK = 0x2588
const LIGHT_SHADE = 0x2591
const BRAILLE_BASE = 0x2800
const BAR_BACKGROUND = 0x27272a
const TRACK_FOREGROUND = 0x3f3f46
const TRACK_BACKGROUND = 0x18181b
// A finished agent breathes at a quarter of its running speed.
export const FINISHED_SPEED = 0.25

export type TaskKind = 'verify' | 'handle' | 'default'
export type ModelTier = 'haiku' | 'sonnet' | 'opus'
export type EffortLevel = 'low' | 'medium' | 'high'

// `verify:` and `handle:` name the job; anything else (deploy:, no prefix) is the default silhouette.
export const taskKindOf = (description: string): TaskKind => {
  const prefix = /^\s*([a-z]+)\s*:/i.exec(description)?.[1]?.toLowerCase()
  return prefix === 'verify' || prefix === 'handle' ? prefix : 'default'
}

// Fable and anything unknown draw with the top ramp.
export const modelTierOf = (model: string): ModelTier => {
  const id = model.toLowerCase()
  return id.includes('haiku') ? 'haiku' : id.includes('sonnet') ? 'sonnet' : 'opus'
}

// xhigh and max are the busiest the card shows; an unreported effort reads as medium.
export const effortLevelOf = (effort: string | undefined): EffortLevel => {
  if (effort === 'low') return 'low'
  if (effort === 'high' || effort === 'xhigh' || effort === 'max') return 'high'
  return 'medium'
}

export const TASK_STYLE: Record<TaskKind, { accent: string; prefix: string }> = {
  verify: { accent: '#06b6d4', prefix: '◈' },
  handle: { accent: '#10b981', prefix: '⚙' },
  default: { accent: '#8b5cf6', prefix: '🚀' },
}

export const EFFORT_STYLE: Record<EffortLevel, { borderStyle: 'round' | 'double'; badge: string; color: string }> = {
  low: { borderStyle: 'round', badge: '◦ LOW', color: '#94a3b8' },
  medium: { borderStyle: 'round', badge: '◈ MED', color: '#38bdf8' },
  high: { borderStyle: 'double', badge: '⚡ HIGH', color: '#f59e0b' },
}

export const EFFORT_SPEED: Record<EffortLevel, number> = { low: 0.0015, medium: 0.0035, high: 0.0075 }

// Eight stops, deep to bright.
export const MODEL_RAMPS: Record<ModelTier, readonly number[]> = {
  haiku: [0x0f172a, 0x164e63, 0x0891b2, 0x06b6d4, 0x22d3ee, 0x67e8f9, 0xccfbf1, 0xf8fafc],
  sonnet: [0x1e1b4b, 0x312e81, 0x4338ca, 0x6366f1, 0x818cf8, 0xa855f7, 0xe9d5ff, 0xf8fafc],
  opus: [0x27170a, 0x78350f, 0xb45309, 0xd97706, 0xf59e0b, 0xfbbf24, 0xfef08a, 0xffffff],
}

const stop = (ramp: readonly number[], index: number): number => ramp[Math.max(0, Math.min(ramp.length - 1, index))] ?? DEFAULT_COLOR

// One [codePoint, foreground, background] triplet per cell, row-major, as the Raster's base64.
export function packRasterCells(columns: number, rows: number, fillCell: (column: number, row: number) => readonly [number, number, number]): string {
  const words = new Uint32Array(columns * rows * 3)
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      words.set(fillCell(column, row), (row * columns + column) * 3)
    }
  }
  return encodeWords(words)
}

const CRAB_ORANGE = 0xd97757
const GREEN = 0x1d9e75
const YELLOW = 0xf5c542
const RED = 0xe24b4a
const BROWN = 0x7a4a26
const GREY = 0x8e929a
const BRICK = 0xb5532f
const BRICK_DARK = 0x93401f
const WHITE = 0xf4f3ee
const DIM = 0x9a9890
const AMBER = 0xef9f27
const BLUE = 0x378add
const SCREEN = 0x2c2c2a
const LIGHT = 0xb4b2a9
const CREAM = 0xe8dcc8
const WOOD = 0xc8a165
const DARK_WOOD = 0x8a5a30
const GLASS = 0x9ab5c4
const SKY = 0x85b7eb
const PINK = 0xd4537e
const BOARD = 0x3b4a3f
const LAMP_OFF = 0x444441
const PAINT_WALL = 0x4a4a48
// The Claude crab, one character a pixel: 18×5, standing at pixels 10-27 of the 28×6 canvas.
const CRAB = ['...############...', '...##.######.##...', '.################.', '...############...', '....#.#....#.#....']
const STEP = '...#.#......#.#...'
const QUADRANTS = ' ▗▖▄▝▐▞▟▘▚▌▙▀▜▛█'
const CANVAS_WIDTH = AVATAR_COLUMNS * 2
const CANVAS_HEIGHT = AVATAR_ROWS * 2

type Rect = [x: number, y: number, width: number, height: number, color: number]
// A one-cell prop: its cell, character and colour.
type Glyph = [cx: number, cy: number, ch: string, color: number]
type Scene = (f: number, accent: number) => Look
type Look = { dx?: number; dy?: number; eyes?: number | 'shut'; legs?: boolean; claw?: boolean; rects?: Rect[]; glyphs?: Glyph[] }
// What an agent is doing right now, from the tool it last called. Each has its own animation.
export type Activity = 'think' | 'read' | 'build' | 'shell' | 'test' | 'web' | 'sub' | 'gear' | 'install' | 'git'
export type Mood = Activity | 'ship' | 'done' | 'dizzy'

const on = (f: number, n: number, k: number): boolean => f % n < k

// The model's own tools are named; shell commands are told apart by their first words, and only
// the class is kept, never the command.
const TEST_COMMAND = /\b(test|pytest|vitest|jest|mocha|rspec|tsc|lint)\b/i
const INSTALL_COMMAND = /\b(install|npm i|pip|apt|brew|choco|winget|bun add)\b/i
export function activityOf(tool: string, input: unknown): Activity {
  const raw = (input as { command?: unknown } | null)?.command
  const command = typeof raw === 'string' ? raw : ''
  if (tool === 'Read' || tool === 'Grep' || tool === 'Glob' || tool === 'NotebookRead') return 'read'
  if (tool === 'Edit' || tool === 'Write' || tool === 'NotebookEdit' || tool === 'MultiEdit') return 'build'
  if (tool === 'Agent' || tool === 'Task') return 'sub'
  if (tool === 'WebFetch' || tool === 'WebSearch' || /firecrawl|searxng|chrome|browse|crawl/i.test(tool)) return 'web'
  if (tool === 'TodoWrite' || tool === 'ExitPlanMode' || tool === 'EnterPlanMode') return 'think'
  if (tool === 'Bash' || tool === 'PowerShell') {
    if (/^\s*git\b/.test(command)) return 'git'
    if (TEST_COMMAND.test(command)) return 'test'
    if (INSTALL_COMMAND.test(command)) return 'install'
    return 'shell'
  }
  return 'gear'
}

// Scenes, several to an activity. Each is a function of the frame and the model's accent colour;
// the first of each list is the one the activity has always drawn. Props live at the left of the
// 28×6 pixel canvas (the crab stands from pixel 10), in the two top corners, or on the ground row.
const lamp = (on_: boolean, color: number): number => (on_ ? color : LAMP_OFF)

const THINK: Scene[] = [
  (f, accent) => ({
    eyes: on(f, 8, 4) ? -1 : 1,
    glyphs: [[3, 0, '·', DIM], ...(f % 8 > 1 ? [[2, 0, '•', accent] as Glyph] : []), ...(f % 8 > 3 ? [[1, 0, '●', accent] as Glyph] : [])],
  }),
  f => ({ rects: [[26, 0, 2, 2, on(f, 6, 4) ? YELLOW : DIM], [26, 2, 1, 1, GREY]] }),
  (f, accent) => ({ eyes: on(f, 8, 4) ? -1 : 1, glyphs: [[13, 0, ['✢', '✣', '✤', '✥'][f % 4] ?? '✢', accent]] }),
  f => ({
    rects: [[0, 0, 7, 4, BOARD], [1, 1, 3, 1, WHITE], [1, 2, 1 + (f % 4), 1, WHITE], [0, 4, 1, 2, WOOD], [6, 4, 1, 2, WOOD]],
  }),
  (f, accent) => ({ eyes: on(f, 6, 3) ? -1 : 1, rects: [[1, 2, 3, 3, accent], [on(f, 6, 3) ? 5 : 4, 2, 3, 3, YELLOW]] }),
]

const READ: Scene[] = [
  (f, accent) => ({ eyes: on(f, 4, 2) ? -1 : 1, glyphs: [[on(f, 8, 4) ? 3 : 4, 1, '◎', accent]] }),
  f => ({
    eyes: on(f, 4, 2) ? -1 : 1,
    rects: [[1, 1, 4, 3, WHITE], [5, 1, 4, 3, CREAM], [2, on(f, 6, 3) ? 2 : 3, 2, 1, GREY], [6, on(f, 6, 3) ? 3 : 2, 2, 1, GREY], [1, 4, 8, 1, BROWN]],
  }),
  f => ({
    rects: [[1, 0, 5, 1, BROWN], [1, 1, 5, 4, CREAM], [2, 1 + (f % 4), 3, 1, GREY], [2, 1 + ((f + 2) % 4), 2, 1, GREY]],
  }),
  f => ({ dy: on(f, 8, 2) ? 1 : 0, rects: [[0, 1, 8, 4, CREAM], [1, 1, 6, 1, GREY], [1, 2, 2, 2, LIGHT], [4, 2, 3, 1, GREY], [4, 4, 3, 1, GREY]] }),
]

const BUILD: Scene[] = [
  (f, accent) => ({
    dy: f % 4 === 2 ? 1 : 0,
    rects: [
      [1, 5, 4, 1, BRICK],
      [5, 5, 4, 1, BRICK_DARK],
      ...(f % 16 >= 4 ? [[1, 4, 4, 1, BRICK_DARK] as Rect] : []),
      ...(f % 16 >= 8 ? [[5, 4, 4, 1, BRICK] as Rect] : []),
      ...(f % 16 >= 12 ? [[3, 3, 4, 1, BRICK_DARK] as Rect] : []),
      [8, f % 4 < 2 ? 0 : 2, 2, 1, accent],
      [9, f % 4 < 2 ? 1 : 3, 1, 2, BROWN],
    ],
  }),
  (f, accent) => ({
    dy: f % 4 === 2 ? 1 : 0,
    rects: [[1, 3, 6, 1, GREY], [2, 4, 4, 1, SCREEN], [3, 5, 2, 1, SCREEN], [7, f % 4 < 2 ? 0 : 2, 2, 1, accent]],
    glyphs: [[1, 1, f % 4 < 2 ? '·' : '✦', AMBER]],
  }),
  f => ({
    rects: [[0, 4, 9, 1, WOOD], [1, 5, 1, 1, BROWN], [8, 5, 1, 1, BROWN], [on(f, 2, 1) ? 1 : 3, 3, 5, 1, GREY], [on(f, 2, 1) ? 6 : 8, 3, 1, 1, BROWN]],
    glyphs: f % 2 ? [[1, 2, '·', WOOD]] : [],
  }),
  (f, accent) => {
    const h = 1 + Math.floor((f % 12) / 2)
    return { rects: [[0, 0, 5, 6, PAINT_WALL], [0, 6 - h, 5, h, accent], [5, Math.max(0, 5 - h), 2, 2, WHITE]] }
  },
]

const SHELL: Scene[] = [
  (f, accent) => ({
    legs: on(f, 2, 1),
    rects: [
      [1, 0, 7, 4, SCREEN],
      [0, 4, 9, 1, GREY],
      ...(f % 8 >= 2 ? [[2, 1, 3, 1, GREEN] as Rect] : []),
      ...(f % 8 >= 4 ? [[2, 2, 4, 1, accent] as Rect] : []),
      ...(f % 8 >= 6 ? [[2, 3, 2, 1, AMBER] as Rect] : []),
      ...(on(f, 2, 1) ? [[6, 3, 1, 1, WHITE] as Rect] : []),
    ],
  }),
  (f, accent) => ({
    legs: on(f, 2, 1),
    rects: [[0, 0, 9, 5, SCREEN], [0, 0, 9, 1, GREY], [1, 2, 1, 1, accent], [3, 2, 1 + (f % 5), 1, GREEN], [3 + (f % 5) + 1, 2, 1, 1, on(f, 2, 1) ? WHITE : SCREEN]],
  }),
  (f, accent) => ({ rects: [[1, 0, 6, 3, SCREEN], [2, 1, 2 + (f % 3), 1, GREEN], [2, 2, 1, 1, accent], [3, 3, 2, 1, GREY], [2, 4, 4, 1, GREY]] }),
]

const TEST: Scene[] = [
  (f, accent) => ({ claw: on(f, 4, 2), glyphs: [[13, 0, on(f, 8, 6) ? '…' : '✓', on(f, 8, 6) ? DIM : accent]] }),
  f => ({
    claw: on(f, 6, 2),
    rects: [[3, 0, 2, 1, GREY], [3, 1, 2, 1, GLASS], [2, 2, 4, 1, GLASS], [1, 3, 6, 2, GLASS], [2, 3, 4, 1, GREEN], [1, 4, 6, 1, GREEN], [2 + (f % 3) * 2, 3, 1, 1, WHITE]],
  }),
  f => ({
    rects: [[1, 0, 6, 6, BROWN], [2, 1, 4, 4, WHITE], [3, 0, 2, 1, GREY], ...[0, 1, 2].map((k): Rect => [3, 1 + k, 2, 1, f % 12 >= k * 4 ? GREEN : LIGHT])],
  }),
  f => ({
    rects: [[2, 0, 3, 5, SCREEN], [3, 0, 1, 1, lamp(f % 12 < 4, RED)], [3, 2, 1, 1, lamp(f % 12 >= 4 && f % 12 < 8, AMBER)], [3, 4, 1, 1, lamp(f % 12 >= 8, GREEN)], [3, 5, 1, 1, GREY]],
  }),
  f => ({ claw: on(f, 6, 2), rects: [[4, 0, 2, 4, GLASS], [3, 4, 4, 2, RED], [4, 3 - (f % 4), 2, 1 + (f % 4), RED]] }),
]

const WEB: Scene[] = [
  (f, accent) => ({
    glyphs: [[2, 1, '·', GREY], ...(f % 6 >= 2 ? [[3, 1, '∙', GREY] as Glyph] : []), ...(f % 6 >= 4 ? [[4, 1, '•', GREY] as Glyph] : []), [0, 1, '◍', accent]],
  }),
  (f, accent) => ({
    rects: [[2, 0, 4, 1, accent], [1, 1, 6, 4, accent], [2, 5, 4, 1, accent], [2 + (f % 3), 1, 2, 1, GREEN], [1 + ((f + 1) % 3), 3, 2, 1, GREEN], [2, 4, 2, 1, GREEN]],
  }),
  (f, accent) => ({
    rects: [[4, 1, 1, 5, GREY], [4, 0, 1, 1, RED]],
    glyphs: [[3, 0, on(f, 4, 2) ? ')' : '·', SKY], [2, 0, on(f, 4, 3) ? ')' : ' ', accent]],
  }),
]

const SUB: Scene[] = [
  f => {
    const x = [1, 2, 3, 2][Math.floor(f / 2) % 4] ?? 1
    return { glyphs: [[x, 2, '▟', CRAB_ORANGE], [x + 1, 2, '▙', CRAB_ORANGE]] }
  },
  f => {
    const x = [1, 2, 3, 2][Math.floor(f / 2) % 4] ?? 1
    return { rects: [[x * 2, 3, 3, 1, BROWN], [x * 2 + 1, 3, 1, 1, YELLOW]], glyphs: [[x, 2, '▟', CRAB_ORANGE], [x + 1, 2, '▙', CRAB_ORANGE]] }
  },
  f => {
    const a = [1, 2, 3, 2][Math.floor(f / 2) % 4] ?? 1
    const b = [3, 2, 1, 2][Math.floor(f / 2) % 4] ?? 3
    return { glyphs: [[a, 2, '▟', CRAB_ORANGE], [a + 1, 2, '▙', CRAB_ORANGE], [b, 1, '▟', CRAB_ORANGE], [b + 1, 1, '▙', CRAB_ORANGE]] }
  },
]

const GEAR: Scene[] = [
  (f, accent) => ({ dy: f % 2, glyphs: [[2, 1, on(f, 2, 1) ? '┼' : '╳', GREY], [3, 0, on(f, 2, 1) ? '╳' : '┼', accent]] }),
  f => {
    const d = f % 4 < 2 ? 0 : 1
    return { rects: [[1, 0, 1, 6, YELLOW], [1, 0, 6, 1, YELLOW], [6, 1, 1, 1 + d, GREY], [5, 2 + d, 3, 2, RED]] }
  },
  (f, accent) => ({
    rects: [[1, 2, 3, 3, GREY], [2, 1, 1, 1, GREY], [2, 5, 1, 1, GREY], [0, 3, 1, 1, GREY], [4, 3, 1, 1, GREY], [2, 3, 1, 1, on(f, 2, 1) ? SCREEN : accent]],
    glyphs: on(f, 4, 2) ? [[3, 0, '✦', AMBER]] : [],
  }),
]

const INSTALL: Scene[] = [
  f => ({ legs: on(f, 2, 1), glyphs: [[3, on(f, 4, 2) ? 1 : 2, '▣', BROWN]] }),
  f => ({
    rects: [[1, 3, 7, 3, BROWN], [4, 3, 1, 3, YELLOW], [0, on(f, 8, 4) ? 2 : 1, 9, 1, DARK_WOOD]],
    glyphs: on(f, 8, 4) && on(f, 4, 2) ? [[2, 0, '✦', YELLOW]] : [],
  }),
  (f, accent) => ({ rects: [[0, 2, 9, 3, GREY], [1, 3, 7, 1, SCREEN], [1, 3, 1 + (f % 7), 1, accent]] }),
  f => ({ rects: [[1, 0, 6, 1, PINK], [0, 1, 8, 1, PINK], [1, 2, 1, 1, LIGHT], [6, 2, 1, 1, LIGHT], [on(f, 6, 3) ? 3 : 4, 3, 2, 2, BROWN]] }),
]

// The same scenes as a git push: a flag, then a rocket, a stamp and a branch.
const GIT: Scene[] = [
  (f, accent) => ({ glyphs: [[2, 1, '│', GREY], [2, 2, '│', GREY], [2, 0, '▕', GREY], [3, 0, on(f, 2, 1) ? '▶' : '▷', accent]] }),
  f => {
    const up = f % 8 >= 4 ? 0 : 1
    return { rects: [[0, 5, 9, 1, GREY], [3, up, 2, 1, RED], [3, up + 1, 2, 3, WHITE], [3, up + 4, 2, 1, AMBER], [on(f, 2, 1) ? 3 : 4, up + 4, 1, 1, YELLOW]] }
  },
  f => {
    const d = f % 8 >= 4 ? 1 : 0
    return { rects: [[0, 5, 9, 1, WHITE], [3, d, 2, 2, BROWN], [2, 2 + d, 4, 1, RED], ...(d ? [[2, 5, 4, 1, GREEN] as Rect] : [])] }
  },
  f => ({
    rects: [[3, 0, 1, 6, GREY], [2, 4, 3, 1, GREEN], ...(f % 12 >= 4 ? [[2, 2, 3, 1, GREEN] as Rect] : []), ...(f % 12 >= 8 ? [[2, 0, 3, 1, YELLOW] as Rect] : [])],
  }),
]

const DONE: Scene[] = [
  f => ({ dy: on(f, 4, 2) ? 0 : 1, claw: on(f, 4, 2), glyphs: [[13, 0, '✓', GREEN]] }),
  f => ({
    claw: on(f, 4, 2),
    rects: [[3, 0, 1, 6, GREY], [4, 0, 1, 1, WHITE], [5, 0, 1, 1, SCREEN], [4, 1, 1, 1, SCREEN], [5, 1, 1, 1, WHITE]],
    glyphs: [[13, 0, '✓', GREEN]],
  }),
  f => ({ rects: [[1, 1, 5, 2, YELLOW], [2, 3, 3, 1, YELLOW], [1, 4, 5, 1, YELLOW]], glyphs: [[on(f, 4, 2) ? 0 : 6, 0, '✦', WHITE], [13, 0, '✓', GREEN]] }),
  f => ({
    dy: on(f, 4, 2) ? 0 : 1,
    glyphs: [[1 + (f % 3), 0, '·', YELLOW], [4 - (f % 3), 1, '•', PINK], [13, 0, '✓', GREEN], [6 + (f % 2), 2, '·', SKY]],
  }),
]

const DIZZY: Scene[] = [
  f => ({ dx: on(f, 4, 2) ? 0 : 1, glyphs: [[on(f, 2, 1) ? 5 : 13, 0, '✶', YELLOW]] }),
  f => ({ dx: on(f, 4, 2) ? 0 : 1, glyphs: [[5 + (f % 4) * 2, 0, '★', YELLOW], [13 - (f % 4) * 2, 0, '·', YELLOW]] }),
  f => ({ glyphs: [[13, 0, on(f, 4, 3) ? '✖' : ' ', RED]] }),
]

const LOOKS: Record<Mood, Scene[]> = {
  think: THINK,
  read: READ,
  build: BUILD,
  shell: SHELL,
  test: TEST,
  web: WEB,
  sub: SUB,
  gear: GEAR,
  install: INSTALL,
  git: GIT,
  // A savvy-flow deploy that has not called a tool yet: a rocket or a flag.
  ship: [GIT[1] as Scene, GIT[0] as Scene],
  done: DONE,
  dizzy: DIZZY,
}

// How many scenes a mood has, and how long one holds while its activity goes on.
export const sceneCount = (mood: Mood): number => LOOKS[mood].length
export const VARIANT_MS = 6000
export const sceneIndexOf = (count: number, seed: number, tMs: number, isFinished: boolean): number =>
  (Math.abs(Math.trunc(seed)) + (isFinished ? 0 : Math.floor(tMs / VARIANT_MS))) % count

// Until the agent's first tool call, the task prefix picks the scene.
const MOOD_OF_TASK: Record<TaskKind, Mood> = { verify: 'read', handle: 'build', default: 'ship' }

// How long a frame holds: a busier agent moves faster. A finished one moves at FINISHED_SPEED.
const FRAME_MS: Record<EffortLevel, number> = { low: 200, medium: 100, high: 60 }

// The crab and its props as AVATAR_ROWS rows of AVATAR_COLUMNS cells. Pure, so tests read it as cells.
function drawCrab(look: Look): (readonly [number, number, number])[][] {
  const pixels: (number | undefined)[][] = Array.from({ length: CANVAS_HEIGHT }, () => Array.from({ length: CANVAS_WIDTH }, () => undefined))
  const put = (x: number, y: number, color: number) => {
    if (x >= 0 && x < CANVAS_WIDTH && y >= 0 && y < CANVAS_HEIGHT) (pixels[y] as (number | undefined)[])[x] = color
  }
  for (const [x, y, width, height, color] of look.rects ?? []) {
    for (let j = 0; j < height; j++) for (let i = 0; i < width; i++) put(x + i, y + j, color)
  }
  const eyes = look.eyes ?? 0
  CRAB.forEach((source, y) => {
    let row = source
    // Eyes are holes at 5 and 12, shifted a pixel to look aside, and filled when shut.
    if (y === 1) row = [...row].map((_, x) => (x < 3 || x > 14 || (eyes !== 'shut' && (x === 5 + eyes || x === 12 + eyes)) ? '.' : '#')).join('')
    if (y === 4 && look.legs) row = STEP
    if (look.claw && y === 1) row = `${row.slice(0, 15)}##.`
    if (look.claw && y === 2) row = '.##############...'
    ;[...row].forEach((c, x) => {
      if (c === '#') put(10 + (look.dx ?? 0) + x, (look.dy ?? 0) + y, CRAB_ORANGE)
    })
  })
  const rows = Array.from({ length: AVATAR_ROWS }, (_, cy) =>
    Array.from({ length: AVATAR_COLUMNS }, (_, cx): readonly [number, number, number] => {
      const quad = [pixels[cy * 2]?.[cx * 2], pixels[cy * 2]?.[cx * 2 + 1], pixels[cy * 2 + 1]?.[cx * 2], pixels[cy * 2 + 1]?.[cx * 2 + 1]]
      const counts = new Map<number, number>()
      for (const c of quad) if (c !== undefined) counts.set(c, (counts.get(c) ?? 0) + 1)
      const [a, b] = [...counts.entries()].sort((p, r) => r[1] - p[1]).map(e => e[0])
      if (a === undefined) return [0x20, DEFAULT_COLOR, DEFAULT_COLOR]
      const mask = quad.reduce((m, c, i) => (c === a ? m | (8 >> i) : m), 0)
      return [QUADRANTS.codePointAt(mask) ?? 0x20, a, b ?? DEFAULT_COLOR]
    }),
  )
  for (const [cx, cy, ch, color] of look.glyphs ?? []) {
    if (rows[cy]?.[cx]) (rows[cy] as (readonly [number, number, number])[])[cx] = [ch.codePointAt(0) ?? 0x20, color, DEFAULT_COLOR]
  }
  return rows
}

// `tMs` is any clock that only moves forward. A running agent acts out its `activity`; a failed
// one is dizzy; a finished one waves slowly. An activity has several scenes: `variantSeed` picks
// the first (the agent's step count, or a stable number for a finished one) and a running agent
// moves on to the next every VARIANT_MS, so a long call does not repeat one scene.
export function drawAgentAvatar(
  task: TaskKind,
  model: ModelTier,
  effort: EffortLevel,
  isFinished: boolean,
  tMs: number,
  isFailed = false,
  activity?: Activity,
  variantSeed = 0,
): string {
  const mood: Mood = isFailed ? 'dizzy' : isFinished ? 'done' : (activity ?? MOOD_OF_TASK[task])
  const interval = FRAME_MS[effort] / (isFinished ? FINISHED_SPEED : 1)
  const scenes = LOOKS[mood]
  const scene = scenes[sceneIndexOf(scenes.length, variantSeed, tMs, isFinished)] ?? scenes[0]
  const rows = drawCrab(scene ? scene(Math.floor(tMs / interval), stop(MODEL_RAMPS[model], 5)) : {})
  return packRasterCells(AVATAR_COLUMNS, AVATAR_ROWS, (column, row) => rows[row]?.[column] ?? [0x20, DEFAULT_COLOR, DEFAULT_COLOR])
}

export type BarState = 'running' | 'done' | 'failed'

// Done is green, failed is red; a running bar is the model's own colour until the context is nearly
// full, when it turns amber and then red.
const GREEN_RAMP: readonly number[] = [0x052e16, 0x14532d, 0x15803d, 0x16a34a, 0x22c55e, 0x4ade80, 0x86efac, 0xdcfce7]
const RED_RAMP: readonly number[] = [0x450a0a, 0x7f1d1d, 0xb91c1c, 0xdc2626, 0xef4444, 0xf87171, 0xfca5a5, 0xfee2e2]
const AMBER_RAMP: readonly number[] = [0x451a03, 0x78350f, 0xb45309, 0xd97706, 0xf59e0b, 0xfbbf24, 0xfde68a, 0xfffbeb]
export const CONTEXT_WARN = 80
export const CONTEXT_DANGER = 90

export function barRampOf(state: BarState, model: ModelTier, contextPercent: number): readonly number[] {
  if (state === 'done') return GREEN_RAMP
  if (state === 'failed' || contextPercent >= CONTEXT_DANGER) return RED_RAMP
  return contextPercent >= CONTEXT_WARN ? AMBER_RAMP : MODEL_RAMPS[model]
}

const DONE_GREEN = 0x22c55e

// Left blocks, one eighth to seven eighths of a cell: the fill grows in steps finer than a cell.
const LEFT_EIGHTHS = [0x258f, 0x258e, 0x258d, 0x258c, 0x258b, 0x258a, 0x2589]

export type BarLook = {
  columns: number
  // How far the fill reaches, 0 to 100: the task's progress, or the context when it reports none.
  value: number
  state: BarState
  model: ModelTier
  effort: EffortLevel
  tMs: number
  // How full the context is, 0 to 100. It colours a running bar, and is drawn as a tick when the
  // fill shows task progress instead (`showContext`).
  contextPercent: number
  showContext?: boolean
}

// One row. Full cells carry a wave of the ramp; the last, partial cell is in eighths and pulses
// while the run works. The rest is a dotted track. A finished or failed bar holds still.
export function drawProgressBar(look: BarLook): string {
  const { columns, state, model, effort, tMs } = look
  const isRunning = state === 'running'
  const ramp = barRampOf(state, model, look.contextPercent)
  const speed = isRunning ? EFFORT_SPEED[effort] : 0
  const eighths = Math.round((Math.max(0, Math.min(100, look.value)) / 100) * columns * 8)
  const full = Math.floor(eighths / 8)
  const part = eighths % 8
  const edge = isRunning && Math.sin(tMs * 0.008) > 0 ? stop(ramp, 7) : stop(ramp, 6)
  const markerAt = look.showContext === true ? Math.min(columns - 1, Math.floor((Math.max(0, look.contextPercent) / 100) * columns)) : -1
  const markerColor = look.contextPercent >= CONTEXT_DANGER ? 0xef4444 : look.contextPercent >= CONTEXT_WARN ? 0xf59e0b : LIGHT

  return packRasterCells(columns, 1, column => {
    const isFull = column < full
    const isPart = column === full && part > 0
    const under = isFull ? BAR_BACKGROUND : TRACK_BACKGROUND
    if (column === markerAt) return [0x2502, markerColor, state === 'done' ? DONE_GREEN : under]
    // A finished bar is one flat green, with no wave and no edge.
    if (isFull && state === 'done') return [FULL_BLOCK, DONE_GREEN, DONE_GREEN]
    if (isFull) {
      const wave = (Math.sin(column * 0.35 - tMs * speed * 2) + 1) * 0.5
      const lead = isRunning && column === full - 1 && part === 0
      return [FULL_BLOCK, lead ? edge : stop(ramp, Math.floor(wave * 4.99) + 2), BAR_BACKGROUND]
    }
    if (isPart) return [LEFT_EIGHTHS[part - 1] ?? FULL_BLOCK, edge, TRACK_BACKGROUND]
    return [LIGHT_SHADE, TRACK_FOREGROUND, TRACK_BACKGROUND]
  })
}

// Braille dots are a 2×4 grid per cell; bit order per column, top to bottom.
const BRAILLE_BITS = [
  [0x01, 0x02, 0x04, 0x40],
  [0x08, 0x10, 0x20, 0x80],
] as const

// A line plot of `values`, oldest first, resampled to the width. A flat or empty series is a flat line.
export function drawBrailleSparkline(columns: number, rows: number, values: readonly number[], foreground = 0x38bdf8, background = DEFAULT_COLOR): string {
  const subWidth = columns * 2
  const subHeight = rows * 4
  const masks = new Uint8Array(columns * rows)
  const min = Math.min(0, ...values)
  const span = Math.max(...values, min) - min
  for (let px = 0; px < subWidth; px++) {
    // The first and last columns are the oldest and the newest sample.
    const at = subWidth > 1 ? Math.round((px / (subWidth - 1)) * (values.length - 1)) : values.length - 1
    const value = values[Math.max(0, at)] ?? min
    const level = span > 0 ? (value - min) / span : 0
    const py = Math.max(0, Math.min(subHeight - 1, Math.round((1 - level) * (subHeight - 1))))
    const index = Math.floor(py / 4) * columns + (px >> 1)
    masks[index] = (masks[index] ?? 0) | (BRAILLE_BITS[px & 1]?.[py % 4] ?? 0)
  }
  return packRasterCells(columns, rows, (column, row) => [BRAILLE_BASE + (masks[row * columns + column] ?? 0), foreground, background])
}

// The tasks of the whole panel as one bar: finished (green), failed (red), running (a shimmering
// blue) and planned (the dotted track), in that order, each as wide as its share. A cell where two
// shares meet is split with an eighth block, so the edges are exact to an eighth of a cell.
export type TaskBarLook = { columns: number; done: number; failed: number; running: number; planned: number; tMs: number }
const FAILED_RED = 0xef4444
const RUNNING_SHADES: readonly number[] = [0x0369a1, 0x0284c7, 0x0ea5e9, 0x38bdf8]

export function drawTaskBar(look: TaskBarLook): string {
  const { columns, tMs } = look
  const total = look.done + look.failed + look.running + look.planned
  const eighths = columns * 8
  const upTo = (n: number) => (total > 0 ? Math.round((n / total) * eighths) : 0)
  const ends = [upTo(look.done), upTo(look.done + look.failed), upTo(look.done + look.failed + look.running)]
  const segmentAt = (eighth: number) => (eighth < (ends[0] ?? 0) ? 0 : eighth < (ends[1] ?? 0) ? 1 : eighth < (ends[2] ?? 0) ? 2 : 3)
  const shimmer = (column: number) => RUNNING_SHADES[Math.floor(((Math.sin(column * 0.7 - tMs * 0.008) + 1) / 2) * 3.99)] ?? RUNNING_SHADES[0] ?? 0
  const colorOfSegment = (segment: number, column: number) => (segment === 0 ? DONE_GREEN : segment === 1 ? FAILED_RED : shimmer(column))

  return packRasterCells(columns, 1, column => {
    const from = column * 8
    const left = segmentAt(from)
    const right = segmentAt(from + 7)
    if (left === right) return left === 3 ? [LIGHT_SHADE, TRACK_FOREGROUND, TRACK_BACKGROUND] : [FULL_BLOCK, colorOfSegment(left, column), colorOfSegment(left, column)]
    // Two shares meet in this cell: the first boundary inside it is where the left share stops.
    const boundary = ends.find(end => end > from && end < from + 8) ?? from + 4
    const blockWidth = Math.max(1, Math.min(7, boundary - from))
    return [LEFT_EIGHTHS[blockWidth - 1] ?? FULL_BLOCK, colorOfSegment(left, column), right === 3 ? TRACK_BACKGROUND : colorOfSegment(right, column)]
  })
}

// The leading plain words of a command line, up to three, stopping at the first flag, path,
// variable, quote, operator or address: whatever follows might be a credential.
const plainWords = (line: string): string => {
  const words: string[] = []
  for (const word of line.split(/\s+/).filter(w => w !== '')) {
    if (words.length === 3 || /[=/\\:@$"'`&|;<>(){}]/.test(word) || word.startsWith('-')) break
    words.push(word)
  }
  return words.join(' ')
}

// A short, readable hint at what a tool call touched: a file's name, a command's first words, a
// pattern, a host. Shown in the agent's tool log; never longer than 60 characters.
export function toolHintOf(tool: string, input: unknown): string {
  const o = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>
  const text = (v: unknown): string => (typeof v === 'string' ? v : '')
  const file = text(o.file_path) || text(o.path) || text(o.notebook_path)
  const url = text(o.url)
  let hint = ''
  if (file) hint = file.split(/[\\/]/).filter(Boolean).at(-1) ?? file
  // A command keeps only its leading plain words (`git log`, `bun test`).
  else if (text(o.command)) hint = plainWords(text(o.command).split('\n')[0] ?? '')
  else if (text(o.pattern)) hint = text(o.pattern)
  // A host, never the user and password a URL may carry in front of it.
  else if (url) hint = (/^[a-z][a-z0-9+.-]*:\/\/([^/?#]+)/i.exec(url)?.[1] ?? '').split('@').at(-1) ?? ''
  else if (text(o.query)) hint = text(o.query)
  else if (text(o.description)) hint = text(o.description)
  else if (tool.startsWith('mcp__')) hint = tool.split('__').slice(1).join(' · ')
  // No control characters (an escape sequence is not text), one line, at most 60 characters.
  const clean = hint.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, ' ').trim().replace(/\s+/g, ' ')
  const chars = Array.from(clean)
  return chars.length > 60 ? `${chars.slice(0, 59).join('')}…` : clean
}
