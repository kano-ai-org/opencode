import type { Message, Part, Session, SessionStatus } from "@opencode-ai/sdk/v2/client"

type SessionStatusMap = Record<string, SessionStatus | undefined>
type PartMap = Record<string, Part[] | undefined>

export type TurnSubagentStatusItem = {
  id: string
  parentMessageID: string
  sessionID?: string
  open: boolean
  title: string
  description: string
  agent?: string
  modelLabel?: string
  statusLabel: "pending" | "running" | "completed"
  live: boolean
}

type LinkedTask = Omit<TurnSubagentStatusItem, "statusLabel" | "live" | "title"> & {
  fallbackTitle: string
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined
}

function partMetadata(part: Extract<Part, { type: "tool" }>): Record<string, unknown> | undefined {
  if (!record(part.state)) return record(part.metadata) ? part.metadata : undefined
  if ("metadata" in part.state && record(part.state.metadata)) return part.state.metadata
  if (record(part.metadata)) return part.metadata
}

function taskMetadata(part: Part): { sessionId?: string; description?: string; agent?: string; modelLabel?: string } | undefined {
  if (part.type !== "tool") return
  if (part.tool !== "task" && part.tool !== "call_omo_agent") return

  const metadata = partMetadata(part)
  if (!metadata) return

  const sessionId = stringValue(metadata.sessionId)
  const agent = stringValue(metadata.agent)
  const description = record(part.state) ? stringValue(part.state.input?.description) : undefined
  const model = record(metadata.model) ? metadata.model : undefined
  const providerID = stringValue(model?.providerID)
  const modelID = stringValue(model?.modelID)
  const variant = stringValue(model?.variant)
  const modelLabel = providerID && modelID
    ? [providerID, modelID].join("/") + (variant ? `:${variant}` : "")
    : undefined

  if (!sessionId && !description) return
  return { sessionId, description, agent, modelLabel }
}

function fallbackTitle(description: string, agent?: string): string {
  return agent ? `${description} (@${agent} subagent)` : description
}

function sortItems(items: TurnSubagentStatusItem[]): TurnSubagentStatusItem[] {
  const rank = (item: TurnSubagentStatusItem) => {
    if (item.statusLabel === "running") return 0
    if (item.statusLabel === "pending") return 1
    return 2
  }

  return items.slice().sort((left, right) => {
    const diff = rank(left) - rank(right)
    if (diff !== 0) return diff
    return left.title.localeCompare(right.title)
  })
}

function toStatusLabel(status: SessionStatus | undefined): { statusLabel: "running" | "completed"; live: boolean } {
  if (status?.type === "busy" || status?.type === "retry") {
    return { statusLabel: "running", live: true }
  }
  return { statusLabel: "completed", live: false }
}

export function groupSubagentStatusByParentMessage(input: {
  sessionID: string
  sessions: Session[]
  sessionStatus: SessionStatusMap
  messages: Message[]
  parts: PartMap
}): Record<string, TurnSubagentStatusItem[]> {
  const linkedBySession = new Map<string, LinkedTask>()
  const grouped = new Map<string, TurnSubagentStatusItem[]>()
  const map = new Map<string, string[]>()

  for (const session of input.sessions) {
    if (!session.parentID) continue
    const list = map.get(session.parentID)
    if (list) {
      list.push(session.id)
      continue
    }
    map.set(session.parentID, [session.id])
  }

  const seen = new Set<string>()
  const ids = [input.sessionID]
  for (const id of ids) {
    const list = map.get(id)
    if (!list) continue
    for (const child of list) {
      if (seen.has(child)) continue
      seen.add(child)
      ids.push(child)
    }
  }

  for (const message of input.messages) {
    if (message.role !== "assistant" || !message.parentID) continue

    for (const part of input.parts[message.id] ?? []) {
      const metadata = taskMetadata(part)
      if (!metadata) continue

      const id = part.id ?? `${message.id}:${metadata.sessionId ?? metadata.description ?? "task"}`
      const description = metadata.description ?? metadata.agent ?? "Subagent task"
      const item: LinkedTask = {
        id,
        parentMessageID: message.parentID,
        sessionID: metadata.sessionId,
        open: false,
        description,
        agent: metadata.agent,
        modelLabel: metadata.modelLabel,
        fallbackTitle: fallbackTitle(description, metadata.agent),
      }

      if (metadata.sessionId && metadata.sessionId !== "pending") {
        linkedBySession.set(metadata.sessionId, item)
        continue
      }

      const list = grouped.get(message.parentID) ?? []
      list.push({ ...item, title: item.fallbackTitle, statusLabel: "pending", live: true })
      grouped.set(message.parentID, list)
    }
  }

  for (const session of input.sessions) {
    if (!seen.has(session.id) || session.time?.archived) continue
    const linked = linkedBySession.get(session.id)
    if (!linked) continue

    const list = grouped.get(linked.parentMessageID) ?? []
    const status = toStatusLabel(input.sessionStatus[session.id])
    list.push({
      id: linked.id,
      parentMessageID: linked.parentMessageID,
      description: linked.description,
      open: true,
      agent: linked.agent,
      modelLabel: linked.modelLabel,
      title: session.title || linked.fallbackTitle,
      sessionID: session.id,
      statusLabel: status.statusLabel,
      live: status.live,
    })
    grouped.set(linked.parentMessageID, list)
  }

  return Object.fromEntries([...grouped.entries()].map(([key, items]) => [key, sortItems(items)]))
}
