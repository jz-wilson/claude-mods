import { expect, mock, test } from 'claude-code/testing'
import type { FoundElement } from 'claude-code/testing'
import type { ThemeKey } from 'claude-code'

const props = { title: 'Mods', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} } as never

// installed_plugins.json: every known mod installed for this user, so each keeps its row.
const KNOWN = ['cache-clock', 'handoff', 'screen-share', 'brain-dump', 'reflect', 'helper-desk', 'chat-inventory', 'cache-bar']
const installedJson = (names: string[], extra: Record<string, unknown[]> = {}) =>
  JSON.stringify({
    version: 2,
    plugins: { ...Object.fromEntries(names.map(n => [`${n}@claude-mods`, [{ scope: 'user', installPath: `/nowhere/${n}` }]])), ...extra },
  })
const INSTALLED_AT = '/.claude/plugins/installed_plugins.json'
const INSTALLED = installedJson(KNOWN)

for (const surface of ['desktop', 'terminal'] as const) {
  test(`switches a mod off, and Show opens a side pane (${surface})`, { timeoutMs: 20000 }, async ($, on) => {
    const files: Record<string, string> = {}
    const opened: string[] = []
    const find = (end: string) => Object.keys(files).find(k => k.endsWith(end))

    on('session.start', async ($, e) => ({ cwd: e.cwd }) as never)
    on('session.id', async () => ({ value: 'sid-123' }) as never)
    on('command.register', async () => ({ value: undefined }) as never)
    const clock = mock.clock(on, { now: new Date(2026, 9, 15, 21, 0).getTime() })
    on('ui.open', async ($, e) => {
      opened.push((e as { id: string }).id)
      return { value: { isPlaced: true } } as never
    })
    on('process.run', async () => ({ value: { exitCode: 0, stdout: '', stderr: '' } }) as never)
    on('fs.exists', async ($, e) => {
      const path = (e as { path: string }).path.replace(/\\/g, '/')
      return { value: path in files || path.endsWith(INSTALLED_AT) } as never
    })
    on('fs.read', async ($, e) => {
      const path = (e as { path: string }).path.replace(/\\/g, '/')
      if (path.endsWith(INSTALLED_AT)) return { value: INSTALLED } as never
      if (!(path in files)) throw new Error(`ENOENT ${path}`)
      return { value: files[path] } as never
    })
    on('fs.write', async ($, e) => {
      const { path: rawPath, text } = e as { path: string; text: string }; const path = rawPath.replace(/\\/g, '/')
      files[path] = text
      return { value: undefined } as never
    })
    on('fs.list', async () => ({ value: [] }) as never)
    mock.env(on, {})

    await $.session.start({ source: 'startup', cwd: '/Users/test/vault', surface, isInteractive: true } as never)
    await $.command.run({ command: 'mods', args: '' } as never)
    await clock.settle()
    expect(opened, '/mods opens the pane').toContain('mods')

    const v = await $.ui.mount({ plugin: 'mods', surface, component: 'Pane', requestId: 'mods', props })
    expect(await v.find({ text: 'Cache Clock' }), 'first row').toBeDefined()
    expect(await v.find({ text: 'Chat Inventory' }), 'last row').toBeDefined()
    expect(await v.find({ text: /Off means off in every chat\. Hidden keeps it on but out of sight\. Changes apply within 3 seconds\./ }), 'footer').toBeDefined()
    expect(await v.find({ text: 'New mods appear here by themselves.' }), 'footer line on new mods').toBeDefined()
    expect(await v.find({ text: 'Helper Desk' }), 'Helper Desk keeps its name').toBeDefined()
    expect(await v.find({ key: 'show-brain-dump' }), 'no Shown/Hidden on brain-dump').toBeUndefined()
    expect(await v.find({ text: '/cacheclock to show or hide' }), 'tip under Cache Clock').toBeDefined()
    expect(await v.find({ text: '/screen-share to hide private data' }), 'tip under Screen-Share').toBeDefined()

    // Cache Clock: On to Off writes the whole file with its key set to false.
    await v.press({ key: 'toggle-cache-clock' })
    const sw = find('/.claude/mods/switches.json') ?? ''
    expect(sw, 'switches.json written under the home folder').not.toBe('')
    expect(JSON.parse(files[sw] ?? '{}'), 'cache-clock off').toEqual({ 'cache-clock': false })
    expect(await v.find({ text: 'Cache Clock is off in every chat.' }), 'note after the press').toBeDefined()

    // Helper Desk: Hide, then Show, which clears the flag and leaves the empty request file for this chat.
    await v.press({ key: 'show-helper-desk' })
    expect(JSON.parse(files[sw] ?? '{}'), 'desk hidden').toEqual({ 'cache-clock': false, 'helper-desk:hidden': true })
    expect(find('/.claude/mods/.open-helper-desk-sid-123'), 'no request on Hide').toBeUndefined()
    await v.press({ key: 'show-helper-desk' })
    expect(JSON.parse(files[sw] ?? '{}'), 'desk shown').toEqual({ 'cache-clock': false })
    const ask = find('/.claude/mods/.open-helper-desk-sid-123') ?? ''
    expect(ask, 'request file has the session id').not.toBe('')
    expect(files[ask], 'request file is empty').toBe('')

    // Off: Shown/Hidden cannot be pressed for that mod, and On brings the key back out.
    await v.press({ key: 'toggle-helper-desk' })
    expect(await v.find({ key: 'show-helper-desk' }), 'no Shown/Hidden button while off').toBeUndefined()
    expect(await v.find({ key: 'show-cache-clock' }), 'nor for Cache Clock, which is off').toBeUndefined()
    expect(JSON.parse(files[sw] ?? '{}'), 'both off').toEqual({ 'cache-clock': false, 'helper-desk': false })
    await v.press({ key: 'toggle-cache-clock' })
    expect(JSON.parse(files[sw] ?? '{}'), 'cache-clock back on: key removed').toEqual({ 'helper-desk': false })
  })
}

for (const surface of ['desktop', 'terminal'] as const) {
  test(`Shown/Hidden on Cache Clock flips its hidden key (${surface})`, { timeoutMs: 20000 }, async ($, on) => {
    const files: Record<string, string> = {}
    const find = (end: string) => Object.keys(files).find(k => k.endsWith(end))
    on('session.start', async ($, e) => ({ cwd: e.cwd }) as never)
    on('session.id', async () => ({ value: 'sid-123' }) as never)
    on('command.register', async () => ({ value: undefined }) as never)
    mock.clock(on, { now: new Date(2026, 9, 15, 21, 0).getTime() })
    on('process.run', async () => ({ value: { exitCode: 0, stdout: '', stderr: '' } }) as never)
    on('fs.exists', async ($, e) => {
      const path = (e as { path: string }).path.replace(/\\/g, '/')
      return { value: path in files || path.endsWith(INSTALLED_AT) } as never
    })
    on('fs.read', async ($, e) => {
      const path = (e as { path: string }).path.replace(/\\/g, '/')
      if (path.endsWith(INSTALLED_AT)) return { value: INSTALLED } as never
      if (!(path in files)) throw new Error(`ENOENT ${path}`)
      return { value: files[path] } as never
    })
    on('fs.write', async ($, e) => {
      const { path: rawPath, text } = e as { path: string; text: string }; const path = rawPath.replace(/\\/g, '/')
      files[path] = text
      return { value: undefined } as never
    })
    on('fs.list', async () => ({ value: [] }) as never)
    mock.env(on, {})

    await $.session.start({ source: 'startup', cwd: '/Users/test/vault', surface, isInteractive: true } as never)
    const v = await $.ui.mount({ plugin: 'mods', surface, component: 'Pane', requestId: 'mods', props })
    await v.press({ key: 'show-cache-clock' })
    const sw = find('/.claude/mods/switches.json') ?? ''
    expect(JSON.parse(files[sw] ?? '{}'), 'hidden key set').toEqual({ 'cache-clock:hidden': true })
    expect(await v.find({ text: 'Cache Clock is hidden in every chat.' }), 'note says hidden').toBeDefined()
    expect(await v.find({ text: 'Hidden' }), 'the row reads Hidden').toBeDefined()
    expect(find('/.claude/mods/.open-cache-clock-sid-123'), 'a band mod needs no open request').toBeUndefined()

    await v.press({ key: 'show-cache-clock' })
    expect(JSON.parse(files[sw] ?? '{}'), 'hidden key removed').toEqual({})
    expect(await v.find({ text: 'Cache Clock is shown in every chat.' }), 'note says shown').toBeDefined()
  })
}

for (const surface of ['desktop', 'terminal'] as const) {
  test(`Open on a pane mod writes the open request only while it is On and Shown (${surface})`, { timeoutMs: 20000 }, async ($, on) => {
    const files: Record<string, string> = {}
    const find = (end: string) => Object.keys(files).find(k => k.endsWith(end))
    on('session.start', async ($, e) => ({ cwd: e.cwd }) as never)
    on('session.id', async () => ({ value: 'sid-123' }) as never)
    on('command.register', async () => ({ value: undefined }) as never)
    mock.clock(on, { now: new Date(2026, 9, 15, 21, 0).getTime() })
    on('process.run', async () => ({ value: { exitCode: 0, stdout: '', stderr: '' } }) as never)
    on('fs.exists', async ($, e) => {
      const path = (e as { path: string }).path.replace(/\\/g, '/')
      return { value: path in files || path.endsWith(INSTALLED_AT) } as never
    })
    on('fs.read', async ($, e) => {
      const path = (e as { path: string }).path.replace(/\\/g, '/')
      if (path.endsWith(INSTALLED_AT)) return { value: INSTALLED } as never
      if (!(path in files)) throw new Error(`ENOENT ${path}`)
      return { value: files[path] } as never
    })
    on('fs.write', async ($, e) => {
      const { path: rawPath, text } = e as { path: string; text: string }; const path = rawPath.replace(/\\/g, '/')
      files[path] = text
      return { value: undefined } as never
    })
    on('fs.list', async () => ({ value: [] }) as never)
    mock.env(on, {})

    await $.session.start({ source: 'startup', cwd: '/Users/test/vault', surface, isInteractive: true } as never)
    const v = await $.ui.mount({ plugin: 'mods', surface, component: 'Pane', requestId: 'mods', props })
    for (const name of ['helper-desk', 'chat-inventory']) {
      expect(await v.find({ key: `open-${name}` }), `Open on ${name}`).toBeDefined()
    }
    expect(await v.find({ key: 'open-cache-clock' }), 'no Open on a band mod').toBeUndefined()

    await v.press({ key: 'open-helper-desk' })
    const ask = find('/.claude/mods/.open-helper-desk-sid-123') ?? ''
    expect(ask, 'open request written').not.toBe('')
    expect(files[ask], 'request file is empty').toBe('')
    expect(await v.find({ text: 'Helper Desk opens in this chat within 3 seconds.' }), 'note').toBeDefined()

    // Hidden: Open cannot be pressed.
    await v.press({ key: 'show-chat-inventory' })
    expect(await v.find({ key: 'open-chat-inventory' }), 'no Open while hidden').toBeUndefined()
    // Off: Open cannot be pressed.
    await v.press({ key: 'toggle-helper-desk' })
    expect(await v.find({ key: 'open-helper-desk' }), 'no Open while off').toBeUndefined()
    await v.press({ key: 'show-chat-inventory' })
    expect(await v.find({ key: 'open-chat-inventory' }), 'Open again on an On and Shown mod').toBeDefined()
  })
}

// A fake machine: the files sit under any home folder, matched by the end of the path.
const disk: Record<string, string> = {
  '/.claude/mods/zeta-notes/.claude-plugin/plugin.json': JSON.stringify({ name: 'zeta-notes', description: 'Keeps short notes beside the chat' }),
  '/.claude/mods/zeta-notes/hooks/hooks.json': JSON.stringify({ modules: ['./register.tsx'] }),
  '/.claude/mods/zeta-notes/hooks/register.tsx': "const f = 'switches.json'\nawait $.command.register({ name: 'zeta', description: 'x' })",
  '/.claude/mods/plain-tool/.claude-plugin/plugin.json': JSON.stringify({ name: 'plain-tool', description: 'Does one plain thing' }),
  '/.claude/mods/plain-tool/hooks/hooks.json': JSON.stringify({ modules: ['./register.ts'] }),
  '/.claude/mods/plain-tool/hooks/register.ts': "await $.command.register({ name: 'plain' })",
  '/.claude/mods/not-a-mod/.claude-plugin/plugin.json': JSON.stringify({ name: 'not-a-mod' }),
  '/.claude/mods/not-a-mod/hooks/hooks.json': JSON.stringify({ hooks: {} }),
  '/.claude/mods/mods/.claude-plugin/plugin.json': JSON.stringify({ name: 'mods' }),
  '/.claude/mods/mods/hooks/hooks.json': JSON.stringify({ modules: ['./register.tsx'] }),
  '/.claude/mods/helper-desk/.claude-plugin/plugin.json': JSON.stringify({ name: 'helper-desk', description: 'long text' }),
  '/.claude/mods/helper-desk/hooks/hooks.json': JSON.stringify({ modules: ['./register.tsx'] }),
  '/.claude/mods/helper-desk/hooks/register.tsx': "readSwitch('switches.json')",
  '/opt/extra/alpha-env/.claude-plugin/plugin.json': JSON.stringify({ name: 'alpha-env', description: 'Found through the env list' }),
  '/opt/extra/alpha-env/hooks/hooks.json': JSON.stringify({ modules: ['./register.tsx'] }),
  '/opt/extra/alpha-env/hooks/register.tsx': "'switches.json'",
  '/.claude/plugins/cache/anthropic/replay-theater/0.1.0/.claude-plugin/plugin.json': JSON.stringify({ name: 'replay-theater', description: 'Replays each edit' }),
  '/.claude/plugins/cache/anthropic/replay-theater/0.1.0/hooks/hooks.json': JSON.stringify({ modules: ['./register.tsx'] }),
  '/.claude/plugins/cache/anthropic/replay-theater/0.1.0/hooks/register.tsx': "await $.command.register({ name: 'replay' })",
  '/.claude/dev-mods/sid-123/brand-new/.claude-plugin/plugin.json': JSON.stringify({ name: 'brand-new', description: 'Made in this chat' }),
  '/.claude/dev-mods/sid-123/brand-new/hooks/hooks.json': JSON.stringify({ modules: ['./register.tsx'] }),
  '/.claude/dev-mods/sid-123/brand-new/hooks/register.tsx': "'switches.json'",
  // Uninstalled, but its files are still in the cache: not listed.
  '/.claude/plugins/cache/claude-mods/agent-tree/0.1.3/.claude-plugin/plugin.json': JSON.stringify({ name: 'agent-tree' }),
  '/.claude/plugins/cache/claude-mods/agent-tree/0.1.3/hooks/hooks.json': JSON.stringify({ modules: ['./register.tsx'] }),
  // reflect is not installed; replay-theater is, for this user; local-only is installed for another folder.
  [INSTALLED_AT]: installedJson(
    KNOWN.filter(n => n !== 'reflect'),
    {
      'replay-theater@anthropic': [{ scope: 'user', installPath: 'C:\\Users\\t\\.claude\\plugins\\cache\\anthropic\\replay-theater\\0.1.0' }],
      'local-only@claude-mods': [{ scope: 'project', projectPath: '/Users/test/elsewhere', installPath: '/Users/t/.claude/plugins/cache/claude-mods/local-only/0.1.0' }],
      // Installed for the folder above the session's: it counts.
      'here-only@claude-mods': [{ scope: 'project', projectPath: '\\Users\\Test\\', installPath: '/Users/t/.claude/plugins/cache/claude-mods/here-only/0.1.0' }],
    },
  ),
  '/.claude/plugins/cache/claude-mods/here-only/0.1.0/.claude-plugin/plugin.json': JSON.stringify({ name: 'here-only' }),
  '/.claude/plugins/cache/claude-mods/here-only/0.1.0/hooks/hooks.json': JSON.stringify({ modules: ['./register.tsx'] }),
  '/.claude/plugins/cache/claude-mods/local-only/0.1.0/.claude-plugin/plugin.json': JSON.stringify({ name: 'local-only' }),
  '/.claude/plugins/cache/claude-mods/local-only/0.1.0/hooks/hooks.json': JSON.stringify({ modules: ['./register.tsx'] }),
  // A marketplace offering an installed mod, a mod not installed, a plain plugin and a remote one.
  '/.claude/plugins/known_marketplaces.json': JSON.stringify({ 'claude-mods': { installLocation: 'C:\\Users\\t\\.claude\\plugins\\marketplaces\\claude-mods' } }),
  '/.claude/plugins/marketplaces/claude-mods/.claude-plugin/marketplace.json': JSON.stringify({
    plugins: [
      { name: 'helper-desk', source: './helper-desk' },
      { name: 'fresh-mod', source: './fresh-mod' },
      { name: 'plain-plugin', source: './plain-plugin' },
      { name: 'remote', source: { source: 'github', repo: 'x/y' } },
    ],
  }),
  '/.claude/plugins/marketplaces/claude-mods/fresh-mod/.claude-plugin/plugin.json': JSON.stringify({ name: 'fresh-mod', description: 'Just published' }),
  '/.claude/plugins/marketplaces/claude-mods/fresh-mod/hooks/hooks.json': JSON.stringify({ modules: ['./register.tsx'] }),
  '/.claude/plugins/marketplaces/claude-mods/plain-plugin/.claude-plugin/plugin.json': JSON.stringify({ name: 'plain-plugin' }),
}
const dirs: Record<string, string[]> = {
  '/.claude/mods': ['zeta-notes', 'plain-tool', 'not-a-mod', 'mods', 'helper-desk'],
  '/.claude/dev-mods/sid-123': ['brand-new'],
  '/.claude/plugins/cache': ['anthropic', 'claude-mods'],
  '/.claude/plugins/cache/anthropic': ['replay-theater'],
  '/.claude/plugins/cache/anthropic/replay-theater': ['0.1.0'],
  '/.claude/plugins/cache/claude-mods': ['agent-tree', 'local-only'],
}
const onDisk = (path: string) => Object.keys(disk).find(k => path.endsWith(k))

for (const surface of ['desktop', 'terminal'] as const) {
  test(`finds new mods by itself, and a mod without the switch gets a note (${surface})`, { timeoutMs: 20000 }, async ($, on) => {
    const files: Record<string, string> = {}
    on('session.start', async ($, e) => ({ cwd: e.cwd }) as never)
    on('session.id', async () => ({ value: 'sid-123' }) as never)
    on('command.register', async () => ({ value: undefined }) as never)
    mock.clock(on, { now: new Date(2026, 9, 16, 9, 0).getTime() })
    on('ui.open', async () => ({ value: { isPlaced: true } }) as never)
    const runs: string[][] = []
    on('process.run', async ($, e) => {
      runs.push([...((e as { argv: readonly string[] }).argv ?? [])])
      return { value: { exitCode: 0, stdout: '', stderr: '' } } as never
    })
    on('fs.exists', async ($, e) => {
      const path = (e as { path: string }).path.replace(/\\/g, '/')
      return { value: path in files || onDisk(path) !== undefined } as never
    })
    on('fs.read', async ($, e) => {
      const path = (e as { path: string }).path.replace(/\\/g, '/')
      if (path in files) return { value: files[path] } as never
      const k = onDisk(path)
      if (k === undefined) throw new Error(`ENOENT ${path}`)
      return { value: disk[k] } as never
    })
    on('fs.write', async ($, e) => {
      const { path: rawPath, text } = e as { path: string; text: string }; const path = rawPath.replace(/\\/g, '/')
      files[path] = text
      return { value: undefined } as never
    })
    on('fs.list', async ($, e) => {
      const path = ((e as { path?: string }).path ?? '').replace(/\\/g, '/').replace(/\/+$/, '')
      const dir = Object.keys(dirs).find(k => path.endsWith(k))
      if (dir) return { value: (dirs[dir] ?? []).map(name => ({ name, kind: 'dir', size: 0, mtimeMs: 0, isLink: false })) } as never
      const names = [...new Set(Object.keys(disk).filter(k => path.endsWith(k.slice(0, k.lastIndexOf('/')))).map(k => k.slice(k.lastIndexOf('/') + 1)))]
      if (!names.length) throw new Error(`ENOENT ${path}`)
      return { value: names.map(name => ({ name, kind: 'file', size: 10, mtimeMs: 0, isLink: false })) } as never
    })
    mock.env(on, { CLAUDE_CODE_PLUGIN_DIRS: '~/.claude/mods/context-meter:/opt/extra/alpha-env/' })

    await $.session.start({ source: 'startup', cwd: '/Users/test/vault', surface, isInteractive: true } as never)
    await $.command.run({ command: 'mods', args: '' } as never)
    const v = await $.ui.mount({ plugin: 'mods', surface, component: 'Pane', requestId: 'mods', props })

    // New mods appear, named from plugin.json, with the description and the slash command.
    expect(await v.find({ text: 'Zeta Notes' }), 'new mod in ~/.claude/mods').toBeDefined()
    expect(await v.find({ text: 'Keeps short notes beside the chat' }), 'its description').toBeDefined()
    expect(await v.find({ text: '/zeta' }), 'its slash command').toBeDefined()
    expect(await v.find({ key: 'toggle-zeta-notes' }), 'it reads switches.json, so it has On/Off').toBeDefined()
    expect(await v.find({ text: 'Alpha Env' }), 'mod from CLAUDE_CODE_PLUGIN_DIRS').toBeDefined()
    expect(await v.find({ text: 'Replay Theater' }), 'mod installed from a marketplace').toBeDefined()
    expect(await v.find({ text: 'Brand New' }), "this chat's own new mod").toBeDefined()
    expect(await v.find({ text: 'This chat only' }), 'labelled This chat only').toBeDefined()

    // No switch in its source: a note and no toggle.
    expect(await v.find({ text: 'Plain Tool' }), 'plain-tool is listed').toBeDefined()
    expect(await v.find({ key: 'toggle-plain-tool' }), 'no toggle for plain-tool').toBeUndefined()
    expect(await v.find({ text: 'Not switchable yet. Ask Claude: add the /mods switch to this mod.' }), 'the note').toBeDefined()

    // Not mods: a plain plugin, and the switchboard itself.
    expect(await v.find({ text: 'Not A Mod' }), 'no modules key, not a mod').toBeUndefined()
    expect(await v.find({ key: 'toggle-mods' }), 'the switchboard skips itself').toBeUndefined()

    // Known ones keep their rows, names and extras.
    expect(await v.find({ text: 'Helper Desk' }), 'helper-desk keeps its known name').toBeDefined()
    expect(await v.find({ text: 'long text' }), 'and its known description').toBeUndefined()
    expect(await v.find({ key: 'open-helper-desk' }), 'and its Open button').toBeDefined()
    expect(await v.find({ key: 'show-cache-clock' }), 'Cache Clock keeps Shown/Hidden').toBeDefined()
    expect(await v.find({ key: 'toggle-brain-dump' }), 'Brain-Dump keeps On/Off').toBeDefined()
    expect(await v.find({ key: 'show-zeta-notes' }), 'a new mod has no Shown/Hidden').toBeUndefined()

    // Installed means installed_plugins.json: not the leftover cache, not another folder's project install.
    expect(await v.find({ text: 'Agent Tree' }), 'uninstalled mod left in the cache').toBeUndefined()
    expect(await v.find({ text: 'Local Only' }), "another folder's project install").toBeUndefined()

    // Order: the old table (less reflect, not installed), new ones A to Z, this chat's own, then not installed.
    const order = (await v.findAll({ type: 'Box' })).map(b => b.key ?? '').filter(k => k.startsWith('row-')).map(k => k.slice(4))
    expect(order.slice(0, 7), 'old table first').toEqual(['cache-clock', 'handoff', 'screen-share', 'brain-dump', 'helper-desk', 'chat-inventory', 'cache-bar'])
    expect(order.slice(7), 'then A to Z, this chat only, then available').toEqual(['alpha-env', 'here-only', 'plain-tool', 'replay-theater', 'zeta-notes', 'brand-new', 'fresh-mod'])

    // A marketplace mod not installed: Install, no switches; pressing it runs the install.
    expect(await v.find({ text: 'Not installed · from claude-mods' }), 'available label').toBeDefined()
    expect(await v.find({ key: 'toggle-fresh-mod' }), 'no On/Off before install').toBeUndefined()
    await v.press({ key: 'install-fresh-mod' })
    expect(runs, 'claude plugin install').toContainEqual(['claude', 'plugin', 'install', 'fresh-mod@claude-mods'])
    expect(await v.find({ text: 'Fresh Mod is installed. Run /reload-plugins to load it.' }), 'install note').toBeDefined()

    // A found mod switches like a known one.
    await v.press({ key: 'toggle-zeta-notes' })
    const sw = Object.keys(files).find(k => k.endsWith('/.claude/mods/switches.json')) ?? ''
    expect(JSON.parse(files[sw] ?? '{}'), 'zeta-notes off').toEqual({ 'zeta-notes': false })
    expect(await v.find({ text: 'Zeta Notes is off in every chat.' }), 'note').toBeDefined()
  })
}

const THEME_KEYS: readonly ThemeKey[] = [
  'text', 'inverseText', 'inactive', 'subtle', 'suggestion', 'remember', 'success', 'error',
  'warning', 'merged', 'claude', 'permission', 'planMode', 'autoAccept', 'promptBorder',
  'bashBorder', 'ide', 'diffAdded', 'diffRemoved', 'diffAddedDimmed', 'diffRemovedDimmed',
  'diffAddedWord', 'diffRemovedWord',
]
const COLOR_PROPS = ['color', 'borderColor', 'backgroundColor']

// Functional color must be a theme key. The kit hides `hover`, so hover colors are checked by eye.
function rawColors(elements: FoundElement[]): string[] {
  return elements.flatMap(element =>
    COLOR_PROPS.map(prop => [prop, element.props[prop]] as const)
      .filter(([, value]) => value !== undefined && !THEME_KEYS.includes(value as ThemeKey))
      .map(([prop, value]) => `${element.type}.${prop}=${String(value)}`),
  )
}

// A machine with every known mod installed and one switches.json, for the pane tests below.
type Opts = { installed?: () => string; opened?: string[]; run?: () => Promise<void>; extra?: Record<string, string> }
function machine(on: Parameters<Parameters<typeof test>[2]>[1], opts: Opts = {}) {
  const files: Record<string, string> = {}
  on('session.start', async ($, e) => ({ cwd: e.cwd }) as never)
  on('session.id', async () => ({ value: 'sid-123' }) as never)
  on('command.register', async () => ({ value: undefined }) as never)
  const clock = mock.clock(on, { now: new Date(2026, 9, 15, 21, 0).getTime() })
  on('ui.open', async (_$, e) => {
    opts.opened?.push((e as { id: string }).id)
    return { value: { isPlaced: true } } as never
  })
  on('process.run', async () => {
    await opts.run?.()
    return { value: { exitCode: 0, stdout: '', stderr: '' } } as never
  })
  const extraKey = (path: string) => Object.keys(opts.extra ?? {}).find(k => path.endsWith(k))
  on('fs.exists', async ($, e) => {
    const path = (e as { path: string }).path.replace(/\\/g, '/')
    return { value: path in files || path.endsWith(INSTALLED_AT) || extraKey(path) !== undefined } as never
  })
  on('fs.read', async ($, e) => {
    const path = (e as { path: string }).path.replace(/\\/g, '/')
    if (path.endsWith(INSTALLED_AT)) return { value: opts.installed?.() ?? INSTALLED } as never
    const k = extraKey(path)
    if (k !== undefined) return { value: opts.extra?.[k] } as never
    if (!(path in files)) throw new Error(`ENOENT ${path}`)
    return { value: files[path] } as never
  })
  on('fs.write', async ($, e) => {
    const { path, text } = e as { path: string; text: string }
    files[path.replace(/\\/g, '/')] = text
    return { value: undefined } as never
  })
  on('fs.list', async () => ({ value: [] }) as never)
  mock.env(on, {})
  return Object.assign(files, { clock })
}

for (const surface of ['desktop', 'terminal'] as const) {
  test(`the pane fits 40, 80 and 144 columns with theme colors only (${surface})`, { timeoutMs: 20000 }, async ($, on) => {
    machine(on)
    await $.session.start({ source: 'startup', cwd: '/Users/test/vault', surface, isInteractive: true } as never)
    for (const bodyColumns of [40, 80, 144]) {
      const v = await $.ui.mount({ plugin: 'mods', surface, component: 'Pane', requestId: 'mods', props: { ...(props as object), bodyColumns } as never })
      expect(rawColors(await v.findAll({})), `no raw color at ${bodyColumns}`).toEqual([])
      // Title column is exactly what is left after the buttons; the pane itself is the full body.
      const cols = Math.max(24, bodyColumns)
      const widths = [...new Set((await v.findAll({ type: 'Box' })).map(b => Number(b.props.width)).filter(w => Number.isFinite(w) && w > 0))].sort((x, y) => x - y)
      expect(widths, `box widths at ${bodyColumns}`).toEqual([Math.max(10, cols - 26), cols])
      await v.unmount()
    }
  })

  test(`the pane shows a focus hint only while unfocused, and every button has a slash twin (${surface})`, { timeoutMs: 20000 }, async ($, on) => {
    const opened: string[] = []
    const files = machine(on, { opened })
    await $.session.start({ source: 'startup', cwd: '/Users/test/vault', surface, isInteractive: true } as never)
    const hint = { text: /ctrl\+x tab or click to focus/ } as const
    const idle = await $.ui.mount({ plugin: 'mods', surface, component: 'Pane', requestId: 'mods', props })
    expect(await idle.find(hint), 'hint while unfocused').toBeDefined()
    await idle.unmount()
    const focused = await $.ui.mount({ plugin: 'mods', surface, component: 'Pane', requestId: 'mods', props: { ...(props as object), isFocused: true } as never })
    expect(await focused.find(hint), 'no hint while focused').toBeUndefined()
    await focused.unmount()

    const run = async (args: string) => JSON.stringify(await $.command.run({ command: 'mods', args } as never))
    const sw = () => JSON.parse(files[Object.keys(files).find(k => k.endsWith('/.claude/mods/switches.json')) ?? ''] ?? '{}')
    expect(await run('toggle cache-clock'), 'toggle says so').toContain('Cache Clock is off in every chat.')
    expect(sw(), 'toggle wrote the file').toEqual({ 'cache-clock': false })
    expect(await run('toggle cache-bar'), 'cache-bar is switchable').toContain('Cache Bar is off')
    expect(await run('show helper-desk'), 'show hides').toContain('Helper Desk is hidden')
    expect(await run('show helper-desk'), 'show shows').toContain('Helper Desk is shown')
    expect(Object.keys(files).some(k => k.endsWith('/.claude/mods/.open-helper-desk-sid-123')), 'show leaves the open request').toBe(true)
    expect(await run('open chat-inventory'), 'open asks the pane').toContain('Chat Inventory opens in this chat')
    expect(await run('toggle nonsense'), 'unknown name is said, not thrown').toContain('No switchable mod named nonsense')
    expect(await run('toggle'), 'a verb without a name gives usage').toContain('Usage: /mods toggle')
    expect(opened, 'usage opens nothing').toEqual([])
    await run('foo')
    expect(opened, '/mods foo opens the pane as before').toEqual(['mods'])
  })
}

for (const surface of ['desktop', 'terminal'] as const) {
  test(`a press on an unknown name, or a second Install press, leaves the note alone (${surface})`, { timeoutMs: 20000 }, async ($, on) => {
    let release = () => {}
    const gate = new Promise<void>(r => (release = r))
    let installs = 0
    let gone = false
    const market = '/.claude/plugins/marketplaces/claude-mods'
    const { clock } = machine(on, {
      installed: () => (gone ? installedJson(KNOWN.filter(n => n !== 'cache-clock')) : INSTALLED),
      run: async () => {
        installs += 1
        await gate
      },
      extra: {
        '/.claude/plugins/known_marketplaces.json': JSON.stringify({ 'claude-mods': { installLocation: `/h${market}` } }),
        [`${market}/.claude-plugin/marketplace.json`]: JSON.stringify({ plugins: [{ name: 'fresh-mod', source: './fresh-mod' }] }),
        [`${market}/fresh-mod/.claude-plugin/plugin.json`]: JSON.stringify({ name: 'fresh-mod' }),
        [`${market}/fresh-mod/hooks/hooks.json`]: JSON.stringify({ modules: ['./register.tsx'] }),
      },
    })
    await $.session.start({ source: 'startup', cwd: '/Users/test/vault', surface, isInteractive: true } as never)
    const v = await $.ui.mount({ plugin: 'mods', surface, component: 'Pane', requestId: 'mods', props })

    await v.press({ key: 'toggle-cache-clock' })
    expect(await v.find({ text: 'Cache Clock is off in every chat.' })).toBeDefined()
    // A stale button: Cache Clock is uninstalled after the pane drew it. Pressing it is silent.
    gone = true
    await clock.advance(11_000)
    await v.press({ key: 'toggle-cache-clock' })
    expect(await v.find({ text: 'Cache Clock is off in every chat.' }), 'unknown name leaves the note').toBeDefined()

    const first = v.press({ key: 'install-fresh-mod' })
    await v.press({ key: 'install-fresh-mod' })
    expect(installs, 'second press starts nothing').toBe(1)
    expect(await v.find({ text: 'Installing Fresh Mod…' }), 'second press leaves Installing').toBeDefined()
    release()
    await first
  })
}
