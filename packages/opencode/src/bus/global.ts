import { EventEmitter } from "events"
import { Identifier } from "@/id/id"

export type GlobalEvent = {
  directory?: string
  project?: string
  workspace?: string
  payload: any
}

type GlobalBusEvents = {
  event: [GlobalEvent]
}

class GlobalBusEmitter extends EventEmitter<GlobalBusEvents> {
  override emit<K extends string | symbol>(
    eventName: K | keyof GlobalBusEvents,
    ...args: K extends keyof GlobalBusEvents ? GlobalBusEvents[K] : any[]
  ): boolean {
    const event = eventName === "event" ? (args[0] as GlobalEvent | undefined) : undefined
    if (event?.payload && typeof event.payload === "object" && !("id" in event.payload)) {
      event.payload.id = event.payload.syncEvent?.id ?? Identifier.create("evt", "ascending")
    }
    return super.emit(eventName as any, ...(args as any[]))
  }
}

export const GlobalBus = new GlobalBusEmitter()
