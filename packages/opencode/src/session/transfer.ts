import { Database } from "@/storage/db"
import { ProjectTable } from "@/project/project.sql"
import { SessionTable, MessageTable, PartTable, TodoTable, PermissionTable } from "@/session/session.sql"
import { SessionShareTable } from "@/share/share.sql"
import { InstanceID } from "@/global/identity"
import { eq } from "drizzle-orm"
import { gunzipSync } from "node:zlib"
import z from "zod"

const Bundle = z.object({
  version: z.literal(1),
  createdAt: z.number(),
  source: z
    .object({
      instanceID: z.string().optional(),
    })
    .optional(),
  tables: z.object({
    project: z.array(z.custom<typeof ProjectTable.$inferSelect>()),
    session: z.array(z.custom<typeof SessionTable.$inferSelect>()),
    message: z.array(z.custom<typeof MessageTable.$inferSelect>()),
    part: z.array(z.custom<typeof PartTable.$inferSelect>()),
    todo: z.array(z.custom<typeof TodoTable.$inferSelect>()),
    permission: z.array(z.custom<typeof PermissionTable.$inferSelect>()),
    session_share: z.array(z.custom<typeof SessionShareTable.$inferSelect>()),
  }),
})

const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes)

const octal = (raw: string) => {
  const value = raw.replace(/\0/g, "").trim()
  if (!value) return 0
  return Number.parseInt(value, 8)
}

const parseTarJson = (bytes: Uint8Array) => {
  let offset = 0
  while (offset + 512 <= bytes.length) {
    const header = bytes.slice(offset, offset + 512)
    if (header.every((value) => value === 0)) break

    const name = text(header.slice(0, 100)).replace(/\0.*$/, "")
    const size = octal(text(header.slice(124, 136)))
    const start = offset + 512
    const end = start + size
    if (end > bytes.length) break
    if (name.endsWith(".json")) {
      return text(bytes.slice(start, end))
    }

    offset = start + Math.ceil(size / 512) * 512
  }
}

const parseContent = (bytes: Uint8Array) => {
  const source = bytes
  const input =
    bytes[0] === 0x1f && bytes[1] === 0x8b
      ? new Uint8Array(gunzipSync(Buffer.from(bytes)).buffer)
      : bytes

  if (input[0] === 0x50 && input[1] === 0x4b) {
    throw new Error("zip import is not supported yet; use json, tar, or tar.gz")
  }

  const asText = text(input).trim()
  if (asText.startsWith("{")) return asText

  const fromTar = parseTarJson(input)
  if (fromTar) return fromTar

  const fallback = text(source).trim()
  if (fallback.startsWith("{")) return fallback
  throw new Error("unsupported import format")
}

export namespace SessionTransfer {
  export async function exportAll() {
    const rows = Database.use((db) => ({
      project: db.select().from(ProjectTable).all(),
      session: db.select().from(SessionTable).all(),
      message: db.select().from(MessageTable).all(),
      part: db.select().from(PartTable).all(),
      todo: db.select().from(TodoTable).all(),
      permission: db.select().from(PermissionTable).all(),
      session_share: db.select().from(SessionShareTable).all(),
    }))

    return Bundle.parse({
      version: 1,
      createdAt: Date.now(),
      source: { instanceID: await InstanceID.get() },
      tables: rows,
    })
  }

  export function parse(input: string | Uint8Array) {
    const json = typeof input === "string" ? input : parseContent(input)
    return Bundle.parse(JSON.parse(json))
  }

  export async function importAll(bundle: z.infer<typeof Bundle>) {
    const data = Bundle.parse(bundle)
    Database.transaction((db) => {
      for (const row of data.tables.project) {
        db.insert(ProjectTable)
          .values(row)
          .onConflictDoUpdate({
            target: ProjectTable.id,
            set: {
              worktree: row.worktree,
              vcs: row.vcs,
              name: row.name,
              icon_url: row.icon_url,
              icon_override: row.icon_override,
              icon_color: row.icon_color,
              time_updated: row.time_updated,
              time_initialized: row.time_initialized,
              sandboxes: row.sandboxes,
              workspace_toggles: row.workspace_toggles,
              workspace_toggles_version: row.workspace_toggles_version,
              commands: row.commands,
            },
          })
          .run()
      }

      for (const row of data.tables.permission) {
        db.insert(PermissionTable)
          .values(row)
          .onConflictDoUpdate({
            target: PermissionTable.project_id,
            set: {
              data: row.data,
              time_updated: row.time_updated,
            },
          })
          .run()
      }

      for (const row of data.tables.session) {
        db.insert(SessionTable)
          .values(row)
          .onConflictDoUpdate({
            target: SessionTable.id,
            set: {
              project_id: row.project_id,
              parent_id: row.parent_id,
              slug: row.slug,
              directory: row.directory,
              title: row.title,
              version: row.version,
              share_url: row.share_url,
              summary_additions: row.summary_additions,
              summary_deletions: row.summary_deletions,
              summary_files: row.summary_files,
              summary_diffs: row.summary_diffs,
              revert: row.revert,
              permission: row.permission,
              time_updated: row.time_updated,
              time_compacting: row.time_compacting,
              time_archived: row.time_archived,
            },
          })
          .run()
      }

      for (const row of data.tables.message) {
        db.insert(MessageTable)
          .values(row)
          .onConflictDoUpdate({
            target: MessageTable.id,
            set: {
              session_id: row.session_id,
              data: row.data,
              time_updated: row.time_updated,
            },
          })
          .run()
      }

      for (const row of data.tables.part) {
        db.insert(PartTable)
          .values(row)
          .onConflictDoUpdate({
            target: PartTable.id,
            set: {
              message_id: row.message_id,
              session_id: row.session_id,
              data: row.data,
              time_updated: row.time_updated,
            },
          })
          .run()
      }

      for (const row of data.tables.todo) {
        db.insert(TodoTable)
          .values(row)
          .onConflictDoUpdate({
            target: [TodoTable.session_id, TodoTable.position],
            set: {
              content: row.content,
              status: row.status,
              priority: row.priority,
              time_updated: row.time_updated,
            },
          })
          .run()
      }

      for (const row of data.tables.session_share) {
        const exists = db
          .select({ id: SessionTable.id })
          .from(SessionTable)
          .where(eq(SessionTable.id, row.session_id))
          .get()
        if (!exists) continue

        db.insert(SessionShareTable)
          .values(row)
          .onConflictDoUpdate({
            target: SessionShareTable.session_id,
            set: {
              id: row.id,
              secret: row.secret,
              url: row.url,
              time_updated: row.time_updated,
            },
          })
          .run()
      }
    })

    return {
      project: data.tables.project.length,
      session: data.tables.session.length,
      message: data.tables.message.length,
      part: data.tables.part.length,
      todo: data.tables.todo.length,
      permission: data.tables.permission.length,
      session_share: data.tables.session_share.length,
    }
  }
}
