import { describe, expect, test } from "bun:test"
import { newLayoutDesignsDefault } from "./settings"

describe("settings defaults", () => {
  test("keeps the legacy desktop layout enabled by default", () => {
    expect(newLayoutDesignsDefault).toBe(false)
  })
})
