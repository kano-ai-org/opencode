import { createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js"
import type { Session, SessionStatus } from "@opencode-ai/sdk/v2"
import { Icon } from "@opencode-ai/ui/icon"
import { Popover } from "@opencode-ai/ui/popover"
import { useLanguage } from "@/context/language"
import { useSync } from "@/context/sync"
import { getRelativeTime } from "@/utils/time"
import { aggregateSessionActivity } from "./session-activity"

const staleAfterMs = 5 * 60 * 1_000

function modelLabel(session: Session | undefined) {
  if (!session?.model) return
  return session.model.variant ? `${session.model.id} (${session.model.variant})` : session.model.id
}

export function SessionActivityIndicator(props: { sessionID: string; onOpenSession: (sessionID: string) => void }) {
  const sync = useSync()
  const language = useLanguage()
  const [now, setNow] = createSignal(Date.now())

  onMount(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 15_000)
    onCleanup(() => window.clearInterval(timer))
  })

  const activity = createMemo(() => {
    const statuses = sync().data.session_status
    const sessions: Record<string, Session | undefined> = {}
    const visited = new Set<string>()

    for (const sessionID of [props.sessionID, ...Object.keys(statuses)]) {
      let currentID: string | undefined = sessionID
      while (currentID && !visited.has(currentID)) {
        visited.add(currentID)
        const info = sync().session.get(currentID)
        sessions[currentID] = info
        currentID = info?.parentID
      }
    }

    return aggregateSessionActivity({ sessionID: props.sessionID, sessions, statuses })
  })
  const relativeTime = (updated: number | undefined) => {
    now()
    if (!updated) return language.t("common.unknown")
    return getRelativeTime(new Date(updated).toISOString(), (key, params) => language.t(key, params))
  }
  const summary = createMemo(() => {
    const current = activity()
    if (current.kind === "working") return language.t("session.activity.working")
    if (current.kind === "retrying") return language.t("session.activity.retrying")
    if (current.kind === "waiting") return language.t("session.activity.waiting", { count: current.descendants.length })
    return language.t("session.activity.idle")
  })
  const mobileSummary = createMemo(() => {
    const count = activity().descendants.length
    return count > 0 ? language.t("session.activity.activeShort", { count }) : summary()
  })
  const lastActivity = createMemo(() => relativeTime(activity().lastUpdated))
  const stale = createMemo(() => {
    const current = activity()
    if (current.kind === "idle" || !current.lastUpdated) return false
    return now() - current.lastUpdated >= staleAfterMs
  })
  const icon = createMemo(() => {
    const current = activity()
    if (current.descendants.length > 0) return "subagent" as const
    if (current.kind === "retrying") return "reset" as const
    if (current.kind === "working") return "brain" as const
    return "dash" as const
  })
  const statusLabel = (status: SessionStatus) => {
    if (status.type === "busy") return language.t("session.activity.working")
    if (status.type === "retry") return language.t("session.activity.retryAttempt", { attempt: status.attempt })
    return language.t("session.activity.idle")
  }

  return (
    <Popover
      placement="bottom-end"
      title={language.t("session.activity.title")}
      class="w-80 max-w-[calc(100vw-24px)]"
      triggerAs="button"
      triggerProps={{
        type: "button",
        "aria-label": `${summary()}. ${language.t("session.activity.lastActivity", { time: lastActivity() })}`,
        class:
          "h-7 min-w-7 max-w-56 shrink-0 items-center gap-1.5 rounded-md px-2 text-[12px] font-[530] leading-4 text-v2-text-text-muted transition-colors hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base",
      }}
      trigger={
        <>
          <span class="relative flex size-4 shrink-0 items-center justify-center">
            <Icon name={icon()} size="small" />
            <span
              classList={{
                "absolute -right-0.5 -top-0.5 size-1.5 rounded-full ring-2 ring-v2-background-bg-base": true,
                "bg-icon-weak-base": activity().kind === "idle",
                "bg-icon-warning-base": activity().kind === "retrying" || stale(),
                "bg-icon-success-base": activity().kind !== "idle" && activity().kind !== "retrying" && !stale(),
              }}
            />
          </span>
          <span class="min-w-0 truncate sm:hidden">{mobileSummary()}</span>
          <span data-slot="session-activity-summary" class="hidden min-w-0 truncate sm:inline">
            {summary()}
          </span>
          <span class="hidden shrink-0 text-v2-text-text-faint lg:inline">/ {lastActivity()}</span>
        </>
      }
    >
      <div data-slot="session-activity-popover" class="flex flex-col gap-3">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0 text-[13px] font-[530] leading-5 text-v2-text-text-base">{summary()}</div>
          <div class="shrink-0 text-[12px] leading-5 text-v2-text-text-faint">{lastActivity()}</div>
        </div>

        <div class="flex items-start gap-2 border-t border-border-weak-base pt-3">
          <span
            classList={{
              "mt-1.5 size-1.5 shrink-0 rounded-full": true,
              "bg-icon-weak-base": activity().parentStatus.type === "idle",
              "bg-icon-warning-base": activity().parentStatus.type === "retry",
              "bg-icon-success-base": activity().parentStatus.type === "busy",
            }}
          />
          <div class="min-w-0 flex-1">
            <div class="flex items-center justify-between gap-2">
              <span class="truncate text-[12px] font-[530] leading-4 text-v2-text-text-base">
                {language.t("session.activity.parent")}
              </span>
              <span class="shrink-0 text-[11px] leading-4 text-v2-text-text-faint">
                {statusLabel(activity().parentStatus)}
              </span>
            </div>
            <div class="mt-0.5 flex min-w-0 items-center gap-1 text-[11px] leading-4 text-v2-text-text-muted">
              <Show when={modelLabel(activity().parent)}>{(model) => <span class="truncate">{model()}</span>}</Show>
              <Show when={modelLabel(activity().parent)}>
                <span aria-hidden="true">/</span>
              </Show>
              <span class="shrink-0">{relativeTime(activity().parent?.time.updated)}</span>
            </div>
          </div>
        </div>

        <Show when={activity().descendants.length > 0}>
          <div class="flex flex-col gap-1.5">
            <div class="text-[11px] font-[530] uppercase leading-4 text-v2-text-text-faint">
              {language.t("session.activity.activeSubagents", { count: activity().descendants.length })}
            </div>
            <For each={activity().descendants}>
              {(child) => (
                <button
                  type="button"
                  class="flex w-full items-start gap-2 rounded-md px-1.5 py-1.5 text-left transition-colors hover:bg-v2-overlay-simple-overlay-hover"
                  aria-label={language.t("session.activity.openSubagent", { name: child.info.title })}
                  onClick={() => props.onOpenSession(child.info.id)}
                >
                  <span
                    classList={{
                      "mt-1.5 size-1.5 shrink-0 rounded-full": true,
                      "bg-icon-success-base": child.status.type === "busy",
                      "bg-icon-warning-base": child.status.type === "retry",
                    }}
                  />
                  <span class="min-w-0 flex-1">
                    <span class="block truncate text-[12px] font-[530] leading-4 text-v2-text-text-base">
                      {child.info.title}
                    </span>
                    <span class="mt-0.5 flex min-w-0 items-center gap-1 text-[11px] leading-4 text-v2-text-text-muted">
                      <Show when={modelLabel(child.info)}>{(model) => <span class="truncate">{model()}</span>}</Show>
                      <Show when={modelLabel(child.info)}>
                        <span aria-hidden="true">/</span>
                      </Show>
                      <span class="shrink-0">{statusLabel(child.status)}</span>
                      <span aria-hidden="true">/</span>
                      <span class="shrink-0">{relativeTime(child.info.time.updated)}</span>
                    </span>
                  </span>
                  <Icon name="chevron-right" size="small" class="mt-0.5 shrink-0 text-v2-text-text-faint" />
                </button>
              )}
            </For>
          </div>
        </Show>
      </div>
    </Popover>
  )
}
