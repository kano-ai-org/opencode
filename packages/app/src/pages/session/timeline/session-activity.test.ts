import { describe, expect, test } from "bun:test"
import type { Session, SessionStatus } from "@opencode-ai/sdk/v2"
import { aggregateSessionActivity } from "./session-activity"

const session = (id: string, parentID?: string, updated = 1): Session => ({
  id,
  slug: id,
  projectID: "project",
  directory: "/repo",
  parentID,
  title: id,
  version: "test",
  time: { created: 1, updated },
})

describe("session activity", () => {
  test("reports an idle parent waiting on active descendants", () => {
    const sessions = {
      parent: session("parent", undefined, 10),
      child: session("child", "parent", 30),
      nested: session("nested", "child", 40),
      unrelated: session("unrelated", undefined, 50),
    }
    const statuses: Record<string, SessionStatus> = {
      child: { type: "busy" },
      nested: { type: "retry", attempt: 2, message: "retry", next: 100 },
      unrelated: { type: "busy" },
    }

    const result = aggregateSessionActivity({ sessionID: "parent", sessions, statuses })

    expect(result.kind).toBe("waiting")
    expect(result.descendants.map((item) => item.info.id)).toEqual(["nested", "child"])
    expect(result.lastUpdated).toBe(40)
  })

  test("prioritizes the parent execution state", () => {
    const sessions = {
      parent: session("parent", undefined, 10),
      child: session("child", "parent", 20),
    }

    expect(
      aggregateSessionActivity({
        sessionID: "parent",
        sessions,
        statuses: { parent: { type: "busy" }, child: { type: "busy" } },
      }).kind,
    ).toBe("working")

    expect(
      aggregateSessionActivity({
        sessionID: "parent",
        sessions,
        statuses: { parent: { type: "retry", attempt: 1, message: "retry", next: 100 } },
      }).kind,
    ).toBe("retrying")
  })

  test("stays idle when no related session is active", () => {
    const result = aggregateSessionActivity({
      sessionID: "parent",
      sessions: { parent: session("parent", undefined, 10), unrelated: session("unrelated", undefined, 20) },
      statuses: { unrelated: { type: "busy" } },
    })

    expect(result.kind).toBe("idle")
    expect(result.descendants).toEqual([])
    expect(result.lastUpdated).toBe(10)
  })

  test("does not loop on malformed parent cycles", () => {
    const result = aggregateSessionActivity({
      sessionID: "parent",
      sessions: {
        parent: session("parent"),
        a: session("a", "b"),
        b: session("b", "a"),
      },
      statuses: { a: { type: "busy" } },
    })

    expect(result.descendants).toEqual([])
  })
})
