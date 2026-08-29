import { describe, expect, test } from "bun:test"
import type { Message } from "@opencode-ai/sdk/v2"
import { messageDurationMs, messageIDsEndingAtGroups, messageModelRef } from "./message-timing"

const message = (role: "user" | "assistant", created: number, completed?: number) =>
  ({ role, time: { created, completed } }) as Message

describe("messageDurationMs", () => {
  test("uses the completed timestamp for a finished assistant message", () => {
    expect(messageDurationMs(message("assistant", 1_000, 4_250), 9_000)).toBe(3_250)
  })

  test("uses the current time for an unfinished assistant message", () => {
    expect(messageDurationMs(message("assistant", 1_000), 4_500)).toBe(3_500)
  })

  test("only adds a user-message duration when live timing is requested", () => {
    const user = message("user", 1_000)
    expect(messageDurationMs(user, 4_500)).toBeUndefined()
    expect(messageDurationMs(user, 4_500, true)).toBe(3_500)
  })

  test("ignores timestamps that end before they start", () => {
    expect(messageDurationMs(message("assistant", 4_000, 3_000), 9_000)).toBeUndefined()
  })
})

describe("messageModelRef", () => {
  test("reads provider and model IDs from a user message", () => {
    const user = {
      role: "user",
      model: { providerID: "openai", modelID: "gpt-5.6-sol" },
    } as Message

    expect(messageModelRef(user)).toEqual({ providerID: "openai", modelID: "gpt-5.6-sol" })
  })

  test("reads provider and model IDs from an assistant message", () => {
    const assistant = {
      role: "assistant",
      providerID: "openai",
      modelID: "gpt-5.6-luna",
    } as Message

    expect(messageModelRef(assistant)).toEqual({ providerID: "openai", modelID: "gpt-5.6-luna" })
  })
})

describe("messageIDsEndingAtGroups", () => {
  test("places each message after its final visible group", () => {
    const result = messageIDsEndingAtGroups([
      { key: "first", type: "part", ref: { messageID: "msg_1" } },
      {
        key: "context",
        type: "context",
        refs: [{ messageID: "msg_1" }, { messageID: "msg_2" }],
      },
      { key: "last", type: "part", ref: { messageID: "msg_2" } },
    ])

    expect(result.get("first")).toBeUndefined()
    expect(result.get("context")).toEqual(["msg_1"])
    expect(result.get("last")).toEqual(["msg_2"])
  })
})
