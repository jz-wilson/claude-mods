import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { crabColumns, crabModeOf, crabRaster } from './register'
import { SPRITE_COLUMNS, SPRITE_ROWS, crabPixels, crabWords, encodeWords, parseColor } from './sprite'
import type { Fill } from './sprite'

const PLUGIN = 'savvy-progress'
const COSTUMES = ['fable', 'heavy', 'careful', 'medium', 'light', 'explore', 'other'] as const
const CELLS = SPRITE_COLUMNS * SPRITE_ROWS
// The characters a crab may use: a space, and the upper and lower half blocks.
const ALLOWED = new Set([0x20, 0x2580, 0x2584])

// What a Raster reads back: the words behind a base64 `cells` string.
function decode(cells: string): Uint32Array {
  const binary = atob(cells)
  const bytes = Uint8Array.from(binary, ch => ch.charCodeAt(0))
  const view = new DataView(bytes.buffer)
  return Uint32Array.from({ length: bytes.length / 4 }, (_, i) => view.getUint32(i * 4, true))
}

test('sprite: colours parse from the forms the costumes use', () => {
  expect(parseColor('#fff')).toEqual({ r: 255, g: 255, b: 255, a: 1 })
  expect(parseColor('#D97757')).toEqual({ r: 0xd9, g: 0x77, b: 0x57, a: 1 })
  expect(parseColor('rgba(169,214,245,.32)')).toEqual({ r: 169, g: 214, b: 245, a: 0.32 })
  expect(parseColor('tomato')).toBeNull()
})

test('sprite: the encoder writes little-endian u32 as padded base64', () => {
  // One orange full block on the default background, as the Raster docs spell it.
  const words = Uint32Array.of(0x2588, 0xff8800, 0x01000000)
  expect(decode(encodeWords(words))).toEqual(words)
  expect(encodeWords(Uint32Array.of(1))).toBe('AQAAAA==')
})

for (const costume of COSTUMES) {
  test(`sprite: the ${costume} crab fills its Raster with printable cells`, () => {
    for (const look of [{}, { isWalking: true, frame: 0 }, { isWalking: true, frame: 1 }, { isDim: true }]) {
      const words = decode(crabRaster(costume, look))
      expect(words.length, 'three words a cell').toBe(CELLS * 3)
      let drawn = 0
      for (let cell = 0; cell < CELLS; cell++) {
        const [codePoint = 0, foreground = 0, background = 0] = words.subarray(cell * 3, cell * 3 + 3)
        expect(ALLOWED.has(codePoint), `cell ${cell} is a space or a half block`).toBe(true)
        expect(foreground <= 0x01000000 && background <= 0x01000000, `cell ${cell} colours are RGB or the default`).toBe(true)
        if (codePoint !== 0x20) drawn += 1
      }
      // The body alone covers a third of the grid; an empty or solid sprite is a bug.
      expect(drawn).toBeGreaterThan(CELLS / 4)
      expect(drawn).toBeLessThan(CELLS)
    }
  })
}

test('sprite: walking lifts one leg pair per frame, standing never moves, dimming changes colour only', () => {
  const draw = (f: Fill) => {
    f(8, 10, 14, 12, '#D97757')
    f(8, 22, 2, 4, '#D97757', 'la')
    f(20, 22, 2, 4, '#D97757', 'lb')
  }
  const still = crabPixels(draw)
  const stepA = crabPixels(draw, { isWalking: true, frame: 0 })
  const stepB = crabPixels(draw, { isWalking: true, frame: 1 })
  expect(Array.from(stepA)).not.toEqual(Array.from(stepB))
  expect(Array.from(stepA)).not.toEqual(Array.from(still))
  // The frame only matters by parity, and not at all while standing.
  expect(Array.from(crabPixels(draw, { isWalking: true, frame: 2 }))).toEqual(Array.from(stepA))
  expect(Array.from(crabPixels(draw, { frame: 1 }))).toEqual(Array.from(still))

  const dimmed = crabPixels(draw, { isDim: true })
  expect(Array.from(dimmed, p => p >= 0)).toEqual(Array.from(still, p => p >= 0))
  expect(Array.from(dimmed)).not.toEqual(Array.from(still))
})

test('sprite: mirroring flips the crab, and a translucent fill over nothing draws nothing', () => {
  const draw = (f: Fill) => f(0, 0, 4, 4, '#112233')
  const facingRight = crabPixels(draw)
  const facingLeft = crabPixels(draw, { isMirrored: true })
  expect(facingRight[0]).toBe(0x112233)
  expect(facingRight[SPRITE_COLUMNS - 1]).toBe(-1)
  expect(facingLeft[SPRITE_COLUMNS - 1]).toBe(0x112233)
  expect(facingLeft[0]).toBe(-1)

  const glass = crabWords(f => f(0, 0, 30, 28, 'rgba(169,214,245,.32)'))
  expect(Array.from(glass).filter((_, i) => i % 3 === 0).every(codePoint => codePoint === 0x20)).toBe(true)
})

test('sprite: the crab is dropped when the card is narrow or crabs are off', () => {
  expect(crabColumns(144, 'walk')).toBe(SPRITE_COLUMNS)
  expect(crabColumns(44, 'still')).toBe(SPRITE_COLUMNS)
  expect(crabColumns(43, 'walk')).toBe(0)
  expect(crabColumns(144, 'off')).toBe(0)
  expect(crabModeOf('still')).toBe('still')
  expect(crabModeOf('off')).toBe('off')
  expect(crabModeOf(undefined)).toBe('walk')
  expect(crabModeOf('dance')).toBe('walk')
})

const paneProps = (bodyColumns: number) =>
  ({ title: '', isFocused: false, bodyColumns, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} }) as const

// One running worker, known to the panel.
const worker = async ($: Engine, on: On) => {
  mock.clock(on)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: 'a1' }))
  await $.agent.spawn({ tool_use_id: 't1', prompt: 'p', description: 'Build the landing page', subagentType: 'savvy-light', provider: 'engine', parentModel: 'claude-haiku-5-5', background: false, fork: false } as never)
}

test('terminal pane: a card has a crab at 60 and 144 columns and none at 40, and keeps its text at every width', async ($, on) => {
  await worker($, on)
  for (const width of [40, 60, 144]) {
    const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'Pane', requestId: 'savvy-agents', props: paneProps(width) })
    const raster = await ui.find({ type: 'Raster' })
    if (width < 44) {
      expect(raster, `no crab at ${width}`).toBeUndefined()
    } else {
      expect(Number(raster?.props.columns), `crab columns at ${width}`).toBe(SPRITE_COLUMNS)
      expect(Number(raster?.props.rows), `crab rows at ${width}`).toBe(SPRITE_ROWS)
      expect(decode(String(raster?.props.cells)).length).toBe(CELLS * 3)
      // The text beside the crab keeps at least 24 columns.
      expect(width - SPRITE_COLUMNS - 4).toBeGreaterThanOrEqual(24)
    }
    expect((await ui.find({ type: 'Text', text: /Build the landing page/ }))?.text).toBe('Build the landing page')
    expect(await ui.find({ type: 'Text', text: /Haiku 5\.5/ }), `model at ${width}`).toBeDefined()
    await ui.unmount()
  }
})

test('desktop pane: no Raster is drawn where the SVG panel is', async ($, on) => {
  await worker($, on)
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'Pane', requestId: 'savvy-agents', props: paneProps(80) })
  expect(await ui.find({ type: 'Raster' })).toBeUndefined()
  await ui.unmount()
})
