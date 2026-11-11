import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { AVATAR_COLUMNS, AVATAR_ROWS } from './agent-shader'
import { crabColumns, crabModeOf } from './register'
import { SPRITE_COLUMNS, crabPixels, crabWords, encodeWords, parseColor } from './sprite'
import type { Fill } from './sprite'

const PLUGIN = 'savvy-progress'

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

test('sprite: the avatar is dropped when the card is narrow or crabs are off', () => {
  expect(crabColumns(144, 'walk')).toBe(AVATAR_COLUMNS)
  expect(crabColumns(44, 'still')).toBe(AVATAR_COLUMNS)
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

test('terminal pane: a card has an avatar at 60 and 144 columns and none at 40, and keeps its text at every width', async ($, on) => {
  await worker($, on)
  for (const width of [40, 60, 144]) {
    const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'Pane', requestId: 'savvy-agents', props: paneProps(width) })
    const rasters = await ui.findAll({ type: 'Raster' })
    const avatar = rasters.find(r => r.props.key === 'avatar-a1')
    const bar = rasters.find(r => r.props.key === 'ctxbar-a1')
    if (width < 44) {
      expect(avatar, `no avatar at ${width}`).toBeUndefined()
    } else {
      expect(Number(avatar?.props.columns), `avatar columns at ${width}`).toBe(AVATAR_COLUMNS)
      expect(Number(avatar?.props.rows), `avatar rows at ${width}`).toBe(AVATAR_ROWS)
      expect(decode(String(avatar?.props.cells)).length).toBe(AVATAR_COLUMNS * AVATAR_ROWS * 3)
      // The text beside the avatar keeps at least 24 columns: the border, padding and gap come off.
      expect(width - AVATAR_COLUMNS - 5).toBeGreaterThanOrEqual(24)
    }
    // The bar fits the card at every width: the border and padding come off, and never more than 40.
    expect(Number(bar?.props.columns), `bar columns at ${width}`).toBeLessThanOrEqual(width - 4)
    expect(Number(bar?.props.rows)).toBe(1)
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
