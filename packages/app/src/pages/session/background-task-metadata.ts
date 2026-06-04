export const BACKGROUND_TASK_METADATA_NAMESPACE = "ohMyOpenAgent"
export const BACKGROUND_TASK_METADATA_KEY = "backgroundTasks"
export const BACKGROUND_TASK_COMPLETED_RETENTION_MS = 5_000

export type BackgroundTaskStatus = "pending" | "running" | "completed" | "error" | "cancelled" | "interrupt"

export type BackgroundTaskSnapshot = {
  id: string
  sessionId?: string
  parentSessionId: string
  rootSessionId: string
  parentMessageId: string
  description: string
  agent: string
  category?: string
  status: BackgroundTaskStatus
  model?: { providerID: string; modelID: string; variant?: string }
  queuedAt?: string
  startedAt?: string
  completedAt?: string
  elapsedMs: number
  retryCount: number
  progress?: { toolCalls: number; lastTool?: string; lastMessage?: string; lastUpdate?: string }
  attempts: {
    attemptId: string
    attemptNumber: number
    sessionId?: string
    providerID?: string
    modelID?: string
    variant?: string
    status: BackgroundTaskStatus
    error?: string
    startedAt?: string
    completedAt?: string
  }[]
  error?: string
}

export type BackgroundTasksMetadataV1 = {
  version: 1
  rootSessionId: string
  updatedAt: string
  allCompleteAt?: string
  tasks: BackgroundTaskSnapshot[]
}

export type BackgroundTaskCounts = {
  pending: number
  running: number
  completed: number
  error: number
  cancelled: number
  interrupt: number
}

const statuses = new Set<BackgroundTaskStatus>(["pending", "running", "completed", "error", "cancelled", "interrupt"])
const activeStatuses = new Set<BackgroundTaskStatus>(["pending", "running"])
const terminalStatuses = new Set<BackgroundTaskStatus>(["completed", "error", "cancelled", "interrupt"])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key]
  return typeof value === "string" ? value : undefined
}

function readNumber(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key]
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function readStatus(value: unknown): BackgroundTaskStatus | undefined {
  return typeof value === "string" && statuses.has(value as BackgroundTaskStatus)
    ? value as BackgroundTaskStatus
    : undefined
}

function readIsoString(record: Record<string, unknown>, key: string): string | undefined {
  const value = readString(record, key)
  if (!value) return undefined
  return Number.isFinite(Date.parse(value)) ? value : undefined
}

function readModel(value: unknown): BackgroundTaskSnapshot["model"] | undefined {
  if (!isRecord(value)) return undefined
  const providerID = readString(value, "providerID")
  const modelID = readString(value, "modelID")
  if (!providerID || !modelID) return undefined
  const variant = readString(value, "variant")
  return { providerID, modelID, ...(variant ? { variant } : {}) }
}

function readAttempt(value: unknown): BackgroundTaskSnapshot["attempts"][number] | undefined {
  if (!isRecord(value)) return undefined
  const attemptId = readString(value, "attemptId")
  const attemptNumber = readNumber(value, "attemptNumber")
  const status = readStatus(value.status)
  if (!attemptId || attemptNumber === undefined || !status) return undefined
  return {
    attemptId,
    attemptNumber,
    ...(readString(value, "sessionId") ? { sessionId: readString(value, "sessionId") } : {}),
    ...(readString(value, "providerID") ? { providerID: readString(value, "providerID") } : {}),
    ...(readString(value, "modelID") ? { modelID: readString(value, "modelID") } : {}),
    ...(readString(value, "variant") ? { variant: readString(value, "variant") } : {}),
    status,
    ...(readString(value, "error") ? { error: readString(value, "error") } : {}),
    ...(readIsoString(value, "startedAt") ? { startedAt: readIsoString(value, "startedAt") } : {}),
    ...(readIsoString(value, "completedAt") ? { completedAt: readIsoString(value, "completedAt") } : {}),
  }
}

function readProgress(value: unknown): BackgroundTaskSnapshot["progress"] | undefined {
  if (!isRecord(value)) return undefined
  const toolCalls = readNumber(value, "toolCalls")
  if (toolCalls === undefined) return undefined
  return {
    toolCalls,
    ...(readString(value, "lastTool") ? { lastTool: readString(value, "lastTool") } : {}),
    ...(readString(value, "lastMessage") ? { lastMessage: readString(value, "lastMessage") } : {}),
    ...(readIsoString(value, "lastUpdate") ? { lastUpdate: readIsoString(value, "lastUpdate") } : {}),
  }
}

function readTask(value: unknown): BackgroundTaskSnapshot | undefined {
  if (!isRecord(value)) return undefined

  const id = readString(value, "id")
  const parentSessionId = readString(value, "parentSessionId")
  const rootSessionId = readString(value, "rootSessionId")
  const parentMessageId = readString(value, "parentMessageId")
  const description = readString(value, "description")
  const agent = readString(value, "agent")
  const status = readStatus(value.status)
  const elapsedMs = readNumber(value, "elapsedMs")
  const retryCount = readNumber(value, "retryCount")

  if (!id || !parentSessionId || !rootSessionId || !parentMessageId || description === undefined || !agent || !status) {
    return undefined
  }

  const attempts = Array.isArray(value.attempts)
    ? value.attempts.flatMap((attempt) => {
        const parsed = readAttempt(attempt)
        return parsed ? [parsed] : []
      })
    : []

  return {
    id,
    ...(readString(value, "sessionId") ? { sessionId: readString(value, "sessionId") } : {}),
    parentSessionId,
    rootSessionId,
    parentMessageId,
    description,
    agent,
    ...(readString(value, "category") ? { category: readString(value, "category") } : {}),
    status,
    ...(readModel(value.model) ? { model: readModel(value.model) } : {}),
    ...(readIsoString(value, "queuedAt") ? { queuedAt: readIsoString(value, "queuedAt") } : {}),
    ...(readIsoString(value, "startedAt") ? { startedAt: readIsoString(value, "startedAt") } : {}),
    ...(readIsoString(value, "completedAt") ? { completedAt: readIsoString(value, "completedAt") } : {}),
    elapsedMs: Math.max(0, elapsedMs ?? 0),
    retryCount: Math.max(0, retryCount ?? 0),
    ...(readProgress(value.progress) ? { progress: readProgress(value.progress) } : {}),
    attempts,
    ...(readString(value, "error") ? { error: readString(value, "error") } : {}),
  }
}

export function readBackgroundTasksMetadata(metadata: unknown): BackgroundTasksMetadataV1 | undefined {
  if (!isRecord(metadata)) return undefined
  const namespace = metadata[BACKGROUND_TASK_METADATA_NAMESPACE]
  if (!isRecord(namespace)) return undefined
  const payload = namespace[BACKGROUND_TASK_METADATA_KEY]
  if (!isRecord(payload)) return undefined
  if (payload.version !== 1) return undefined

  const rootSessionId = readString(payload, "rootSessionId")
  const updatedAt = readIsoString(payload, "updatedAt")
  if (!rootSessionId || !updatedAt) return undefined

  const tasks = Array.isArray(payload.tasks)
    ? payload.tasks.flatMap((task) => {
        const parsed = readTask(task)
        return parsed ? [parsed] : []
      })
    : []

  return {
    version: 1,
    rootSessionId,
    updatedAt,
    ...(readIsoString(payload, "allCompleteAt") ? { allCompleteAt: readIsoString(payload, "allCompleteAt") } : {}),
    tasks,
  }
}

export function resolveRootSession<TSession extends { id: string; parentID?: string }>(
  sessionID: string | undefined,
  getSession: (sessionID: string) => TSession | undefined,
): TSession | undefined {
  if (!sessionID) return undefined
  let current = getSession(sessionID)
  const visited = new Set<string>()
  for (let depth = 0; current?.parentID && depth < 32; depth += 1) {
    if (visited.has(current.id)) return current
    visited.add(current.id)
    const parent = getSession(current.parentID)
    if (!parent) return current
    current = parent
  }
  return current
}

export function isActiveBackgroundTask(task: BackgroundTaskSnapshot): boolean {
  return activeStatuses.has(task.status)
}

export function isTerminalBackgroundTask(task: BackgroundTaskSnapshot): boolean {
  return terminalStatuses.has(task.status)
}

export function shouldShowBackgroundTaskDock(
  metadata: BackgroundTasksMetadataV1 | undefined,
  now = Date.now(),
  completedRetentionMs = BACKGROUND_TASK_COMPLETED_RETENTION_MS,
): boolean {
  if (!metadata || metadata.tasks.length === 0) return false
  if (metadata.tasks.some(isActiveBackgroundTask)) return true
  if (!metadata.allCompleteAt) return true
  const allCompleteAt = Date.parse(metadata.allCompleteAt)
  return Number.isFinite(allCompleteAt) && now - allCompleteAt < completedRetentionMs
}

export function countBackgroundTasks(tasks: BackgroundTaskSnapshot[]): BackgroundTaskCounts {
  const counts: BackgroundTaskCounts = {
    pending: 0,
    running: 0,
    completed: 0,
    error: 0,
    cancelled: 0,
    interrupt: 0,
  }
  for (const task of tasks) {
    counts[task.status] += 1
  }
  return counts
}

export function sortBackgroundTasksForDock(tasks: BackgroundTaskSnapshot[]): BackgroundTaskSnapshot[] {
  const rank: Record<BackgroundTaskStatus, number> = {
    error: 0,
    interrupt: 1,
    running: 2,
    pending: 3,
    cancelled: 4,
    completed: 5,
  }
  return [...tasks].sort((left, right) => {
    const status = rank[left.status] - rank[right.status]
    if (status !== 0) return status
    const leftTime = Date.parse(left.startedAt ?? left.queuedAt ?? left.completedAt ?? "")
    const rightTime = Date.parse(right.startedAt ?? right.queuedAt ?? right.completedAt ?? "")
    const time = (Number.isFinite(leftTime) ? leftTime : 0) - (Number.isFinite(rightTime) ? rightTime : 0)
    if (time !== 0) return time
    return left.id.localeCompare(right.id)
  })
}

export function formatBackgroundTaskElapsed(task: BackgroundTaskSnapshot, now = Date.now()): string {
  const start = Date.parse(task.startedAt ?? task.queuedAt ?? "")
  const end = task.completedAt ? Date.parse(task.completedAt) : now
  const elapsed = Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, end - start) : task.elapsedMs
  const seconds = Math.floor(elapsed / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  if (hours > 0) return `${hours}h ${minutes % 60}m`
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`
  return `${seconds}s`
}

export function formatBackgroundTaskModel(task: BackgroundTaskSnapshot): string {
  if (!task.model) return "model unknown"
  const variant = task.model.variant ? `:${task.model.variant}` : ""
  return `${task.model.providerID}/${task.model.modelID}${variant}`
}

export function formatBackgroundTaskRetry(task: BackgroundTaskSnapshot): string {
  return task.retryCount === 1 ? "1 retry" : `${task.retryCount} retries`
}

export function backgroundTaskActivityLabel(task: BackgroundTaskSnapshot): string | undefined {
  if (task.progress?.lastTool) return `tool: ${task.progress.lastTool}`
  if (task.progress?.lastMessage) return task.progress.lastMessage
  if (task.progress?.toolCalls) return `${task.progress.toolCalls} tool calls`
  return undefined
}
