import { expect, test } from 'claude-code/testing'

const PLUGIN = 'savvy-progress'
const PROGRESS = 'mcp__savvy-progress__progress'

const band = { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 4, bodyColumns: 100, scroll: { offset: 0, bodyRows: 4 }, view: {} }
const pane = { title: '', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} } as const

const plan = {
  tool: PROGRESS,
  title: 'Ship the thing',
  phase: 'delegate',
  tasks: [
    { title: 'Write the parser', tier: 'careful' },
    { title: 'Wire the CLI', tier: 'light', after: [1] },
  ],
} as const

for (const surface of ['terminal', 'desktop'] as const) {
  test(`${surface}: the band shows what the flow reports`, async ($, on) => {
    // Reporting a plan opens the panel by itself, once per flow.
    const opened: string[] = []
    on('ui.open', (_$, e) => {
      opened.push(e.id)
      return { value: { isPlaced: true } }
    })

    const reported = await $.tool.call(plan as never)
    expect(reported).toMatchObject({ result: 'ok: Tasks 0/2' })

    const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'AbovePrompt', props: band })
    // Two planned tasks, none started: the crew button counts both.
    expect((await ui.find({ key: 'savvy-agents' }))?.props.label).toBe('×2')

    await $.tool.call({ tool: PROGRESS, done: 1 } as never)
    expect(opened).toEqual(['savvy-agents'])
    expect(await $.tool.call({ tool: PROGRESS, finished: true } as never)).toMatchObject({ result: 'ok: Done' })
  })

  // The schema's enum and bounds are advice to the model: a call outside them must still draw.
  test(`${surface}: input outside the tool's schema cannot break the drawing`, async ($, on) => {
    on('ui.open', () => ({ value: { isPlaced: true } }))
    const tasks = [
      { title: 'Odd one', tier: '__proto__' },
      { title: 'Odd two', tier: 'constructor' },
      ...Array.from({ length: 500 }, (_, i) => ({ title: `Task ${i}`, tier: 'light' })),
    ]
    const reported = await $.tool.call({ tool: PROGRESS, title: 'Odd input', phase: 'delegate', tasks, total: 1e9 } as never)
    expect(reported).toMatchObject({ result: 'ok: Tasks 0/200' })

    const bar = await $.ui.mount({ plugin: PLUGIN, surface, component: 'AbovePrompt', props: band })
    expect((await bar.find({ key: 'savvy-agents' }))?.props.label).toBe('×200')

    const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'Pane', requestId: 'savvy-agents', props: pane })
    expect(await ui.find({ text: /Planned · 200/ })).toBeDefined()
    const drawn = (await ui.findAll({ type: 'Svg' })).map(el => String(el.props.source)).join('')
    expect(drawn).not.toContain('native code')
    expect(drawn).not.toContain('[object')
  })

  const paneSvg = async (mounted: unknown) =>
    (await (mounted as { findAll: (q: { type: 'Svg' }) => Promise<{ props: Record<string, unknown> }[]> }).findAll({ type: 'Svg' }))
      .map(el => String(el.props.source))
      .join('')
  const mountPane = ($: { ui: { mount: (a: never) => Promise<unknown> } }) =>
    $.ui.mount({ plugin: PLUGIN, surface, component: 'Pane', requestId: 'savvy-agents', props: pane } as never)

  test(`${surface}: a plan with model and effort draws the careful costume and its label`, async ($, on) => {
    on('ui.open', () => ({ value: { isPlaced: true } }))
    const tasks = [{ title: 'Build it', model: 'claude-sonnet-5-5', effort: 'high', agent: 'software-engineer', after: [1] }]
    expect(await $.tool.call({ tool: PROGRESS, title: 'Model plan', phase: 'delegate', tasks } as never)).toMatchObject({ result: 'ok: Tasks 0/1' })
    if (surface === 'desktop') {
      const drawn = await paneSvg(await mountPane($))
      expect(drawn).toContain('c-careful')
      expect(drawn).toContain('Sonnet · high')
      expect(drawn).toContain('software-engineer')
    } else {
      const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'Pane', requestId: 'savvy-agents', props: pane })
      expect(await ui.find({ text: /software-engineer · Sonnet · high/ })).toBeDefined()
    }
  })

  test(`${surface}: a legacy tier plan still draws`, async ($, on) => {
    on('ui.open', () => ({ value: { isPlaced: true } }))
    await $.tool.call({ tool: PROGRESS, title: 'Tier plan', phase: 'delegate', tasks: [{ title: 'Old way', tier: 'heavy' }] } as never)
    if (surface === 'desktop') {
      const drawn = await paneSvg(await mountPane($))
      expect(drawn).toContain('c-heavy')
      expect(drawn).toContain('Opus · xhigh')
    } else {
      const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'Pane', requestId: 'savvy-agents', props: pane })
      expect(await ui.find({ text: /Opus · xhigh/ })).toBeDefined()
    }
  })

  test(`${surface}: hostile model, effort and agent values are bounded and a task with no tier or model is dropped`, async ($, on) => {
    on('ui.open', () => ({ value: { isPlaced: true } }))
    const tasks = [
      { title: 'Hostile', model: '__proto__', effort: '<script>', agent: '<b>'.repeat(500) },
      { title: 'Object', model: { x: 1 }, effort: 5, agent: {} },
      { title: 'Neither' },
      { title: 'Blank model', model: '  ' },
    ]
    // Only the task that gave a model string is kept; the object model, no tier and blank model are dropped.
    expect(await $.tool.call({ tool: PROGRESS, title: 'Hostile plan', phase: 'delegate', tasks } as never)).toMatchObject({ result: 'ok: Tasks 0/1' })
    if (surface === 'desktop') {
      const drawn = await paneSvg(await mountPane($))
      expect(drawn).not.toContain('<script>')
      expect(drawn).not.toContain('[object')
      expect(drawn).not.toContain('native code')
      expect(drawn).not.toContain('<b><b><b><b><b><b><b><b><b><b><b><b>')
    }
  })

  // Not a savvy agent type: the costume comes from the model the run really started on.
  test(`${surface}: a non-savvy agent on haiku gets the light costume`, async ($, on) => {
    on('ui.open', () => ({ value: { isPlaced: true } }))
    on('clock.now', () => ({ value: 1000 }) as never)
    on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: 'a1' }) as never)
    await $.agent.spawn({ tool_use_id: 's1', prompt: 'x', description: 'Fix typo', subagentType: 'software-engineer' } as never)
    if (surface === 'desktop') {
      const drawn = await paneSvg(await mountPane($))
      expect(drawn).toContain('c-light')
      expect(drawn).toContain('software-engineer')
      expect(drawn).toContain('Haiku 5.5')
    } else {
      const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'Pane', requestId: 'savvy-agents', props: pane })
      expect(await ui.find({ text: /software-engineer/ })).toBeDefined()
    }
  })

  // The stored title is clipped, so the incoming one is clipped before the two are compared.
  test(`${surface}: a title past the cap is still the same flow`, async ($, on) => {
    on('ui.open', () => ({ value: { isPlaced: true } }))
    const long = 'L'.repeat(500)

    const first = await $.tool.call({ tool: PROGRESS, title: long, phase: 'delegate', total: 4, done: 2 } as never)
    expect(first).toMatchObject({ result: 'ok: Tasks 2/4' })

    // Repeating the long title keeps the counters instead of starting over at 0/0.
    expect(await $.tool.call({ tool: PROGRESS, title: long } as never)).toMatchObject({ result: 'ok: Tasks 2/4' })

    const started = await $.tool.call({ tool: PROGRESS, title: 'Another flow', phase: 'delegate', total: 3 } as never)
    expect(started).toMatchObject({ result: 'ok: Tasks 0/3' })
  })
}
