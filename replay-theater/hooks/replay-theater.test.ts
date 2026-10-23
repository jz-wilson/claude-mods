import { expect, mock, test } from 'claude-code/testing'
import type { FoundElement } from 'claude-code/testing'

test('replay-theater registers /replay and reports when there is nothing to replay', async ($, on) => {
  let registered: { name?: string } = {}
  on('session.start', async ($, e) => ({ cwd: e.cwd }) as never)
  on('session.id', async () => ({ value: 'sid' }) as never)
  on('command.register', async ($, e) => {
    registered = e as { name?: string }
    return { value: { command: 'replay' } } as never
  })
  on('ui.toast', async () => ({ value: undefined }) as never)
  const clock = mock.clock(on, { now: 0 })

  await $.session.start({ source: 'startup', cwd: '/Users/test/project', surface: 'terminal', isInteractive: true } as never)
  await clock.settle()
  expect(registered.name, '/replay is registered at session start').toBe('replay')

  const res = await $.command.run({ command: 'replay', args: '' } as never)
  expect(String((res as { text?: string }).text), 'no edits yet').toContain('no edits')
})

const THEME_KEYS = [
  'text', 'inverseText', 'inactive', 'subtle', 'suggestion', 'remember', 'success', 'error',
  'warning', 'merged', 'claude', 'permission', 'planMode', 'autoAccept', 'promptBorder',
  'bashBorder', 'ide', 'diffAdded', 'diffRemoved', 'diffAddedDimmed', 'diffRemovedDimmed',
  'diffAddedWord', 'diffRemovedWord',
]

// Functional color must be a theme key, never hex, a color name or rgb().
function rawColors(elements: FoundElement[]): string[] {
  return elements.flatMap(element =>
    ['color', 'borderColor', 'backgroundColor']
      .map(prop => [prop, element.props[prop]] as const)
      .filter(([, value]) => value !== undefined && !THEME_KEYS.includes(String(value)))
      .map(([prop, value]) => `${element.type}.${prop}=${String(value)}`),
  )
}

const bandProps = (bodyColumns: number, hasSurvey = false) =>
  ({ hasSurvey, isWorking: false, maxRows: 10, bodyColumns, scroll: { offset: 0, bodyRows: 10 }, view: {} }) as never

async function withReplay($: Parameters<Parameters<typeof test>[1]>[0], on: Parameters<Parameters<typeof test>[1]>[1], surface: 'terminal' | 'desktop') {
  on('session.start', async ($, e) => ({ cwd: e.cwd }) as never)
  on('session.id', async () => ({ value: 'sid' }) as never)
  on('session.cwd', async () => ({ value: '/Users/test/project' }) as never)
  on('command.register', async () => ({ value: { command: 'replay' } }) as never)
  on('ui.toast', async () => ({ value: undefined }) as never)
  on('ui.open', async () => ({ value: { isPlaced: true } }) as never)
  on('ui.close', async () => ({ value: undefined }) as never)
  on('fs.exists', async () => ({ value: false }) as never)
  on('tool.call', async ($, e) => ({ result: e }) as never)
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return Text({ children: 'engine' })
  })
  on('turn.start', async () => ({}) as never)
  on('turn.complete', async () => ({ text: '' }) as never)
  const clock = mock.clock(on, { now: 0 })
  await $.session.start({ source: 'startup', cwd: '/Users/test/project', surface, isInteractive: true } as never)
  await clock.settle()
  await $.tool.call({ tool: 'Edit', file_path: '/Users/test/project/src/a-long-file-name.ts', old_string: 'one' + String.fromCharCode(10) + 'two', new_string: 'one' + String.fromCharCode(10) + 'three' } as never)
  await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' } as never)
  await clock.settle()
  return clock
}

for (const surface of ['terminal', 'desktop'] as const) {
  test(`band and pane use theme colors at 40, 80 and 144 columns, and the band yields to a survey (${surface})`, async ($, on) => {
    const clock = await withReplay($, on, surface)
    for (const bodyColumns of [40, 80, 144]) {
      const band = await $.ui.mount({ plugin: 'replay-theater', surface, component: 'AbovePrompt', requestId: 'band', props: bandProps(bodyColumns) })
      expect(await band.find({ key: 'open-replay' }), `band at ${bodyColumns}`).toBeDefined()
      expect(rawColors(await band.findAll({})), `band colors at ${bodyColumns}`).toEqual([])
      await band.unmount()

      const pane = await $.ui.mount({ plugin: 'replay-theater', surface, component: 'Pane', requestId: 'replay-theater', props: { title: 'Replay Theater', isFocused: false, bodyColumns, bodyRows: 20 } as never })
      expect(await pane.find({ key: 'next' }), `pane at ${bodyColumns}`).toBeDefined()
      expect(rawColors(await pane.findAll({})), `pane colors at ${bodyColumns}`).toEqual([])
      expect(await pane.find({ text: /click to focus/ }), 'focus hint while unfocused').toBeDefined()
      await pane.unmount()
    }

    const survey = await $.ui.mount({ plugin: 'replay-theater', surface, component: 'AbovePrompt', requestId: 'band', props: bandProps(80, true) })
    expect(await survey.find({ key: 'open-replay' }), 'yields to a survey').toBeUndefined()
    await clock.settle()
  })
}

test('/replay next, prev and close drive the open view', async ($, on) => {
  const clock = await withReplay($, on, 'terminal')
  const pending = $.command.run({ command: 'replay', args: 'close' } as never)
  await clock.advance(300)
  const idle = await pending
  expect(String((idle as { text?: string }).text), 'a subcommand with nothing open just opens it').toContain('1 edits')
  const next = await $.command.run({ command: 'replay', args: 'next' } as never)
  expect(String((next as { text?: string }).text)).toContain('step 1 of 1')
  const closed = await $.command.run({ command: 'replay', args: 'close' } as never)
  expect(String((closed as { text?: string }).text)).toContain('closed')
})
