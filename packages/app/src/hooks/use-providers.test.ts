import { describe, expect, test } from "bun:test"
import { hasProviderVariantCoverage } from "./provider-freshness"

describe("provider freshness", () => {
  test("accepts project providers with the same variants as global providers", () => {
    expect(
      hasProviderVariantCoverage(
        {
          models: {
            "gpt-5.5": { variants: { low: {}, medium: {}, high: {}, xhigh: {} } },
          },
        },
        {
          models: {
            "gpt-5.5": { variants: { low: {}, medium: {}, high: {}, xhigh: {} } },
          },
        },
      ),
    ).toBe(true)
  })

  test("rejects stale project providers that are missing global variants", () => {
    expect(
      hasProviderVariantCoverage(
        {
          models: {
            "gpt-5.5": { variants: { low: {}, medium: {}, high: {}, xhigh: {} } },
          },
        },
        {
          models: {
            "gpt-5.5": { variants: {} },
          },
        },
      ),
    ).toBe(false)
  })

  test("ignores models that do not expose variants", () => {
    expect(
      hasProviderVariantCoverage(
        {
          models: {
            "claude-sonnet": { variants: {} },
          },
        },
        {
          models: {
            "claude-sonnet": { variants: {} },
          },
        },
      ),
    ).toBe(true)
  })
})
