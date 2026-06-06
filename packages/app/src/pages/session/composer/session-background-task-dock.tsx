import { For, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import { useNavigate } from "@solidjs/router"
import { DockTray } from "@opencode-ai/ui/dock-surface"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { useSync } from "@/context/sync"
import { useSessionKey } from "@/pages/session/session-layout"
import {
  backgroundTaskActivityLabel,
  countBackgroundTasks,
  deriveFallbackBackgroundTasks,
  deriveMessageFallbackBackgroundTasks,
  formatBackgroundTaskElapsed,
  formatBackgroundTaskModel,
  formatBackgroundTaskRetry,
  isActiveBackgroundTask,
  mergeBackgroundTaskSnapshots,
  readBackgroundTasksMetadata,
  resolveRootSession,
  shouldShowBackgroundTaskDock,
  sortBackgroundTasksForDock,
  type BackgroundTaskSnapshot,
  type BackgroundTaskStatus,
} from "@/pages/session/background-task-metadata"

function statusLabel(status: BackgroundTaskStatus): string {
  if (status === "interrupt") return "interrupted"
  return status
}

function statusDotClass(status: BackgroundTaskStatus): string {
  if (status === "running") return "bg-icon-success-base"
  if (status === "pending") return "bg-icon-warning-base"
  if (status === "error" || status === "interrupt") return "bg-icon-critical-base"
  return "bg-icon-weak-base"
}

function summaryText(tasks: BackgroundTaskSnapshot[]): string {
  const counts = countBackgroundTasks(tasks)
  const parts = [
    counts.running > 0 ? `${counts.running} running` : undefined,
    counts.pending > 0 ? `${counts.pending} pending` : undefined,
    counts.error + counts.interrupt > 0 ? `${counts.error + counts.interrupt} error` : undefined,
    counts.cancelled > 0 ? `${counts.cancelled} cancelled` : undefined,
    counts.completed > 0 ? `${counts.completed} done` : undefined,
  ].filter(Boolean)
  return parts.join(" / ")
}

function taskRows(tasks: BackgroundTaskSnapshot[], expanded: boolean): BackgroundTaskSnapshot[] {
  const sorted = sortBackgroundTasksForDock(tasks)
  return expanded || sorted.length <= 3 ? sorted : sorted.slice(0, 3)
}

function sessionLinkLabel(task: BackgroundTaskSnapshot): string {
  return task.sessionId ? "open" : "queued"
}

export function SessionBackgroundTaskDock() {
  const route = useSessionKey()
  const sync = useSync()
  const navigate = useNavigate()
  const [expanded, setExpanded] = createSignal(false)
  const [now, setNow] = createSignal(Date.now())
  const requestedFallbackSessions = new Set<string>()

  const rootSession = createMemo(() =>
    resolveRootSession(route.params.id, (sessionID) => sync.session.get(sessionID)),
  )
  const metadata = createMemo(() => readBackgroundTasksMetadata(rootSession()?.metadata))
  const metadataVisible = createMemo(() => shouldShowBackgroundTaskDock(metadata(), now()))
  const sessionStatusFallbackTasks = createMemo(() =>
    deriveFallbackBackgroundTasks({
      rootSessionId: rootSession()?.id,
      sessions: sync.data.session,
      statuses: sync.data.session_status,
      messages: sync.data.message,
      now: now(),
    }),
  )
  const messageFallbackTasks = createMemo(() =>
    deriveMessageFallbackBackgroundTasks({
      rootSessionId: rootSession()?.id,
      sessions: sync.data.session,
      statuses: sync.data.session_status,
      messages: sync.data.message,
      parts: sync.data.part,
      now: now(),
    }),
  )
  const fallbackTasks = createMemo(() =>
    mergeBackgroundTaskSnapshots(messageFallbackTasks(), sessionStatusFallbackTasks()),
  )
  const tasks = createMemo(() =>
    mergeBackgroundTaskSnapshots(metadataVisible() ? metadata()?.tasks ?? [] : [], fallbackTasks()),
  )
  const visible = createMemo(() => metadataVisible() || fallbackTasks().length > 0)
  const compact = createMemo(() => tasks().length > 3 && !expanded())
  const rows = createMemo(() => taskRows(tasks(), expanded()))
  const batchKey = createMemo(() => `${rootSession()?.id ?? ""}:${tasks().map((task) => task.id).join(",")}`)

  createEffect(() => {
    batchKey()
    setExpanded(false)
  })

  createEffect(() => {
    if (!visible()) return
    const timer = window.setInterval(() => setNow(Date.now()), 1_000)
    onCleanup(() => window.clearInterval(timer))
  })

  createEffect(() => {
    for (const task of fallbackTasks()) {
      const sessionID = task.sessionId
      if (!sessionID) continue
      if (sync.data.message[sessionID]?.length) continue
      if (requestedFallbackSessions.has(sessionID)) continue
      requestedFallbackSessions.add(sessionID)
      void sync.session.sync(sessionID).catch(() => undefined)
    }
  })

  const openTaskSession = (task: BackgroundTaskSnapshot) => {
    if (!task.sessionId) return
    navigate(`/${route.params.dir}/session/${task.sessionId}`)
  }

  return (
    <Show when={visible()}>
      <div class="pb-2">
        <DockTray
          data-action="background-task-dock"
          data-component="session-background-task-dock"
          style={{
            "overflow-x": "hidden",
            "overflow-y": "hidden",
          }}
        >
          <div class="px-3 py-2 flex items-center gap-2 min-w-0">
            <span class="shrink-0 text-13-medium text-text-strong cursor-default">Background agents</span>
            <span class="min-w-0 flex-1 truncate text-12-regular text-text-weak cursor-default">
              {summaryText(tasks())}
            </span>
            <Show when={tasks().length > 3}>
              <IconButton
                data-action="background-task-dock-toggle"
                data-expanded={expanded() ? "true" : "false"}
                icon="chevron-down"
                size="normal"
                variant="ghost"
                style={{ transform: `rotate(${expanded() ? 180 : 0}deg)` }}
                aria-label={expanded() ? "Collapse background agents" : "Expand background agents"}
                onClick={() => setExpanded((value) => !value)}
              />
            </Show>
          </div>

          <div class="px-3 pb-3 flex flex-col gap-1.5 max-h-48 overflow-y-auto no-scrollbar">
            <For each={rows()}>
              {(task) => (
                <div
                  data-background-task-id={task.id}
                  data-background-task-status={task.status}
                  class="min-w-0 flex items-start gap-2 rounded-md border border-border-weak-base bg-background-base/45 px-2.5 py-2"
                >
                  <span
                    aria-hidden="true"
                    class={`mt-1.5 size-1.5 shrink-0 rounded-full ${statusDotClass(task.status)}`}
                    style={{
                      animation: isActiveBackgroundTask(task) ? "var(--animate-pulse-scale)" : undefined,
                    }}
                  />
                  <div class="min-w-0 flex-1">
                    <div class="min-w-0 flex items-baseline gap-1.5">
                      <span class="shrink-0 text-12-medium text-text-strong">{task.agent}</span>
                      <span class="min-w-0 truncate text-12-regular text-text-base">{task.description}</span>
                    </div>
                    <div class="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-11-regular text-text-weak">
                      <span class="capitalize">{statusLabel(task.status)}</span>
                      <span class="max-w-full truncate">{formatBackgroundTaskModel(task)}</span>
                      <span>{formatBackgroundTaskElapsed(task, now())}</span>
                      <Show when={task.retryCount > 0}>
                        <span>{formatBackgroundTaskRetry(task)}</span>
                      </Show>
                      <Show when={backgroundTaskActivityLabel(task)}>
                        {(activity) => <span class="max-w-full truncate">{activity()}</span>}
                      </Show>
                    </div>
                    <Show when={task.error}>
                      {(error) => <div class="mt-1 truncate text-11-regular text-text-danger-base">{error()}</div>}
                    </Show>
                  </div>
                  <button
                    type="button"
                    data-action="background-task-session-link"
                    disabled={!task.sessionId}
                    class="shrink-0 rounded px-1.5 py-0.5 text-11-medium text-text-weak transition-colors hover:text-text-strong disabled:cursor-default disabled:opacity-55 disabled:hover:text-text-weak"
                    onClick={() => openTaskSession(task)}
                  >
                    {sessionLinkLabel(task)}
                  </button>
                </div>
              )}
            </For>

            <Show when={compact()}>
              <div class="px-2 pt-0.5 text-11-regular text-text-weak">
                {tasks().length - rows().length} more background agents
              </div>
            </Show>
          </div>
        </DockTray>
      </div>
    </Show>
  )
}
