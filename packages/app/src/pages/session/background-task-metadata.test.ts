import { describe, expect, test } from "bun:test"
import {
  backgroundTaskActivityLabel,
  countBackgroundTasks,
  deriveFallbackBackgroundTasks,
  deriveMessageFallbackBackgroundTasks,
  formatBackgroundTaskElapsed,
  formatBackgroundTaskModel,
  formatBackgroundTaskRetry,
  mergeBackgroundTaskSnapshots,
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

  test("derives active fallback tasks from loaded session tree", () => {
    const tasks = deriveFallbackBackgroundTasks({
      rootSessionId: "ses_root",
      sessions: [
        {
          id: "ses_root",
          title: "Root session",
          time: { created: 10, updated: 20 },
        },
        {
          id: "ses_child_busy",
          parentID: "ses_root",
          title: "Research Meshy API (@librarian subagent)",
          time: { created: Date.parse("2026-06-05T00:00:00.000Z"), updated: Date.parse("2026-06-05T00:00:20.000Z") },
        },
        {
          id: "ses_child_retry",
          parentID: "ses_root",
          title: "Map blockers (@explore subagent)",
          time: { created: Date.parse("2026-06-05T00:00:10.000Z"), updated: Date.parse("2026-06-05T00:00:30.000Z") },
        },
        {
          id: "ses_idle",
          parentID: "ses_root",
          title: "Idle child",
          time: { created: 10, updated: 20 },
        },
      ] as any,
      statuses: {
        ses_child_busy: { type: "busy" },
        ses_child_retry: { type: "retry", attempt: 3, message: "waiting for retry", next: Date.now() + 1000 },
        ses_idle: { type: "idle" },
      },
      messages: {
        ses_child_busy: [
          {
            role: "user",
            model: { providerID: "openai", modelID: "gpt-5", variant: "high" },
          },
        ] as any,
      },
      now: Date.parse("2026-06-05T00:00:40.000Z"),
    })

    expect(tasks.map((item) => item.sessionId)).toEqual(["ses_child_busy", "ses_child_retry"])
    expect(tasks[0]).toMatchObject({
      description: "Research Meshy API",
      agent: "librarian",
      model: { providerID: "openai", modelID: "gpt-5", variant: "high" },
    })
    expect(tasks[1]).toMatchObject({
      description: "Map blockers",
      agent: "explore",
      retryCount: 2,
      progress: { lastMessage: "waiting for retry" },
    })
  })

  test("prefers metadata task rows over fallback duplicates", () => {
    const merged = mergeBackgroundTaskSnapshots(
      [task({ id: "bg_meta", sessionId: "ses_child" })],
      [
        task({ id: "session:ses_child", sessionId: "ses_child" }),
        task({ id: "session:ses_other", sessionId: "ses_other" }),
      ],
    )

    expect(merged.map((item) => item.id)).toEqual(["bg_meta", "session:ses_other"])
  })

  test("merges placeholder tool rows with the matching active child session", () => {
    const merged = mergeBackgroundTaskSnapshots(
      [
        task({
          id: "part:msg_parent:prt_tool",
          sessionId: undefined,
          description: "Implement T5 coverage",
          agent: "subagent",
          model: undefined,
          category: "unspecified-high",
          status: "running",
          queuedAt: "2026-06-05T00:00:00.000Z",
          startedAt: "2026-06-05T00:00:00.000Z",
          elapsedMs: 45_000,
          attempts: [],
        }),
      ],
      [
        task({
          id: "session:ses_child",
          sessionId: "ses_child",
          description: "Implement T5 coverage",
          agent: "Sisyphus-Junior",
          model: { providerID: "openai", modelID: "gpt-5.5", variant: "max" },
          queuedAt: "2026-06-05T00:00:01.000Z",
          startedAt: "2026-06-05T00:00:01.000Z",
          elapsedMs: 44_000,
          attempts: [
            {
              attemptId: "attempt:ses_child",
              attemptNumber: 1,
              sessionId: "ses_child",
              providerID: "openai",
              modelID: "gpt-5.5",
              variant: "max",
              status: "running",
              startedAt: "2026-06-05T00:00:01.000Z",
            },
          ],
        }),
      ],
    )

    expect(merged).toHaveLength(1)
    expect(merged[0]).toMatchObject({
      id: "part:msg_parent:prt_tool",
      sessionId: "ses_child",
      description: "Implement T5 coverage",
      agent: "Sisyphus-Junior",
      status: "running",
      model: { providerID: "openai", modelID: "gpt-5.5", variant: "max" },
    })
    expect(merged[0]?.attempts).toHaveLength(1)
  })

  test("keeps ambiguous placeholder rows when multiple child sessions match", () => {
    const placeholder = task({
      id: "part:msg_parent:prt_tool",
      sessionId: undefined,
      description: "Implement T5 coverage",
      agent: "subagent",
      model: undefined,
      queuedAt: "2026-06-05T00:00:00.000Z",
      startedAt: "2026-06-05T00:00:00.000Z",
    })
    const firstChild = task({
      id: "session:ses_child_a",
      sessionId: "ses_child_a",
      description: "Implement T5 coverage",
      agent: "Sisyphus-Junior",
      queuedAt: "2026-06-05T00:00:01.000Z",
      startedAt: "2026-06-05T00:00:01.000Z",
    })
    const secondChild = task({
      id: "session:ses_child_b",
      sessionId: "ses_child_b",
      description: "Implement T5 coverage",
      agent: "Sisyphus-Junior",
      queuedAt: "2026-06-05T00:00:02.000Z",
      startedAt: "2026-06-05T00:00:02.000Z",
    })

    const merged = mergeBackgroundTaskSnapshots([placeholder], [firstChild, secondChild])

    expect(merged.map((item) => item.id)).toEqual([
      "part:msg_parent:prt_tool",
      "session:ses_child_a",
      "session:ses_child_b",
    ])
  })

  test("derives current-turn tasks from tool parts when session status is idle", () => {
    const tasks = deriveMessageFallbackBackgroundTasks({
      rootSessionId: "ses_root",
      sessions: [
        {
          id: "ses_root",
          title: "Root session",
          time: { created: Date.parse("2026-06-06T00:00:00.000Z"), updated: Date.parse("2026-06-06T00:05:00.000Z") },
        },
      ] as any,
      statuses: {},
      messages: {
        ses_root: [
          {
            id: "msg_old_user",
            role: "user",
            time: { created: Date.parse("2026-06-06T00:00:05.000Z") },
          },
          {
            id: "msg_old_assistant",
            role: "assistant",
            parentID: "msg_old_user",
            time: {
              created: Date.parse("2026-06-06T00:00:10.000Z"),
              completed: Date.parse("2026-06-06T00:00:40.000Z"),
            },
          },
          {
            id: "msg_user",
            role: "user",
            time: { created: Date.parse("2026-06-06T00:01:00.000Z") },
          },
          {
            id: "msg_assistant",
            role: "assistant",
            parentID: "msg_user",
            time: { created: Date.parse("2026-06-06T00:01:05.000Z") },
          },
        ] as any,
      },
      parts: {
        msg_old_assistant: [
          {
            id: "prt_old",
            type: "tool",
            tool: "task",
            state: {
              status: "completed",
              input: { description: "Old batch task", subagent_type: "oracle" },
              output: "Background task launched.\nBackground Task ID: bg_old\nSession ID: ses_old\nDescription: Old batch task\nAgent: oracle\nStatus: pending",
            },
          },
        ] as any,
        msg_assistant: [
          {
            id: "prt_review",
            type: "tool",
            tool: "task",
            state: {
              status: "completed",
              input: { description: "Wire T4 workflow", category: "unspecified-high" },
              output:
                "Task completed in 13m 31s.\n\nAgent: Sisyphus-Junior (category: unspecified-high)\nModel: openai/gpt-5.5\n\nReview agents are running in the background.\n\n<task_metadata>\nsession_id: ses_child\ntask_id: ses_child\nsubagent: Sisyphus-Junior\ncategory: unspecified-high\n</task_metadata>",
              metadata: {
                sessionId: "ses_child",
                taskId: "ses_child",
                description: "Wire T4 workflow",
                agent: "Sisyphus-Junior",
                category: "unspecified-high",
                model: { providerID: "openai", modelID: "gpt-5.5" },
              },
            },
          },
          {
            id: "prt_running",
            type: "tool",
            tool: "task",
            state: {
              status: "running",
              input: { description: "Plan blocker fixes", subagent_type: "plan" },
            },
          },
        ] as any,
      },
      now: Date.parse("2026-06-06T00:05:30.000Z"),
    })

    expect(tasks.map((item) => item.description)).toEqual(["Wire T4 workflow", "Plan blocker fixes"])
    expect(tasks[0]).toMatchObject({
      sessionId: "ses_child",
      agent: "Sisyphus-Junior",
      status: "running",
      model: { providerID: "openai", modelID: "gpt-5.5" },
    })
    expect(tasks[1]).toMatchObject({
      agent: "plan",
      status: "running",
    })
  })

  test("derives nested background launches from loaded child session messages", () => {
    const tasks = deriveMessageFallbackBackgroundTasks({
      rootSessionId: "ses_root",
      sessions: [
        {
          id: "ses_root",
          title: "Root session",
          time: { created: Date.parse("2026-06-06T00:00:00.000Z"), updated: Date.parse("2026-06-06T00:05:00.000Z") },
        },
        {
          id: "ses_child",
          parentID: "ses_root",
          title: "Wire T4 workflow (@Sisyphus-Junior subagent)",
          time: { created: Date.parse("2026-06-06T00:01:10.000Z"), updated: Date.parse("2026-06-06T00:05:10.000Z") },
        },
      ] as any,
      statuses: {},
      messages: {
        ses_root: [
          {
            id: "msg_root_user",
            role: "user",
            time: { created: Date.parse("2026-06-06T00:01:00.000Z") },
          },
          {
            id: "msg_root_assistant",
            role: "assistant",
            parentID: "msg_root_user",
            time: { created: Date.parse("2026-06-06T00:01:05.000Z") },
          },
        ] as any,
        ses_child: [
          {
            id: "msg_child_user",
            role: "user",
            time: { created: Date.parse("2026-06-06T00:01:15.000Z") },
          },
          {
            id: "msg_child_assistant",
            role: "assistant",
            parentID: "msg_child_user",
            time: {
              created: Date.parse("2026-06-06T00:01:20.000Z"),
              completed: Date.parse("2026-06-06T00:01:40.000Z"),
            },
          },
        ] as any,
      },
      parts: {
        msg_root_assistant: [
          {
            id: "prt_root_task",
            type: "tool",
            tool: "task",
            state: {
              status: "completed",
              input: { description: "Wire T4 workflow", category: "unspecified-high" },
              output:
                "Task completed.\nReview agents are running in the background.\n<task_metadata>\nsession_id: ses_child\ntask_id: ses_child\nsubagent: Sisyphus-Junior\ncategory: unspecified-high\n</task_metadata>",
              metadata: {
                sessionId: "ses_child",
                taskId: "ses_child",
                description: "Wire T4 workflow",
                agent: "Sisyphus-Junior",
                category: "unspecified-high",
              },
            },
          },
        ] as any,
        msg_child_assistant: [
          {
            id: "prt_nested_launch",
            type: "tool",
            tool: "call_omo_agent",
            state: {
              status: "completed",
              input: { description: "Explore T4 blockers" },
              output:
                "Background agent task launched successfully.\nTask ID: bg_nested\nSession ID: ses_nested\nDescription: Explore T4 blockers\nAgent: explore (subagent)\nStatus: pending",
            },
          },
        ] as any,
      },
      now: Date.parse("2026-06-06T00:05:30.000Z"),
    })

    expect(tasks.map((item) => item.description)).toEqual(["Explore T4 blockers"])
    expect(tasks[0]).toMatchObject({
      id: "bg_nested",
      sessionId: "ses_nested",
      agent: "explore",
      status: "pending",
    })
  })

  test("uses child session model when launch output has no model metadata", () => {
    const tasks = deriveMessageFallbackBackgroundTasks({
      rootSessionId: "ses_root",
      sessions: [
        {
          id: "ses_root",
          title: "Root session",
          time: { created: Date.parse("2026-06-06T00:00:00.000Z"), updated: Date.parse("2026-06-06T00:01:00.000Z") },
        },
        {
          id: "ses_child",
          parentID: "ses_root",
          title: "Explore T5 context (@explore subagent)",
          model: { id: "MiniMax-M3", providerID: "minimax" },
          time: { created: Date.parse("2026-06-06T00:00:10.000Z"), updated: Date.parse("2026-06-06T00:00:30.000Z") },
        },
      ] as any,
      statuses: {},
      messages: {
        ses_root: [
          {
            id: "msg_user",
            role: "user",
            time: { created: Date.parse("2026-06-06T00:00:00.000Z") },
          },
          {
            id: "msg_assistant",
            role: "assistant",
            parentID: "msg_user",
            time: {
              created: Date.parse("2026-06-06T00:00:05.000Z"),
              completed: Date.parse("2026-06-06T00:00:06.000Z"),
            },
          },
        ] as any,
      },
      parts: {
        msg_assistant: [
          {
            id: "prt_launch",
            type: "tool",
            tool: "call_omo_agent",
            state: {
              status: "completed",
              input: { description: "Explore T5 context" },
              output:
                "Background agent task launched successfully.\nTask ID: bg_context\nSession ID: ses_child\nDescription: Explore T5 context\nAgent: explore (subagent)\nStatus: pending",
            },
          },
        ] as any,
      },
      now: Date.parse("2026-06-06T00:00:33.000Z"),
    })

    expect(tasks).toHaveLength(1)
    expect(tasks[0]).toMatchObject({
      sessionId: "ses_child",
      status: "pending",
      model: { providerID: "minimax", modelID: "MiniMax-M3" },
    })
  })

  test("hides stale pending launch rows when the child session is inactive", () => {
    const tasks = deriveMessageFallbackBackgroundTasks({
      rootSessionId: "ses_root",
      sessions: [
        {
          id: "ses_root",
          title: "Root session",
          time: { created: Date.parse("2026-06-06T00:00:00.000Z"), updated: Date.parse("2026-06-06T00:10:00.000Z") },
        },
        {
          id: "ses_child",
          parentID: "ses_root",
          title: "Research Meshy contract (@librarian subagent)",
          model: { id: "MiniMax-M3", providerID: "minimax" },
          time: { created: Date.parse("2026-06-06T00:00:10.000Z"), updated: Date.parse("2026-06-06T00:01:00.000Z") },
        },
      ] as any,
      statuses: {},
      messages: {
        ses_root: [
          {
            id: "msg_user",
            role: "user",
            time: { created: Date.parse("2026-06-06T00:00:00.000Z") },
          },
          {
            id: "msg_assistant",
            role: "assistant",
            parentID: "msg_user",
            time: {
              created: Date.parse("2026-06-06T00:00:05.000Z"),
              completed: Date.parse("2026-06-06T00:00:06.000Z"),
            },
          },
        ] as any,
      },
      parts: {
        msg_assistant: [
          {
            id: "prt_launch",
            type: "tool",
            tool: "call_omo_agent",
            state: {
              status: "completed",
              input: { description: "Research Meshy contract" },
              output:
                "Background agent task launched successfully.\nTask ID: bg_contract\nSession ID: ses_child\nDescription: Research Meshy contract\nAgent: librarian (subagent)\nStatus: pending",
            },
          },
        ] as any,
      },
      now: Date.parse("2026-06-06T00:01:06.001Z"),
    })

    expect(tasks).toEqual([])
  })

  test("hides stale completed message-derived batches after retention", () => {
    const tasks = deriveMessageFallbackBackgroundTasks({
      rootSessionId: "ses_root",
      sessions: [
        {
          id: "ses_root",
          title: "Root session",
          time: { created: Date.parse("2026-06-06T00:00:00.000Z"), updated: Date.parse("2026-06-06T00:06:00.000Z") },
        },
      ] as any,
      statuses: {},
      messages: {
        ses_root: [
          {
            id: "msg_user",
            role: "user",
            time: { created: Date.parse("2026-06-06T00:01:00.000Z") },
          },
          {
            id: "msg_assistant",
            role: "assistant",
            parentID: "msg_user",
            time: {
              created: Date.parse("2026-06-06T00:01:05.000Z"),
              completed: Date.parse("2026-06-06T00:01:20.000Z"),
            },
          },
        ] as any,
      },
      parts: {
        msg_assistant: [
          {
            id: "prt_done",
            type: "tool",
            tool: "task",
            state: {
              status: "completed",
              input: { description: "Completed batch", subagent_type: "oracle" },
              output:
                "Background task launched.\nBackground Task ID: bg_done\nSession ID: ses_done\nDescription: Completed batch\nAgent: oracle\nStatus: completed",
              time: {
                start: Date.parse("2026-06-06T00:01:05.000Z"),
                end: Date.parse("2026-06-06T00:01:20.000Z"),
              },
            },
          },
        ] as any,
      },
      now: Date.parse("2026-06-06T00:01:30.500Z"),
    })

    expect(tasks).toEqual([])
  })
})
