import { describe, expect, test } from "bun:test"
import {
  backgroundTaskActivityLabel,
  countBackgroundTasks,
  formatBackgroundTaskElapsed,
  formatBackgroundTaskModel,
  formatBackgroundTaskRetry,
  readBackgroundTasksMetadata,
  resolveRootSession,
  shouldShowBackgroundTaskDock,
  sortBackgroundTasksForDock,
  type BackgroundTaskSnapshot,
} from "./background-task-metadata"

function metadata(tasks: BackgroundTaskSnapshot[], allCompleteAt?: string) {
  return {
    ohMyOpenAgent: {
      backgroundTasks: {
        version: 1,
        rootSessionId: "ses_root",
        updatedAt: "2026-06-05T00:00:00.000Z",
        ...(allCompleteAt ? { allCompleteAt } : {}),
        tasks,
      },
    },
  }
}

function task(input: Partial<BackgroundTaskSnapshot> = {}): BackgroundTaskSnapshot {
  return {
    id: "bg_1",
    sessionId: "ses_child",
    parentSessionId: "ses_root",
    rootSessionId: "ses_root",
    parentMessageId: "msg_parent",
    description: "Research provider quotas",
    agent: "oracle",
    status: "running",
    model: { providerID: "openai", modelID: "gpt-5", variant: "high" },
    queuedAt: "2026-06-05T00:00:00.000Z",
    startedAt: "2026-06-05T00:00:10.000Z",
    elapsedMs: 20_000,
    retryCount: 2,
    progress: {
      toolCalls: 3,
      lastTool: "rg",
      lastUpdate: "2026-06-05T00:00:25.000Z",
    },
    attempts: [],
    ...input,
  }
}

describe("background task metadata parser", () => {
  test("accepts valid v1 metadata", () => {
    const parsed = readBackgroundTasksMetadata(metadata([task()]))

    expect(parsed?.rootSessionId).toBe("ses_root")
    expect(parsed?.tasks[0]?.model).toEqual({ providerID: "openai", modelID: "gpt-5", variant: "high" })
    expect(parsed?.tasks[0]?.retryCount).toBe(2)
  })

  test("treats missing or malformed metadata as empty state", () => {
    expect(readBackgroundTasksMetadata(undefined)).toBeUndefined()
    expect(readBackgroundTasksMetadata({ ohMyOpenAgent: { backgroundTasks: { version: 2 } } })).toBeUndefined()
    expect(readBackgroundTasksMetadata({ ohMyOpenAgent: { backgroundTasks: { version: 1, tasks: "bad" } } })).toBeUndefined()
  })

  test("resolves the root parent session", () => {
    const sessions = new Map([
      ["ses_root", { id: "ses_root" }],
      ["ses_child", { id: "ses_child", parentID: "ses_root" }],
      ["ses_nested", { id: "ses_nested", parentID: "ses_child" }],
    ])

    expect(resolveRootSession("ses_nested", (id) => sessions.get(id))?.id).toBe("ses_root")
  })

  test("visibility stays while active and briefly after all complete", () => {
    const active = readBackgroundTasksMetadata(metadata([task({ status: "pending" })]))
    const recentComplete = readBackgroundTasksMetadata(metadata([
      task({ status: "completed", completedAt: "2026-06-05T00:00:03.000Z" }),
    ], "2026-06-05T00:00:03.000Z"))
    const staleComplete = readBackgroundTasksMetadata(metadata([
      task({ status: "completed", completedAt: "2026-06-05T00:00:03.000Z" }),
    ], "2026-06-05T00:00:03.000Z"))

    expect(shouldShowBackgroundTaskDock(active, Date.parse("2026-06-05T00:00:10.000Z"))).toBe(true)
    expect(shouldShowBackgroundTaskDock(recentComplete, Date.parse("2026-06-05T00:00:06.000Z"))).toBe(true)
    expect(shouldShowBackgroundTaskDock(staleComplete, Date.parse("2026-06-05T00:00:10.000Z"))).toBe(false)
    expect(shouldShowBackgroundTaskDock(readBackgroundTasksMetadata(metadata([])))).toBe(false)
  })

  test("formats dock row details", () => {
    const item = task()

    expect(formatBackgroundTaskModel(item)).toBe("openai/gpt-5:high")
    expect(formatBackgroundTaskRetry(item)).toBe("2 retries")
    expect(formatBackgroundTaskElapsed(item, Date.parse("2026-06-05T00:00:45.000Z"))).toBe("35s")
    expect(backgroundTaskActivityLabel(item)).toBe("tool: rg")
  })

  test("counts and sorts tasks by dock priority", () => {
    const tasks = [
      task({ id: "bg_done", status: "completed" }),
      task({ id: "bg_running", status: "running" }),
      task({ id: "bg_error", status: "error" }),
      task({ id: "bg_pending", status: "pending" }),
    ]

    expect(countBackgroundTasks(tasks)).toMatchObject({ completed: 1, running: 1, error: 1, pending: 1 })
    expect(sortBackgroundTasksForDock(tasks).map((item) => item.id)).toEqual([
      "bg_error",
      "bg_running",
      "bg_pending",
      "bg_done",
    ])
  })
})
