import type { Project } from "@opencode-ai/sdk/v2"

export type WorkspaceTogglesState = {
  version: number
  toggles: Record<string, boolean>
}

const normalize = (directory: string) => {
  const next = directory.replace(/\\/g, "/").replace(/\/+$/, "")
  if (!/^[A-Za-z]:\//.test(next)) return next
  return `${next.slice(0, 1).toUpperCase()}${next.slice(1).toLowerCase()}`
}

export const EMPTY_WORKSPACE_TOGGLES: WorkspaceTogglesState = {
  version: 0,
  toggles: {},
}

export function workspaceDirectories(project: Pick<Project, "worktree" | "sandboxes">) {
  return [project.worktree, ...(project.sandboxes ?? [])]
}

export function filterWorkspaceToggles(
  project: Pick<Project, "worktree" | "sandboxes">,
  toggles: Record<string, boolean>,
) {
  const allowed = new Set(workspaceDirectories(project).map(normalize))
  return Object.fromEntries(Object.entries(toggles).filter(([directory]) => allowed.has(normalize(directory))))
}

export function pickLocalWorkspaceToggles(
  project: Pick<Project, "worktree" | "sandboxes">,
  map: Record<string, boolean>,
) {
  const allowed = new Set(workspaceDirectories(project).map(normalize))
  return Object.fromEntries(Object.entries(map).filter(([directory]) => allowed.has(normalize(directory))))
}

export function applyWorkspaceToggles(
  project: Pick<Project, "worktree" | "sandboxes">,
  current: Record<string, boolean>,
  toggles: Record<string, boolean>,
) {
  const next = { ...current }
  const normalized = Object.entries(toggles).reduce<Record<string, boolean>>((acc, [directory, value]) => {
    acc[normalize(directory)] = value
    return acc
  }, {})

  for (const directory of workspaceDirectories(project)) {
    const value = toggles[directory] ?? normalized[normalize(directory)]
    if (value === undefined) {
      delete next[directory]
      continue
    }
    next[directory] = value
  }
  return next
}

export function shouldSeedWorkspaceToggles(remote: WorkspaceTogglesState, local: Record<string, boolean>) {
  return remote.version === 0 && Object.keys(remote.toggles).length === 0 && Object.keys(local).length > 0
}
