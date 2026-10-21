// Status-line entry point: prints the inner status line (for example claude-hud), then the cache bar.
// Config: <claude config dir>/plugins/cache-bar/config.json
//   { "inner": "<shell command>", "handoffMinutes": 5, "floorTokens": 80000 }

import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { DEFAULTS, renderBar } from '../lib/bar.ts'

type Config = { inner?: string; handoffMinutes?: number; floorTokens?: number }

const configDir = process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude')
const configPath = join(configDir, 'plugins', 'cache-bar', 'config.json')
// The /mods switchboard turns the bar off with `"cache-bar": false`; the inner status line still prints.
const switchesPath = join(configDir, 'mods', 'switches.json')

function isSwitchedOff(): boolean {
  try {
    return JSON.parse(readFileSync(switchesPath, 'utf8'))['cache-bar'] === false
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') console.error(`cache-bar: ignoring ${switchesPath}: ${(err as Error).message}`)
    return false
  }
}

function readConfig(): Config {
  let text: string
  try {
    text = readFileSync(configPath, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {}
    throw err
  }
  try {
    return JSON.parse(text)
  } catch (err) {
    console.error(`cache-bar: ignoring ${configPath}: ${(err as Error).message}`)
    return {}
  }
}

const input = await Bun.stdin.text()
const config = readConfig()

if (config.inner) {
  // The inner command's stderr passes through; if it fails, the bar still prints.
  const inner = spawnSync('bash', ['-c', config.inner], { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'inherit'] })
  if (inner.stdout) process.stdout.write(inner.stdout.endsWith('\n') ? inner.stdout : `${inner.stdout}\n`)
  if (inner.error) console.error(`cache-bar: inner command failed: ${inner.error.message}`)
  else if (inner.status !== 0) console.error(`cache-bar: inner command exited ${inner.status}`)
}

if (isSwitchedOff()) process.exit(0)

let stdin
try {
  stdin = JSON.parse(input)
} catch (err) {
  console.error(`cache-bar: status-line stdin is not JSON: ${(err as Error).message}`)
  process.exit(1)
}

const bar = renderBar(stdin, Math.floor(Date.now() / 1000), {
  handoffMinutes: config.handoffMinutes ?? DEFAULTS.handoffMinutes,
  floorTokens: config.floorTokens ?? DEFAULTS.floorTokens,
})
if (bar !== null) console.log(bar)
