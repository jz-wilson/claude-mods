import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { PerList, PerTask } from '../types'

const PANE = 'helpin-per'
const TITLE = 'Helpin PER'
const SERVER = 'helpin'
const PREFIX = 'PER-'
const PRIORITY_RANK: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3, none: 4 }

const ACCENT = '#06b6d4'
const HEALTHY = '#22c55e'
const DANGER = '#ef4444'
const PRIORITY_COLOR: Record<string, string | undefined> = {
  urgent: DANGER,
  high: '#f59e0b',
  medium: ACCENT,
}

function clockTime(ms: number): string {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

const list = atom({ plugin: 'helpin-per', key: 'list' } as const, { tasks: [] } as PerList, {
  shape: 'list-1',
})

type RawTask = {
  task_key?: string
  task_id: string
  name: string
  state_name?: string
  priority?: string
}

let inflight: Promise<boolean> | undefined

// Tasks load only when the person presses the pane's load button, never on a
// timer, a turn or session start: a plugin's MCP call fires PreToolUse and
// PostToolUse hooks, and Orca reads those as Claude working until the next Stop.
function refresh($: EngineInterface): Promise<boolean> {
  inflight ??= fetchTasks($)
    .catch(error => {
      $.ui.toast(`Helpin PER refresh failed: ${error instanceof Error ? error.message : String(error)}`)
      return false
    })
    .finally(() => {
      inflight = undefined
    })
  return inflight
}

async function fetchTasks($: EngineInterface): Promise<boolean> {
  const tasks: PerTask[] = []
  try {
    let offset: number | null = 0
    while (offset !== null) {
      const result = await $.mcp.call(SERVER, 'list_tasks', {
        open_only: true,
        detail_level: 'summary',
        limit: 100,
        offset,
      })
      const text = result.content.find(block => block.type === 'text')?.text ?? ''
      if (result.isError) throw new Error(text || 'list_tasks failed')
      const data = JSON.parse(text).data as {
        tasks: RawTask[]
        has_more?: boolean
        next_offset?: number | null
      }
      for (const raw of data.tasks) {
        if (!raw.task_key?.startsWith(PREFIX)) continue
        tasks.push({
          key: raw.task_key,
          id: raw.task_id,
          name: raw.name,
          state: raw.state_name ?? '',
          priority: raw.priority ?? 'none',
        })
      }
      const next = data.next_offset
      offset = data.has_more && typeof next === 'number' && next > offset ? next : null
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await update($, list, old => ({ ...old, error: message }))
    return false
  }
  tasks.sort(
    (a, b) =>
      (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9) ||
      Number(b.key.slice(PREFIX.length)) - Number(a.key.slice(PREFIX.length)),
  )
  await update($, list, () => ({ tasks, fetchedAt: Date.now() }))
  return true
}

async function startWork($: EngineInterface, task: PerTask): Promise<void> {
  const result = await $.prompt.submit({
    asUser: true,
    text:
      `Start working on Helpin task ${task.key} "${task.name}" (task_id ${task.id}). ` +
      `Read it in full with mcp__helpin__get_task_context, move it to In Progress, ` +
      `then do the work and comment on the task with what you did.`,
  })
  $.ui.toast(
    'drop' in result ? `${task.key} not queued: ${result.drop}` : `Queued ${task.key} for Claude`,
  )
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'per',
      description: 'Show open Helpin PER-* tasks in a pane and pick one to work on',
    })
    try {
      const opened = await $.ui.open({ id: PANE, title: TITLE })
      if (!opened.isPlaced) $.ui.log(`Helpin PER pane waiting: ${opened.reason}`)
    } catch (error) {
      $.ui.log(`Helpin PER pane failed to open: ${error instanceof Error ? error.message : String(error)}`)
    }

    return next(e)
  })

  on('command.run', { command: 'per' }, async $ => {
    await $.ui.open({ id: PANE, title: TITLE })

    return { text: 'Helpin PER pane opened.' }
  })

  // The pane scrolls its own body (arrows while focused), so every task is drawn.
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const { tasks, error, fetchedAt } = await read($, list)
    const at = fetchedAt ? clockTime(fetchedAt) : 'never'

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="row" justifyContent="space-between">
          <Text wrap="truncate-end">
            <Text color={ACCENT} weight="bold">
              PER
            </Text>
            <Text dimColor>
              {' '}
              {tasks.length} open · {at}
            </Text>
          </Text>
          <Button key="refresh" plain hotkey="r" onPress={() => refresh($)}>
            {fetchedAt ? 'refresh' : 'load'}
          </Button>
        </Box>
        {error && (
          <Text color={DANGER} wrap="truncate-end">
            Helpin: {error}
          </Text>
        )}
        {tasks.length === 0 && !error && (
          <Text dimColor>
            {fetchedAt ? 'No open PER tasks.' : 'Press load (r) to fetch tasks.'}
          </Text>
        )}
        {tasks.length > 0 && (
          <Box flexDirection="column">
            {tasks.map(task => (
              <Button key={task.key} plain onPress={() => startWork($, task)}>
                <Text color={task.state === 'In Progress' ? HEALTHY : 'gray'}>
                  {task.state === 'In Progress' ? '● ' : '○ '}
                </Text>
                <Text color={PRIORITY_COLOR[task.priority]} weight="bold">
                  {task.key}
                </Text>{' '}
                {task.name}{' '}
                <Text dimColor>
                  {task.state}
                  {task.priority !== 'none' ? ` · ${task.priority}` : ''}
                </Text>
              </Button>
            ))}
          </Box>
        )}
        {!e.props.isFocused && tasks.length > 0 && (
          <Text dimColor wrap="truncate-end">
            {e.surface === 'terminal' ? 'ctrl+x tab or click to focus · ' : ''}press a task to
            start work
          </Text>
        )}
      </Box>
    )
  })
}
