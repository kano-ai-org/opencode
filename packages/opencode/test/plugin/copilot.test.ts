import { describe, expect, test } from "bun:test"
import { isCopilotAgentInitiatedMessage } from "../../src/plugin/copilot"

describe("copilot x-initiator detection", () => {
  test("treats internal marker user message as agent initiated", () => {
    expect(
      isCopilotAgentInitiatedMessage({
        role: "user",
        content: "search repo\n<!-- OMO_INTERNAL_INITIATOR -->",
      }),
    ).toBe(true)
  })

  test("treats normal user message as user initiated", () => {
    expect(
      isCopilotAgentInitiatedMessage({
        role: "user",
        content: "hello",
      }),
    ).toBe(false)
  })

  test("treats assistant message as agent initiated", () => {
    expect(
      isCopilotAgentInitiatedMessage({
        role: "assistant",
        content: "working",
      }),
    ).toBe(true)
  })
})
