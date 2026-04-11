export type WorkspaceSyncProjectProbe = {
  root: string
  enabled: boolean
}

export type WorkspaceSyncProbeState = {
  local: Record<string, boolean>
  localKeys: string[]
  projects: Record<string, WorkspaceSyncProjectProbe>
  defaultValue: boolean
}

type WorkspaceSyncWindow = Window & {
  __opencode_e2e?: {
    workspaceSync?: {
      enabled?: boolean
      current?: WorkspaceSyncProbeState
    }
  }
}

export const workspaceSyncEnabled = () => {
  if (typeof window === "undefined") return false
  return (window as WorkspaceSyncWindow).__opencode_e2e?.workspaceSync?.enabled === true
}

const root = () => {
  if (!workspaceSyncEnabled()) return
  return (window as WorkspaceSyncWindow).__opencode_e2e?.workspaceSync
}

export const workspaceSyncProbe = {
  set(input: WorkspaceSyncProbeState) {
    const state = root()
    if (!state) return
    state.current = {
      local: { ...input.local },
      localKeys: input.localKeys.slice(),
      projects: Object.fromEntries(
        Object.entries(input.projects).map(([key, value]) => [
          key,
          {
            root: value.root,
            enabled: value.enabled,
          },
        ]),
      ),
      defaultValue: input.defaultValue,
    }
  },
  clear() {
    const state = root()
    if (!state) return
    state.current = undefined
  },
}
