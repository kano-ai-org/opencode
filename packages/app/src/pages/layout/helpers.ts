import { getFilename } from "@opencode-ai/util/path"
import { type Session } from "@opencode-ai/sdk/v2/client"

export const workspaceKey = (directory: string) => {
  const normalized = directory.replace(/\\/g, "/")
  const drive = normalized.match(/^([A-Za-z]:)\/+$/)
  if (drive) return `${drive[1].toUpperCase()}/`
  if (/^\/+$/i.test(normalized)) return "/"

  const trimmed = normalized.replace(/\/+$/, "")
  if (!/^[A-Za-z]:\//.test(trimmed)) return trimmed
  return `${trimmed.slice(0, 1).toUpperCase()}${trimmed.slice(1).toLowerCase()}`
}

export const workspaceTail = (directory: string) => workspaceKey(directory).split("/").filter(Boolean).slice(-2).join("/")

export const workspaceMatch = (left: string, right: string) => {
  const leftKey = workspaceKey(left)
  const rightKey = workspaceKey(right)
  if (leftKey === rightKey) return true
  const leftTail = workspaceTail(leftKey)
  if (!leftTail) return false
  return leftTail === workspaceTail(rightKey)
}

export function sortSessions(now: number) {
  const oneMinuteAgo = now - 60 * 1000
  return (a: Session, b: Session) => {
    const aUpdated = a.time.updated ?? a.time.created
    const bUpdated = b.time.updated ?? b.time.created
    const aRecent = aUpdated > oneMinuteAgo
    const bRecent = bUpdated > oneMinuteAgo
    if (aRecent && bRecent) return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
    if (aRecent && !bRecent) return -1
    if (!aRecent && bRecent) return 1
    return bUpdated - aUpdated
  }
}

export const isRootVisibleSession = (session: Session, directory: string) =>
  workspaceMatch(session.directory, directory) && !session.parentID && !session.time?.archived

export const sortedRootSessions = (store: { session: Session[]; path: { directory: string } }, now: number) =>
  store.session.filter((session) => isRootVisibleSession(session, store.path.directory)).sort(sortSessions(now))

export const childMapByParent = (sessions: Session[]) => {
  const map = new Map<string, string[]>()
  for (const session of sessions) {
    if (!session.parentID) continue
    const existing = map.get(session.parentID)
    if (existing) {
      existing.push(session.id)
      continue
    }
    map.set(session.parentID, [session.id])
  }
  return map
}

export function getDraggableId(event: unknown): string | undefined {
  if (typeof event !== "object" || event === null) return undefined
  if (!("draggable" in event)) return undefined
  const draggable = (event as { draggable?: { id?: unknown } }).draggable
  if (!draggable) return undefined
  return typeof draggable.id === "string" ? draggable.id : undefined
}

export const displayName = (project: { name?: string; worktree: string }) =>
  project.name || getFilename(project.worktree)

export const errorMessage = (err: unknown, fallback: string) => {
  if (err && typeof err === "object" && "data" in err) {
    const data = (err as { data?: { message?: string } }).data
    if (data?.message) return data.message
  }
  if (err instanceof Error) return err.message
  return fallback
}

export const syncWorkspaceOrder = (local: string, dirs: string[], existing?: string[]) => {
  if (!existing) return dirs
  const keep = existing.filter((d) => d !== local && dirs.includes(d))
  const missing = dirs.filter((d) => d !== local && !existing.includes(d))
  return [local, ...missing, ...keep]
}
