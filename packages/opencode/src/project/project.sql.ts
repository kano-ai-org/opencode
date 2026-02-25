import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core"
import { Timestamps } from "@/storage/schema.sql"

export const ProjectTable = sqliteTable("project", {
  id: text().primaryKey(),
  worktree: text().notNull(),
  vcs: text(),
  name: text(),
  icon_url: text(),
  icon_override: text(),
  icon_color: text(),
  ...Timestamps,
  time_initialized: integer(),
  sandboxes: text({ mode: "json" }).notNull().$type<string[]>(),
  workspace_toggles: text({ mode: "json" }).notNull().$type<Record<string, boolean>>(),
  workspace_toggles_version: integer().notNull(),
  commands: text({ mode: "json" }).$type<{ start?: string }>(),
})
