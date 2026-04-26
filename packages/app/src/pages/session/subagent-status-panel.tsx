import { useNavigate } from "@solidjs/router"
import { For, Show } from "solid-js"
import type { TurnSubagentStatusItem } from "./subagent-status"

function badgeClass(status: TurnSubagentStatusItem["statusLabel"]): string {
  if (status === "running") return "bg-info/15 text-info"
  if (status === "pending") return "bg-warning/15 text-warning"
  return "bg-success/15 text-success"
}

function rowClass(item: TurnSubagentStatusItem): string {
  if (!item.open) return "rounded-[6px] border border-border-weak-base/80 bg-background-panel px-2.5 py-2"
  return "rounded-[6px] border border-border-weak-base/80 bg-background-panel px-2.5 py-2 cursor-pointer transition-colors hover:bg-background-strong"
}

export function SubagentStatusPanel(props: {
  routeDirectory: string
  items: TurnSubagentStatusItem[]
}) {
  const navigate = useNavigate()
  const open = (item: TurnSubagentStatusItem) => {
    if (!item.sessionID) return
    navigate(`/${props.routeDirectory}/session/${item.sessionID}`)
  }

  return (
    <Show when={props.items.length > 0}>
      <div class="px-4 md:px-5 pt-3">
        <div class="ml-auto max-w-[82%] rounded-[8px] border border-border-weak-base bg-background-stronger/80 px-3 py-2.5">
          <div class="pb-2 text-11-medium uppercase tracking-wide text-text-weak">
            Subagents
          </div>
          <div class="flex flex-col gap-2">
            <For each={props.items}>
              {(item) => (
                <div
                  class={rowClass(item)}
                  data-component="subagent-status-item"
                  data-subagent-open={item.open ? "true" : "false"}
                  data-session-id={item.sessionID}
                  onClick={() => open(item)}
                >
                  <div class="flex items-center justify-between gap-2">
                    <div class="min-w-0 text-12-medium text-text-strong truncate">{item.title}</div>
                    <span class={`shrink-0 rounded-full px-2 py-0.5 text-10-medium uppercase tracking-wide ${badgeClass(item.statusLabel)}`}>
                      {item.statusLabel}
                    </span>
                  </div>
                  <div class="pt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-11-regular text-text-weak">
                    <Show when={item.agent}>
                      <span>@{item.agent}</span>
                    </Show>
                    <Show when={item.modelLabel}>
                      <span>{item.modelLabel}</span>
                    </Show>
                    <Show when={item.sessionID}>
                      <button
                        type="button"
                        class="text-text-link hover:underline"
                        onClick={(event) => {
                          event.stopPropagation()
                          open(item)
                        }}
                      >
                        Open
                      </button>
                    </Show>
                  </div>
                </div>
              )}
            </For>
          </div>
        </div>
      </div>
    </Show>
  )
}
