// Prints every crab scene as truecolor blocks.
//   bun savvy-progress/preview.ts                 every activity, every scene, one frame
//   bun savvy-progress/preview.ts read            one activity, all its scenes, six frames each
//   bun savvy-progress/preview.ts read sonnet high   with a model and an effort
//   bun savvy-progress/preview.ts bar [model]     the progress bar in every state
import { AVATAR_COLUMNS, AVATAR_ROWS, drawAgentAvatar, drawProgressBar, sceneCount } from './hooks/agent-shader'
import type { Activity, EffortLevel, Mood, ModelTier } from './hooks/agent-shader'

const MOODS: Mood[] = ['think', 'read', 'build', 'shell', 'test', 'web', 'sub', 'gear', 'install', 'git', 'ship', 'done', 'dizzy']
const only = process.argv[2] as Mood | undefined
const wantsBars = process.argv[2] === 'bar'
const model = (process.argv[3] ?? 'haiku') as ModelTier
const effort = (process.argv[4] ?? 'medium') as EffortLevel
const DEFAULT_COLOR = 0x01000000

const decode = (cells: string) => {
  const bytes = Buffer.from(cells, 'base64')
  return Array.from({ length: bytes.length / 4 }, (_, i) => bytes.readUInt32LE(i * 4))
}
const paint = (word: number, layer: 38 | 48) =>
  word === DEFAULT_COLOR ? `\x1b[${layer + 1}m` : `\x1b[${layer};2;${(word >> 16) & 255};${(word >> 8) & 255};${word & 255}m`
const draw = (mood: Mood, seed: number, t: number) =>
  decode(
    mood === 'done' || mood === 'dizzy'
      ? drawAgentAvatar('verify', model, effort, true, t, mood === 'dizzy', undefined, seed)
      : drawAgentAvatar('verify', model, effort, false, t, false, mood as Activity, seed),
  )
const row = (words: number[], y: number) =>
  Array.from({ length: AVATAR_COLUMNS }, (_, c) => {
    const i = (y * AVATAR_COLUMNS + c) * 3
    return `${paint(words[i + 1] ?? 0, 38)}${paint(words[i + 2] ?? 0, 48)}${String.fromCodePoint(words[i] ?? 32)}`
  }).join('') + '\x1b[0m'

if (wantsBars) {
  const cells = (word: number[], i: number) => `${paint(word[i + 1] ?? 0, 38)}${paint(word[i + 2] ?? 0, 48)}${String.fromCodePoint(word[i] ?? 32)}`
  const line = (look: Parameters<typeof drawProgressBar>[0]) => {
    const w = decode(drawProgressBar(look))
    return Array.from({ length: look.columns }, (_, c) => cells(w, c * 3)).join('') + '[0m'
  }
  const base = { columns: 40, model: (process.argv[3] ?? 'haiku') as ModelTier, effort: 'medium' as EffortLevel, tMs: 0 }
  const rows: [string, Parameters<typeof drawProgressBar>[0]][] = [
    ['running 0%', { ...base, value: 0, state: 'running', contextPercent: 5 }],
    ['running 33.3% (eighths)', { ...base, value: 33.3, state: 'running', contextPercent: 20 }],
    ['running 62%', { ...base, value: 62, state: 'running', contextPercent: 30 }],
    ['task 40%, context tick at 55%', { ...base, value: 40, state: 'running', contextPercent: 55, showContext: true }],
    ['context 82% (amber)', { ...base, value: 82, state: 'running', contextPercent: 82 }],
    ['context 94% (red)', { ...base, value: 94, state: 'running', contextPercent: 94 }],
    ['done', { ...base, value: 100, state: 'done', contextPercent: 40 }],
    ['failed at 48%', { ...base, value: 48, state: 'failed', contextPercent: 40 }],
  ]
  for (const [name, look] of rows) console.log(`${line(look)}  ${name}`)
  process.exit(0)
}

const times = only ? [0, 150, 300, 450, 600, 750] : [450]
for (const mood of only ? [only] : MOODS) {
  console.log(`\n${mood} (${sceneCount(mood)} scenes)`)
  for (let seed = 0; seed < sceneCount(mood); seed++) {
    for (let y = 0; y < AVATAR_ROWS; y++) console.log(times.map(t => row(draw(mood, seed, t), y)).join('  '))
    console.log()
  }
}

