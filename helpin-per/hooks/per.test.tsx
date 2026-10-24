import { expect, mock, test } from 'claude-code/testing'

const PANE = {
  plugin: 'helpin-per',
  component: 'Pane',
  requestId: 'helpin-per',
  props: {
    title: 'Helpin PER',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
} as const

const LIST = {
  value: {
    shape: 'list-1',
    value: {
      tasks: [
        { key: 'PER-25', id: 't25', name: 'Fix alertmanager', state: 'To Do', priority: 'high' },
        { key: 'PER-49', id: 't49', name: 'Decide Ask anything', state: 'In Progress', priority: 'none' },
      ],
      fetchedAt: Date.UTC(2026, 9, 22, 12, 0),
    },
  },
  version: 1,
}

test('the pane lists PER tasks on every surface', async ($, on) => {
  on('state.get', () => ({ value: LIST }))

  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    const header = await ui.find({ type: 'Text', text: /2 open/ })
    expect(header?.text).toMatch(/2 open · \d\d:\d\d/)
    expect(await ui.find({ type: 'Button', key: 'PER-25' })).toBeTruthy()
    expect(await ui.find({ type: 'Text', text: /press a task/ })).toBeTruthy()
    await ui.unmount()
  }
})

test('a fetch error is shown', async ($, on) => {
  on('state.get', () => ({
    value: { value: { shape: 'list-1', value: { tasks: [], error: 'boom' } }, version: 1 },
  }))

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /boom/ }))?.text).toBe('Helpin: boom')
  await ui.unmount()
})

test('pressing a task queues a prompt naming it', async ($, on) => {
  const sent: string[] = []
  on('state.get', () => ({ value: LIST }))
  on('prompt.submit', (_, e) => {
    sent.push(e.text)
    return { text: e.text }
  })
  on('ui.toast', () => ({ value: undefined }))

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'PER-25' })
  expect(sent.length).toBe(1)
  expect(sent[0]).toContain('PER-25')
  expect(sent[0]).toContain('t25')
  await ui.unmount()
})

test('helpin is called only when the load button is pressed', async ($, on) => {
  const clock = mock.clock(on)
  const opened: string[] = []
  let calls = 0
  on('command.register', () => ({ value: { command: 'per' } }))
  on('ui.open', (_, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('ui.toast', () => ({ value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('mcp.call', () => {
    calls++
    const data = {
      tasks: [{ task_key: 'PER-7', task_id: 't7', name: 'Seven', state_name: 'To Do', priority: 'low' }],
      has_more: false,
    }
    return { value: { isError: false, content: [{ type: 'text' as const, text: JSON.stringify({ data }) }] } }
  })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: 'go', turnId: 'main' })
  await $.command.run({ command: 'per', args: '' } as never)
  await clock.advance(10 * 60_000)
  expect(opened).toEqual(['helpin-per', 'helpin-per'])
  expect(calls).toBe(0)

  const before = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await before.find({ type: 'Text', text: /Press load/ })).toBeTruthy()
  await before.press({ key: 'refresh' })
  await clock.settle()
  expect(calls).toBe(1)
  await before.unmount()

  const after = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await after.find({ type: 'Button', key: 'PER-7' })).toBeTruthy()
  await after.unmount()
})

test('an empty list says so once fetched', async ($, on) => {
  on('state.get', () => ({
    value: { value: { shape: 'list-1', value: { tasks: [], fetchedAt: 1 } }, version: 1 },
  }))

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /No open PER/ }))?.text).toBe('No open PER tasks.')
  await ui.unmount()
})
