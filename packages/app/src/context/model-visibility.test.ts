import { describe, expect, test } from "bun:test"
import { isModelVisibleInSelector } from "./model-visibility"

describe("isModelVisibleInSelector", () => {
  test("keeps the current model visible even when it is hidden by default", () => {
    const result = isModelVisibleInSelector(
      { providerID: "github-copilot", modelID: "gpt-5.4" },
      false,
      { providerID: "github-copilot", modelID: "gpt-5.4" },
    )

    expect(result).toBe(true)
  })

  test("keeps existing visibility decisions for non-current models", () => {
    const hidden = isModelVisibleInSelector(
      { providerID: "github-copilot", modelID: "gpt-5.4" },
      false,
      { providerID: "github-copilot", modelID: "gpt-5.5" },
    )
    const shown = isModelVisibleInSelector(
      { providerID: "github-copilot", modelID: "gpt-5.4" },
      true,
      { providerID: "github-copilot", modelID: "gpt-5.5" },
    )

    expect(hidden).toBe(false)
    expect(shown).toBe(true)
  })
})