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

const tail = (directory: string) => normalize(directory).split("/").filter(Boolean).slice(-2).join("/")

const sameWorkspace = (a: string, b: string) => {
  const left = normalize(a)
  const right = normalize(b)
  if (left === right) return true
  const leftTail = tail(left)
  if (!leftTail) return false
  return leftTail === tail(right)
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
  const allowed = workspaceDirectories(project)
  return Object.fromEntries(Object.entries(toggles).filter(([directory]) => allowed.some((item) => sameWorkspace(item, directory))))
}

export function pickLocalWorkspaceToggles(
  project: Pick<Project, "worktree" | "sandboxes">,
  map: Record<string, boolean>,
) {
  const allowed = workspaceDirectories(project)
  return Object.fromEntries(Object.entries(map).filter(([directory]) => allowed.some((item) => sameWorkspace(item, directory))))
}

export function applyWorkspaceToggles(
  project: Pick<Project, "worktree" | "sandboxes">,
  current: Record<string, boolean>,
  toggles: Record<string, boolean>,
) {
  const next = { ...current }
  const entries = Object.entries(toggles)

  for (const directory of workspaceDirectories(project)) {
    const value = entries.find(([item]) => sameWorkspace(item, directory))?.[1]
    for (const existing of Object.keys(next)) {
      if (!sameWorkspace(existing, directory)) continue
      delete next[existing]
    }
    if (value === undefined) {
      continue
    }
    next[directory] = value
  }
  return next
}

export function shouldSeedWorkspaceToggles(remote: WorkspaceTogglesState, local: Record<string, boolean>) {
  return remote.version === 0 && Object.keys(remote.toggles).length === 0 && Object.keys(local).length > 0
}
