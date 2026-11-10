// The terminal's crab: the same pixel drawing the SVG panel uses, painted into a Raster.
//
// A costume draws on a 30×28 grid through a `Fill` callback. Here that grid is halved to
// 15×14 pixels and packed two pixels to a cell with half-block characters, so a crab is
// 15 columns by 7 rows. Nothing in this file touches the engine: it turns a drawing into
// the base64 cell grid a `Raster` takes, which is what makes it testable on its own.

// `cls` names the group a pixel belongs to: `la` and `lb` are the two leg pairs, which step
// in turn while the crab walks; everything else is the body, its costume and its props.
export type Fill = (x: number, y: number, w: number, h: number, c: string, cls?: string) => void

export type CrabLook = {
  // A running agent's crab walks: the leg pairs lift in turn, one per frame.
  isWalking?: boolean
  // Which of the two walking frames to draw; any integer, only its parity matters.
  frame?: number
  // A finished or planned agent's crab is greyed back.
  isDim?: boolean
  // Faces left (right-to-left languages).
  isMirrored?: boolean
}

const SOURCE_WIDTH = 30
const SOURCE_HEIGHT = 28
export const SPRITE_COLUMNS = SOURCE_WIDTH / 2
export const SPRITE_ROWS = SOURCE_HEIGHT / 4

// A Raster color is 0x00RRGGBB; bit 24 alone means the terminal's own default.
const DEFAULT_COLOR = 0x01000000
const SPACE = 0x20
const UPPER_HALF = 0x2580
const LOWER_HALF = 0x2584
const EMPTY = -1
// How far a dimmed crab is pulled towards mid grey, which reads on light and dark themes.
const DIM_MIX = 0.55
const DIM_GREY = 0x80

type Rgba = { r: number; g: number; b: number; a: number }

// The costumes use #RGB, #RRGGBB and rgba(r,g,b,a). Anything else draws nothing.
export function parseColor(color: string): Rgba | null {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim())
  if (hex?.[1] !== undefined) {
    const digits = hex[1].length === 3 ? [...hex[1]].map(d => d + d).join('') : hex[1]
    const n = Number.parseInt(digits, 16)
    return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff, a: 1 }
  }
  const rgba = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(color.trim())
  if (rgba === null) return null
  const channel = (v: string | undefined) => Math.max(0, Math.min(255, Math.round(Number(v))))
  const alpha = rgba[4] === undefined ? 1 : Math.max(0, Math.min(1, Number(rgba[4])))
  return { r: channel(rgba[1]), g: channel(rgba[2]), b: channel(rgba[3]), a: alpha }
}

// Paints a costume onto the 30×28 grid. A translucent fill tints what is under it, and over
// nothing it stays translucent, so a glass dome shows its rim and not a block of colour.
function paint(draw: (fill: Fill) => void, look: CrabLook): Array<Rgba | null> {
  const grid: Array<Rgba | null> = new Array(SOURCE_WIDTH * SOURCE_HEIGHT).fill(null)
  const liftedLegs = look.isWalking === true ? (Math.abs(Math.trunc(look.frame ?? 0)) % 2 === 0 ? 'la' : 'lb') : ''
  const fill: Fill = (x, y, w, h, c, cls) => {
    const color = parseColor(c)
    if (color === null) return
    // Two source pixels are one drawn pixel, so a lifted leg rises by two.
    const top = cls !== undefined && cls === liftedLegs ? y - 2 : y
    for (let py = Math.max(0, top); py < Math.min(SOURCE_HEIGHT, top + h); py++) {
      for (let px = Math.max(0, x); px < Math.min(SOURCE_WIDTH, x + w); px++) {
        const at = py * SOURCE_WIDTH + px
        const under = grid[at] ?? null
        if (color.a >= 1 || under === null) {
          grid[at] = { ...color }
        } else {
          const keep = 1 - color.a
          grid[at] = {
            r: Math.round(color.r * color.a + under.r * keep),
            g: Math.round(color.g * color.a + under.g * keep),
            b: Math.round(color.b * color.a + under.b * keep),
            a: Math.max(under.a, color.a),
          }
        }
      }
    }
  }
  draw(fill)
  return grid
}

// The 15×14 pixels of a crab, row-major: 0x00RRGGBB, or -1 where nothing is drawn.
// Each is the commonest solid colour of its 2×2 source block; a block that is less than
// half covered stays empty, which keeps one-pixel-wide props (a flag pole) and drops specks.
export function crabPixels(draw: (fill: Fill) => void, look: CrabLook = {}): Int32Array {
  const grid = paint(draw, look)
  const width = SPRITE_COLUMNS
  const height = SOURCE_HEIGHT / 2
  const pixels = new Int32Array(width * height).fill(EMPTY)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const counts = new Map<number, number>()
      for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) {
        const cell = grid[(y * 2 + dy) * SOURCE_WIDTH + x * 2 + dx] ?? null
        if (cell === null || cell.a < 0.5) continue
        const rgb = (cell.r << 16) | (cell.g << 8) | cell.b
        counts.set(rgb, (counts.get(rgb) ?? 0) + 1)
      }
      let solid = 0
      let best = EMPTY
      let bestCount = 0
      for (const [rgb, count] of counts) {
        solid += count
        if (count > bestCount) {
          best = rgb
          bestCount = count
        }
      }
      if (solid < 2) continue
      const target = look.isMirrored === true ? width - 1 - x : x
      pixels[y * width + target] = look.isDim === true ? dim(best) : best
    }
  }
  return pixels
}

function dim(rgb: number): number {
  const mix = (channel: number) => Math.round(channel * (1 - DIM_MIX) + DIM_GREY * DIM_MIX)
  return (mix((rgb >> 16) & 0xff) << 16) | (mix((rgb >> 8) & 0xff) << 8) | mix(rgb & 0xff)
}

// One [codePoint, foreground, background] triplet per cell, row-major.
export function crabWords(draw: (fill: Fill) => void, look: CrabLook = {}): Uint32Array {
  const pixels = crabPixels(draw, look)
  const words = new Uint32Array(SPRITE_COLUMNS * SPRITE_ROWS * 3)
  for (let row = 0; row < SPRITE_ROWS; row++) {
    for (let column = 0; column < SPRITE_COLUMNS; column++) {
      const upper = pixels[row * 2 * SPRITE_COLUMNS + column] ?? EMPTY
      const lower = pixels[(row * 2 + 1) * SPRITE_COLUMNS + column] ?? EMPTY
      const at = (row * SPRITE_COLUMNS + column) * 3
      if (upper === EMPTY && lower === EMPTY) {
        words.set([SPACE, DEFAULT_COLOR, DEFAULT_COLOR], at)
      } else if (upper === EMPTY) {
        words.set([LOWER_HALF, lower, DEFAULT_COLOR], at)
      } else {
        // The upper half is the foreground; an empty lower half shows the terminal's background.
        words.set([UPPER_HALF, upper, lower === EMPTY ? DEFAULT_COLOR : lower], at)
      }
    }
  }
  return words
}

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

// Standard padded base64 of the words as little-endian u32, whatever the platform's byte
// order. `Uint8Array.prototype.toBase64` is outside the lib a mod's tsconfig names.
export function encodeWords(words: Uint32Array): string {
  const bytes = new Uint8Array(words.length * 4)
  const view = new DataView(bytes.buffer)
  words.forEach((word, i) => view.setUint32(i * 4, word, true))
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] ?? 0
    const b = bytes[i + 1]
    const c = bytes[i + 2]
    const triple = (a << 16) | ((b ?? 0) << 8) | (c ?? 0)
    out += BASE64.charAt((triple >> 18) & 63) + BASE64.charAt((triple >> 12) & 63)
    out += b === undefined ? '=' : BASE64.charAt((triple >> 6) & 63)
    out += c === undefined ? '=' : BASE64.charAt(triple & 63)
  }
  return out
}

// The `cells` of a Raster of SPRITE_COLUMNS by SPRITE_ROWS.
export function crabCells(draw: (fill: Fill) => void, look: CrabLook = {}): string {
  return encodeWords(crabWords(draw, look))
}
