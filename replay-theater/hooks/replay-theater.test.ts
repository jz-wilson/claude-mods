import { expect, mock, test } from 'claude-code/testing'
import type { FoundElement } from 'claude-code/testing'

import { listWindow, replaySvg, totals } from './replay-theater.mjs'

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

async function withReplay($: Parameters<Parameters<typeof test>[1]>[0], on: Parameters<Parameters<typeof test>[1]>[1], surface: 'terminal' | 'desktop', edits = 1) {
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
  for (let n = 0; n < edits; n++) await $.tool.call({ tool: 'Edit', file_path: '/Users/test/project/src/a-long-file-name.ts', old_string: 'one' + String.fromCharCode(10) + 'two', new_string: 'one' + String.fromCharCode(10) + 'three' } as never)
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
      // The terminal draws the summary as text; elsewhere it is inside the SVG card.
      if (surface === 'terminal') expect(await pane.find({ text: /1 edit in 1 file/ }), `summary at ${bodyColumns}`).toBeDefined()
      else expect(await pane.find({ text: /1 edit in 1 file/ }), 'no text summary beside the card').toBeUndefined()
      await pane.unmount()
    }

    const survey = await $.ui.mount({ plugin: 'replay-theater', surface, component: 'AbovePrompt', requestId: 'band', props: bandProps(80, true) })
    expect(await survey.find({ key: 'open-replay' }), 'yields to a survey').toBeUndefined()
    await clock.settle()
  })
}

test('/replay next, prev and close drive the open view', async ($, on) => {
  const clock = await withReplay($, on, 'terminal', 3)
  const text = async (args: string) => String(((await $.command.run({ command: 'replay', args } as never)) as { text?: string }).text)
  const pending = text('')
  await clock.advance(300)
  expect(await pending, 'opens with three edits').toContain('3 edits')
  expect(await text('prev'), 'clamps at the first edit').toContain('edit 1 of 3')
  expect(await text('next')).toContain('edit 2 of 3')
  expect(await text('next')).toContain('edit 3 of 3')
  expect(await text('next'), 'clamps at the last edit').toContain('edit 3 of 3')
  expect(await text('prev')).toContain('edit 2 of 3')
  expect(await text('close')).toContain('closed')
})

const step = (file: string, diff: Array<{ op: string; t: string }>, note = '') => ({ tool: 'Edit', file, diff, note })

test('totals count edits, files and changed lines across the replay', () => {
  const steps = [
    step('draft.md', [{ op: '-', t: 'a' }, { op: '+', t: 'b' }]),
    step('draft.md', [{ op: ' ', t: 'same' }, { op: '+', t: 'c' }, { op: '+', t: 'd' }]),
    step('src/other.ts', [{ op: '-', t: 'x' }]),
  ]
  expect(totals(steps)).toEqual({ edits: 3, files: 2, add: 3, del: 2 })
})

test('the edit list shows everything when it fits and keeps the current edit in view when it does not', () => {
  expect(listWindow(3, 2)).toEqual({ from: 0, to: 3 })
  expect(listWindow(20, 0)).toEqual({ from: 0, to: 6 })
  expect(listWindow(20, 10)).toEqual({ from: 7, to: 13 })
  expect(listWindow(20, 19)).toEqual({ from: 14, to: 20 })
})

test('the SVG card escapes project text, marks viewed edits, and respects reduced motion', () => {
  const tab = String.fromCharCode(9)
  const steps = [
    step('a.md', [{ op: '+', t: 'one' }]),
    step('<b>&"evil".md', [{ op: '-', t: '<script>alert(1)</script>' }, { op: '+', t: `tab${tab}here & "quoted"` }], 'replace all'),
    step('c.md', []),
  ]
  const card = replaySvg(steps, 1, 400)
  expect(card.source.startsWith('<svg ')).toBe(true)
  expect(card.source.length).toBeLessThan(131072)
  expect(card.source).toContain('3 edits in 3 files')
  expect(card.source).toContain('EDIT 2 OF 3')
  expect(card.source, 'markup from the project never reaches the document').not.toContain('<script>')
  expect(card.source).toContain('&lt;script&gt;')
  expect(card.source).toContain('&lt;b&gt;&amp;&quot;evil&quot;.md')
  expect(card.source.includes(tab), 'tabs become spaces').toBe(false)
  expect(card.source.match(/class="okc"/g)?.length, 'one viewed edit is checked').toBe(1)
  expect(card.source.match(/class="curc"/g)?.length, 'one current edit').toBe(1)
  expect(card.source).toContain('prefers-reduced-motion')
  expect(card.source).toContain('prefers-color-scheme: dark')
  expect(card.alt).toContain('Edit 2 of 3')
  expect(card.height).toBeGreaterThan(150)
  expect(card.height).toBeLessThan(4096)
  // An edit with no line changes still draws, and a long replay stays inside the limits.
  expect(replaySvg(steps, 2, 240).source).toContain('no line changes')
  const many = Array.from({ length: 200 }, (_, n) => step(`src/file-${n}.ts`, Array.from({ length: 40 }, () => ({ op: '+', t: 'x'.repeat(300) }))))
  const big = replaySvg(many, 150, 900)
  expect(big.source.length).toBeLessThan(131072)
  expect(big.height).toBeLessThan(4096)
  expect(big.source).toContain('148 to 153 of 200')
})

// True when the text holds a surrogate without its pair, or a character XML 1.0 forbids.
function badForXml(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = text.charCodeAt(i + 1)
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true
      i++
    } else if (c >= 0xdc00 && c <= 0xdfff) return true
    else if (c === 0xfffe || c === 0xffff) return true
    else if (c < 0x20 && c !== 9 && c !== 10 && c !== 13) return true
  }
  return false
}

test('the SVG card stays well-formed for odd input: split emoji, lone surrogates, wide text, no steps', () => {
  const emoji = String.fromCodePoint(0x1f600)
  const lone = String.fromCharCode(0xd83d)
  const han = String.fromCharCode(0x6f22)
  const steps = [
    step(`${emoji.repeat(80)}.md`, [{ op: '+', t: emoji.repeat(200) }, { op: '-', t: `a${lone}b${String.fromCharCode(0xffff)}c${String.fromCharCode(1)}d` }], 'edit 12 of 12'),
    step(`${han.repeat(60)}.md`, [{ op: '+', t: han.repeat(300) }]),
  ]
  for (const W of [240, 400, 900]) {
    for (const k of [0, 1]) expect(badForXml(replaySvg(steps, k, W).source), `well-formed at ${W}, edit ${k + 1}`).toBe(false)
  }
  // At the narrowest card the tool and note are cut, so they cannot run under the file name.
  const narrow = replaySvg([step('a-rather-long-file-name.md', [], 'edit 12 of 12 and a long note besides')], 0, 240).source
  expect(narrow).not.toContain('a long note besides')
  // No steps, or an index that is not a number, still draws a card.
  expect(replaySvg([], 0, 300).source).toContain('No edits to replay.')
  expect(replaySvg(steps, Number.NaN, 300).source).toContain('EDIT 1 OF 2')
})
