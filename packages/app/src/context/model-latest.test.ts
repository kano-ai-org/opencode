import { describe, expect, test } from "bun:test"
import { DateTime } from "luxon"
import { pickLatestModels } from "./model-latest"

describe("pickLatestModels", () => {
  test("keeps all tied newest models in the same provider family", () => {
    const result = pickLatestModels(
      [
        {
          providerID: "minimax",
          modelID: "MiniMax-M2.7",
          family: "minimax",
          release_date: "2026-03-18",
        },
        {
          providerID: "minimax",
          modelID: "MiniMax-M2.7-highspeed",
          family: "minimax",
          release_date: "2026-03-18",
        },
        {
          providerID: "minimax",
          modelID: "MiniMax-M2.5",
          family: "minimax",
          release_date: "2026-02-12",
        },
      ],
      DateTime.fromISO("2026-03-24"),
    )

    expect(result).toEqual([
      { providerID: "minimax", modelID: "MiniMax-M2.7" },
      { providerID: "minimax", modelID: "MiniMax-M2.7-highspeed" },
    ])
  })

  test("ignores stale models older than six months", () => {
    const result = pickLatestModels(
      [
        {
          providerID: "openai",
          modelID: "gpt-old",
          family: "gpt",
          release_date: "2025-01-01",
        },
      ],
      DateTime.fromISO("2026-03-24"),
    )

    expect(result).toEqual([])
  })
})
