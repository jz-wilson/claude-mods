import { expect, mock, test } from 'claude-code/testing'

for (const surface of ['desktop', 'terminal'] as const) {
  test(`/effort-optimizer reports and switches the mode, and slash commands are never checked (${surface})`, { timeoutMs: 30000 }, async ($, on) => {
    const store: Record<string, unknown> = {}
    let modelCalls = 0
    const passed: string[] = []

    on('session.start', async ($, e) => ({ cwd: e.cwd }) as never)
    on('command.register', async () => ({ value: undefined }) as never)
    mock.clock(on, { now: 0 })
    on('store.get', async ($, e) => ({ value: store[(e as { key: string }).key] }) as never)
    on('store.set', async ($, e) => {
      const { key, value } = e as { key: string; value: unknown }
      store[key] = value
      return { value: undefined } as never
    })
    on('config.list', async () => ({ value: [] }) as never)
    on('fs.exists', async () => ({ value: false }) as never)
    on('fs.read', async () => ({ value: '' }) as never)
    on('fs.write', async () => ({ value: undefined }) as never)
    on('model.complete', async () => {
      modelCalls += 1
      return { value: { isAnswered: true, text: '{"level":"low","why":"simple task"}', usage: {} } } as never
    })
    on('prompt.submit', async ($, e) => {
      passed.push(e.text)
      return { text: e.text }
    })

    await $.session.start({ source: 'startup', cwd: '/tmp', surface, isInteractive: true } as never)

    let said = JSON.stringify(await $.command.run({ command: 'effort-optimizer', args: '' } as never))
    expect(said, 'status names the mode').toContain('mode: suggest')

    said = JSON.stringify(await $.command.run({ command: 'effort-optimizer', args: 'auto' } as never))
    expect(said, 'auto turns on').toContain('Effort Optimizer: auto')
    expect(store.mode, 'auto is stored').toBe('auto')

    said = JSON.stringify(await $.command.run({ command: 'effort-optimizer', args: 'suggest' } as never))
    expect(store.mode, 'suggest is stored').toBe('suggest')

    said = JSON.stringify(await $.command.run({ command: 'effort-optimizer', args: 'off' } as never))
    expect(said, 'off says how to turn back on').toContain('/effort-optimizer on')
    expect(store.enabled, 'off is stored').toBe(false)

    said = JSON.stringify(await $.command.run({ command: 'effort-optimizer', args: 'on' } as never))
    expect(said, 'on names the mode').toContain('is on (suggest)')

    // A slash command passes through unchanged and costs no model call.
    await $.prompt.submit({ text: '/help', origin: { kind: 'composer' }, wait: false } as never)
    expect(passed[0], 'slash command sent as typed').toBe('/help')
    // A prompt is held for the first request, not checked at submit.
    await $.prompt.submit({ text: 'Give me 15 subject lines', origin: { kind: 'composer' }, wait: false } as never)
    expect(passed[1], 'prompt sent as typed').toBe('Give me 15 subject lines')
    expect(modelCalls, 'no model call before a request').toBe(0)
  })
}
