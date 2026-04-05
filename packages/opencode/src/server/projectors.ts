import z from "zod"
import sessionProjectors from "../session/projectors"
import { SyncEvent } from "@/sync"
import { Session } from "@/session"
import { SessionID } from "@/session/schema"
import { SessionTable } from "@/session/session.sql"
import { Database, eq } from "@/storage/db"

export function initProjectors() {
  SyncEvent.init({
    projectors: sessionProjectors,
    convertEvent: (type, data) => {
      if (type === "session.updated") {
        const parsed = Session.Event.Updated.properties.parse(data)
        const id = SessionID.make(parsed.info.id)
        const row = Database.use((db) => db.select().from(SessionTable).where(eq(SessionTable.id, id)).get())

        if (!row) return data

        return {
          sessionID: id,
          info: Session.fromRow(row),
        }
      }
      return data
    },
  })
}

initProjectors()
