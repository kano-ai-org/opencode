import type { Project } from "@opencode-ai/sdk/v2"

export type WorkspaceTogglesState = {
  version: number
  toggles: Record<string, boolean>
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
  const allowed = new Set(workspaceDirectories(project))
  return Object.fromEntries(Object.entries(toggles).filter(([directory]) => allowed.has(directory)))
}

export function pickLocalWorkspaceToggles(
  project: Pick<Project, "worktree" | "sandboxes">,
  map: Record<string, boolean>,
) {
  const allowed = new Set(workspaceDirectories(project))
  return Object.fromEntries(Object.entries(map).filter(([directory]) => allowed.has(directory)))
}

export function applyWorkspaceToggles(
  project: Pick<Project, "worktree" | "sandboxes">,
  current: Record<string, boolean>,
  toggles: Record<string, boolean>,
) {
  const next = { ...current }
  for (const directory of workspaceDirectories(project)) {
    const value = toggles[directory]
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
