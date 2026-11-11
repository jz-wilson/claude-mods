export type Phase = 'plan' | 'design' | 'delegate' | 'review' | 'close'

export type PlannedTask = {
  title: string
  tier: string
  after: number[]
}

export type Flow = {
  title: string
  total: number
  done: number
  running: number
  phase: Phase
  isFinished: boolean
  tasks: PlannedTask[]
}

/** One tool call an agent made: the tool, a short hint at what it touched, its class and when. */
export type ToolLog = {
  name: string
  hint: string
  kind: string
  at: number
}

export type AgentStatus = 'running' | 'done' | 'failed'

export type AgentRun = {
  id: string
  agentId?: string
  type: string
  description: string
  model: string
  effort?: string
  status: AgentStatus
  startedAt: number
  endedAt?: number
  contextTokens: number
  contextMax: number
  tokens: number
  costUsd: number
  steps: number
  round: number
  /** Self-reported by the worker through the `step` tool. */
  stepDone?: number
  stepTotal?: number
  stepNote?: string
  /** What the agent last did, as a class (`read`, `build`, `shell`...); never the command itself. */
  doing?: string
  /** How many tool calls it has made, and the latest of them (the log keeps the last 40). */
  calls?: number
  log?: ToolLog[]
}

export type Panel = {
  isCompact: boolean
  isDoneCollapsed: boolean
  autoOpenedFor: string
  /** Agent ids whose card shows its tool log. */
  expanded?: string[]
}

declare module 'claude-code' {
  interface PluginState {
    'savvy-progress': {
      flow: Flow | null
      agents: AgentRun[]
      panel: Panel
      now: number
    }
  }
}
