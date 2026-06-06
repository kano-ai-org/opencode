import type { Message, Part, PermissionRequest, QuestionRequest, Session, ToolPart } from "@opencode-ai/sdk/v2/client"

function sessionTreeRequest<T>(
  session: Session[],
  request: Record<string, T[] | undefined>,
  sessionID?: string,
  include: (item: T) => boolean = () => true,
) {
  if (!sessionID) return

  const map = session.reduce((acc, item) => {
    if (!item.parentID) return acc
    const list = acc.get(item.parentID)
    if (list) list.push(item.id)
    if (!list) acc.set(item.parentID, [item.id])
    return acc
  }, new Map<string, string[]>())

  const seen = new Set([sessionID])
  const ids = [sessionID]
  for (const id of ids) {
    const list = map.get(id)
    if (!list) continue
    for (const child of list) {
      if (seen.has(child)) continue
      seen.add(child)
      ids.push(child)
    }
  }

  const id = ids.find((id) => request[id]?.some(include))
  if (!id) return
  return request[id]?.find(include)
}

export function sessionPermissionRequest(
  session: Session[],
  request: Record<string, PermissionRequest[] | undefined>,
  sessionID?: string,
  include?: (item: PermissionRequest) => boolean,
) {
  return sessionTreeRequest(session, request, sessionID, include)
}

export function sessionQuestionRequest(
  session: Session[],
  request: Record<string, QuestionRequest[] | undefined>,
  sessionID?: string,
  include?: (item: QuestionRequest) => boolean,
) {
  return sessionTreeRequest(session, request, sessionID, include)
}

function isLiveQuestionToolPart(part: Part | undefined): part is ToolPart {
  return part?.type === "tool" && part.tool === "question"
}

function isRealUserMessage(
  message: Message,
  part: Record<string, Part[] | undefined>,
): message is Extract<Message, { role: "user" }> {
  if (message.role !== "user") return false
  return (part[message.id] ?? []).some((item) => !("synthetic" in item) || item.synthetic !== true)
}

export function isQuestionRequestActive(
  message: Record<string, Message[] | undefined>,
  part: Record<string, Part[] | undefined>,
  request: QuestionRequest,
) {
  const tool = request.tool
  if (!tool) return true

  const toolPart = part[tool.messageID]?.find(
    (item): item is ToolPart => isLiveQuestionToolPart(item) && item.callID === tool.callID,
  )
  if (toolPart && toolPart.state.status !== "pending" && toolPart.state.status !== "running") {
    return false
  }

  const messages = message[request.sessionID]
  if (!messages) return true

  const messageIndex = messages.findIndex((item) => item.id === tool.messageID)
  if (messageIndex === -1) return true

  return !messages.slice(messageIndex + 1).some((item) => isRealUserMessage(item, part))
}
