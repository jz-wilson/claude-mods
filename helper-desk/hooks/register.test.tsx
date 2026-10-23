import { expect, mock, test } from 'claude-code/testing'
import type { FoundElement } from 'claude-code/testing'
import type { ThemeKey } from 'claude-code'

import { crabSprite, drawCrab, drawJev, jevSprite, petCanvas, poseAt, tierOf } from './register'

/** The `on` a test body is handed. */
type On = Parameters<NonNullable<Parameters<typeof test>[2]>>[1]

type Agent = { id: string; description: string; type: string; status: string }

/** The file `path` names: exact, or a key led by a star that any home can end with. */
const keyOf = (files: Record<string, string>, path: string) =>
  path in files ? path : Object.keys(files).find(k => k.startsWith('*') && path.endsWith(k.slice(1)))

const WIDTHS = [40, 80, 144] as const
const THEME_KEYS: readonly ThemeKey[] = [
  'text', 'inverseText', 'inactive', 'subtle', 'suggestion', 'remember', 'success', 'error',
  'warning', 'merged', 'claude', 'permission', 'planMode', 'autoAccept', 'promptBorder',
  'bashBorder', 'ide', 'diffAdded', 'diffRemoved', 'diffAddedDimmed', 'diffRemovedDimmed',
  'diffAddedWord', 'diffRemovedWord',
]

/** Functional colour must be a theme key; raw colour belongs to Svg markup only. */
function rawColors(elements: FoundElement[]): string[] {
  return elements.flatMap(element =>
    ['color', 'borderColor', 'backgroundColor']
      .map(prop => [prop, element.props[prop]] as const)
      .filter(([, value]) => value !== undefined && !THEME_KEYS.includes(value as ThemeKey))
      .map(([prop, value]) => `${element.type}.${prop}=${String(value)}`),
  )
}

/** Each tool spec the mod registered, newest test only. */
let specs: { isDeferred?: boolean }[] = []

/** Mocks every $ call the mod makes; `files` stands in for the disk. */
function rig(on: On, files: Record<string, string>, stored: Record<string, unknown> = {}) {
  const ids = ['agent-a1', 'agent-a2', 'agent-a3']
  const agents: Agent[] = []
  const statuses: (string | undefined)[] = []
  const opened: string[] = []
  const closed: string[] = []
  const ran: string[][] = []
  const toasts: string[] = []
  const probes = { blits: 0, badBlits: 0, denyBlit: false, jevReads: 0, onBlit: undefined as undefined | (() => Promise<unknown>) }

  on('session.start', async ($, e) => ({ cwd: e.cwd }) as never)
  on('session.id', async () => ({ value: 'sess1' }) as never)
  on('session.usage', async () => ({ value: { startedAt: 0, context: {}, rateLimits: [], cost: { usd: 0.42 } } }) as never)
  on('command.register', async () => ({ value: undefined }) as never)
  on('tool.register', async ($, e) => {
    specs.push(e as { isDeferred?: boolean })
    return { value: { tool: 'mcp__helper-desk__plan' } } as never
  })
  const clock = mock.clock(on, { now: 1_000_000 })
  mock.store(on, stored)
  on('ui.blit', async ($, e) => {
    probes.blits += 1
    const b = e as { cells: string; columns?: number; rows?: number }
    // A frame drawn for another canvas than the mounted one would be refused by the engine.
    if (b.columns && b.rows && b.cells.length !== b.columns * b.rows * 16) probes.badBlits += 1
    await probes.onBlit?.()
    return { value: probes.denyBlit ? { deny: 'not mounted' } : {} } as never
  })
  on('session.send', async () => ({ isDelivered: true }) as never)
  on('turn.step', async function* ($, e) {
    const step = e as { turnId: string; index: number }
    return { turnId: step.turnId, index: step.index, answer: '', toolUses: [] } as never
  })
  on('agent.spawn', async ($, e) => {
    const { description, subagentType } = e as { description: string; subagentType: string }
    const id = ids[agents.length]!
    agents.push({ id, description, type: subagentType, status: 'running' })
    return { model: 'claude-opus-5-5', agentId: id } as never
  })
  on('agent.list', async () => ({ value: agents.map(a => ({ ...a })) }) as never)
  on('ui.open', async ($, e) => {
    opened.push((e as { id: string }).id)
    return { value: { isPlaced: true } } as never
  })
  on('ui.close', async ($, e) => {
    closed.push((e as { id: string }).id)
    return { value: undefined } as never
  })
  on('ui.status', async ($, e) => {
    statuses.push((e as { text: string | undefined }).text)
    return { value: undefined } as never
  })
  on('ui.toast', async ($, e) => {
    toasts.push((e as { text: string }).text)
    return { value: undefined } as never
  })
  on('tool.call', async () => ({ result: 'ok' }) as never)
  // Beneath the plugins a pane nobody draws is empty.
  on('ui.render', async ($, e) => {
    const { Box } = $.ui.resolve(e)
    return (<Box />) as never
  })
  on('turn.start', async (_, e) => ({ turnId: (e as { turnId: string }).turnId }) as never)
  on('turn.complete', async () => ({ text: '' }) as never)
  on('fs.exists', async ($, e) => ({ value: keyOf(files, (e as { path: string }).path.replace(/\\/g, '/')) !== undefined }) as never)
  on('fs.read', async ($, e) => {
    const path = (e as { path: string }).path.replace(/\\/g, '/')
    if (path.endsWith('/jev-live/sess1.json')) probes.jevReads += 1
    return { value: files[keyOf(files, path) ?? ''] ?? '' } as never
  })
  on('fs.write', async ($, e) => {
    const { path: rawPath, text } = e as { path: string; text: string }; const path = rawPath.replace(/\\/g, '/')
    files[path] = text
    return { value: undefined } as never
  })
  on('env.get', async () => ({ value: 'Windows_NT' }) as never)
  on('process.run', async ($, e) => {
    const argv = (e as { argv?: string[]; command?: string[] }).argv ?? (e as { command?: string[] }).command ?? []
    ran.push(argv)
    const hit = ['rm', 'cmd'].includes(argv[0] ?? '') ? keyOf(files, argv[argv.length - 1]!.replace(/\\/g, '/')) : undefined
    if (hit) delete files[hit]
    return { value: { exitCode: 0, stdout: '', stderr: '' } } as never
  })
  return { agents, statuses, opened, closed, ran, clock, toasts, probes }
}

/** What the band says: the drawing's alt text on desktop, every text in the terminal. */
async function bandSays(v: { find: (q: object) => Promise<unknown>; findAll: (q: object) => Promise<unknown[]> }, _surface: 'desktop' | 'terminal') {
  return ((await v.findAll({ type: 'Text' })) as { text: string }[]).map(t => t.text).join(' ')
}

const bandProps = (bodyColumns = 40) => ({ isWorking: true, hasSurvey: false, maxRows: 20, bodyColumns, scroll: {}, view: {} }) as never

/** The plan file this chat writes, whatever the home. */
const planFile = (files: Record<string, string>) => Object.keys(files).find(k => k.endsWith('/.claude/mods-state/plan-sess1.json'))

const steps4 = (done: number, live: boolean) =>
  ['Read the brief', 'Draft the outline', 'Build the slides', 'Check the deck'].map((text, i) => ({
    text,
    status: i < done ? 'completed' : i === done && live ? 'in_progress' : 'pending',
  }))

const props = (bodyColumns = 60) =>
  ({ title: 'Helpers', isFocused: false, bodyColumns, placement: 'dock', scroll: {}, view: {} }) as never

for (const surface of ['desktop', 'terminal'] as const) {
  test(`two helpers get live cards, then both are done (${surface})`, { timeoutMs: 30000 }, async ($, on) => {
    const { agents, statuses, opened, clock } = rig(on, {})
    await $.session.start({ source: 'startup', cwd: '/Users/test/vault', surface, isInteractive: true } as never)
    // A plain signature: the connector-typed one is too deep for tsc.
    const callTool = $.tool.call as unknown as (input: unknown) => Promise<unknown>

    const spawn = (description: string, subagentType: string, model: string, n: number) =>
      $.agent.spawn({ tool_use_id: `spawn${n}`, prompt: 'Do the job.', description, subagentType, model } as never)
    await spawn('Read the research notes', 'Explore', 'haiku', 1)
    await spawn('Find invoice threads', 'general-purpose', 'opus', 2)
    await clock.settle()
    expect(opened, 'pane opened by itself').toContain('helpers')

    await callTool({ tool: 'Read', tool_use_id: 'c1', file_path: '/Users/test/vault/research.md', agentId: 'agent-a1' } as never)
    await callTool({ tool: 'mcp__00000000-0000-0000-0000-00000000000a__search_threads', tool_use_id: 'c2', query: 'invoice', agentId: 'agent-a2' } as never)
    await clock.advance(5_000)

    const v = await $.ui.mount({ plugin: 'helper-desk', surface, component: 'Pane', requestId: 'helpers', props: props() })
    expect(await v.find({ text: /Read the research notes/ }), 'first description').toBeDefined()
    expect(await v.find({ text: /Find invoice threads/ }), 'second description').toBeDefined()
    expect(await v.find({ text: /Step 1 · Reading research\.md/ }), 'Read in words').toBeDefined()
    expect(await v.find({ text: /Gmail: search threads/ }), 'Gmail connector in words').toBeDefined()
    expect(await v.find({ type: 'Text', text: /^Running · 2\s*$/ }), 'Running heading with its count').toBeDefined()
    const runHead = await v.find({ key: 'head-running' })
    expect(runHead?.props.backgroundColor, 'Running sits in a green box').toBe('success')
    expect(await v.find({ text: /Explore · Haiku/ }), 'type and model').toBeDefined()
    expect(await v.find({ text: /^Time$/ }), 'time tile').toBeDefined()
    expect(await v.find({ type: 'Text', text: /^Total chat cost$/ }), 'Total chat cost label').toBeDefined()
    expect(await v.find({ text: /\$0\.42/ }), 'chat cost from the engine').toBeDefined()
    expect(await v.find({ text: /^Subagent tokens$/ }), 'no tokens tile before any usage').toBeUndefined()
    expect(statuses.every(t => t === undefined), 'no footer status line').toBe(true)

    const usage = { input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 30000, cache_creation_input_tokens: 2000, model: 'claude-opus-5-5' }
    await $.turn.complete({ answer: 'Found it.', agentId: 'agent-a1', reason: 'answer', durationMs: 4000, isAborted: false, turnId: 't1', usage } as never)
    await clock.settle()
    expect(await v.find({ type: 'Text', text: /^Finished · 1\s*$/ }), 'Finished heading with its count').toBeDefined()
    expect((await v.find({ key: 'head-finished' }))?.props.backgroundColor, 'Finished sits in a yellow box').toBe('warning')
    expect(await v.find({ text: /^Subagent tokens$/ }), 'subagent tokens tile from usage').toBeDefined()
    expect(await v.find({ text: /34k tokens/ }), 'card tokens').toBeDefined()
    expect(statuses[statuses.length - 1], 'still no footer status').toBeUndefined()

    // The 2 s poll sees the second helper finish from $.agent.list().
    agents[1]!.status = 'completed'
    await clock.advance(2_100)
    expect(await v.find({ type: 'Text', text: /^Finished · 2\s*$/ }), 'both finished from the poll').toBeDefined()
    expect(await v.find({ key: 'head-running' }), 'running group gone').toBeUndefined()
    expect(statuses[statuses.length - 1], 'status cleared').toBeUndefined()
  })

  test(`two helpers get two body colours, and only working pets carry motion (${surface})`, { timeoutMs: 30000 }, async ($, on) => {
    const { clock } = rig(on, {})
    await $.session.start({ source: 'startup', cwd: '/Users/test/vault', surface, isInteractive: true } as never)
    await $.agent.spawn({ tool_use_id: 's1', prompt: 'x', description: 'Build the landing page', subagentType: 'general-purpose' } as never)
    await $.agent.spawn({ tool_use_id: 's2', prompt: 'x', description: 'Design the graphics', subagentType: 'general-purpose' } as never)
    await clock.settle()
    const v = await $.ui.mount({ plugin: 'helper-desk', surface, component: 'Pane', requestId: 'helpers', props: props() })
    if (surface === 'terminal') {
      const rasters = await v.findAll({ type: 'Raster' })
      expect(rasters, 'two Raster pets').toHaveLength(2)
      expect(rasters[0]!.props.cells !== rasters[1]!.props.cells, 'pets in different colours').toBe(true)
      expect(await v.findAll({ type: 'Svg' }), 'no Svg on the terminal').toHaveLength(0)
      expect(await v.find({ text: /▐/ }), 'no glyph pet').toBeUndefined()
      const { columns, rows } = petCanvas(60)
      expect(rasters[0]!.props.columns, 'sized to the canvas').toBe(columns)
      expect(rasters[0]!.props.rows).toBe(rows)
      return
    }
    const pets = (await v.findAll({ type: 'Svg' })).filter(p => String(p.props.alt).startsWith('Claude crab'))
    expect(pets, 'two pets').toHaveLength(2)
    const a = String(pets[0]!.props.source)
    const b = String(pets[1]!.props.source)
    expect(a.startsWith('<svg'), 'an svg document').toBe(true)
    expect(a.includes('#dc2626'), 'first helper is red').toBe(true)
    expect(b.includes('#ea580c'), 'second helper is orange').toBe(true)
    expect(a.includes('#2b1d16') && b.includes('#2b1d16'), 'same eyes and outline').toBe(true)
    expect(a.length < 131072, 'under the Svg limit').toBe(true)
    expect(String(pets[0]!.props.alt), 'alt names the colour').toBe('Claude crab, red')
    expect(Number(pets[0]!.props.width) >= 48, 'a bigger pet').toBe(true)

    // Running pets carry their motion as CSS keyframes; no redraw is needed.
    expect(a.includes('@keyframes'), 'a running pet animates in CSS').toBe(true)
    for (const name of ['bob', 'lg', 'up', 'dn', 'ey']) expect(a.includes(`@keyframes ${name}`), `keyframes ${name}`).toBe(true)

    // Finished: a static frame with no keyframes.
    await $.turn.complete({ answer: 'ok', agentId: 'agent-a1', reason: 'answer', durationMs: 1, isAborted: false, turnId: 't1' } as never)
    await clock.settle()
    const done = String((await v.findAll({ type: 'Svg' })).find(p => String(p.props.alt).endsWith('red'))?.props.source)
    expect(done.includes('@keyframes'), 'a finished pet has no keyframes').toBe(false)
    const other = String((await v.findAll({ type: 'Svg' })).find(p => String(p.props.alt).endsWith('orange'))?.props.source)
    expect(other.includes('@keyframes'), 'the one still working keeps moving').toBe(true)
  })

  test(`a new helper never takes a running helper's colour (${surface})`, { timeoutMs: 30000 }, async ($, on) => {
    const { clock, agents } = rig(on, {})
    await $.session.start({ source: 'startup', cwd: '/Users/test/vault', surface, isInteractive: true } as never)
    await $.agent.spawn({ tool_use_id: 's1', prompt: 'x', description: 'One', subagentType: 'general-purpose' } as never)
    await $.agent.spawn({ tool_use_id: 's2', prompt: 'x', description: 'Two', subagentType: 'general-purpose' } as never)
    await clock.settle()
    expect(agents, 'two spawned').toHaveLength(2)
    const v = await $.ui.mount({ plugin: 'helper-desk', surface, component: 'Pane', requestId: 'helpers', props: props() })
    const colours = async () =>
      surface === 'terminal'
        ? (await v.findAll({ type: 'Raster' })).map(t => String(t.props.cells))
        : (await v.findAll({ type: 'Svg' })).filter(p => String(p.props.alt).startsWith('Claude crab')).map(p => String(p.props.alt).replace('Claude crab, ', ''))
    const got = await colours()
    expect(new Set(got).size, 'two different colours').toBe(2)

    // One finishes, a third starts: it takes the next colour in order, never the running one's.
    await $.turn.complete({ answer: 'ok', agentId: 'agent-a1', reason: 'answer', durationMs: 1, isAborted: false, turnId: 't1' } as never)
    await $.agent.spawn({ tool_use_id: 's3', prompt: 'x', description: 'Three', subagentType: 'general-purpose' } as never)
    await clock.settle()
    const all = await colours()
    expect(all, 'three pets').toHaveLength(3)
    expect(new Set(all).size, 'three different colours').toBe(3)
    if (surface === 'desktop') expect(all, 'third is yellow').toContain('yellow')
  })

  test(`connector steps are named from the server or the tool names, never a raw id (${surface})`, { timeoutMs: 30000 }, async ($, on) => {
    const { clock } = rig(on, {})
    await $.session.start({ source: 'startup', cwd: '/Users/test/vault', surface, isInteractive: true } as never)
    const callTool = $.tool.call as unknown as (input: unknown) => Promise<unknown>
    await $.agent.spawn({ tool_use_id: 's1', prompt: 'x', description: 'Check the tools', subagentType: 'general-purpose' } as never)
    await clock.settle()
    // Made-up ids: on a real account each claude.ai connector has its own random id.
    const kit = 'mcp__00000000-0000-0000-0000-0000000000c1__'
    const calls = [
      { tool: `${kit}list_landing_pages` },
      // list_posts alone could be Kit or Circle; this server already showed it is Kit.
      { tool: `${kit}list_posts` },
      { tool: 'mcp__00000000-0000-0000-0000-0000000000c2__list_spaces' },
      { tool: 'mcp__00000000-0000-0000-0000-0000000000c3__notion-search', query: 'roadmap' },
      { tool: 'mcp__plugin_demo_fireflies__fireflies_search', query: 'kickoff' },
      { tool: 'mcp__claude_ai_Slack__slack_search_public', query: 'launch' },
      { tool: 'mcp__00000000-0000-0000-0000-0000000000c5__do_something_new' },
    ]
    let n = 0
    for (const c of calls) await callTool({ ...c, tool_use_id: `c${(n += 1)}`, agentId: 'agent-a1' } as never)
    await clock.advance(1_000)

    const v = await $.ui.mount({ plugin: 'helper-desk', surface, component: 'Pane', requestId: 'helpers', props: props(70) })
    await v.press({ key: 'steps-agent-a1' })
    for (const label of [
      /^Kit · list landing pages/,
      /^Kit · list posts/,
      /^Circle · list spaces/,
      /^Notion · search/,
      /^Fireflies · search/,
      /^Slack · search public/,
      /^Connector · do something new/,
    ]) {
      expect(await v.find({ text: label }), String(label)).toBeDefined()
    }
    expect(await v.find({ text: /00000000/ }), 'no raw server id').toBeUndefined()
  })

  test(`pressing a card's toggle shows its full step list (${surface})`, { timeoutMs: 30000 }, async ($, on) => {
    const { clock } = rig(on, {})
    await $.session.start({ source: 'startup', cwd: '/Users/test/vault', surface, isInteractive: true } as never)
    const callTool = $.tool.call as unknown as (input: unknown) => Promise<unknown>
    await $.agent.spawn({ tool_use_id: 's1', prompt: 'x', description: 'Prep the video', subagentType: 'general-purpose' } as never)
    await clock.settle()
    const calls = [
      { tool: 'Read', file_path: '/Users/test/vault/YouTube/videos/mods/pre-outline.md' },
      { tool: 'Bash', command: 'ls -la /tmp', description: 'List the temp folder' },
      { tool: 'mcp__00000000-0000-0000-0000-00000000000b__list_recent_files' },
      { tool: 'Skill', skill: 'video-prep' },
      { tool: 'WebFetch', url: 'https://docs.example.com/page', prompt: 'read' },
      { tool: 'Write', file_path: '/Users/test/vault/YouTube/videos/mods/research.md', content: 'x' },
    ]
    let n = 0
    for (const c of calls) await callTool({ ...c, tool_use_id: `c${(n += 1)}`, agentId: 'agent-a1' } as never)
    await clock.advance(1_000)

    const v = await $.ui.mount({ plugin: 'helper-desk', surface, component: 'Pane', requestId: 'helpers', props: props(70) })
    expect(await v.find({ text: /Step 6 · Writing research\.md/ }), 'live line').toBeDefined()
    expect(await v.find({ text: /Opening docs\.example\.com/ }), 'last steps under the live line').toBeDefined()
    expect(await v.find({ text: /pre-outline\.md/ }), 'collapsed hides older steps').toBeUndefined()
    expect((await v.find({ key: 'steps-agent-a1' }))?.text ?? '', 'toggle').toContain('All 6 steps')

    await v.press({ key: 'steps-agent-a1' })
    expect((await v.find({ key: 'steps-agent-a1' }))?.text ?? '', 'toggle open').toContain('Hide steps')
    expect(await v.find({ text: /^File read$/ }), 'kind tag').toBeDefined()
    expect(await v.find({ text: /^pre-outline\.md/ }), 'first step listed').toBeDefined()
    expect(await v.find({ text: /YouTube\/videos\/mods/ }), 'folder in dim text').toBeDefined()
    expect(await v.find({ text: /^List the temp folder/ }), 'command by its description').toBeDefined()
    expect(await v.find({ text: /^Google Drive · list recent files/ }), 'connector name and tool').toBeDefined()
    expect(await v.find({ text: /^video-prep/ }), 'skill name').toBeDefined()
    expect(await v.find({ text: /^docs\.example\.com/ }), 'web host').toBeDefined()
    expect(await v.find({ text: /^File write$/ }), 'write tag').toBeDefined()

    await v.press({ key: 'steps-agent-a1' })
    expect(await v.find({ text: /^File read$/ }), 'closed again').toBeUndefined()
  })

  test(`switches.json false: the pane draws nothing of its own (${surface})`, { timeoutMs: 30000 }, async ($, on) => {
    const files: Record<string, string> = {}
    const { opened, closed, clock } = rig(on, files)
    await $.session.start({ source: 'startup', cwd: '/Users/test/vault', surface, isInteractive: true } as never)
    await $.agent.spawn({ tool_use_id: 's1', prompt: 'x', description: 'Build the landing page', subagentType: 'general-purpose' } as never)
    await clock.settle()
    const v = await $.ui.mount({ plugin: 'helper-desk', surface, component: 'Pane', requestId: 'helpers', props: props() })
    expect(await v.find({ text: /Build the landing page/ }), 'drawn while on').toBeDefined()

    // The switchboard writes the file; the 3 s poll reads it.
    files['*/.claude/mods/switches.json'] = JSON.stringify({ 'helper-desk': false })
    await clock.advance(3_100)
    expect(closed, 'pane closed').toContain('helpers')
    expect(await v.find({ text: /Build the landing page/ }), 'no card').toBeUndefined()
    expect(await v.find({ text: /helper/i }), 'nothing of its own').toBeUndefined()
    const r = await $.command.run({ command: 'helpers', args: '' } as never)
    expect(String((r as { text?: string }).text), 'command says off').toContain('Helper Desk is off')

    // An open request is used up but opens nothing while off; on again, it opens.
    const before = opened.length
    files['*/.claude/mods/.open-helper-desk-sess1'] = ''
    await clock.advance(3_100)
    expect(opened.length, 'no open while off').toBe(before)
    expect('*/.claude/mods/.open-helper-desk-sess1' in files, 'request used up while off').toBe(false)
    files['*/.claude/mods/switches.json'] = '{}'
    files['*/.claude/mods/.open-helper-desk-sess1'] = ''
    await clock.advance(3_100)
    expect(opened.length, 'open request answered').toBe(before + 1)
    expect('*/.claude/mods/.open-helper-desk-sess1' in files, 'request file removed').toBe(false)
  })

  test(`each card has one sparkle bar (${surface})`, { timeoutMs: 30000 }, async ($, on) => {
    const { clock } = rig(on, {})
    await $.session.start({ source: 'startup', cwd: '/Users/test/vault', surface, isInteractive: true } as never)
    await $.agent.spawn({ tool_use_id: 's1', prompt: 'x', description: 'Build the landing page', subagentType: 'general-purpose' } as never)
    await clock.settle()
    const v = await $.ui.mount({ plugin: 'helper-desk', surface, component: 'Pane', requestId: 'helpers', props: props() })
    expect(await v.find({ text: /[─━]/ }), 'no thin two-line bar').toBeUndefined()
    if (surface === 'desktop') {
      const bars = (await v.findAll({ type: 'Svg' })).filter(b => b.props.alt === 'Working')
      expect(bars, 'one bar for the card').toHaveLength(1)
      expect(bars[0]!.props.height, 'thin').toBe(3)
      expect(bars[0]!.props.source, 'sparkles twinkle').toContain('@keyframes tw')
    } else {
      expect(await v.find({ text: /^▁{20,}$/ }), 'one bar of thin blocks').toBeDefined()
    }
  })

  test(`Hide in the pane writes the shared flag and closes it (${surface})`, { timeoutMs: 30000 }, async ($, on) => {
    const files: Record<string, string> = {}
    const { opened, closed, clock } = rig(on, files)
    await $.session.start({ source: 'startup', cwd: '/Users/test/vault', surface, isInteractive: true } as never)
    await $.agent.spawn({ tool_use_id: 's1', prompt: 'x', description: 'Build the landing page', subagentType: 'general-purpose' } as never)
    await clock.settle()
    expect(opened, 'opened by itself').toContain('helpers')
    const v = await $.ui.mount({ plugin: 'helper-desk', surface, component: 'Pane', requestId: 'helpers', props: props() })
    await v.press({ key: 'hide' })
    const sw = Object.keys(files).find(k => k.endsWith('/.claude/mods/switches.json')) ?? ''
    expect(JSON.parse(files[sw] ?? '{}'), 'Hide writes the shared flag').toEqual({ 'helper-desk:hidden': true })
    expect(closed, 'the pane closes').toContain('helpers')
  })

  test(`hidden, it does not open by itself; cleared, Show opens it (${surface})`, { timeoutMs: 30000 }, async ($, on) => {
    const files: Record<string, string> = { '*/.claude/mods/switches.json': JSON.stringify({ 'helper-desk:hidden': true }) }
    const { opened, clock } = rig(on, files)
    await $.session.start({ source: 'startup', cwd: '/Users/test/vault', surface, isInteractive: true } as never)
    await $.agent.spawn({ tool_use_id: 's1', prompt: 'x', description: 'Build the landing page', subagentType: 'general-purpose' } as never)
    await clock.settle()
    expect(opened, 'no auto open while hidden').not.toContain('helpers')

    files['*/.claude/mods/switches.json'] = '{}'
    files['*/.claude/mods/.open-helper-desk-sess1'] = ''
    await clock.advance(3_100)
    expect(opened, 'Show opens the pane').toContain('helpers')
    const v = await $.ui.mount({ plugin: 'helper-desk', surface, component: 'Pane', requestId: 'helpers', props: props() })
    expect(await v.find({ text: /Build the landing page/ }), 'the card draws').toBeDefined()
  })

  test(`the plan tool writes the plan file and draws "2 of 4" (${surface})`, { timeoutMs: 30000 }, async ($, on) => {
    const files: Record<string, string> = {}
    const { clock, ran } = rig(on, files)
    await $.session.start({ source: 'startup', cwd: '/Users/test/vault', surface, isInteractive: true } as never)
    const callTool = $.tool.call as unknown as (input: unknown) => Promise<{ result?: unknown }>
    const said = await callTool({ tool: 'mcp__helper-desk__plan', tool_use_id: 'p1', title: 'Make the deck', steps: steps4(2, true) })
    await clock.settle()
    expect(String(said.result), 'tool answer').toBe('Plan saved: 2 of 4 steps done.')
    const path = planFile(files)
    expect(path, 'plan file written').toBeDefined()
    const saved = JSON.parse(files[path!]!) as { title: string; steps: { text: string; status: string; doneAt?: string }[]; updatedAt: string }
    expect(saved.title, 'title saved').toBe('Make the deck')
    expect(saved.steps.map(st => st.status), 'statuses saved').toEqual(['completed', 'completed', 'in_progress', 'pending'])
    expect(typeof saved.steps[0]!.doneAt, 'done steps carry a time').toBe('string')
    expect(typeof saved.updatedAt, 'updatedAt').toBe('string')

    const v = await $.ui.mount({ plugin: 'helper-desk', surface, component: 'AbovePrompt', props: bandProps(80) })
    const says = await bandSays(v, surface)
    expect(says, 'plan title').toContain('Make the deck')
    expect(says, 'count').toContain('Tasks 2/4')
    expect(says, 'percent').toContain('50%')
    expect(await v.find({ type: 'Text', text: /^✓ Read the brief$/ }), 'done step').toBeDefined()
    expect(await v.find({ type: 'Text', text: /^✓ Draft the outline$/ }), 'done step').toBeDefined()
    expect(await v.find({ type: 'Text', text: /^○ Check the deck$/ }), 'pending step').toBeDefined()
    const flashOf = async () => String((await v.find({ type: 'Text', text: /^▶ Build the slides$/ }))!.props.dimColor)
    // Idle: no turn is running, so the flash holds still.
    const idle1 = await flashOf()
    await clock.advance(1_000)
    expect(await flashOf(), 'idle: the step in progress holds still').toBe(idle1)
    await $.turn.start({ turnId: 'm1', text: 'go' } as never)
    const live1 = await flashOf()
    await clock.advance(360)
    const live2 = await flashOf()
    expect(live1 !== live2, 'the step in progress flashes during a main turn').toBe(true)
    expect(await v.find({ text: /^█$/ }), 'no progress bar').toBeUndefined()
    // A row budget smaller than the list shows a window from just before the step in progress.
    const tight = await $.ui.mount({ plugin: 'helper-desk', surface, component: 'AbovePrompt', props: { ...(bandProps(80) as object), maxRows: 4 } as never })
    expect(await tight.find({ type: 'Text', text: /^✓ 2 earlier done$/ }), 'earlier steps folded').toBeDefined()
    expect(await tight.find({ type: 'Text', text: /^▶ Build the slides$/ }), 'step in progress kept').toBeDefined()
    expect(await tight.find({ type: 'Text', text: /^○ 1 more$/ }), 'later steps folded').toBeDefined()
    expect(await tight.findAll({ type: 'Text', text: /^[✓▶○] / }), 'within the row budget').toHaveLength(3)

    // The bar follows the plan, not subagents: a running subagent adds nothing to it.
    await $.agent.spawn({ tool_use_id: 's1', prompt: 'x', description: 'Build the slides', subagentType: 'general-purpose' } as never)
    await clock.settle()
    expect(await v.find({ text: /subagent/i }), 'no subagent line').toBeUndefined()

    // The ✕ hides the bar; the next plan update brings it back.
    await v.press({ key: 'plan-dismiss' })
    expect(await v.find({ key: 'plan-band' }), 'dismissed').toBeUndefined()
    await callTool({ tool: 'mcp__helper-desk__plan', tool_use_id: 'p2', title: 'Make the deck', steps: steps4(3, true) })
    await clock.settle()
    expect(await bandSays(v, surface), 'back on the next update').toContain('Tasks 3/4')
  })

  test(`a TodoWrite call on the main chat is mirrored into the plan (${surface})`, { timeoutMs: 30000 }, async ($, on) => {
    const files: Record<string, string> = {}
    const { clock } = rig(on, files)
    await $.session.start({ source: 'startup', cwd: '/Users/test/vault', surface, isInteractive: true } as never)
    const callTool = $.tool.call as unknown as (input: unknown) => Promise<unknown>
    const todos = [
      { content: 'Pull the numbers', status: 'completed', activeForm: 'Pulling the numbers' },
      { content: 'Write the summary', status: 'in_progress', activeForm: 'Writing the summary' },
      { content: 'Send the link', status: 'pending', activeForm: 'Sending the link' },
    ]
    // A subagent's list is its own: it stays out of the plan.
    await callTool({ tool: 'TodoWrite', tool_use_id: 't0', todos, agentId: 'agent-x' })
    await clock.settle()
    expect(planFile(files), 'no plan from a subagent').toBeUndefined()

    await callTool({ tool: 'TodoWrite', tool_use_id: 't1', todos })
    await clock.settle()
    const saved = JSON.parse(files[planFile(files)!]!) as { steps: { text: string; status: string }[] }
    expect(saved.steps.map(st => st.text), 'todos mirrored').toEqual(['Pull the numbers', 'Write the summary', 'Send the link'])
    const v = await $.ui.mount({ plugin: 'helper-desk', surface, component: 'AbovePrompt', props: bandProps() })
    expect(await bandSays(v, surface), 'band from TodoWrite').toContain('Tasks 1/3')
    expect(await v.find({ type: 'Text', text: /^▶ Write the summary$/ }), 'current todo').toBeDefined()
  })

  test(`a step finishing raises a toast, and a finished plan holds 20 s then hides (${surface})`, { timeoutMs: 30000 }, async ($, on) => {
    const { clock, toasts } = rig(on, {})
    await $.session.start({ source: 'startup', cwd: '/Users/test/vault', surface, isInteractive: true } as never)
    const callTool = $.tool.call as unknown as (input: unknown) => Promise<unknown>
    const plan = (steps: unknown, n: number) => callTool({ tool: 'mcp__helper-desk__plan', tool_use_id: `p${n}`, title: 'Make the deck', steps })
    await plan(steps4(1, true), 1)
    await clock.settle()
    expect(toasts, 'no toast for steps already done in a new plan').toHaveLength(0)
    await plan(steps4(2, true), 2)
    await clock.settle()
    expect(toasts, 'the step that finished').toEqual(['Done: Draft the outline'])

    await plan(steps4(4, false), 3)
    await clock.settle()
    expect(toasts[toasts.length - 1], 'whole plan done').toBe('All 4 steps done.')
    const v = await $.ui.mount({ plugin: 'helper-desk', surface, component: 'AbovePrompt', props: bandProps() })
    expect(await bandSays(v, surface), 'held at 100%').toContain('100%')
    await clock.advance(19_000)
    expect(await v.find({ key: 'plan-band' }), 'still there before 20 s').toBeDefined()
    await clock.advance(1_500)
    expect(await v.find({ key: 'plan-band' }), 'gone after 20 s').toBeUndefined()

    // A new plan brings the band back.
    await plan(steps4(0, true), 4)
    await clock.settle()
    expect(await bandSays(v, surface), 'new plan shows').toContain('Tasks 0/4')
  })

  test(`off or hidden: the band draws nothing of its own (${surface})`, { timeoutMs: 30000 }, async ($, on) => {
    const files: Record<string, string> = {}
    const { clock } = rig(on, files)
    await $.session.start({ source: 'startup', cwd: '/Users/test/vault', surface, isInteractive: true } as never)
    const callTool = $.tool.call as unknown as (input: unknown) => Promise<{ result?: unknown }>
    await callTool({ tool: 'mcp__helper-desk__plan', tool_use_id: 'p1', steps: steps4(1, true) })
    await clock.settle()
    const v = await $.ui.mount({ plugin: 'helper-desk', surface, component: 'AbovePrompt', props: bandProps() })
    expect(await v.find({ key: 'plan-band' }), 'drawn while on').toBeDefined()

    files['*/.claude/mods/switches.json'] = JSON.stringify({ 'helper-desk:hidden': true })
    await clock.advance(3_100)
    expect(await v.find({ key: 'plan-band' }), 'hidden: no band').toBeUndefined()

    files['*/.claude/mods/switches.json'] = JSON.stringify({ 'helper-desk': false })
    await clock.advance(3_100)
    expect(await v.find({ key: 'plan-band' }), 'off: no band').toBeUndefined()
    expect(await v.find({ text: /Tasks|steps/ }), 'off: nothing of its own').toBeUndefined()
    const said = await callTool({ tool: 'mcp__helper-desk__plan', tool_use_id: 'p2', steps: steps4(2, true) })
    expect(String(said.result), 'the tool says it is off').toContain('off')
  })
}

test('the flash follows the main turn only', { timeoutMs: 30000 }, async ($, on) => {
  const { clock } = rig(on, {})
  await $.session.start({ source: 'startup', cwd: '/Users/test/vault', surface: 'terminal', isInteractive: true } as never)
  const callTool = $.tool.call as unknown as (input: unknown) => Promise<unknown>
  await callTool({ tool: 'mcp__helper-desk__plan', tool_use_id: 'p1', title: 'Make the deck', steps: steps4(2, true) })
  await clock.settle()
  const v = await $.ui.mount({ plugin: 'helper-desk', surface: 'terminal', component: 'AbovePrompt', props: bandProps(80) })
  const seen = async () => {
    const out = new Set<string>()
    for (let i = 0; i < 4; i += 1) {
      out.add(String((await v.find({ type: 'Text', text: /^▶ Build the slides$/ }))!.props.dimColor))
      await clock.advance(350)
    }
    return out.size
  }
  expect(await seen(), 'idle: one static frame').toBe(1)
  // A subagent's turn is not the main loop's.
  const done = { answer: '', durationMs: 5, isAborted: false, reason: 'answer' }
  await $.turn.start({ turnId: 's1', text: 'sub', agentId: 'agent-x' } as never)
  expect(await seen(), 'subagent turn: still static').toBe(1)
  await $.turn.start({ turnId: 't1', text: 'go' } as never)
  expect(await seen(), 'main turn: flashes').toBe(2)
  await $.turn.complete({ ...done, turnId: 's1', agentId: 'agent-x' } as never)
  expect(await seen(), 'subagent done mid-turn: keeps flashing').toBe(2)
  await $.turn.complete({ ...done, turnId: 't1' } as never)
  expect(await seen(), 'main turn over: static again').toBe(1)
  // An aborted turn and a failed one stop it like a finished one.
  await $.turn.start({ turnId: 't2', text: 'again' } as never)
  expect(await seen(), 'next main turn: flashes').toBe(2)
  await $.turn.complete({ ...done, turnId: 't2', isAborted: true, reason: 'aborted' } as never)
  expect(await seen(), 'aborted turn: static').toBe(1)
  await $.turn.start({ turnId: 't3', text: 'once more' } as never)
  expect(await seen(), 'next main turn: flashes').toBe(2)
  await $.turn.complete({ ...done, turnId: 't3', reason: 'error' } as never)
  expect(await seen(), 'failed turn: static').toBe(1)
})

test('/helpers steps <n> counts cards in the order the pane lists them', { timeoutMs: 30000 }, async ($, on) => {
  const { clock, agents } = rig(on, {})
  await $.session.start({ source: 'startup', cwd: '/Users/test/vault', surface: 'terminal', isInteractive: true } as never)
  const callTool = $.tool.call as unknown as (input: unknown) => Promise<unknown>
  for (const [n, d] of [[1, 'First'], [2, 'Second']] as const) await $.agent.spawn({ tool_use_id: `s${n}`, prompt: 'x', description: d, subagentType: 'general-purpose' } as never)
  await callTool({ tool: 'Read', tool_use_id: 'c1', file_path: '/a.md', agentId: 'agent-a1' })
  await callTool({ tool: 'Read', tool_use_id: 'c2', file_path: '/b.md', agentId: 'agent-a2' })
  await clock.settle()
  // The first helper finishes: the pane now lists Second (running) above First (finished).
  await $.turn.complete({ answer: 'ok', agentId: 'agent-a1', reason: 'answer', durationMs: 1, isAborted: false, turnId: 't1' } as never)
  await clock.settle()
  expect(agents, 'two spawned').toHaveLength(2)
  const v = await $.ui.mount({ plugin: 'helper-desk', surface: 'terminal', component: 'Pane', requestId: 'helpers', props: props(80) })
  const run = (args: string) => $.command.run({ command: 'helpers', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } } as never)
  await run('steps 1')
  expect((await v.find({ key: 'steps-agent-a2' }))?.text ?? '', 'card 1 is the running one').toContain('Hide steps')
  expect((await v.find({ key: 'steps-agent-a1' }))?.text ?? '', 'card 2 stays closed').toContain('All 1 step')
})

test('the pane and band fit 40, 80 and 144 columns on every surface, with theme colours only', { timeoutMs: 30000 }, async ($, on) => {
  const { clock } = rig(on, {})
  await $.session.start({ source: 'startup', cwd: '/Users/test/vault', surface: 'terminal', isInteractive: true } as never)
  const callTool = $.tool.call as unknown as (input: unknown) => Promise<unknown>
  await $.agent.spawn({ tool_use_id: 's1', prompt: 'x', description: 'Build the landing page with a long description', subagentType: 'general-purpose' } as never)
  await $.agent.spawn({ tool_use_id: 's2', prompt: 'x', description: 'Design the graphics', subagentType: 'general-purpose' } as never)
  await callTool({ tool: 'Read', tool_use_id: 'c1', file_path: '/Users/test/vault/research.md', agentId: 'agent-a1' })
  await callTool({ tool: 'mcp__helper-desk__plan', tool_use_id: 'p1', title: 'A plan with a fairly long title', steps: steps4(1, true) })
  await clock.settle()
  const tooWide = (els: FoundElement[], width: number) =>
    els.filter(el => el.type === 'Box' && typeof el.props.width === 'number' && el.props.width > Math.max(32, width)).map(el => String(el.props.width))
  for (const surface of ['terminal', 'desktop'] as const) {
    for (const width of WIDTHS) {
      const pane = await $.ui.mount({ plugin: 'helper-desk', surface, component: 'Pane', requestId: 'helpers', props: props(width) })
      const paneEls = await pane.findAll({})
      expect(rawColors(paneEls), `pane ${surface} ${width}: raw colours`).toEqual([])
      expect(tooWide(paneEls, width), `pane ${surface} ${width}: nothing wider than the body`).toEqual([])
      await pane.unmount()
      const band = await $.ui.mount({ plugin: 'helper-desk', surface, component: 'AbovePrompt', props: bandProps(width) })
      expect(rawColors(await band.findAll({})), `band ${surface} ${width}: raw colours`).toEqual([])
      expect(await band.find({ key: 'plan-band' }), `band ${surface} ${width}: drawn`).toBeDefined()
      await band.unmount()
    }
  }
})

test('the pane hints at focus only while unfocused, and each button has a /helpers subcommand', { timeoutMs: 30000 }, async ($, on) => {
  const files: Record<string, string> = {}
  const { clock, closed } = rig(on, files)
  await $.session.start({ source: 'startup', cwd: '/Users/test/vault', surface: 'terminal', isInteractive: true } as never)
  await $.agent.spawn({ tool_use_id: 's1', prompt: 'x', description: 'Build the landing page', subagentType: 'general-purpose' } as never)
  await $.tool.call({ tool: 'Read', tool_use_id: 'c1', file_path: '/Users/test/vault/a.md', agentId: 'agent-a1' } as never)
  await clock.settle()
  for (const width of WIDTHS) {
    for (const [isFocused, shown] of [[false, true], [true, false], [undefined, false]] as const) {
      const v = await $.ui.mount({ plugin: 'helper-desk', surface: 'terminal', component: 'Pane', requestId: 'helpers', props: { ...(props(width) as object), isFocused } as never })
      const hint = await v.find({ type: 'Text', text: /^Focus this pane/ })
      expect(hint !== undefined, `hint at ${width}, isFocused=${String(isFocused)}`).toBe(shown)
      if (hint) {
        expect(hint.props.wrap, 'hint truncates').toBe('truncate-end')
        expect(hint.props.dimColor, 'hint is dim').toBe(true)
      }
      await v.unmount()
    }
  }
  const run = (args: string) => $.command.run({ command: 'helpers', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } } as never)
  const v = await $.ui.mount({ plugin: 'helper-desk', surface: 'terminal', component: 'Pane', requestId: 'helpers', props: props(80) })
  expect(await v.find({ key: 'steps-agent-a1' }), 'toggle drawn').toBeDefined()
  expect(await v.find({ text: /Step 1 · Reading a\.md/ })).toBeDefined()
  // steps: same as pressing the card toggle.
  await run('steps 1')
  expect((await v.find({ key: 'steps-agent-a1' }))?.text ?? '', 'steps opens the list').toContain('Hide steps')
  await run('steps agent-a1')
  expect((await v.find({ key: 'steps-agent-a1' }))?.text ?? '', 'steps by id closes it').toContain('All 1 step')
  // fold: same as pressing the group arrow.
  await run('fold running')
  expect(await v.find({ key: 'card-agent-a1' }), 'fold hides the cards').toBeUndefined()
  await run('fold running')
  expect(await v.find({ key: 'card-agent-a1' }), 'fold again shows them').toBeDefined()
  expect(String(((await run('fold nonsense')) as { text?: string }).text), 'bad group').toContain('Usage')
  // hide: same as pressing Hide.
  await run('hide')
  const sw = Object.keys(files).find(k => k.endsWith('/.claude/mods/switches.json')) ?? ''
  expect(JSON.parse(files[sw] ?? '{}'), 'hide writes the shared flag').toEqual({ 'helper-desk:hidden': true })
  expect(closed, 'hide closes the pane').toContain('helpers')
})

test('the band yields to a survey', { timeoutMs: 30000 }, async ($, on) => {
  const { clock } = rig(on, {})
  await $.session.start({ source: 'startup', cwd: '/Users/test/vault', surface: 'terminal', isInteractive: true } as never)
  const callTool = $.tool.call as unknown as (input: unknown) => Promise<unknown>
  await callTool({ tool: 'mcp__helper-desk__plan', tool_use_id: 'p1', steps: steps4(1, true) })
  await clock.settle()
  const survey = await $.ui.mount({ plugin: 'helper-desk', surface: 'terminal', component: 'AbovePrompt', props: { ...(bandProps(80) as object), hasSurvey: true } as never })
  expect(await survey.find({ key: 'plan-band' }), 'survey: no band').toBeUndefined()
  const shown = await $.ui.mount({ plugin: 'helper-desk', surface: 'terminal', component: 'AbovePrompt', props: bandProps(80) })
  expect(await shown.find({ key: 'plan-band' }), 'no survey: band').toBeDefined()
})

test('the plan tool sits in front, and work without a plan gets one nudge', { timeoutMs: 30000 }, async ($, on) => {
  specs = []
  const files: Record<string, string> = {}
  const { clock } = rig(on, files)
  await $.session.start({ source: 'startup', cwd: '/Users/test/vault', surface: 'desktop', isInteractive: true } as never)
  await clock.settle()
  expect(specs[0]?.isDeferred, 'not behind ToolSearch').toBe(false)

  const callTool = $.tool.call as unknown as (input: unknown) => Promise<{ result?: unknown; context?: string[] }>
  const first = await callTool({ tool: 'Bash', tool_use_id: 'b1', command: 'ls' })
  expect((first.context ?? []).join(' '), 'no plan yet: nudge').toContain('mcp__helper-desk__plan')
  const second = await callTool({ tool: 'Bash', tool_use_id: 'b2', command: 'ls' })
  expect(second.context ?? [], 'only once a turn').toHaveLength(0)

  await callTool({ tool: 'mcp__helper-desk__plan', tool_use_id: 'p1', steps: steps4(0, true) })
  const after = await callTool({ tool: 'Read', tool_use_id: 'r1', file_path: '/x' })
  expect(after.context ?? [], 'plan made: quiet').toHaveLength(0)
  expect(planFile(files), 'plan file written for Chat Inventory').toBeDefined()
})

// ---------- Jev cards ----------

const JEV_FILE = '*/.claude/logs/jev-live/sess1.json'

const jevCall = (id: string, phase: string, extra: Record<string, unknown> = {}) => ({
  id,
  at: 1_000_000,
  description: 'Fluid pass: filetree',
  subagentType: 'general-purpose',
  chosen: 'sonnet',
  chosenEffort: 'medium',
  phase,
  ...extra,
})
const jevFile = (calls: unknown[]) => JSON.stringify({ calls })
const judgedCall = jevCall('j1', 'judged', {
  tier: 'sonnet',
  effort: 'high',
  probs: { haiku: 0.1, sonnet: 0.74, opus: 0.16 },
  judge: { tier: 'sonnet', effort: 'medium', model: 'haiku', reason: 'Scoped edit across a few files.' },
})

test('Jev calls draw as cards at 40, 80 and 144 columns on both surfaces, with theme colours only', { timeoutMs: 30000 }, async ($, on) => {
  const files: Record<string, string> = {
    [JEV_FILE]: jevFile([
      judgedCall,
      jevCall('j2', 'asking'),
      jevCall('j3', 'judging', { tier: 'opus', effort: 'low', probs: { haiku: 0.2, sonnet: 0.3, opus: 0.5 } }),
      jevCall('j4', 'skipped', { skipReason: 'timeout' }),
    ]),
  }
  rig(on, files)
  await $.session.start({ source: 'startup', cwd: '/Users/test/vault', surface: 'terminal', isInteractive: true } as never)
  for (const surface of ['terminal', 'desktop'] as const) {
    for (const width of WIDTHS) {
      const v = await $.ui.mount({ plugin: 'helper-desk', surface, component: 'Pane', requestId: 'helpers', props: props(width) })
      const where = `${surface} ${width}`
      expect(await v.findAll({ type: 'Text', text: /^ Jev $/ }), `${where}: one Jev badge per call`).toHaveLength(4)
      expect(await v.find({ type: 'Text', text: /→ sonnet 74% · high$/ }), `${where}: the pick`).toBeDefined()
      expect(await v.findAll({ type: 'Text', text: /^ran sonnet · medium$/ }), `${where}: what ran`).toHaveLength(3)
      expect(await v.find({ type: 'Text', text: /^judge \(haiku\): sonnet · medium/ }), `${where}: the verdict`).toBeDefined()
      expect(await v.find({ type: 'Text', text: /→ asking…$/ }), `${where}: asking`).toBeDefined()
      expect(await v.find({ type: 'Text', text: /^chose sonnet · medium$/ }), `${where}: asking has chosen, not ran`).toBeDefined()
      expect(await v.find({ type: 'Text', text: /^judging…$/ }), `${where}: judging`).toBeDefined()
      expect(await v.find({ type: 'Text', text: /→ skipped \(timeout\)$/ }), `${where}: skipped`).toBeDefined()
      expect(await v.find({ text: /Claude crab/ }), `${where}: no pet on a Jev card`).toBeUndefined()
      const badge = await v.find({ type: 'Text', text: /^ Jev $/ })
      expect(badge?.props.backgroundColor, `${where}: badge is suggestion`).toBe('suggestion')
      expect(rawColors(await v.findAll({})), `${where}: raw colours`).toEqual([])
      await v.unmount()

      const band = await $.ui.mount({ plugin: 'helper-desk', surface, component: 'AbovePrompt', props: bandProps(width) })
      expect(await band.find({ type: 'Text', text: /^asking about Fluid/ }), `${where}: band entry while asking`).toBeDefined()
      expect(rawColors(await band.findAll({})), `${where}: band raw colours`).toEqual([])
      await band.unmount()
    }
  }
})

test('no Jev file, or one that cannot be read, draws no cards and no error', { timeoutMs: 30000 }, async ($, on) => {
  const files: Record<string, string> = {}
  const { clock } = rig(on, files)
  await $.session.start({ source: 'startup', cwd: '/Users/test/vault', surface: 'terminal', isInteractive: true } as never)
  let open: { unmount: () => Promise<unknown> } | undefined
  const mount = async () => {
    await open?.unmount()
    const pane = await $.ui.mount({ plugin: 'helper-desk', surface: 'terminal', component: 'Pane', requestId: 'helpers', props: props(80) })
    open = pane
    return pane
  }
  expect(await (await mount()).find({ text: /Jev/ }), 'missing file').toBeUndefined()
  files[JEV_FILE] = '{ not json'
  await $.agent.spawn({ tool_use_id: 's1', prompt: 'x', description: 'One', subagentType: 'general-purpose' } as never)
  await clock.advance(2_100)
  expect(await (await mount()).find({ text: /Jev/ }), 'unreadable file').toBeUndefined()
  files[JEV_FILE] = JSON.stringify({ calls: 'nope' })
  await clock.advance(2_100)
  expect(await (await mount()).find({ text: /Jev/ }), 'wrong shape').toBeUndefined()
  const band = await $.ui.mount({ plugin: 'helper-desk', surface: 'terminal', component: 'AbovePrompt', props: bandProps(80) })
  expect(await band.find({ text: /Jev/ }), 'no band entry').toBeUndefined()
})

test('the Jev poller runs while a call is open, stops once all are final, and restarts on an Agent dispatch', { timeoutMs: 30000 }, async ($, on) => {
  const files: Record<string, string> = { [JEV_FILE]: jevFile([jevCall('j1', 'asking')]) }
  const { clock, probes } = rig(on, files)
  const callTool = $.tool.call as unknown as (input: unknown) => Promise<unknown>
  await $.session.start({ source: 'startup', cwd: '/Users/test/vault', surface: 'terminal', isInteractive: true } as never)
  const v = await $.ui.mount({ plugin: 'helper-desk', surface: 'terminal', component: 'Pane', requestId: 'helpers', props: props(80) })
  expect(await v.find({ type: 'Text', text: /→ asking…$/ }), 'asking from the first read').toBeDefined()

  const before = probes.jevReads
  await clock.advance(6_100)
  expect(probes.jevReads - before, 'polls while a call is open').toBeGreaterThanOrEqual(2)

  files[JEV_FILE] = jevFile([judgedCall])
  await clock.advance(2_100)
  expect(await v.find({ type: 'Text', text: /^judge \(haiku\)/ }), 'the verdict arrives').toBeDefined()
  const stopped = probes.jevReads
  await clock.advance(20_000)
  expect(probes.jevReads, 'no reads once every call is final').toBe(stopped)

  // A new Agent dispatch starts it again, and it holds on a few seconds for the first row.
  files[JEV_FILE] = jevFile([judgedCall, jevCall('j2', 'asking', { description: 'Second pass' })])
  await callTool({ tool: 'Agent', tool_use_id: 'a1', description: 'Second pass', prompt: 'x', subagentType: 'general-purpose' })
  await clock.settle()
  expect(await v.find({ type: 'Text', text: /Second pass → asking…$/ }), 'new call drawn at once').toBeDefined()
  files[JEV_FILE] = jevFile([
    judgedCall,
    jevCall('j2', 'judged', { description: 'Second pass', tier: 'haiku', effort: 'low', judge: { tier: 'haiku', effort: 'low', model: 'haiku', reason: 'ok' } }),
  ])
  await clock.advance(2_100)
  const again = probes.jevReads
  await clock.advance(20_000)
  expect(probes.jevReads - again, 'stops again once the grace period is over').toBeLessThanOrEqual(3)
  const settled = probes.jevReads
  await clock.advance(20_000)
  expect(probes.jevReads, 'and stays stopped').toBe(settled)
})

// ---------- Agent links ----------

test('session.send puts a link chip on both cards; pressing one scrolls to and lights the other', { timeoutMs: 30000 }, async ($, on) => {
  const { clock } = rig(on, {})
  await $.session.start({ source: 'startup', cwd: '/Users/test/vault', surface: 'terminal', isInteractive: true } as never)
  const spawn = (name: string, n: number) =>
    $.agent.spawn({ tool_use_id: `s${n}`, prompt: 'x', description: `Task of ${name}`, subagentType: 'general-purpose', name } as never)
  await spawn('alice', 1)
  await spawn('bob', 2)
  await clock.settle()
  const send = (to: string, agentId?: string) => $.session.send({ to, text: 'hello', ...(agentId ? { agentId } : {}) } as never)
  expect(await send('bob', 'agent-a1'), 'the send still goes through').toMatchObject({ isDelivered: true })
  await send('alice')
  await send('team-lead', 'agent-a1')
  await clock.settle()

  for (const surface of ['terminal', 'desktop'] as const) {
    for (const width of WIDTHS) {
      const where = `${surface} ${width}`
      const v = await $.ui.mount({ plugin: 'helper-desk', surface, component: 'Pane', requestId: 'helpers', props: props(width) })
      expect((await v.find({ key: 'goto|agent-a1|to|agent-a2' }))?.text ?? '', `${where}: sender chip`).toMatch(/^→ /)
      expect((await v.find({ key: 'goto|agent-a2|from|agent-a1' }))?.text ?? '', `${where}: receiver chip`).toMatch(/^← /)
      expect(await v.find({ type: 'Text', text: /^→ main chat$/ }), `${where}: to the main chat is plain text`).toBeDefined()
      expect(await v.find({ type: 'Text', text: /^← main chat$/ }), `${where}: from the main chat is plain text`).toBeDefined()
      expect(await v.find({ key: 'goto|agent-a1|to|main' }), `${where}: no button for the main chat`).toBeUndefined()
      expect(rawColors(await v.findAll({})), `${where}: raw colours`).toEqual([])
      await v.unmount()
    }
  }

  const v = await $.ui.mount({ plugin: 'helper-desk', surface: 'terminal', component: 'Pane', requestId: 'helpers', props: props(80) })
  expect((await v.find({ key: 'goto|agent-a2|from|agent-a1' }))?.text, 'chip shows the name').toBe('← alice')
  const border = async (id: string) => (await v.find({ key: `card-${id}` }))?.props.borderColor
  expect(await border('agent-a1'), 'not lit at rest').not.toBe('claude')
  await v.press({ key: 'goto|agent-a2|from|agent-a1' })
  expect(await border('agent-a1'), 'the card is lit').toBe('claude')
  await clock.advance(1_900)
  expect(await border('agent-a1'), 'still lit before 2 s').toBe('claude')
  await clock.advance(300)
  expect(await border('agent-a1'), 'back to rest after 2 s').not.toBe('claude')

  const run = (args: string) => $.command.run({ command: 'helpers', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } } as never)
  expect(String(((await run('goto bob')) as { text?: string }).text), 'goto by name').toContain('Scrolled to bob')
  expect(await border('agent-a2'), 'goto lights the card').toBe('claude')
  expect(String(((await run('goto nobody')) as { text?: string }).text), 'goto unknown').toContain('Usage')
})

test('a card keeps only its last three peers', { timeoutMs: 30000 }, async ($, on) => {
  const { clock } = rig(on, {})
  await $.session.start({ source: 'startup', cwd: '/Users/test/vault', surface: 'terminal', isInteractive: true } as never)
  for (const [i, name] of ['alice', 'bob', 'cy'].entries()) {
    await $.agent.spawn({ tool_use_id: `s${i}`, prompt: 'x', description: `Task ${name}`, subagentType: 'general-purpose', name } as never)
  }
  await clock.settle()
  // alice writes to bob, cy, bob again and the main chat: four sends, three peers kept.
  for (const to of ['bob', 'cy', 'bob', 'team-lead']) await $.session.send({ to, text: 'hi', agentId: 'agent-a1' } as never)
  await clock.settle()
  const v = await $.ui.mount({ plugin: 'helper-desk', surface: 'terminal', component: 'Pane', requestId: 'helpers', props: props(144) })
  const chips = (await v.findAll({ type: 'Button' })).filter(b => String(b.props.key).startsWith('goto|agent-a1|to|'))
  expect(chips, 'two helper buttons').toHaveLength(2)
  expect(await v.find({ type: 'Text', text: /^→ main chat$/ }), 'and the main chat').toBeDefined()
})

// ---------- Crab motion ----------

test('drawCrab is sized to its canvas and moves over time', () => {
  for (const [columns, rows] of [[9, 4], [18, 7], [5, 3], [30, 8]] as const) {
    expect(drawCrab(columns, rows, 0, 0).length, `${columns}x${rows}: 16 base64 characters a cell`).toBe(columns * rows * 16)
  }
  const { columns, rows } = petCanvas(80)
  const seen = new Set<string>()
  for (let t = 0; t < 4_000; t += 40) seen.add(drawCrab(columns, rows, t, 0))
  expect(seen.size, 'bob, legs, claws and blink make many distinct frames').toBeGreaterThan(8)
  expect(drawCrab(columns, rows, 0, 0, { still: true }), 'the standing pose does not move').toBe(drawCrab(columns, rows, 999, 0, { still: true }))
  expect(drawCrab(columns, rows, 400, 0) !== drawCrab(columns, rows, 400, 1), 'each pet has its own colour and phase').toBe(true)
  expect(petCanvas(40), 'a narrow pane gets the half-size pet').toEqual({ columns: 12, rows: 5 })
  expect(petCanvas(80), 'a wide pane gets the full-size pet').toEqual({ columns: 24, rows: 9 })
  expect(petCanvas(144), 'and so does a very wide one').toEqual({ columns: 24, rows: 9 })
})

test('the pet timer runs only while a helper works, once, and stops on a denied blit, motion off or the last finish', { timeoutMs: 30000 }, async ($, on) => {
  const { clock, probes } = rig(on, {})
  await $.session.start({ source: 'startup', cwd: '/Users/test/vault', surface: 'terminal', isInteractive: true } as never)
  let open: { unmount: () => Promise<unknown> } | undefined
  const mount = async () => {
    await open?.unmount()
    const pane = await $.ui.mount({ plugin: 'helper-desk', surface: 'terminal', component: 'Pane', requestId: 'helpers', props: props(80) })
    open = pane
    return pane
  }
  const run = (args: string) => $.command.run({ command: 'helpers', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } } as never)
  const spawn = (n: number) => $.agent.spawn({ tool_use_id: `s${n}`, prompt: 'x', description: `Task ${n}`, subagentType: 'general-purpose' } as never)
  const done = (id: string, n: number) => $.turn.complete({ answer: 'ok', agentId: id, reason: 'answer', durationMs: 1, isAborted: false, turnId: `t${n}` } as never)

  // Idle: no helpers, no blits.
  let v = await mount()
  await clock.advance(1_000)
  expect(probes.blits, 'idle: no blits').toBe(0)

  // Working: blits come, from one timer for all pets (at most one a pet a 40 ms frame).
  await spawn(1)
  await clock.settle()
  v = await mount()
  const t0 = probes.blits
  await clock.advance(400)
  expect(probes.blits - t0, 'working: blits').toBeGreaterThan(0)
  await spawn(2)
  await clock.settle()
  v = await mount()
  const t1 = probes.blits
  await clock.advance(400)
  const two = probes.blits - t1
  // The clock mock cannot count timers, so count what a second timer would double: ten 40 ms frames, two pets.
  expect(two, 'two pets, one timer: exactly one blit a pet a 40 ms frame').toBe(2 * 10)

  // A finished pet is not repainted; the other keeps going.
  await done('agent-a1', 1)
  await clock.settle()
  const t2 = probes.blits
  await clock.advance(400)
  const one = probes.blits - t2
  expect(one, 'one working pet: fewer blits').toBeLessThan(two)
  expect(one, 'and still moving').toBeGreaterThan(0)

  // Motion off mid-run stops at once and draws the standing pose; on starts it again.
  expect(String(((await run('motion off')) as { text?: string }).text), 'motion command').toContain('off')
  const t3 = probes.blits
  await clock.advance(400)
  expect(probes.blits, 'motion off: no blits').toBe(t3)
  const { columns, rows } = petCanvas(80)
  const rasters = (await v.findAll({ type: 'Raster' })).map(r => String(r.props.cells))
  expect(rasters, 'standing frames while off').toContain(drawCrab(columns, rows, 0, 1, { tier: 'opus', still: true }))
  await run('motion on')
  await clock.advance(400)
  expect(probes.blits, 'motion on: blits again').toBeGreaterThan(t3)

  // The last helper finishing stops the timer.
  await done('agent-a2', 2)
  await clock.settle()
  const t4 = probes.blits
  await clock.advance(1_000)
  expect(probes.blits, 'after the last finish: no blits').toBe(t4)

  // A denied blit (the canvas is gone) stops painting until the next draw.
  await spawn(3)
  await clock.settle()
  probes.denyBlit = true
  v = await mount()
  await clock.advance(400)
  const t5 = probes.blits
  expect(t5 - t4, 'one denied blit is enough').toBeLessThanOrEqual(2)
  await clock.advance(1_000)
  // The 300 ms clock tick redraws the card, and a redraw is the next draw: one try each, not 25 a second.
  expect(probes.blits - t5, 'denied: one blit per redraw, not one per frame').toBeLessThanOrEqual(4)
  probes.denyBlit = false
  v = await mount()
  await clock.advance(400)
  expect(probes.blits, 'a new draw starts it again').toBeGreaterThan(t5)
  void v
})

test('motion off is kept across sessions: a stored off starts the pets still', { timeoutMs: 30000 }, async ($, on) => {
  const { clock, probes } = rig(on, {}, { motion: false })
  await $.session.start({ source: 'startup', cwd: '/Users/test/vault', surface: 'terminal', isInteractive: true } as never)
  await $.agent.spawn({ tool_use_id: 's1', prompt: 'x', description: 'One', subagentType: 'general-purpose' } as never)
  await clock.settle()
  const v = await $.ui.mount({ plugin: 'helper-desk', surface: 'terminal', component: 'Pane', requestId: 'helpers', props: props(80) })
  await clock.advance(1_000)
  expect(probes.blits, 'stored off: no blits while working').toBe(0)
  const { columns, rows } = petCanvas(80)
  expect(String((await v.find({ type: 'Raster' }))?.props.cells), 'standing pose').toBe(drawCrab(columns, rows, 0, 0, { tier: 'opus', still: true }))
  await v.unmount()
  const d = await $.ui.mount({ plugin: 'helper-desk', surface: 'desktop', component: 'Pane', requestId: 'helpers', props: props(80) })
  const svg = String((await d.findAll({ type: 'Svg' })).find(p => String(p.props.alt).startsWith('Claude crab'))?.props.source)
  expect(svg.includes('@keyframes'), 'stored off: no keyframes on the desktop pet either').toBe(false)
})

// ---------- Fix round 1 ----------

test('one unreadable Jev poll keeps the cards and the watch; a good one then shows the verdict', { timeoutMs: 30000 }, async ($, on) => {
  const files: Record<string, string> = { [JEV_FILE]: jevFile([jevCall('j1', 'answered', { tier: 'sonnet', effort: 'high' })]) }
  const { clock } = rig(on, files)
  await $.session.start({ source: 'startup', cwd: '/Users/test/vault', surface: 'terminal', isInteractive: true } as never)
  const v = await $.ui.mount({ plugin: 'helper-desk', surface: 'terminal', component: 'Pane', requestId: 'helpers', props: props(80) })
  expect(await v.find({ type: 'Text', text: /→ sonnet · high$/ }), 'open call drawn').toBeDefined()
  // A torn write: the cards stay and the poller carries on.
  files[JEV_FILE] = '{"calls":[{"id":'
  await clock.advance(2_100)
  expect(await v.find({ type: 'Text', text: /→ sonnet · high$/ }), 'torn read: cards kept').toBeDefined()
  files[JEV_FILE] = jevFile([judgedCall])
  await clock.advance(2_100)
  expect(await v.find({ type: 'Text', text: /^judge \(haiku\)/ }), 'the next good read shows the verdict').toBeDefined()
  // A file that is gone is no cards.
  delete files[JEV_FILE]
  await $.tool.call({ tool: 'Agent', tool_use_id: 'a1', description: 'x', prompt: 'x', subagentType: 'general-purpose' } as never)
  await clock.advance(2_100)
  expect(await v.find({ text: /Jev/ }), 'missing file: no cards').toBeUndefined()
})

test('a malformed Jev row is dropped instead of crashing the pane', { timeoutMs: 30000 }, async ($, on) => {
  const { description: _gone, ...noDescription } = jevCall('bad', 'asking')
  const files: Record<string, string> = {
    [JEV_FILE]: jevFile([noDescription, { ...jevCall('bad2', 'judged'), judge: 'nope', probs: 3 }, 7, null, jevCall('ok', 'asking')]),
  }
  rig(on, files)
  await $.session.start({ source: 'startup', cwd: '/Users/test/vault', surface: 'terminal', isInteractive: true } as never)
  const v = await $.ui.mount({ plugin: 'helper-desk', surface: 'terminal', component: 'Pane', requestId: 'helpers', props: props(80) })
  expect(await v.findAll({ type: 'Text', text: /^ Jev $/ }), 'the row without a description is dropped, the odd-typed one kept plain').toHaveLength(2)
  expect(await v.find({ type: 'Text', text: /→ asking…$/ }), 'the good row draws').toBeDefined()
})

test('a Jev call stuck open turns stale and the poller stops', { timeoutMs: 30000 }, async ($, on) => {
  const files: Record<string, string> = { [JEV_FILE]: jevFile([jevCall('j1', 'judging', { tier: 'sonnet', effort: 'high' }), jevCall('j2', 'asking', { at: 1_000_000 + 11 * 60_000 })]) }
  const { clock, probes } = rig(on, files)
  await $.session.start({ source: 'startup', cwd: '/Users/test/vault', surface: 'terminal', isInteractive: true } as never)
  // Motion off, so no 40 ms sprite timer runs through the twenty minutes this test lets pass.
  await $.command.run({ command: 'helpers', args: 'motion off', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } } as never)
  const v = await $.ui.mount({ plugin: 'helper-desk', surface: 'terminal', component: 'Pane', requestId: 'helpers', props: props(80) })
  expect(await v.find({ type: 'Text', text: /^judging…$/ }), 'live at first').toBeDefined()
  await clock.advance(9 * 60_000)
  expect(await v.find({ type: 'Text', text: /^judging…$/ }), 'still judging at 9 minutes').toBeDefined()
  await clock.advance(2 * 60_000)
  expect(await v.find({ type: 'Text', text: /^judging…$/ }), 'no live judging past the cap').toBeUndefined()
  expect(await v.find({ type: 'Text', text: /^judge never answered \(stale\)$/ }), 'shown as stale').toBeDefined()
  expect(await v.find({ type: 'Text', text: /→ asking…$/ }), 'the later call is still live').toBeDefined()
  // Once that one is stale as well, polling stops.
  await clock.advance(11 * 60_000)
  const stopped = probes.jevReads
  await clock.advance(60_000)
  expect(probes.jevReads, 'no reads once every call is final or stale').toBe(stopped)
  const band = await $.ui.mount({ plugin: 'helper-desk', surface: 'terminal', component: 'AbovePrompt', props: bandProps(80) })
  expect(await band.find({ text: /Jev/ }), 'a stale call is not asking in the band').toBeUndefined()
})

test('a send right after a spawn finds the helper; names prefer the working helper; unknown addresses are not the main chat', { timeoutMs: 30000 }, async ($, on) => {
  const { clock } = rig(on, {})
  await $.session.start({ source: 'startup', cwd: '/Users/test/vault', surface: 'terminal', isInteractive: true } as never)
  const spawn = (name: string, n: number) =>
    $.agent.spawn({ tool_use_id: `s${n}`, prompt: 'x', description: `Task ${n}`, subagentType: 'general-purpose', name } as never)
  await spawn('alice', 1)
  await spawn('bob', 2)
  // No settle: the send runs as soon as the spawns return.
  await $.session.send({ to: 'bob', text: 'hi', agentId: 'agent-a1' } as never)
  await $.session.send({ to: '*', text: 'everyone', agentId: 'agent-a1' } as never)
  await $.session.send({ to: 'nobody-here', text: 'hi' } as never)
  await clock.settle()
  const v = await $.ui.mount({ plugin: 'helper-desk', surface: 'terminal', component: 'Pane', requestId: 'helpers', props: props(80) })
  expect(await v.find({ key: 'goto|agent-a1|to|agent-a2' }), 'sent right after the spawn').toBeDefined()
  expect(await v.find({ type: 'Text', text: /main chat/ }), 'an address nobody carries is not the main chat').toBeUndefined()

  // Two helpers share a name: the working one gets the message.
  await $.turn.complete({ answer: 'ok', agentId: 'agent-a2', reason: 'answer', durationMs: 1, isAborted: false, turnId: 't1' } as never)
  await $.agent.spawn({ tool_use_id: 's3', prompt: 'x', description: 'Task 3', subagentType: 'general-purpose', name: 'bob' } as never)
  await $.session.send({ to: 'bob', text: 'again', agentId: 'agent-a1' } as never)
  await clock.settle()
  expect(await v.find({ key: 'goto|agent-a1|to|agent-a3' }), 'the working bob is the receiver').toBeDefined()
})

test('motion off from inside a frame stops the blits at once', { timeoutMs: 30000 }, async ($, on) => {
  const { clock, probes } = rig(on, {})
  await $.session.start({ source: 'startup', cwd: '/Users/test/vault', surface: 'terminal', isInteractive: true } as never)
  await $.agent.spawn({ tool_use_id: 's1', prompt: 'x', description: 'One', subagentType: 'general-purpose' } as never)
  await $.agent.spawn({ tool_use_id: 's2', prompt: 'x', description: 'Two', subagentType: 'general-purpose' } as never)
  await clock.settle()
  const v = await $.ui.mount({ plugin: 'helper-desk', surface: 'terminal', component: 'Pane', requestId: 'helpers', props: props(80) })
  probes.onBlit = async () => {
    probes.onBlit = undefined
    await $.command.run({ command: 'helpers', args: 'motion off', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } } as never)
  }
  await clock.advance(1_000)
  expect(probes.blits, 'the second pet of that frame and every later frame are not blitted').toBe(1)
  void v
})

test('/helpers goto and a chip open a folded group first', { timeoutMs: 30000 }, async ($, on) => {
  const { clock } = rig(on, {})
  await $.session.start({ source: 'startup', cwd: '/Users/test/vault', surface: 'terminal', isInteractive: true } as never)
  for (const [i, name] of ['alice', 'bob'].entries()) {
    await $.agent.spawn({ tool_use_id: `s${i}`, prompt: 'x', description: `Task ${name}`, subagentType: 'general-purpose', name } as never)
  }
  await $.session.send({ to: 'bob', text: 'hi', agentId: 'agent-a1' } as never)
  await clock.settle()
  const v = await $.ui.mount({ plugin: 'helper-desk', surface: 'terminal', component: 'Pane', requestId: 'helpers', props: props(80) })
  const run = (args: string) => $.command.run({ command: 'helpers', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } } as never)
  await run('fold running')
  expect(await v.find({ key: 'card-agent-a2' }), 'folded: no card').toBeUndefined()
  await run('goto bob')
  expect(await v.find({ key: 'card-agent-a2' }), 'goto opened the group').toBeDefined()
  expect((await v.find({ key: 'card-agent-a2' }))?.props.borderColor, 'and lit the card').toBe('claude')
  // A chip on a running card points at a finished helper whose group is folded.
  await $.turn.complete({ answer: 'ok', agentId: 'agent-a2', reason: 'answer', durationMs: 1, isAborted: false, turnId: 't1' } as never)
  await run('fold finished')
  await clock.settle()
  expect(await v.find({ key: 'card-agent-a2' }), 'finished group folded').toBeUndefined()
  await v.press({ key: 'goto|agent-a1|to|agent-a2' })
  expect(await v.find({ key: 'card-agent-a2' }), 'the chip opened the finished group').toBeDefined()
})

// ---------- Sprites ----------

const countOf = (sprite: { px: Map<string, string> }, code: string) => [...sprite.px.values()].filter(c => c === code).length
const cellOf = (key: string) => key.split(',').map(Number) as [number, number]

test('the shell size and the prop tell the model', () => {
  const sizes = { haiku: [8, 5], sonnet: [10, 7], opus: [12, 8] } as const
  for (const tier of ['haiku', 'sonnet', 'opus'] as const) {
    const sprite = crabSprite(tier, 0, { still: true })
    const shell = [...sprite.px].filter(([k, c]) => 'BDL'.includes(c) && cellOf(k)[1] <= 13).map(([k]) => cellOf(k))
    const xs = shell.map(([x]) => x)
    const ys = shell.map(([, y]) => y)
    const [w, h] = sizes[tier]
    // The two claws on each side add four columns to the shell.
    expect(Math.max(...xs) - Math.min(...xs) + 1, `${tier}: shell and claws wide`).toBe(w + 4)
    expect(Math.max(...ys) - Math.min(...ys) + 1, `${tier}: shell tall`).toBe(h)
    const props = { sprout: countOf(sprite, 'G') + countOf(sprite, 'g'), quill: countOf(sprite, 'Q') + countOf(sprite, 'N'), crown: countOf(sprite, 'C') }
    expect(props.sprout > 0, `${tier}: sprout`).toBe(tier === 'haiku')
    expect(props.quill > 0, `${tier}: quill`).toBe(tier === 'sonnet')
    expect(props.crown > 0, `${tier}: crown`).toBe(tier === 'opus')
    expect(countOf(sprite, 'L') > 0, `${tier}: spots only on opus`).toBe(tier === 'opus')
  }
  expect(drawCrab(24, 9, 0, 0, { tier: 'haiku', still: true }) !== drawCrab(24, 9, 0, 0, { tier: 'opus', still: true }), 'the art differs').toBe(true)
  expect([tierOf('Haiku 4.5'), tierOf('Opus 5.5'), tierOf('Sonnet'), tierOf('Fable 5.1'), tierOf('')], 'the tier from a model name; unknown is sonnet').toEqual(['haiku', 'opus', 'sonnet', 'sonnet', 'sonnet'])
})

test('effort sets the leg pace, and steam rises only at xhigh and max while working', () => {
  const stepMs = (effort: 'low' | 'medium' | 'high' | 'xhigh' | 'max') => {
    const first = poseAt(0, 0, effort).legs
    let t = 1
    while (poseAt(t, 0, effort).legs === first) t += 1
    return t
  }
  expect([stepMs('low'), stepMs('medium'), stepMs('high'), stepMs('xhigh'), stepMs('max')], 'one leg step in ms').toEqual([200, 140, 110, 90, 75])
  for (const effort of ['low', 'medium', 'high'] as const) expect(countOf(crabSprite('sonnet', 500, { effort }), 'S'), `${effort}: no steam`).toBe(0)
  for (const effort of ['xhigh', 'max'] as const) {
    expect(countOf(crabSprite('sonnet', 500, { effort }), 'S'), `${effort}: steam while working`).toBeGreaterThan(0)
    expect(countOf(crabSprite('sonnet', 500, { effort, still: true }), 'S'), `${effort}: none once still`).toBe(0)
    const frames = new Set([0, 300, 600].map(t => [...crabSprite('sonnet', t, { effort }).px].filter(([, c]) => c === 'S').map(([k]) => k).join()))
    expect(frames.size, `${effort}: the puff rises`).toBeGreaterThan(1)
  }
})

for (const surface of ['terminal', 'desktop'] as const) {
  test(`each card shows its model badge and effort dots; the Svg carries steam only for a working xhigh pet (${surface})`, { timeoutMs: 30000 }, async ($, on) => {
    const { clock } = rig(on, {})
    await $.session.start({ source: 'startup', cwd: '/Users/test/vault', surface, isInteractive: true } as never)
    const dispatch = async (n: number, model: string, effort?: string) => {
      await $.tool.call({ tool: 'Agent', tool_use_id: `s${n}`, description: `Task ${n}`, prompt: 'x', subagentType: 'general-purpose', ...(effort ? { effort } : {}) } as never)
      await $.agent.spawn({ tool_use_id: `s${n}`, prompt: 'x', description: `Task ${n}`, subagentType: 'general-purpose', model } as never)
    }
    await dispatch(1, 'haiku', 'low')
    await dispatch(2, 'sonnet')
    await dispatch(3, 'opus', 'xhigh')
    await clock.settle()
    for (const width of WIDTHS) {
      const v = await $.ui.mount({ plugin: 'helper-desk', surface, component: 'Pane', requestId: 'helpers', props: props(width) })
      const where = `${surface} ${width}`
      for (const [letter, dots] of [['H', '●○○○○'], ['S', '●●○○○'], ['O', '●●●●○']]) {
        const badge = await v.find({ type: 'Text', text: new RegExp(`^${letter}$`) })
        expect(badge, `${where}: badge ${letter}`).toBeDefined()
        expect(['success', 'suggestion', 'claude'], `${where}: badge ${letter} is a theme key`).toContain(String(badge?.props.color))
        expect(await v.find({ type: 'Text', text: new RegExp(`^${dots}$`) }), `${where}: dots ${dots}`).toBeDefined()
      }
      expect(rawColors(await v.findAll({})), `${where}: raw colours`).toEqual([])
      if (surface === 'desktop') {
        const svgs = (await v.findAll({ type: 'Svg' })).filter(p => String(p.props.alt).startsWith('Claude crab')).map(p => String(p.props.source))
        expect(svgs.filter(x => x.includes('@keyframes st')), `${where}: steam on the xhigh pet only`).toHaveLength(1)
        expect(svgs.filter(x => x.includes('@keyframes lg')), `${where}: all three move`).toHaveLength(3)
        expect(svgs.some(x => x.includes('lg 0.8s')), `${where}: low effort legs, 4 x 200 ms`).toBe(true)
        expect(svgs.find(x => x.includes('@keyframes st'))!.includes('lg 0.36s'), `${where}: xhigh effort legs, 4 x 90 ms`).toBe(true)
        expect(new Set(svgs).size, `${where}: three different pets`).toBe(3)
      }
      await v.unmount()
    }
    // A finished pet is still: no keyframes at all.
    if (surface === 'desktop') {
      await $.turn.complete({ answer: 'ok', agentId: 'agent-a3', reason: 'answer', durationMs: 1, isAborted: false, turnId: 't1' } as never)
      await clock.settle()
      const v = await $.ui.mount({ plugin: 'helper-desk', surface, component: 'Pane', requestId: 'helpers', props: props(80) })
      const svgs = (await v.findAll({ type: 'Svg' })).filter(p => String(p.props.alt).startsWith('Claude crab')).map(p => String(p.props.source))
      expect(svgs.filter(x => x.includes('@keyframes st')), 'no steam once it is done').toHaveLength(0)
      expect(svgs.filter(x => !x.includes('@keyframes')), 'the finished pet has no keyframes').toHaveLength(1)
    }
  })
}

test('Jev bars show its pick, the asking cube tumbles, and a judged one stands still', () => {
  const barColumns = (tier: 'haiku' | 'sonnet' | 'opus') =>
    new Set([...jevSprite('answered', tier, 0, { still: true }).px].filter(([, c]) => c === 'k').map(([k]) => cellOf(k)[0])).size
  expect([barColumns('haiku'), barColumns('sonnet'), barColumns('opus')], 'one, two or three bars').toEqual([1, 2, 3])
  const asking = new Set<string>()
  for (let t = 0; t < 1_440; t += 120) asking.add(drawJev(20, 9, 'asking', 'sonnet', t))
  expect(asking.size, 'asking: three rotations, the hop and the first blinks, at least six distinct frames').toBeGreaterThanOrEqual(6)
  expect(drawJev(20, 9, 'asking', 'sonnet', 0) !== drawJev(20, 9, 'asking', 'sonnet', 120), 'and each 120 ms step shows another').toBe(true)
  expect(drawJev(20, 9, 'judged', 'sonnet', 0), 'judged: still').toBe(drawJev(20, 9, 'judged', 'sonnet', 777))
  const judging = new Set<string>()
  for (let t = 0; t < 2_400; t += 120) judging.add(drawJev(16, 5, 'judging', 'sonnet', t))
  expect(judging.size, 'judging: bobs, tilts and the judge crab moves').toBeGreaterThan(4)
  expect(drawJev(32, 9, 'judging', 'sonnet', 0, 0, true).length, 'judging canvas 32 wide').toBe(32 * 9 * 16)
  expect(drawJev(20, 9, 'asking', 'sonnet', 0).length, 'single canvas 20 wide').toBe(20 * 9 * 16)
})

test('Jev draws as an Svg with keyframes only while its call is open', { timeoutMs: 30000 }, async ($, on) => {
  const files: Record<string, string> = {
    [JEV_FILE]: jevFile([
      jevCall('j1', 'asking'),
      jevCall('j2', 'answered', { tier: 'opus', effort: 'high' }),
      jevCall('j3', 'judging', { tier: 'sonnet', effort: 'high' }),
      jevCall('j4', 'judged', { tier: 'haiku', effort: 'low' }),
    ]),
  }
  rig(on, files)
  await $.session.start({ source: 'startup', cwd: '/Users/test/vault', surface: 'desktop', isInteractive: true } as never)
  for (const width of WIDTHS) {
    const v = await $.ui.mount({ plugin: 'helper-desk', surface: 'desktop', component: 'Pane', requestId: 'helpers', props: props(width) })
    const art = (await v.findAll({ type: 'Svg' })).filter(p => p.props.alt === 'Jev, the cube-bot').map(p => String(p.props.source))
    expect(art, `${width}: one drawing a call`).toHaveLength(4)
    expect(art[0]!.includes('@keyframes fb'), `${width}: asking tumbles`).toBe(true)
    expect(art[1]!.includes('@keyframes jbob') && art[1]!.includes('@keyframes jey'), `${width}: answered bobs and blinks`).toBe(true)
    expect(art[2]!.includes('@keyframes jtl') && art[2]!.includes('@keyframes cbob'), `${width}: judging tilts, beside its judge crab`).toBe(true)
    expect(art[3]!.includes('@keyframes'), `${width}: judged stands still`).toBe(false)
    expect(art.every(x => x.length < 131072), `${width}: under the Svg limit`).toBe(true)
    await v.unmount()
  }
})

test('one timer paints crabs and Jev: nothing moving is no blits, an open Jev call alone is some, a judged one none', { timeoutMs: 30000 }, async ($, on) => {
  const files: Record<string, string> = { [JEV_FILE]: jevFile([jevCall('j1', 'judged', { tier: 'sonnet', effort: 'high' })]) }
  const { clock, probes } = rig(on, files)
  await $.session.start({ source: 'startup', cwd: '/Users/test/vault', surface: 'terminal', isInteractive: true } as never)
  const callTool = $.tool.call as unknown as (input: unknown) => Promise<unknown>
  const v = await $.ui.mount({ plugin: 'helper-desk', surface: 'terminal', component: 'Pane', requestId: 'helpers', props: props(80) })
  await clock.advance(1_000)
  expect(probes.blits, 'a judged call is still: no blits').toBe(0)

  files[JEV_FILE] = jevFile([jevCall('j1', 'judged', { tier: 'sonnet', effort: 'high' }), jevCall('j2', 'asking')])
  await callTool({ tool: 'Agent', tool_use_id: 'a1', description: 'x', prompt: 'x', subagentType: 'general-purpose' })
  await clock.advance(400)
  expect(probes.blits, 'an asking call alone moves').toBeGreaterThan(0)
  expect(probes.blits, 'and only the open call is painted: one blit a 40 ms frame').toBeLessThanOrEqual(10 + 1)

  // A crab joins the same timer.
  await $.agent.spawn({ tool_use_id: 's1', prompt: 'x', description: 'One', subagentType: 'general-purpose' } as never)
  await clock.settle()
  const withCrab = probes.blits
  await clock.advance(400)
  expect(probes.blits - withCrab, 'crab and Jev: at most two blits a frame from one timer').toBeLessThanOrEqual(2 * 10)
  expect(probes.blits - withCrab, 'and both paint').toBeGreaterThan(10)

  // Both end: the crab finishes, the call is judged.
  await $.turn.complete({ answer: 'ok', agentId: 'agent-a1', reason: 'answer', durationMs: 1, isAborted: false, turnId: 't1' } as never)
  files[JEV_FILE] = jevFile([jevCall('j1', 'judged', { tier: 'sonnet', effort: 'high' }), jevCall('j2', 'judged', { tier: 'sonnet', effort: 'high' })])
  await clock.advance(2_100)
  const after = probes.blits
  await clock.advance(1_000)
  expect(probes.blits, 'nothing moves: no blits').toBe(after)

  // Motion off stops an open call too.
  files[JEV_FILE] = jevFile([jevCall('j3', 'answered', { tier: 'opus', effort: 'high' })])
  await callTool({ tool: 'Agent', tool_use_id: 'a2', description: 'x', prompt: 'x', subagentType: 'general-purpose' })
  await clock.advance(400)
  expect(probes.blits, 'answered moves').toBeGreaterThan(after)
  await $.command.run({ command: 'helpers', args: 'motion off', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } } as never)
  const off = probes.blits
  await clock.advance(1_000)
  expect(probes.blits, 'motion off: no blits').toBe(off)
  void v
})

// ---------- Sprite fix round 1 ----------

test('a card adopted from its own tool calls takes its effort from the spawn, and effort names are case-blind', { timeoutMs: 30000 }, async ($, on) => {
  const { clock, agents } = rig(on, {})
  await $.session.start({ source: 'startup', cwd: '/Users/test/vault', surface: 'terminal', isInteractive: true } as never)
  // The helper's tool call arrives before its spawn: the card is adopted at medium.
  agents.push({ id: 'agent-a1', description: 'Early bird', type: 'general-purpose', status: 'running' })
  await $.tool.call({ tool: 'Read', tool_use_id: 'c1', file_path: '/a.md', agentId: 'agent-a1' } as never)
  await clock.settle()
  const v = await $.ui.mount({ plugin: 'helper-desk', surface: 'terminal', component: 'Pane', requestId: 'helpers', props: props(80) })
  expect(await v.find({ type: 'Text', text: /^●●○○○$/ }), 'adopted at medium').toBeDefined()
  // Then its spawn names the effort, in any case.
  agents.length = 0
  await $.tool.call({ tool: 'Agent', tool_use_id: 's1', description: 'Early bird', prompt: 'x', subagentType: 'general-purpose', effort: 'HIGH' } as never)
  await $.agent.spawn({ tool_use_id: 's1', prompt: 'x', description: 'Early bird', subagentType: 'general-purpose' } as never)
  await clock.settle()
  expect(await v.find({ type: 'Text', text: /^●●●○○$/ }), 'three dots once the spawn is known').toBeDefined()
  expect(await v.find({ type: 'Text', text: /^●●○○○$/ }), 'no medium dots left').toBeUndefined()
})

test('a helper that inherits draws as the main chat model until its own requests name one', { timeoutMs: 30000 }, async ($, on) => {
  const { clock, agents } = rig(on, {})
  await $.session.start({ source: 'startup', cwd: '/Users/test/vault', surface: 'terminal', isInteractive: true } as never)
  agents.push({ id: 'agent-a1', description: 'Adopted', type: 'general-purpose', status: 'running' })
  await $.tool.call({ tool: 'Read', tool_use_id: 'c1', file_path: '/a.md', agentId: 'agent-a1' } as never)
  await clock.settle()
  const v = await $.ui.mount({ plugin: 'helper-desk', surface: 'terminal', component: 'Pane', requestId: 'helpers', props: props(80) })
  expect(await v.find({ type: 'Text', text: /^S$/ }), 'no model known anywhere: sonnet art').toBeDefined()
  const step = async (model: string, agentId?: string) => {
    for await (const chunk of $.turn.step({ turnId: 't1', index: 0, model, ...(agentId ? { agentId } : {}) } as never)) void chunk
  }
  await step('claude-haiku-5-5')
  await $.tool.call({ tool: 'Read', tool_use_id: 'c2', file_path: '/b.md', agentId: 'agent-a1' } as never)
  await clock.settle()
  expect(await v.find({ type: 'Text', text: /^H$/ }), 'the main chat model stands in').toBeDefined()
  await step('claude-opus-5-5', 'agent-a1')
  await clock.settle()
  expect(await v.find({ type: 'Text', text: /^O$/ }), 'its own model replaces it').toBeDefined()
  // A spawn that says inherit shows the model the engine resolved, not the word.
  agents.length = 0
  await $.agent.spawn({ tool_use_id: 's9', prompt: 'x', description: 'Borrower', subagentType: 'general-purpose', model: 'inherit' } as never)
  await clock.settle()
  expect(await v.find({ type: 'Text', text: /inherit/i }), 'never the word inherit').toBeUndefined()
})

test('bookkeeping that throws never blocks the helper tool call', { timeoutMs: 30000 }, async ($, on) => {
  const { clock } = rig(on, {})
  await $.session.start({ source: 'startup', cwd: '/Users/test/vault', surface: 'terminal', isInteractive: true } as never)
  await $.agent.spawn({ tool_use_id: 's1', prompt: 'x', description: 'One', subagentType: 'general-purpose' } as never)
  await clock.settle()
  // A tool name that is not text makes the step description throw.
  const r = (await $.tool.call({ tool: 7, tool_use_id: 'c1', agentId: 'agent-a1' } as never)) as { result?: unknown }
  expect(r.result, 'the call still reached the tool').toBe('ok')
})

test('terminal Jev does not blink while asking, as the Svg does not', () => {
  const eyesAtTop = (state: 'asking' | 'answered') => [...jevSprite(state, 'sonnet', 0).px].filter(([k, c]) => c === 'e' && cellOf(k)[1] === 8).length
  expect(eyesAtTop('asking'), 'asking at a blink time: both eyes open').toBe(2)
  expect(eyesAtTop('answered'), 'answered blinks at the same time').toBe(0)
})

test('a frame never uses a canvas other than the one mounted: answered to judging between a draw and a frame', { timeoutMs: 30000 }, async ($, on) => {
  const files: Record<string, string> = { [JEV_FILE]: jevFile([jevCall('j1', 'answered', { tier: 'sonnet', effort: 'high' })]) }
  const { clock, probes } = rig(on, files)
  await $.session.start({ source: 'startup', cwd: '/Users/test/vault', surface: 'terminal', isInteractive: true } as never)
  const v = await $.ui.mount({ plugin: 'helper-desk', surface: 'terminal', component: 'Pane', requestId: 'helpers', props: props(80) })
  await clock.advance(400)
  expect(probes.blits, 'answered paints').toBeGreaterThan(0)
  // The pane is gone (no redraw follows), the call moves to judging: the 32-wide canvas is not the mounted 20-wide one.
  await v.unmount()
  files[JEV_FILE] = jevFile([jevCall('j1', 'judging', { tier: 'sonnet', effort: 'high' })])
  await clock.advance(2_100)
  const after = probes.blits
  await clock.advance(1_000)
  expect(probes.blits, 'no frames for the old canvas').toBe(after)
  expect(probes.badBlits, 'and none was ever the wrong size').toBe(0)
})

test('a Jev call left answered until it goes stale stops painting', { timeoutMs: 120000 }, async ($, on) => {
  const files: Record<string, string> = { [JEV_FILE]: jevFile([jevCall('j1', 'answered', { tier: 'sonnet', effort: 'high' })]) }
  const { clock, probes } = rig(on, files)
  await $.session.start({ source: 'startup', cwd: '/Users/test/vault', surface: 'terminal', isInteractive: true } as never)
  const v = await $.ui.mount({ plugin: 'helper-desk', surface: 'terminal', component: 'Pane', requestId: 'helpers', props: props(80) })
  await clock.advance(1_000)
  expect(probes.blits, 'answered moves').toBeGreaterThan(0)
  // The clock allows 10,000 waits an advance: 40 ms frames cross ten minutes in two steps.
  await clock.advance(301_000)
  await clock.advance(301_000)
  await clock.advance(2_100)
  expect(await v.find({ type: 'Text', text: /^ran sonnet · medium$/ }), 'still on the desk').toBeDefined()
  const stale = probes.blits
  await clock.advance(2_000)
  expect(probes.blits, 'stale: no more frames').toBe(stale)
})
