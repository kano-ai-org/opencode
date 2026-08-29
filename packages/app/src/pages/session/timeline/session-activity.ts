import type { Session, SessionStatus } from "@opencode-ai/sdk/v2"

export type SessionActivityKind = "working" | "retrying" | "waiting" | "idle"

export type ActiveSession = {
  info: Session
  status: Exclude<SessionStatus, { type: "idle" }>
}

export type SessionActivity = {
  kind: SessionActivityKind
  parent?: Session
  parentStatus: SessionStatus
  descendants: ActiveSession[]
  lastUpdated?: number
}

const idle = { type: "idle" as const }

function isDescendant(session: Session, ancestorID: string, sessions: Record<string, Session | undefined>) {
  const seen = new Set([session.id])
  let current: Session | undefined = session

  while (current?.parentID) {
    if (current.parentID === ancestorID) return true
    if (seen.has(current.parentID)) return false
    seen.add(current.parentID)
    current = sessions[current.parentID]
  }

  return false
}

export function aggregateSessionActivity(input: {
  sessionID: string
  sessions: Record<string, Session | undefined>
  statuses: Record<string, SessionStatus | undefined>
}): SessionActivity {
  const parent = input.sessions[input.sessionID]
  const parentStatus = input.statuses[input.sessionID] ?? idle
  const descendants = Object.entries(input.statuses)
    .flatMap(([sessionID, status]) => {
      if (sessionID === input.sessionID || !status || status.type === "idle") return []
      const info = input.sessions[sessionID]
      if (!info || !isDescendant(info, input.sessionID, input.sessions)) return []
      return [{ info, status } satisfies ActiveSession]
    })
    .sort((a, b) => b.info.time.updated - a.info.time.updated)

  const updated = [parent?.time.updated, ...descendants.map((item) => item.info.time.updated)].filter(
    (value): value is number => typeof value === "number",
  )
  const kind =
    parentStatus.type === "retry"
      ? "retrying"
      : parentStatus.type === "busy"
        ? "working"
        : descendants.length > 0
          ? "waiting"
          : "idle"

  return {
    kind,
    parent,
    parentStatus,
    descendants,
    lastUpdated: updated.length > 0 ? Math.max(...updated) : undefined,
  }
}
