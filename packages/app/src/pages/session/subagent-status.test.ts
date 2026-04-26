import { describe, expect, test } from "bun:test"
import type { Message, Part, Session, SessionStatus } from "@opencode-ai/sdk/v2/client"
import { groupSubagentStatusByParentMessage } from "./subagent-status"

const assistantMessage = (input: { id: string; parentID: string }) => ({
  id: input.id,
  role: "assistant",
  parentID: input.parentID,
}) as Message

const toolPart = (input: {
  id: string
  sessionId?: string
  description?: string
  agent?: string
  model?: { providerID: string; modelID: string; variant?: string }
  metadataInState?: boolean
  rootSessionId?: string
  rootAgent?: string
  rootModel?: { providerID: string; modelID: string; variant?: string }
}) => ({
  id: input.id,
  type: "tool",
  tool: "task",
  metadata: {
    ...(input.metadataInState ? {} : { ...(input.sessionId ? { sessionId: input.sessionId } : {}) }),
    ...(input.metadataInState ? {} : { ...(input.agent ? { agent: input.agent } : {}) }),
    ...(input.metadataInState ? {} : { ...(input.model ? { model: input.model } : {}) }),
    ...(input.rootSessionId ? { sessionId: input.rootSessionId } : {}),
    ...(input.rootAgent ? { agent: input.rootAgent } : {}),
    ...(input.rootModel ? { model: input.rootModel } : {}),
  },
  state: {
    ...(input.metadataInState
      ? {
          metadata: {
            ...(input.sessionId ? { sessionId: input.sessionId } : {}),
            ...(input.agent ? { agent: input.agent } : {}),
            ...(input.model ? { model: input.model } : {}),
          },
        }
      : {}),
    input: {
      ...(input.description ? { description: input.description } : {}),
    },
  },
}) as Part

const childSession = (input: { id: string; parentID: string; title: string }) => ({
  id: input.id,
  parentID: input.parentID,
  title: input.title,
}) as Session

describe("groupSubagentStatusByParentMessage", () => {
  test("groups a running child session onto the spawning parent turn", () => {
    const result = groupSubagentStatusByParentMessage({
      sessionID: "root",
      sessions: [childSession({ id: "child", parentID: "root", title: "Explore code (@explore subagent)" })],
      sessionStatus: { child: { type: "busy" } as SessionStatus },
      messages: [assistantMessage({ id: "assistant-1", parentID: "user-1" })],
      parts: {
        "assistant-1": [
          toolPart({
            id: "tool-1",
            sessionId: "child",
            description: "Explore code",
            agent: "explore",
            model: { providerID: "openai", modelID: "gpt-5.4" },
          }),
        ],
      },
    })

    expect(result["user-1"]).toEqual([
      {
        id: "tool-1",
        parentMessageID: "user-1",
        sessionID: "child",
        open: true,
        title: "Explore code (@explore subagent)",
        description: "Explore code",
        agent: "explore",
        modelLabel: "openai/gpt-5.4",
        statusLabel: "running",
        live: true,
      },
    ])
  })

  test("keeps pending tasks visible before a child session id exists", () => {
    const result = groupSubagentStatusByParentMessage({
      sessionID: "root",
      sessions: [],
      sessionStatus: {},
      messages: [assistantMessage({ id: "assistant-1", parentID: "user-1" })],
      parts: {
        "assistant-1": [toolPart({ id: "tool-1", sessionId: "pending", description: "Trace models", agent: "explore" })],
      },
    })

    expect(result["user-1"]?.[0]).toMatchObject({
      open: false,
      title: "Trace models (@explore subagent)",
      statusLabel: "pending",
      live: true,
    })
  })

  test("marks idle child sessions as completed", () => {
    const result = groupSubagentStatusByParentMessage({
      sessionID: "root",
      sessions: [childSession({ id: "child", parentID: "root", title: "Find docs (@librarian subagent)" })],
      sessionStatus: { child: { type: "idle" } as SessionStatus },
      messages: [assistantMessage({ id: "assistant-1", parentID: "user-1" })],
      parts: {
        "assistant-1": [toolPart({ id: "tool-1", sessionId: "child", description: "Find docs", agent: "librarian" })],
      },
    })

    expect(result["user-1"]?.[0]).toMatchObject({
      statusLabel: "completed",
      live: false,
    })
  })

  test("reads linked session metadata from part.state.metadata", () => {
    const result = groupSubagentStatusByParentMessage({
      sessionID: "root",
      sessions: [childSession({ id: "child", parentID: "root", title: "Explore code (@explore subagent)" })],
      sessionStatus: { child: { type: "busy" } as SessionStatus },
      messages: [assistantMessage({ id: "assistant-1", parentID: "user-1" })],
      parts: {
        "assistant-1": [
          toolPart({
            id: "tool-1",
            sessionId: "child",
            description: "Explore code",
            agent: "explore",
            model: { providerID: "github-copilot", modelID: "gpt-5.4", variant: "fast" },
            metadataInState: true,
          }),
        ],
      },
    })

    expect(result["user-1"]).toEqual([
      {
        id: "tool-1",
        parentMessageID: "user-1",
        sessionID: "child",
        open: true,
        title: "Explore code (@explore subagent)",
        description: "Explore code",
        agent: "explore",
        modelLabel: "github-copilot/gpt-5.4:fast",
        statusLabel: "running",
        live: true,
      },
    ])
  })

  test("prefers part.state.metadata over part.metadata", () => {
    const result = groupSubagentStatusByParentMessage({
      sessionID: "root",
      sessions: [childSession({ id: "child-state", parentID: "root", title: "Explore code (@explore subagent)" })],
      sessionStatus: { "child-state": { type: "busy" } as SessionStatus },
      messages: [assistantMessage({ id: "assistant-1", parentID: "user-1" })],
      parts: {
        "assistant-1": [
          toolPart({
            id: "tool-1",
            sessionId: "child-state",
            description: "Explore code",
            agent: "explore",
            model: { providerID: "github-copilot", modelID: "gpt-5.4" },
            metadataInState: true,
            rootSessionId: "child-root",
            rootAgent: "general",
            rootModel: { providerID: "openai", modelID: "gpt-5-mini" },
          }),
        ],
      },
    })

    expect(result["user-1"]).toEqual([
      {
        id: "tool-1",
        parentMessageID: "user-1",
        sessionID: "child-state",
        open: true,
        title: "Explore code (@explore subagent)",
        description: "Explore code",
        agent: "explore",
        modelLabel: "github-copilot/gpt-5.4",
        statusLabel: "running",
        live: true,
      },
    ])
  })
})
