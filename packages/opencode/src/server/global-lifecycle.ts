import { GlobalBus } from "@/bus/global"
import { InstanceStore } from "@/project/instance-store"
import { Effect } from "effect"
import { Event } from "./event"

export const emitGlobalDisposed = Effect.sync(() =>
  GlobalBus.emit("event", {
    directory: "global",
    payload: {
      type: Event.Disposed.type,
      properties: {},
    },
  }),
)

export const disposeAllInstances = Effect.fn("Server.disposeAllInstances")(function* (options?: { swallowErrors?: boolean }) {
  const store = yield* InstanceStore.Service
  yield* Effect.gen(function* () {
    yield* options?.swallowErrors
      ? store.disposeAll().pipe(Effect.catchCause((cause) => Effect.logWarning("global disposal failed", { cause })))
      : store.disposeAll()
  }).pipe(Effect.uninterruptible)
})

export const disposeAllInstancesAndEmitGlobalDisposed = Effect.fn("Server.disposeAllInstancesAndEmitGlobalDisposed")(
  function* (options?: { swallowErrors?: boolean }) {
    yield* Effect.gen(function* () {
      yield* disposeAllInstances(options)
      yield* emitGlobalDisposed
    }).pipe(Effect.uninterruptible)
  },
)

export * as GlobalLifecycle from "./global-lifecycle"
