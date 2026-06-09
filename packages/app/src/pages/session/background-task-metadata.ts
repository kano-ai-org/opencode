import type { Message, Part, Session, SessionStatus } from "@opencode-ai/sdk/v2/client"

export const BACKGROUND_TASK_METADATA_NAMESPACE = "ohMyOpenAgent"
export const BACKGROUND_TASK_METADATA_KEY = "backgroundTasks"
export const BACKGROUND_TASK_COMPLETED_RETENTION_MS = 5_000
const BACKGROUND_TASK_STALE_INACTIVE_MS = 10 * 60 * 1000

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

type SessionLike = {
  id: Session["id"]
  parentID?: Session["parentID"]
  title: Session["title"]
  agent?: Session["agent"]
  model?: string | {
    id?: string
    providerID?: string
    modelID?: string
    variant?: string
  }
  time: {
    created: number
    updated: number
    archived?: number
  }
}
type MessageLike = {
  id: Message["id"]
  parentID?: string
  role: Message["role"]
  time: {
    created: number
    completed?: number
  }
  model?: string | {
    providerID?: string
    modelID?: string
    variant?: string
  }
  providerID?: string
  modelID?: string
  variant?: string
  error?: {
    name?: string
    data?: {
      message?: string
    }
  }
}
type SessionStatusMap = Record<string, SessionStatus | undefined>
type PartStore = Record<string, Part[] | undefined>
type DerivedSessionState = {
  status: BackgroundTaskStatus
  completedAt?: string
  error?: string
  progress?: BackgroundTaskSnapshot["progress"]
  retryCount?: number
}

const statuses = new Set<BackgroundTaskStatus>(["pending", "running", "completed", "error", "cancelled", "interrupt"])
const activeStatuses = new Set<BackgroundTaskStatus>(["pending", "running"])
const terminalStatuses = new Set<BackgroundTaskStatus>(["completed", "error", "cancelled", "interrupt"])
const duplicateTaskTimeWindowMs = 5 * 60 * 1000
const genericAgentLabels = new Set(["agent", "background agent", "background task", "subagent", "task"])

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

function readModelRecord(value: unknown): Record<string, unknown> | undefined {
  if (isRecord(value)) return value
  if (typeof value !== "string") return undefined
  try {
    const parsed = JSON.parse(value) as unknown
    return isRecord(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

function readModel(value: unknown): BackgroundTaskSnapshot["model"] | undefined {
  const record = readModelRecord(value)
  if (!record) return typeof value === "string" ? parseModelSummary(value) : undefined
  const providerID = readString(record, "providerID")
  const modelID = readString(record, "modelID") ?? readString(record, "id")
  if (!providerID || !modelID) return undefined
  const variant = readString(record, "variant")
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

function isActiveSessionStatus(status: SessionStatus | undefined): boolean {
  return !!status && status.type !== "idle"
}

function parseSubagentSessionTitle(title: string): { description: string; agent: string } {
  const match = title.match(/^(.*)\s+\(@(.+?) subagent\)$/)
  if (!match) {
    return {
      description: title,
      agent: "subagent",
    }
  }
  return {
    description: match[1]?.trim() || title,
    agent: match[2] || "subagent",
  }
}

function findMatchingChildSession(input: {
  parentSessionId: string
  sessions: Map<string, SessionLike>
  description: string
  startedAt?: number
}): SessionLike | undefined {
  const description = normalizedTaskText(input.description)
  if (!description) return undefined

  const matches = [...input.sessions.values()].filter((session) => {
    if (session.parentID !== input.parentSessionId) return false
    const parsed = parseSubagentSessionTitle(session.title)
    return normalizedTaskText(parsed.description) === description
  })
  if (matches.length === 0) return undefined
  if (matches.length === 1) return matches[0]
  if (input.startedAt === undefined) return undefined

  const close = matches
    .map((session) => ({
      session,
      distance: Math.abs(session.time.created - input.startedAt!),
    }))
    .filter((item) => item.distance <= duplicateTaskTimeWindowMs)
    .sort((left, right) => left.distance - right.distance)

  return close.length === 1 || close[0]?.distance !== close[1]?.distance ? close[0]?.session : undefined
}

function modelFromMessages(messages: MessageLike[] | undefined): BackgroundTaskSnapshot["model"] | undefined {
  if (!messages?.length) return undefined
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    const model = readModel(message.model)
    if (model) return model
    if (message.providerID && message.modelID) {
      return {
        providerID: message.providerID,
        modelID: message.modelID,
        ...(message.variant ? { variant: message.variant } : {}),
      }
    }
  }
  return undefined
}

function modelFromSession(session: SessionLike | undefined): BackgroundTaskSnapshot["model"] | undefined {
  return readModel(session?.model)
}

function isDescendantOfRoot(session: SessionLike, rootSessionId: string, sessions: Map<string, SessionLike>): boolean {
  let current: SessionLike | undefined = session
  const visited = new Set<string>()
  for (let depth = 0; current?.parentID && depth < 32; depth += 1) {
    if (current.parentID === rootSessionId) return true
    if (visited.has(current.id)) return false
    visited.add(current.id)
    current = sessions.get(current.parentID)
  }
  return false
}

function parseOutputMatch(output: string | undefined, pattern: RegExp): string | undefined {
  if (!output) return undefined
  const match = output.match(pattern)
  const value = match?.[1]?.trim()
  return value ? value : undefined
}

function normalizeAgentLabel(value: string | undefined): string | undefined {
  if (!value) return undefined
  return value
    .replace(/\s+\(category:.*$/i, "")
    .replace(/\s+\(subagent\)$/i, "")
    .trim()
}

function toolStateTimestamp(part: Part, key: "start" | "end"): number | undefined {
  if (part.type !== "tool") return undefined
  const time = "time" in part.state && isRecord(part.state.time)
    ? part.state.time as Record<string, unknown>
    : undefined
  const value = time?.[key]
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function toIso(timestamp: number | undefined): string | undefined {
  return timestamp === undefined ? undefined : new Date(timestamp).toISOString()
}

function staleInactiveSessionCompletedAt(input: {
  session: SessionLike | undefined
  status: SessionStatus | undefined
  now: number
  staleMs: number
}): string | undefined {
  if (!input.session) return undefined
  if (isActiveSessionStatus(input.status)) return undefined
  if (input.now - input.session.time.updated <= input.staleMs) return undefined
  return toIso(input.session.time.updated)
}

function truncateMessage(value: string | undefined, limit = 180): string | undefined {
  const text = value?.replace(/\s+/g, " ").trim()
  if (!text) return undefined
  if (text.length <= limit) return text
  return `${text.slice(0, Math.max(0, limit - 1)).trimEnd()}...`
}

function normalizedTaskText(value: string | undefined): string {
  return value?.replace(/\s+/g, " ").trim().toLowerCase() ?? ""
}

function isGenericAgentLabel(value: string | undefined): boolean {
  const normalized = normalizedTaskText(value)
  return !normalized || genericAgentLabels.has(normalized)
}

function areAgentLabelsCompatible(left: BackgroundTaskSnapshot, right: BackgroundTaskSnapshot): boolean {
  const leftAgent = normalizedTaskText(left.agent)
  const rightAgent = normalizedTaskText(right.agent)
  return leftAgent === rightAgent || isGenericAgentLabel(left.agent) || isGenericAgentLabel(right.agent)
}

function taskComparisonTime(task: BackgroundTaskSnapshot): number | undefined {
  for (const value of [task.startedAt, task.queuedAt, task.completedAt]) {
    const timestamp = Date.parse(value ?? "")
    if (Number.isFinite(timestamp)) return timestamp
  }
  return undefined
}

function hasCompatibleTaskTime(left: BackgroundTaskSnapshot, right: BackgroundTaskSnapshot): boolean {
  const leftTime = taskComparisonTime(left)
  const rightTime = taskComparisonTime(right)
  if (leftTime === undefined || rightTime === undefined) return true
  return Math.abs(leftTime - rightTime) <= duplicateTaskTimeWindowMs
}

function isPlaceholderTask(task: BackgroundTaskSnapshot): boolean {
  return !task.sessionId || !task.model || isGenericAgentLabel(task.agent)
}

function areCompatibleBackgroundTasks(left: BackgroundTaskSnapshot, right: BackgroundTaskSnapshot): boolean {
  if (left.id === right.id) return true
  if (left.sessionId && right.sessionId) return left.sessionId === right.sessionId
  if (!isPlaceholderTask(left) && !isPlaceholderTask(right)) return false
  if (!left.sessionId && !right.sessionId) return false
  if (left.rootSessionId !== right.rootSessionId) return false
  if (normalizedTaskText(left.description) !== normalizedTaskText(right.description)) return false
  if (!areAgentLabelsCompatible(left, right)) return false
  return hasCompatibleTaskTime(left, right)
}

function mergeAttempts(
  left: BackgroundTaskSnapshot["attempts"],
  right: BackgroundTaskSnapshot["attempts"],
): BackgroundTaskSnapshot["attempts"] {
  const attempts = new Map<string, BackgroundTaskSnapshot["attempts"][number]>()
  for (const attempt of [...left, ...right]) {
    attempts.set(attempt.attemptId, { ...attempts.get(attempt.attemptId), ...attempt })
  }
  return [...attempts.values()]
}

function mergeBackgroundTaskSnapshot(
  primary: BackgroundTaskSnapshot,
  secondary: BackgroundTaskSnapshot,
): BackgroundTaskSnapshot {
  const primaryAgentIsGeneric = isGenericAgentLabel(primary.agent)
  const primaryStatus = primary.status
  const secondaryStatus = secondary.status
  const status = primaryStatus === "pending" && secondaryStatus === "running" ? "running" : primaryStatus

  return {
    ...secondary,
    ...primary,
    sessionId: primary.sessionId ?? secondary.sessionId,
    agent: primaryAgentIsGeneric && !isGenericAgentLabel(secondary.agent) ? secondary.agent : primary.agent,
    category: primary.category ?? secondary.category,
    status,
    model: primary.model ?? secondary.model,
    queuedAt: primary.queuedAt ?? secondary.queuedAt,
    startedAt: primary.startedAt ?? secondary.startedAt,
    completedAt: primary.completedAt ?? secondary.completedAt,
    elapsedMs: Math.max(primary.elapsedMs, secondary.elapsedMs),
    retryCount: Math.max(primary.retryCount, secondary.retryCount),
    progress: primary.progress ?? secondary.progress,
    attempts: mergeAttempts(primary.attempts, secondary.attempts),
    error: primary.error ?? secondary.error,
  }
}

function parseModelSummary(value: string | undefined): BackgroundTaskSnapshot["model"] | undefined {
  if (!value) return undefined
  const match = value.trim().match(/^([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)(?::([A-Za-z0-9._-]+))?$/)
  if (!match) return undefined
  const providerID = match[1]
  const modelID = match[2]
  const variant = match[3]
  if (!providerID || !modelID) return undefined
  return {
    providerID,
    modelID,
    ...(variant ? { variant } : {}),
  }
}

function activeUserMessageId(messages: MessageLike[] | undefined, status: SessionStatus | undefined): string | undefined {
  if (!messages?.length) return undefined

  const pendingAssistant = [...messages].reverse().find(
    (message) => message.role === "assistant" && typeof message.time.completed !== "number",
  )
  if (pendingAssistant?.parentID) return pendingAssistant.parentID

  if (isActiveSessionStatus(status)) {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index]
      if (message?.role === "user") return message.id
    }
  }

  return undefined
}

function userMessageIdsNewest(messages: MessageLike[] | undefined): string[] {
  if (!messages?.length) return []
  return messages
    .filter((message) => message.role === "user")
    .map((message) => message.id)
    .reverse()
}

function backgroundTaskBatchCompletedAt(tasks: BackgroundTaskSnapshot[]): number | undefined {
  let latest: number | undefined

  for (const task of tasks) {
    if (!terminalStatuses.has(task.status)) return undefined
    const timestamp = Date.parse(task.completedAt ?? task.startedAt ?? task.queuedAt ?? "")
    if (!Number.isFinite(timestamp)) continue
    latest = latest === undefined ? timestamp : Math.max(latest, timestamp)
  }

  return latest
}

function shouldRetainFallbackTaskBatch(tasks: BackgroundTaskSnapshot[], now: number): boolean {
  if (tasks.length === 0) return false
  if (tasks.some((task) => isActiveBackgroundTask(task))) return true

  const completedAt = backgroundTaskBatchCompletedAt(tasks)
  if (completedAt === undefined) return false

  return now - completedAt <= BACKGROUND_TASK_COMPLETED_RETENTION_MS
}

function deriveSessionProgress(input: {
  sessionId: string
  messages: Record<string, MessageLike[] | undefined>
  parts: PartStore
  statuses: SessionStatusMap
}): BackgroundTaskSnapshot["progress"] | undefined {
  const messages = input.messages[input.sessionId]
  if (!messages?.length) return undefined

  const userMessageId = activeUserMessageId(messages, input.statuses[input.sessionId]) ?? [...messages]
    .reverse()
    .find((message) => message.role === "user")?.id

  const assistants = messages.filter(
    (message) => message.role === "assistant" && (!userMessageId || message.parentID === userMessageId),
  )
  if (assistants.length === 0) return undefined

  let toolCalls = 0
  let lastTool: string | undefined
  let lastMessage: string | undefined
  let lastUpdate: string | undefined

  for (const message of assistants) {
    const parts = input.parts[message.id] ?? []
    for (const part of parts) {
      if (part.type === "tool") toolCalls += 1
    }
  }

  for (let messageIndex = assistants.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const message = assistants[messageIndex]
    const parts = input.parts[message.id] ?? []

    for (let partIndex = parts.length - 1; partIndex >= 0; partIndex -= 1) {
      const part = parts[partIndex]
      if (!lastTool && part.type === "tool") {
        lastTool = part.tool
        lastUpdate = toIso(toolStateTimestamp(part, "end") ?? toolStateTimestamp(part, "start")) ?? lastUpdate
      }

      if (!lastMessage && (part.type === "text" || part.type === "reasoning")) {
        lastMessage = truncateMessage(part.text)
      }

      if (lastTool && lastMessage) break
    }

    lastUpdate = lastUpdate ?? toIso(message.time.completed ?? message.time.created)
    if (lastTool && lastMessage && lastUpdate) break
  }

  if (toolCalls === 0 && !lastTool && !lastMessage) return undefined

  return {
    toolCalls,
    ...(lastTool ? { lastTool } : {}),
    ...(lastMessage ? { lastMessage } : {}),
    ...(lastUpdate ? { lastUpdate } : {}),
  }
}

function deriveSessionState(input: {
  sessionId: string
  messages: Record<string, MessageLike[] | undefined>
  parts: PartStore
  statuses: SessionStatusMap
}): DerivedSessionState | undefined {
  const status = input.statuses[input.sessionId]
  if (status?.type === "retry") {
    return {
      status: "running",
      retryCount: Math.max(0, status.attempt - 1),
      progress: {
        toolCalls: 0,
        ...(status.message ? { lastMessage: status.message } : {}),
      },
    }
  }
  if (isActiveSessionStatus(status)) {
    return {
      status: "running",
      progress: deriveSessionProgress(input),
    }
  }

  const messages = input.messages[input.sessionId]
  if (!messages?.length) return undefined

  const pendingAssistant = [...messages].reverse().find(
    (message) => message.role === "assistant" && typeof message.time.completed !== "number",
  )
  if (pendingAssistant) {
    return {
      status: "running",
      progress: deriveSessionProgress(input),
    }
  }

  const assistantError = [...messages].reverse().find(
    (message) => message.role === "assistant" && !!message.error?.name,
  )
  if (assistantError?.error) {
    return {
      status: "error",
      completedAt: toIso(assistantError.time.completed ?? assistantError.time.created),
      error: assistantError.error.data?.message ?? assistantError.error.name,
      progress: deriveSessionProgress(input),
    }
  }

  const lastMessage = messages[messages.length - 1]
  return {
    status: "completed",
    completedAt: toIso(lastMessage?.time.completed ?? lastMessage?.time.created),
    progress: deriveSessionProgress(input),
  }
}

function parseToolOutputStatus(output: string | undefined): BackgroundTaskStatus | undefined {
  const value = parseOutputMatch(output, /^Status:\s*([A-Za-z_]+)\s*$/im)?.toLowerCase()
  if (!value) return undefined
  if (value === "pending") return "pending"
  if (value === "running" || value === "busy" || value === "in_progress") return "running"
  if (value === "completed" || value === "succeeded" || value === "success") return "completed"
  if (value === "failed" || value === "error") return "error"
  if (value === "cancelled" || value === "canceled") return "cancelled"
  if (value === "interrupt" || value === "interrupted") return "interrupt"
}

function parseToolBackgroundSnapshot(input: {
  rootSessionId: string
  parentSessionId: string
  message: MessageLike
  part: Part
  messages: Record<string, MessageLike[] | undefined>
  parts: PartStore
  statuses: SessionStatusMap
  sessions: Map<string, SessionLike>
  now: number
}): BackgroundTaskSnapshot | undefined {
  const part = input.part
  if (part.type !== "tool") return undefined
  if (part.tool !== "task" && part.tool !== "call_omo_agent") return undefined

  const metadata = "metadata" in part.state && isRecord(part.state.metadata) ? part.state.metadata : undefined
  const toolInput = "input" in part.state && isRecord(part.state.input) ? part.state.input : undefined
  const output = "output" in part.state && typeof part.state.output === "string" ? part.state.output : undefined

  const inputTaskId = readString(toolInput ?? {}, "task_id") ?? readString(toolInput ?? {}, "taskId")
  const explicitSessionId = readString(metadata ?? {}, "sessionId")
    ?? parseOutputMatch(output, /session_id:\s*(ses_[A-Za-z0-9]+)/i)
    ?? parseOutputMatch(output, /Session ID:\s*(ses_[A-Za-z0-9]+)/i)
    ?? (inputTaskId?.startsWith("ses_") ? inputTaskId : undefined)
  const backgroundTaskId = readString(metadata ?? {}, "backgroundTaskId")
    ?? parseOutputMatch(output, /background_task_id:\s*(bg_[A-Za-z0-9]+)/i)
    ?? parseOutputMatch(output, /Background Task ID:\s*(bg_[A-Za-z0-9]+)/i)
    ?? parseOutputMatch(output, /Task ID:\s*(bg_[A-Za-z0-9]+)/i)
    ?? (inputTaskId?.startsWith("bg_") ? inputTaskId : undefined)
  const metadataTaskId = readString(metadata ?? {}, "taskId")
    ?? parseOutputMatch(output, /task_id:\s*((?:ses|bg)_[A-Za-z0-9]+)/i)
  const description = readString(metadata ?? {}, "description")
    ?? readString(toolInput ?? {}, "description")
    ?? parseOutputMatch(output, /^Description:\s*(.+)$/im)
    ?? (part.tool === "call_omo_agent" ? "Background agent" : "Background task")
  const explicitSessionInfo = explicitSessionId ? input.sessions.get(explicitSessionId) : undefined
  const inferredSessionInfo = explicitSessionInfo ?? findMatchingChildSession({
    parentSessionId: input.parentSessionId,
    sessions: input.sessions,
    description,
    startedAt: toolStateTimestamp(part, "start") ?? input.message.time.created,
  })
  const sessionId = explicitSessionId ?? inferredSessionInfo?.id
  const sessionInfo = explicitSessionInfo ?? inferredSessionInfo
  const agent = normalizeAgentLabel(
    readString(metadata ?? {}, "agent")
      ?? parseOutputMatch(output, /^Agent:\s*(.+)$/im)
      ?? readString(toolInput ?? {}, "subagent_type")
      ?? readString(toolInput ?? {}, "requested_subagent_type")
      ?? sessionInfo?.agent,
  ) ?? "subagent"
  const category = readString(metadata ?? {}, "category")
    ?? readString(toolInput ?? {}, "category")
    ?? readString(toolInput ?? {}, "subagent_type")
  const model = readModel(metadata?.model)
    ?? parseModelSummary(parseOutputMatch(output, /^Model:\s*(.+)$/im))
    ?? modelFromMessages(sessionId ? input.messages[sessionId] : undefined)
    ?? modelFromSession(sessionInfo)

  const launchedInBackground = !!output
    && /Background (?:agent )?task launched/i.test(output)
  const reviewRunning = !!output
    && /Review agents are running in the background/i.test(output)
  const childState = sessionId
    ? deriveSessionState({
        sessionId,
        messages: input.messages,
        parts: input.parts,
        statuses: input.statuses,
      })
    : undefined

  const staleCompletedAt = staleInactiveSessionCompletedAt({
    session: sessionInfo,
    status: input.statuses[sessionId ?? ""],
    now: input.now,
    staleMs: childState ? BACKGROUND_TASK_STALE_INACTIVE_MS : BACKGROUND_TASK_COMPLETED_RETENTION_MS,
  })

  let status: BackgroundTaskStatus | undefined
  if (childState?.status && terminalStatuses.has(childState.status)) status = childState.status
  else if (part.state.status === "running") status = "running"
  else if (part.state.status === "error") status = "error"
  else if (childState?.status) status = childState.status
  else if (reviewRunning) status = "running"
  else if (launchedInBackground) status = parseToolOutputStatus(output) ?? "pending"
  else status = parseToolOutputStatus(output)

  if (!status) return undefined

  const startedAtMs = sessionInfo?.time.created
    ?? toolStateTimestamp(part, "start")
    ?? input.message.time.created
  if (staleCompletedAt && activeStatuses.has(status)) {
    status = "interrupt"
  } else if (status === "pending" && staleCompletedAt) {
    status = "completed"
  }
  const completedAt = childState?.completedAt
    ?? staleCompletedAt
    ?? (status === "completed" || status === "error" || status === "cancelled" || status === "interrupt"
      ? toIso(toolStateTimestamp(part, "end") ?? input.message.time.completed)
      : undefined)
  const retryCount = childState?.retryCount ?? 0
  const progress = childState?.progress
    ?? (launchedInBackground || reviewRunning
      ? {
          toolCalls: 0,
          ...(launchedInBackground ? { lastMessage: "launched" } : {}),
        }
      : undefined)

  return {
    id: backgroundTaskId ?? metadataTaskId ?? sessionId ?? `part:${input.message.id}:${part.id}`,
    ...(sessionId ? { sessionId } : {}),
    parentSessionId: input.parentSessionId,
    rootSessionId: input.rootSessionId,
    parentMessageId: input.message.id,
    description,
    agent,
    ...(category ? { category } : {}),
    status,
    ...(model ? { model } : {}),
    ...(toIso(startedAtMs) ? { queuedAt: toIso(startedAtMs) } : {}),
    ...(toIso(startedAtMs) ? { startedAt: toIso(startedAtMs) } : {}),
    ...(completedAt ? { completedAt } : {}),
    elapsedMs: Math.max(0, input.now - startedAtMs),
    retryCount,
    ...(progress ? { progress } : {}),
    attempts: [],
    ...(childState?.error ? { error: childState.error } : {}),
  }
}

function deriveMessageTasksForUserMessage(input: {
  session: SessionLike
  userMessageId: string
  rootSessionId: string
  messages: Record<string, MessageLike[] | undefined>
  parts: PartStore
  statuses: SessionStatusMap
  sessions: Map<string, SessionLike>
  now: number
}): BackgroundTaskSnapshot[] {
  const sessionMessages = input.messages[input.session.id]
  if (!sessionMessages?.length) return []

  return sessionMessages
    .filter((message) => message.role === "assistant" && message.parentID === input.userMessageId)
    .flatMap((message) =>
      (input.parts[message.id] ?? []).flatMap((part) => {
        const task = parseToolBackgroundSnapshot({
          rootSessionId: input.rootSessionId,
          parentSessionId: input.session.id,
          message,
          part,
          messages: input.messages,
          parts: input.parts,
          statuses: input.statuses,
          sessions: input.sessions,
          now: input.now,
        })
        return task ? [task] : []
      }),
    )
}

export function mergeBackgroundTaskSnapshots(
  metadataTasks: BackgroundTaskSnapshot[],
  fallbackTasks: BackgroundTaskSnapshot[],
): BackgroundTaskSnapshot[] {
  if (metadataTasks.length === 0) return fallbackTasks
  if (fallbackTasks.length === 0) return metadataTasks

  const merged = [...metadataTasks]

  for (const fallbackTask of fallbackTasks) {
    const exactMatchIndex = merged.findIndex((task) =>
      task.id === fallbackTask.id || (!!task.sessionId && task.sessionId === fallbackTask.sessionId),
    )
    if (exactMatchIndex >= 0) {
      merged[exactMatchIndex] = mergeBackgroundTaskSnapshot(merged[exactMatchIndex]!, fallbackTask)
      continue
    }

    const compatibleMatches = merged
      .map((task, index) => ({ task, index }))
      .filter(({ task }) => areCompatibleBackgroundTasks(task, fallbackTask))

    if (compatibleMatches.length === 1) {
      const index = compatibleMatches[0]!.index
      const fallbackCandidates = fallbackTasks.filter((task) =>
        areCompatibleBackgroundTasks(compatibleMatches[0]!.task, task),
      )
      if (fallbackCandidates.length !== 1) {
        merged.push(fallbackTask)
        continue
      }
      merged[index] = mergeBackgroundTaskSnapshot(merged[index]!, fallbackTask)
      continue
    }

    merged.push(fallbackTask)
  }

  return merged
}

export function deriveFallbackBackgroundTasks(input: {
  rootSessionId: string | undefined
  sessions: SessionLike[]
  statuses: SessionStatusMap
  messages?: Record<string, MessageLike[] | undefined>
  now?: number
}): BackgroundTaskSnapshot[] {
  if (!input.rootSessionId) return []

  const now = input.now ?? Date.now()
  const sessions = new Map(input.sessions.map((session) => [session.id, session] as const))

  return input.sessions
    .filter((session) => {
      if (!session.parentID) return false
      if (!isActiveSessionStatus(input.statuses[session.id])) return false
      return isDescendantOfRoot(session, input.rootSessionId!, sessions)
    })
    .map((session) => {
      const parsed = parseSubagentSessionTitle(session.title)
      const status = input.statuses[session.id]
      const model = modelFromMessages(input.messages?.[session.id]) ?? modelFromSession(session)
      const startedAt = new Date(session.time.created).toISOString()
      const retryCount = status?.type === "retry" ? Math.max(0, status.attempt - 1) : 0
      return {
        id: `session:${session.id}`,
        sessionId: session.id,
        parentSessionId: session.parentID!,
        rootSessionId: input.rootSessionId!,
        parentMessageId: `session:${session.parentID}`,
        description: parsed.description,
        agent: parsed.agent,
        status: "running",
        ...(model ? { model } : {}),
        queuedAt: startedAt,
        startedAt,
        elapsedMs: Math.max(0, now - session.time.created),
        retryCount,
        ...(status?.type === "retry"
          ? {
              progress: {
                toolCalls: 0,
                lastMessage: status.message,
              },
            }
          : {}),
        attempts: [
          {
            attemptId: `attempt:${session.id}`,
            attemptNumber: Math.max(1, retryCount + 1),
            sessionId: session.id,
            ...(model ? model : {}),
            status: "running",
            startedAt,
          },
        ],
      }
    })
}

export function deriveMessageFallbackBackgroundTasks(input: {
  rootSessionId: string | undefined
  sessions: SessionLike[]
  statuses: SessionStatusMap
  messages: Record<string, MessageLike[] | undefined>
  parts: PartStore
  now?: number
}): BackgroundTaskSnapshot[] {
  if (!input.rootSessionId) return []

  const now = input.now ?? Date.now()
  const sessions = new Map(input.sessions.map((session) => [session.id, session] as const))

  return input.sessions
    .filter((session) => session.id === input.rootSessionId || isDescendantOfRoot(session, input.rootSessionId!, sessions))
    .flatMap((session) => {
      const sessionMessages = input.messages[session.id]
      if (!sessionMessages?.length) return []

      for (const userMessageId of userMessageIdsNewest(sessionMessages)) {
        const tasks = deriveMessageTasksForUserMessage({
          session,
          userMessageId,
          rootSessionId: input.rootSessionId!,
          messages: input.messages,
          parts: input.parts,
          statuses: input.statuses,
          sessions,
          now,
        })
        if (tasks.length === 0) continue
        return shouldRetainFallbackTaskBatch(tasks, now) ? tasks : []
      }

      return []
    })
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
