import type { Message } from "@opencode-ai/sdk/v2"
import { createEffect, createMemo, createSignal, onCleanup, Show } from "solid-js"
import { useI18n } from "@opencode-ai/ui/context/i18n"
import { useData } from "../context"

type MessageGroup =
  | { key: string; type: "part"; ref: { messageID: string } }
  | { key: string; type: "context"; refs: { messageID: string }[] }

export function messageIDsEndingAtGroups(groups: readonly MessageGroup[]) {
  const endByMessage = new Map<string, string>()

  for (const group of groups) {
    const refs = group.type === "part" ? [group.ref] : group.refs
    for (const ref of refs) endByMessage.set(ref.messageID, group.key)
  }

  const result = new Map<string, string[]>()
  for (const [messageID, groupKey] of endByMessage) {
    const messageIDs = result.get(groupKey)
    if (messageIDs) {
      messageIDs.push(messageID)
      continue
    }
    result.set(groupKey, [messageID])
  }
  return result
}

export function messageDurationMs(message: Message, now = Date.now(), live = false) {
  if (message.role !== "assistant" && !live) return
  const created = message.time?.created
  if (typeof created !== "number" || !Number.isFinite(created)) return

  const completed = message.role === "assistant" ? message.time.completed : undefined
  const end = live || typeof completed !== "number" ? now : completed
  if (!Number.isFinite(end) || end < created) return
  return end - created
}

export function messageModelRef(message: Message) {
  if (message.role === "user") return message.model
  return {
    providerID: message.providerID,
    modelID: message.modelID,
  }
}

export function MessageTiming(props: { message: Message; live?: boolean }) {
  const i18n = useI18n()
  const data = useData()
  const [now, setNow] = createSignal(Date.now())
  const running = createMemo(
    () => !!props.live || (props.message.role === "assistant" && typeof props.message.time.completed !== "number"),
  )

  createEffect(() => {
    if (!running()) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1_000)
    onCleanup(() => clearInterval(timer))
  })

  const timestampFormat = createMemo(
    () =>
      new Intl.DateTimeFormat(i18n.locale(), {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23",
      }),
  )
  const tooltipFormat = createMemo(
    () => new Intl.DateTimeFormat(i18n.locale(), { dateStyle: "medium", timeStyle: "medium" }),
  )
  const numberFormat = createMemo(() => new Intl.NumberFormat(i18n.locale()))
  const model = createMemo(() => {
    const ref = messageModelRef(props.message)
    if (!ref?.providerID || !ref.modelID) return ""
    const provider = data.store.provider?.all?.get(ref.providerID)
    return provider?.models?.[ref.modelID]?.name ?? ref.modelID
  })

  const created = createMemo(() => props.message.time?.created)
  const timestamp = createMemo(() => {
    const value = created()
    if (typeof value !== "number" || !Number.isFinite(value)) return ""
    const parts = new Map(
      timestampFormat()
        .formatToParts(value)
        .map((part) => [part.type, part.value]),
    )
    return `${parts.get("month")}/${parts.get("day")} ${parts.get("hour")}:${parts.get("minute")}:${parts.get("second")}`
  })
  const tooltip = createMemo(() => {
    const value = created()
    if (typeof value !== "number" || !Number.isFinite(value)) return
    return tooltipFormat().format(value)
  })
  const duration = createMemo(() => {
    const value = messageDurationMs(props.message, now(), !!props.live)
    if (typeof value !== "number") return ""
    const total = Math.floor(value / 1_000)
    if (total < 60) return i18n.t("ui.message.duration.seconds", { count: numberFormat().format(total) })
    const minutes = Math.floor(total / 60)
    const seconds = total % 60
    return i18n.t("ui.message.duration.minutesSeconds", {
      minutes: numberFormat().format(minutes),
      seconds: numberFormat().format(seconds),
    })
  })

  return (
    <Show when={timestamp()}>
      <span data-slot="message-timing" data-running={running() ? "" : undefined} title={tooltip()}>
        <Show when={running()}>
          <span data-slot="message-timing-indicator" aria-hidden="true" />
        </Show>
        <time dateTime={new Date(created()!).toISOString()}>{timestamp()}</time>
        <Show when={model()}>
          <span data-slot="message-timing-separator" aria-hidden="true">
            {"\u00A0\u00B7\u00A0"}
          </span>
          <span data-slot="message-timing-model" title={model()}>
            {model()}
          </span>
        </Show>
        <Show when={duration()}>
          <span data-slot="message-timing-separator" aria-hidden="true">
            {"\u00A0\u00B7\u00A0"}
          </span>
          <span data-slot="message-timing-duration">{duration()}</span>
        </Show>
      </span>
    </Show>
  )
}
