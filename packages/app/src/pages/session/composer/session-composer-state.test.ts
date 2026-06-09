import { describe, expect, test } from "bun:test"
import type { Message, Part, PermissionRequest, QuestionRequest, Session, ToolPart } from "@opencode-ai/sdk/v2/client"
import {
  isPermissionRequestNotFoundError,
  removePermissionRequest,
  todoState,
} from "./session-composer-state.logic"
import { isQuestionRequestActive, sessionPermissionRequest, sessionQuestionRequest } from "./session-request-tree"

const session = (input: { id: string; parentID?: string }) =>
  ({
    id: input.id,
    parentID: input.parentID,
  }) as Session

const permission = (id: string, sessionID: string) =>
  ({
    id,
    sessionID,
  }) as PermissionRequest

const question = (id: string, sessionID: string, tool?: QuestionRequest["tool"]) =>
  ({
    id,
    sessionID,
    questions: [],
    tool,
  }) as QuestionRequest

const assistant = (id: string, sessionID: string) =>
  ({
    id,
    sessionID,
    role: "assistant",
    parentID: "user-0",
    modelID: "gpt-5",
    providerID: "openai",
    mode: "build",
    agent: "codex",
    path: { cwd: "/", root: "/" },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 1 },
  }) as Message

const user = (id: string, sessionID: string) =>
  ({
    id,
    sessionID,
    role: "user",
    time: { created: 1 },
    agent: "codex",
    model: { providerID: "openai", modelID: "gpt-5" },
  }) as Message

const textPart = (messageID: string, synthetic?: boolean) =>
  ({
    id: `txt-${messageID}-${synthetic ? "synthetic" : "real"}`,
    sessionID: "root",
    messageID,
    type: "text",
    text: "hello",
    synthetic,
  }) as Part

const questionToolPart = (input: {
  messageID: string
  callID?: string
  status: ToolPart["state"]["status"]
}) =>
  ({
    id: `tool-${input.messageID}`,
    sessionID: "root",
    messageID: input.messageID,
    type: "tool",
    callID: input.callID ?? "call-question",
    tool: "question",
    state:
      input.status === "completed"
        ? {
            status: "completed",
            input: {},
            output: "done",
            title: "Asked 1 question",
            metadata: {},
            time: { start: 1, end: 2 },
          }
        : input.status === "error"
          ? {
              status: "error",
              input: {},
              error: "dismissed",
              time: { start: 1, end: 2 },
            }
          : input.status === "pending"
            ? {
                status: "pending",
                input: {},
                raw: "{}",
              }
            : {
                status: "running",
                input: {},
                time: { start: 1 },
              },
  }) as ToolPart

describe("sessionPermissionRequest", () => {
  test("prefers the current session permission", () => {
    const sessions = [session({ id: "root" }), session({ id: "child", parentID: "root" })]
    const permissions = {
      root: [permission("perm-root", "root")],
      child: [permission("perm-child", "child")],
    }

    expect(sessionPermissionRequest(sessions, permissions, "root")?.id).toBe("perm-root")
  })

  test("returns a nested child permission", () => {
    const sessions = [
      session({ id: "root" }),
      session({ id: "child", parentID: "root" }),
      session({ id: "grand", parentID: "child" }),
      session({ id: "other" }),
    ]
    const permissions = {
      grand: [permission("perm-grand", "grand")],
      other: [permission("perm-other", "other")],
    }

    expect(sessionPermissionRequest(sessions, permissions, "root")?.id).toBe("perm-grand")
  })

  test("returns undefined without a matching tree permission", () => {
    const sessions = [session({ id: "root" }), session({ id: "child", parentID: "root" })]
    const permissions = {
      other: [permission("perm-other", "other")],
    }

    expect(sessionPermissionRequest(sessions, permissions, "root")).toBeUndefined()
  })

  test("skips filtered permissions in the current tree", () => {
    const sessions = [session({ id: "root" }), session({ id: "child", parentID: "root" })]
    const permissions = {
      root: [permission("perm-root", "root")],
      child: [permission("perm-child", "child")],
    }

    expect(sessionPermissionRequest(sessions, permissions, "root", (item) => item.id !== "perm-root"))?.toMatchObject({
      id: "perm-child",
    })
  })

  test("returns undefined when all tree permissions are filtered out", () => {
    const sessions = [session({ id: "root" }), session({ id: "child", parentID: "root" })]
    const permissions = {
      root: [permission("perm-root", "root")],
      child: [permission("perm-child", "child")],
    }

    expect(sessionPermissionRequest(sessions, permissions, "root", () => false)).toBeUndefined()
  })
})

describe("sessionQuestionRequest", () => {
  test("prefers the current session question", () => {
    const sessions = [session({ id: "root" }), session({ id: "child", parentID: "root" })]
    const questions = {
      root: [question("q-root", "root")],
      child: [question("q-child", "child")],
    }

    expect(sessionQuestionRequest(sessions, questions, "root")?.id).toBe("q-root")
  })

  test("returns a nested child question", () => {
    const sessions = [
      session({ id: "root" }),
      session({ id: "child", parentID: "root" }),
      session({ id: "grand", parentID: "child" }),
    ]
    const questions = {
      grand: [question("q-grand", "grand")],
    }

    expect(sessionQuestionRequest(sessions, questions, "root")?.id).toBe("q-grand")
  })

  test("skips questions whose tool part already completed", () => {
    const sessions = [session({ id: "root" })]
    const requests = {
      root: [
        question("q-stale", "root", {
          messageID: "msg-question",
          callID: "call-question",
        }),
      ],
    }
    const messages = {
      root: [assistant("msg-question", "root")],
    }
    const parts = {
      "msg-question": [questionToolPart({ messageID: "msg-question", status: "completed" })],
    }

    expect(
      sessionQuestionRequest(sessions, requests, "root", (item) => isQuestionRequestActive(messages, parts, item)),
    ).toBeUndefined()
  })

  test("skips questions after a newer real user turn", () => {
    const sessions = [session({ id: "root" })]
    const requests = {
      root: [
        question("q-stale", "root", {
          messageID: "msg-question",
          callID: "call-question",
        }),
      ],
    }
    const messages = {
      root: [assistant("msg-question", "root"), user("msg-newer", "root")],
    }
    const parts = {
      "msg-question": [questionToolPart({ messageID: "msg-question", status: "running" })],
      "msg-newer": [textPart("msg-newer")],
    }

    expect(
      sessionQuestionRequest(sessions, requests, "root", (item) => isQuestionRequestActive(messages, parts, item)),
    ).toBeUndefined()
  })

  test("keeps questions when the newer user turn is synthetic only", () => {
    const sessions = [session({ id: "root" })]
    const requests = {
      root: [
        question("q-live", "root", {
          messageID: "msg-question",
          callID: "call-question",
        }),
      ],
    }
    const messages = {
      root: [assistant("msg-question", "root"), user("msg-system", "root")],
    }
    const parts = {
      "msg-question": [questionToolPart({ messageID: "msg-question", status: "running" })],
      "msg-system": [textPart("msg-system", true)],
    }

    expect(
      sessionQuestionRequest(sessions, requests, "root", (item) => isQuestionRequestActive(messages, parts, item)),
    )?.toMatchObject({ id: "q-live" })
  })
})

describe("todoState", () => {
  test("hides when there are no todos", () => {
    expect(todoState({ count: 0, done: false, live: true })).toBe("hide")
  })

  test("opens while the session is still working", () => {
    expect(todoState({ count: 2, done: false, live: true })).toBe("open")
  })

  test("closes completed todos after a running turn", () => {
    expect(todoState({ count: 2, done: true, live: true })).toBe("close")
  })

  test("clears stale todos when the turn ends", () => {
    expect(todoState({ count: 2, done: false, live: false })).toBe("clear")
  })

  test("clears completed todos when the session is no longer live", () => {
    expect(todoState({ count: 2, done: true, live: false })).toBe("clear")
  })
})

describe("permission reply stale request handling", () => {
  test("recognizes matching missing permission request errors", () => {
    expect(
      isPermissionRequestNotFoundError(
        new Error("Permission request not found: per_123"),
        "per_123",
      ),
    ).toBe(true)
    expect(
      isPermissionRequestNotFoundError(
        new Error("Permission request not found: per_other"),
        "per_123",
      ),
    ).toBe(false)
    expect(isPermissionRequestNotFoundError(new Error("Network failed"), "per_123")).toBe(false)
  })

  test("removes only the stale permission request", () => {
    expect(
      removePermissionRequest(
        [
          permission("per_1", "root"),
          permission("per_2", "root"),
        ],
        "per_1",
      ).map((item) => item.id),
    ).toEqual(["per_2"])
    expect(removePermissionRequest(undefined, "per_1")).toEqual([])
  })
})
