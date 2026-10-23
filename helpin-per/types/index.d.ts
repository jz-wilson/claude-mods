export type PerTask = {
  key: string
  id: string
  name: string
  state: string
  priority: string
}

export type PerList = {
  tasks: PerTask[]
  error?: string
  fetchedAt?: number
}

declare module 'claude-code' {
  interface PluginState {
    'helpin-per': { list: Shaped<PerList> }
  }
}
