import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import {
  AVATAR_COLUMNS,
  AVATAR_ROWS,
  FINISHED_SPEED,
  VARIANT_MS,
  sceneCount,
  sceneIndexOf,
  activityOf,
  drawAgentAvatar,
  drawBrailleSparkline,
  drawProgressBar,
  drawTaskBar,
  toolHintOf,
  barRampOf,
  effortLevelOf,
  modelTierOf,
  taskKindOf,
} from './agent-shader'
import type { Activity, EffortLevel, Mood, ModelTier, TaskKind } from './agent-shader'

const TASKS: TaskKind[] = ['verify', 'handle', 'default']
const MODELS: ModelTier[] = ['haiku', 'sonnet', 'opus']
const EFFORTS: EffortLevel[] = ['low', 'medium', 'high']

function decode(cells: string): Uint32Array {
  const bytes = Uint8Array.from(atob(cells), ch => ch.charCodeAt(0))
  const view = new DataView(bytes.buffer)
  return Uint32Array.from({ length: bytes.length / 4 }, (_, i) => view.getUint32(i * 4, true))
}

// A Raster takes up to 1024 distinct (foreground, background) pairs, and printable width-1 code points.
function expectValidRaster(cells: string, count: number, label: string): void {
  const words = decode(cells)
  expect(words.length, `${label}: three words a cell`).toBe(count * 3)
  const pairs = new Set<string>()
  for (let cell = 0; cell < count; cell++) {
    const [codePoint = 0, foreground = 0, background = 0] = words.subarray(cell * 3, cell * 3 + 3)
    expect(codePoint >= 0x20 && codePoint <= 0xffff && !(codePoint >= 0xd800 && codePoint <= 0xdfff), `${label}: cell ${cell} code point`).toBe(true)
    expect(foreground <= 0x01000000 && background <= 0x01000000, `${label}: cell ${cell} colours`).toBe(true)
    pairs.add(`${foreground}/${background}`)
  }
  expect(pairs.size, `${label}: colour pairs`).toBeLessThan(1024)
}

test('shader: the task, model and effort are read from what the run reports', () => {
  expect(taskKindOf('verify: the migration')).toBe('verify')
  expect(taskKindOf('  Handle:cleanup')).toBe('handle')
  expect(taskKindOf('deploy: staging')).toBe('default')
  expect(taskKindOf('Build the landing page')).toBe('default')
  expect(taskKindOf('verifying things')).toBe('default')
  expect(modelTierOf('claude-haiku-5-5')).toBe('haiku')
  expect(modelTierOf('claude-sonnet-5-5')).toBe('sonnet')
  expect(modelTierOf('claude-opus-5-5')).toBe('opus')
  expect(modelTierOf('claude-fable-5-2')).toBe('opus')
  expect(effortLevelOf('low')).toBe('low')
  expect(effortLevelOf('xhigh')).toBe('high')
  expect(effortLevelOf('max')).toBe('high')
  expect(effortLevelOf(undefined)).toBe('medium')
})

test('shader: every avatar is 8x4 valid cells, at any time and in any state', () => {
  for (const task of TASKS) {
    for (const model of MODELS) {
      for (const effort of EFFORTS) {
        for (const isFinished of [false, true]) {
          for (const t of [0, 137, 4000, 123_456]) {
            expectValidRaster(drawAgentAvatar(task, model, effort, isFinished, t), AVATAR_COLUMNS * AVATAR_ROWS, `${task}/${model}/${effort}/${isFinished}/${t}`)
          }
        }
      }
    }
  }
})

test('shader: the task, model, effort and state each change the picture', () => {
  const at = (task: TaskKind, model: ModelTier, effort: EffortLevel, t = 500) => drawAgentAvatar(task, model, effort, false, t)
  expect(new Set(TASKS.map(task => at(task, 'sonnet', 'medium'))).size).toBe(3)
  expect(new Set(MODELS.map(model => at('handle', model, 'medium'))).size).toBe(3)
  expect(new Set(MODELS.map(model => at('verify', model, 'medium'))).size).toBe(3)
  // The tempo: in one second a high-effort crab shows more distinct frames than a low-effort one.
  const frames = (effort: EffortLevel) => new Set(Array.from({ length: 40 }, (_, i) => at('handle', 'haiku', effort, i * 25)))
  expect(frames('high').size).toBeGreaterThan(frames('low').size)
  // Done and failed are their own pictures; a finished crab runs at a quarter of the tempo.
  expect(drawAgentAvatar('verify', 'opus', 'high', true, 4000)).not.toBe(at('verify', 'opus', 'high', 4000))
  expect(drawAgentAvatar('verify', 'opus', 'high', true, 4000, true)).not.toBe(drawAgentAvatar('verify', 'opus', 'high', true, 4000))
  expect(FINISHED_SPEED).toBe(0.25)
  const finished = new Set(Array.from({ length: 40 }, (_, i) => drawAgentAvatar('verify', 'opus', 'high', true, i * 25)))
  const running = new Set(Array.from({ length: 40 }, (_, i) => at('verify', 'opus', 'high', i * 25)))
  expect(finished.size).toBeLessThan(running.size)
})

test('shader: the crab is Claude orange with its eyes as holes, in quadrant blocks', () => {
  const words = decode(drawAgentAvatar('verify', 'haiku', 'medium', false, 0))
  const colours = new Set<number>()
  for (let i = 0; i < words.length; i += 3) colours.add(words[i + 1] ?? 0)
  expect(colours.has(0xd97757)).toBe(true)
  const blocks = Array.from({ length: words.length / 3 }, (_, i) => words[i * 3] ?? 0).filter(c => c >= 0x2596 && c <= 0x259f || c === 0x2580 || c === 0x2584 || c === 0x258c || c === 0x2590 || c === 0x2588)
  expect(blocks.length).toBeGreaterThan(8)
})

const look = (over: Partial<Parameters<typeof drawProgressBar>[0]> = {}) => ({
  columns: 20,
  value: 50,
  state: 'running' as const,
  model: 'sonnet' as const,
  effort: 'medium' as const,
  tMs: 700,
  contextPercent: 10,
  ...over,
})
const codePoints = (cells: string) => decode(cells).filter((_, i) => i % 3 === 0)
const colours = (cells: string) => decode(cells).filter((_, i) => i % 3 === 1)

test('bar: the fill grows in eighths of a cell, and an empty bar is all track', () => {
  const full = (value: number, columns = 20) => codePoints(drawProgressBar(look({ value, columns }))).filter(c => c === 0x2588).length
  expect(full(0)).toBe(0)
  expect(full(50)).toBe(10)
  expect(full(100)).toBe(20)
  expect(full(250)).toBe(20)
  expect(full(50, 6)).toBe(3)
  // 52.5% of 20 cells is ten whole cells and four eighths: a half block closes the fill.
  const half = codePoints(drawProgressBar(look({ value: 52.5 })))
  expect(half.filter(c => c === 0x2588).length).toBe(10)
  expect(half[10]).toBe(0x258c)
  expect(half[11]).toBe(0x2591)
  // Every eighth has its own block, left to right.
  const parts = [1, 2, 3, 4, 5, 6, 7].map(n => codePoints(drawProgressBar(look({ columns: 4, value: (n / 32) * 100 })))[0])
  expect(new Set(parts).size).toBe(7)
  expectValidRaster(drawProgressBar(look({ columns: 28, value: 63, tMs: 99 })), 28, 'bar')
})

test('bar: the colour says the state, and a nearly full context turns it amber then red', () => {
  expect(barRampOf('done', 'opus', 10)).not.toBe(barRampOf('running', 'opus', 10))
  expect(barRampOf('failed', 'opus', 10)).not.toBe(barRampOf('done', 'opus', 10))
  expect(barRampOf('running', 'haiku', 10)).not.toBe(barRampOf('running', 'sonnet', 10))
  expect(new Set([10, 79, 80, 89, 90, 100].map(p => barRampOf('running', 'opus', p))).size).toBe(3)
  const filled = (state: 'running' | 'done' | 'failed') => colours(drawProgressBar(look({ state, value: 60, contextPercent: 10 }))).slice(0, 12)
  expect(filled('done')).not.toEqual(filled('running'))
  expect(filled('failed')).not.toEqual(filled('done'))
})

test('bar: task progress is the fill and the context is a tick; the leading edge pulses; a finished bar holds still', () => {
  const marked = codePoints(drawProgressBar(look({ value: 30, contextPercent: 70, showContext: true })))
  expect(marked.filter(c => c === 0x2502).length).toBe(1)
  expect(marked[14]).toBe(0x2502)
  expect(codePoints(drawProgressBar(look({ value: 30, contextPercent: 70 }))).includes(0x2502)).toBe(false)
  // The newest full cell brightens and dims with the clock; behind it the wave is unchanged by it.
  const pulse = (tMs: number) => colours(drawProgressBar(look({ value: 50, tMs })))[9]
  expect(new Set([0, 200, 400, 600, 800].map(pulse)).size).toBeGreaterThan(1)
  const bar = (state: 'running' | 'done', t: number) => drawProgressBar(look({ state, tMs: t }))
  expect(bar('done', 0)).toBe(bar('done', 5000))
  expect(bar('running', 0)).not.toBe(bar('running', 400))
})

test('shader: the sparkline is braille, flat for a flat or empty series, and rises with the values', () => {
  for (const values of [[], [3], [0, 0, 0], [1, 5, 2, 9, 4, 4, 8]]) {
    const words = decode(drawBrailleSparkline(10, 1, values))
    expectValidRaster(drawBrailleSparkline(10, 1, values), 10, `values ${values.length}`)
    expect(words.filter((_, i) => i % 3 === 0).every(codePoint => codePoint >= 0x2800 && codePoint <= 0x28ff)).toBe(true)
  }
  // Rising values put their right-hand dots higher than their left-hand ones.
  const lit = (cells: string) => decode(cells).filter((_, i) => i % 3 === 0).map(codePoint => codePoint - 0x2800)
  const rising = lit(drawBrailleSparkline(4, 1, [0, 1, 2, 3, 4, 5, 6, 7]))
  const top = 0x01 | 0x08
  expect((rising[0] ?? 0) & top).toBe(0)
  expect((rising[3] ?? 0) & top).not.toBe(0)
})

test('shader: a series of small values keeps its shape, and the newest sample is plotted', () => {
  const lit = (cells: string) => decode(cells).filter((_, i) => i % 3 === 0).map(codePoint => codePoint - 0x2800)
  // Dollars a second are far below 1: the plot scales to the series, not to a unit.
  const cost = lit(drawBrailleSparkline(4, 1, [0, 0.004, 0.02, 0.001]))
  expect(new Set(cost).size).toBeGreaterThan(1)
  // More samples than columns: the last one is still the rightmost dot, at full height.
  const spike = lit(drawBrailleSparkline(3, 1, [...Array.from({ length: 23 }, () => 0), 5]))
  expect((spike[2] ?? 0) & 0x08).toBe(0x08)
})

const paneProps = (bodyColumns: number) =>
  ({ title: '', isFocused: false, bodyColumns, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} }) as const

async function session($: Engine, on: On, description: string) {
  mock.env(on, { LANG: 'en_US.UTF-8' })
  on('settings.read', async () => ({ value: {} }) as never)
  on('session.start', async () => ({ cwd: '/repo' }) as never)
  on('tool.register', () => ({ value: {} }) as never)
  on('command.register', () => ({ value: { command: 'agents-info' } }) as never)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: 'a1' }))
  await $.session.start({ source: 'startup', cwd: '/repo', surface: 'terminal', isInteractive: true } as never)
  await $.agent.spawn({ tool_use_id: 't1', prompt: 'p', description, subagentType: 'savvy-light', provider: 'engine', parentModel: 'claude-sonnet-5-5', background: false, fork: false } as never)
}

test('terminal pane: the card is bordered in the task colour and repainted by blit, not by redraws', async ($, on) => {
  const clock = mock.clock(on)
  const blits: { requestId: string; key: string }[] = []
  let attempts = 0
  let isMounted = true
  on('ui.blit', (_, e) => {
    attempts += 1
    if (!isMounted) return { value: { deny: 'nothing is mounted there' } }
    blits.push({ requestId: String(e.requestId), key: String(e.key) })
    return { value: {} }
  })
  await session($, on, 'verify: the migration')

  // Nothing is mounted yet: the timer is quiet.
  await clock.advance(500)
  expect(blits.length).toBe(0)

  const ui = await $.ui.mount({ plugin: 'savvy-progress', surface: 'terminal', component: 'Pane', requestId: 'savvy-agents', props: paneProps(80) })
  const cards = (await ui.findAll({ type: 'Box' })).filter(b => b.props.borderColor === '#06b6d4')
  expect(cards.length, 'verify: draws the cyan card').toBe(1)
  expect(await ui.find({ type: 'Text', text: /◈ MED|⚡ HIGH|◦ LOW/ }), 'effort badge').toBeDefined()

  await clock.advance(500)
  expect(blits.length).toBeGreaterThan(0)
  expect(new Set(blits.map(b => b.requestId))).toEqual(new Set(['savvy-agents']))
  expect(new Set(blits.map(b => b.key))).toEqual(new Set(['taskbar', 'avatar-a1', 'ctxbar-a1']))

  // A denied blit means the canvas is gone: painting stops until the next draw.
  // (Between the pane's own once-a-second redraws, which would register the rasters again.)
  isMounted = false
  await clock.advance(600)
  const settled = attempts
  await clock.advance(350)
  expect(attempts).toBe(settled)
  await ui.unmount()
})

test('activity: a tool call is classed by what it does, never by its command text', () => {
  expect(activityOf('Read', {})).toBe('read')
  expect(activityOf('Grep', { pattern: 'x' })).toBe('read')
  expect(activityOf('Edit', {})).toBe('build')
  expect(activityOf('Write', {})).toBe('build')
  expect(activityOf('Agent', {})).toBe('sub')
  expect(activityOf('WebFetch', {})).toBe('web')
  expect(activityOf('mcp__claude_ai_Firecrawl__firecrawl_scrape', {})).toBe('web')
  expect(activityOf('TodoWrite', {})).toBe('think')
  expect(activityOf('Bash', { command: 'git status' })).toBe('git')
  expect(activityOf('Bash', { command: 'bun test' })).toBe('test')
  expect(activityOf('Bash', { command: 'claude plugin test x' })).toBe('test')
  expect(activityOf('Bash', { command: 'bun add left-pad' })).toBe('install')
  expect(activityOf('Bash', { command: 'ls -la' })).toBe('shell')
  expect(activityOf('PowerShell', undefined)).toBe('shell')
  expect(activityOf('mcp__helpin__list_tasks', {})).toBe('gear')
})

test('activity: every activity draws its own scene, and moves', () => {
  const all: Activity[] = ['think', 'read', 'build', 'shell', 'test', 'web', 'sub', 'gear', 'install', 'git']
  const scene = (activity: Activity, t = 0) => drawAgentAvatar('default', 'sonnet', 'medium', false, t, false, activity)
  // Sampled over a few frames, no two activities draw the same sequence.
  const sequence = (activity: Activity) => [0, 150, 300, 450, 600, 750, 900, 1050].map(t => scene(activity, t)).join('|')
  expect(new Set(all.map(sequence)).size).toBe(all.length)
  for (const activity of all) {
    expect(new Set([0, 150, 300, 450, 600, 750, 900, 1050].map(t => scene(activity, t))).size, `${activity} moves`).toBeGreaterThan(1)
    expectValidRaster(scene(activity, 333), AVATAR_COLUMNS * AVATAR_ROWS, activity)
  }
  // An agent that has called a tool acts that out, whatever its task prefix says.
  expect(drawAgentAvatar('verify', 'sonnet', 'medium', false, 0, false, 'shell')).toBe(scene('shell'))
  expect(drawAgentAvatar('verify', 'sonnet', 'medium', false, 0)).not.toBe(scene('shell'))
})

const MOODS: Mood[] = ['think', 'read', 'build', 'shell', 'test', 'web', 'sub', 'gear', 'install', 'git', 'ship', 'done', 'dizzy']
const FRAMES = [0, 150, 300, 450, 600, 750, 900, 1050, 1200, 1350, 1500, 1650]

test('variants: most activities have several scenes, all valid, and no two alike', () => {
  const total = MOODS.reduce((n, mood) => n + sceneCount(mood), 0)
  expect(total).toBeGreaterThanOrEqual(40)
  for (const mood of MOODS) {
    const activity = mood as Activity
    const seq = (seed: number) =>
      FRAMES.map(t =>
        mood === 'done' || mood === 'dizzy'
          ? drawAgentAvatar('verify', 'sonnet', 'medium', true, t, mood === 'dizzy', undefined, seed)
          : drawAgentAvatar('verify', 'sonnet', 'medium', false, t, false, activity, seed),
      )
    const sequences = Array.from({ length: sceneCount(mood) }, (_, seed) => seq(seed).join('|'))
    expect(new Set(sequences).size, `${mood}: scenes differ`).toBe(sceneCount(mood))
    for (let seed = 0; seed < sceneCount(mood); seed++) {
      for (const cells of seq(seed)) expectValidRaster(cells, AVATAR_COLUMNS * AVATAR_ROWS, `${mood}#${seed}`)
    }
  }
})

test('variants: the seed picks the scene, a running agent moves on every VARIANT_MS, a finished one stays', () => {
  const at = (seed: number, t: number) => drawAgentAvatar('verify', 'sonnet', 'medium', false, t, false, 'read', seed)
  expect(at(0, 0)).not.toBe(at(1, 0))
  expect(at(0, 0)).toBe(at(sceneCount('read'), 0))
  // The scene index: the seed, then one on every hold while running; a finished agent keeps its own.
  expect(sceneIndexOf(4, 0, 0, false)).toBe(0)
  expect(sceneIndexOf(4, 0, VARIANT_MS, false)).toBe(1)
  expect(sceneIndexOf(4, 3, VARIANT_MS, false)).toBe(0)
  expect(sceneIndexOf(4, 2, VARIANT_MS * 9, true)).toBe(2)
  expect(sceneIndexOf(3, -5, 0, false)).toBe(2)
})

test('bar: a finished bar is one flat green with no wave, a failed one is not', () => {
  const done = drawProgressBar(look({ state: 'done', value: 100, contextPercent: 40 }))
  const solid = colours(done)
  expect(new Set(solid).size).toBe(1)
  expect(solid[0]).toBe(0x22c55e)
  expect(codePoints(done).every(c => c === 0x2588)).toBe(true)
  // Whatever the time, the same flat green.
  expect(done).toBe(drawProgressBar(look({ state: 'done', value: 100, contextPercent: 40, tMs: 9000 })))
  // With the context tick on, only that one cell differs.
  const ticked = codePoints(drawProgressBar(look({ state: 'done', value: 100, contextPercent: 40, showContext: true })))
  expect(ticked.filter(c => c === 0x2502).length).toBe(1)
  expect(new Set(colours(drawProgressBar(look({ state: 'failed', value: 100 })))).size).toBeGreaterThan(1)
})

test('task bar: finished, failed, running and planned each take their share, to the eighth', () => {
  const bar = (over: Partial<Parameters<typeof drawTaskBar>[0]>) => drawTaskBar({ columns: 20, done: 0, failed: 0, running: 0, planned: 0, tMs: 300, ...over })
  const cells = (cellsB64: string) => ({ chars: codePoints(cellsB64), fg: colours(cellsB64) })
  // Nothing at all: an empty track.
  expect(cells(bar({})).chars.every(c => c === 0x2591)).toBe(true)
  // Half done, half planned: ten green cells, then the track.
  const half = cells(bar({ done: 4, planned: 4 }))
  expect(half.chars.slice(0, 10).every(c => c === 0x2588)).toBe(true)
  expect(new Set(half.fg.slice(0, 10))).toEqual(new Set([0x22c55e]))
  expect(half.chars.slice(10).every(c => c === 0x2591)).toBe(true)
  // Done, failed, running and planned in order, one cell each of five.
  const four = cells(bar({ columns: 4, done: 1, failed: 1, running: 1, planned: 1 }))
  expect(four.fg[0]).toBe(0x22c55e)
  expect(four.fg[1]).toBe(0xef4444)
  expect(four.chars[2]).toBe(0x2588)
  expect(four.chars[3]).toBe(0x2591)
  // A share that ends inside a cell splits it with an eighth block: 1 of 3 done in 10 cells.
  const third = cells(bar({ columns: 10, done: 1, planned: 2 }))
  expect(third.chars.some(c => c >= 0x2589 && c <= 0x258f)).toBe(true)
  // The running share shimmers with the clock; the rest holds.
  expect(bar({ running: 1, tMs: 0 })).not.toBe(bar({ running: 1, tMs: 400 }))
  expect(bar({ done: 2, planned: 2, tMs: 0 })).toBe(bar({ done: 2, planned: 2, tMs: 400 }))
  expectValidRaster(bar({ columns: 30, done: 3, failed: 1, running: 2, planned: 5 }), 30, 'task bar')
})

test('tool log: a hint is a file name, the first plain words of a command, a pattern or a host', () => {
  expect(toolHintOf('Read', { file_path: 'C:\\Users\\x\\notes\\todo.md' })).toBe('todo.md')
  expect(toolHintOf('Edit', { file_path: '/repo/src/app.ts' })).toBe('app.ts')
  expect(toolHintOf('Bash', { command: 'git log --oneline -5\nsecond line' })).toBe('git log')
  expect(toolHintOf('Bash', { command: 'bun test' })).toBe('bun test')
  expect(toolHintOf('Grep', { pattern: 'TODO' })).toBe('TODO')
  expect(toolHintOf('WebFetch', { url: 'https://example.com/a/b?c=d' })).toBe('example.com')
  expect(toolHintOf('Agent', { description: 'verify: the thing' })).toBe('verify: the thing')
  expect(toolHintOf('mcp__helpin__list_tasks', {})).toBe('helpin · list_tasks')
  expect(toolHintOf('Read', undefined)).toBe('')
  expect(toolHintOf('Grep', { pattern: 'x'.repeat(200) }).length).toBe(60)
})

test('tool log: a hint never carries a credential, a path, an escape code or half an emoji', () => {
  expect(toolHintOf('Bash', { command: 'export TOKEN=abc123 && ls' })).toBe('export')
  expect(toolHintOf('Bash', { command: 'curl -H "Authorization: Bearer abc" https://user:pw@host/x' })).toBe('curl')
  expect(toolHintOf('Bash', { command: 'git -C /secret/path status' })).toBe('git')
  expect(toolHintOf('WebFetch', { url: 'https://user:hunter2@example.com/x' })).toBe('example.com')
  expect(toolHintOf('Grep', { pattern: '\u001b]0;x\u0007ls' })).toBe(']0;x ls')
  const hint = toolHintOf('Grep', { pattern: `${'a'.repeat(58)}😀😀😀` })
  expect(hint.endsWith('…')).toBe(true)
  expect(Array.from(hint).length).toBe(60)
  expect(/[\ud800-\udfff]/.test(hint.replace(/\p{Extended_Pictographic}/gu, ''))).toBe(false)
})

test('terminal pane: pressing an agent title opens its tool log, and the finished header stands out', async ($, on) => {
  mock.clock(on)
  on('turn.complete', () => ({ text: 'ok' }) as never)
  let n = 0
  on('turn.step', async function* (_, e) {
    n += 1
    return {
      turnId: e.turnId, index: e.index, answer: '', stopReason: 'tool_use',
      toolUses: [{ name: n % 2 ? 'Read' : 'Grep', input: { file_path: `/docs/file${n - 1}.md` } }],
      usage: { model: 'claude-sonnet-5-5', input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    } as never
  })
  await session($, on, 'verify: read docs')
  // Twelve model requests, each calling a tool, then the agent's turn ends: the real hooks record them.
  // `turn.step` streams: the call returns an iterator the test drains.
  const step = $.turn.step as unknown as (e: unknown) => AsyncIterable<unknown>
  for (let i = 0; i < 12; i++) for await (const _chunk of step({ turnId: 't', index: i, agentId: 'a1', model: 'claude-sonnet-5-5', effort: 'low' })) void _chunk
  await $.turn.complete({ turnId: 't', agentId: 'a1', reason: 'answer', answer: 'ok', durationMs: 1, isAborted: false } as never)
  const ui = await $.ui.mount({ plugin: 'savvy-progress', surface: 'terminal', component: 'Pane', requestId: 'savvy-agents', props: paneProps(80) })
  // The finished header is its own green box, and the counts are on the card.
  const header = (await ui.findAll({ type: 'Box' })).filter(b => b.props.borderColor === '#22c55e')
  expect(header.length).toBe(1)
  expect(await ui.find({ type: 'Text', text: /FINISHED · 1/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Tasks 1\/1/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /12 tools/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /file11\.md/ })).toBeUndefined()
  // Press the title: the last eight calls show, the four before them are counted.
  await ui.press({ key: 'open-a1' })
  expect(await ui.find({ type: 'Text', text: /file11\.md/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /file4\.md/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /file3\.md/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /\+4 earlier/ })).toBeDefined()
  // And press it again: closed.
  await ui.press({ key: 'open-a1' })
  expect(await ui.find({ type: 'Text', text: /file11\.md/ })).toBeUndefined()
  await ui.unmount()
})
