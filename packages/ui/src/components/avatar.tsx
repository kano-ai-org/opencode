import { type ComponentProps, splitProps, Show, createEffect, createMemo, createSignal } from "solid-js"

const segmenter =
  typeof Intl !== "undefined" && "Segmenter" in Intl
    ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
    : undefined

function first(value: string) {
  if (!value) return ""
  if (!segmenter) return Array.from(value)[0] ?? ""
  return segmenter.segment(value)[Symbol.iterator]().next().value?.segment ?? Array.from(value)[0] ?? ""
}

export interface AvatarProps extends ComponentProps<"div"> {
  fallback: string
  src?: string
  fallbackSrc?: string
  background?: string
  foreground?: string
  size?: "small" | "normal" | "large"
}

export function Avatar(props: AvatarProps) {
  const [split, rest] = splitProps(props, [
    "fallback",
    "src",
    "fallbackSrc",
    "background",
    "foreground",
    "size",
    "class",
    "classList",
    "style",
  ])
  const [stage, setStage] = createSignal<0 | 1 | 2>(0)
  createEffect(() => {
    split.src
    split.fallbackSrc
    setStage(0)
  })
  const src = createMemo(() => {
    const current = stage()
    if (current === 0) return split.src
    if (current === 1) return split.fallbackSrc
    return undefined
  })
  const onError = () => {
    setStage((current) => {
      if (current === 0 && split.fallbackSrc) return 1
      return 2
    })
  }
  return (
    <div
      {...rest}
      data-component="avatar"
      data-size={split.size || "normal"}
      data-has-image={src() ? "" : undefined}
      classList={{
        ...split.classList,
        [split.class ?? ""]: !!split.class,
      }}
      style={{
        ...(typeof split.style === "object" ? split.style : {}),
        ...(!src && split.background ? { "--avatar-bg": split.background } : {}),
        ...(!src && split.foreground ? { "--avatar-fg": split.foreground } : {}),
      }}
    >
      <Show when={src()} fallback={first(split.fallback)}>
        {(value) => <img src={value()} draggable={false} data-slot="avatar-image" onError={onError} />}
      </Show>
    </div>
  )
}
