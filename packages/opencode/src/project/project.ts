import z from "zod"
import { Filesystem } from "../util/filesystem"
import path from "path"
import { Database, NotFoundError, and, eq } from "../storage/db"
import { ProjectTable } from "./project.sql"
import { SessionTable } from "../session/session.sql"
import { Log } from "../util/log"
import { Flag } from "@/flag/flag"
import { work } from "../util/queue"
import { fn } from "@opencode-ai/util/fn"
import { BusEvent } from "@/bus/bus-event"
import { iife } from "@/util/iife"
import { GlobalBus } from "@/bus/global"
import { existsSync } from "fs"
import { realpath } from "fs/promises"
import { git } from "../util/git"

export namespace Project {
  const log = Log.create({ service: "project" })
  export const Info = z
    .object({
      id: z.string(),
      worktree: z.string(),
      vcs: z.literal("git").optional(),
      name: z.string().optional(),
      icon: z
        .object({
          url: z.string().optional(),
          override: z.string().optional(),
          color: z.string().optional(),
        })
        .optional(),
      commands: z
        .object({
          start: z.string().optional().describe("Startup script to run when creating a new workspace (worktree)"),
        })
        .optional(),
      time: z.object({
        created: z.number(),
        updated: z.number(),
        initialized: z.number().optional(),
      }),
      sandboxes: z.array(z.string()),
    })
    .meta({
      ref: "Project",
    })
  export type Info = z.infer<typeof Info>

  export const Event = {
    Updated: BusEvent.define("project.updated", Info),
  }

  export const WorkspaceToggles = z
    .object({
      version: z.number().int().nonnegative(),
      toggles: z.record(z.string(), z.boolean()),
    })
    .meta({
      ref: "ProjectWorkspaceToggles",
    })

  export const WorkspaceTogglesInput = z.object({
    projectID: z.string(),
    version: z.number().int().nonnegative(),
    toggles: z.record(z.string(), z.boolean()),
  })

  type Row = typeof ProjectTable.$inferSelect

  const pathkey = (directory: string) => {
    const normalized = directory.replace(/\\/g, "/").replace(/\/+$/, "")
    if (!/^[A-Za-z]:\//.test(normalized)) return normalized
    return `${normalized.slice(0, 1).toUpperCase()}${normalized.slice(1).toLowerCase()}`
  }

  const canonical = (directory: string) =>
    realpath(directory)
      .then(pathkey)
      .catch(() => pathkey(directory))

  const sanitizeWorkspaceToggles = (row: Row, toggles: Record<string, boolean>) => {
    const allowed = new Set([row.worktree, ...row.sandboxes])
    return Object.fromEntries(Object.entries(toggles).filter(([directory]) => allowed.has(directory)))
  }

  const sanitizeWorkspaceTogglesInput = async (row: Row, toggles: Record<string, boolean>) => {
    const allowed = [row.worktree, ...row.sandboxes]
    const aliases = await Promise.all(allowed.map((directory) => canonical(directory).then((key) => [key, directory] as const)))
    const map = new Map(aliases)
    const direct = new Map(allowed.map((directory) => [pathkey(directory), directory] as const))
    const tail = allowed.reduce<Map<string, string | undefined>>((acc, directory) => {
      const name = path.basename(directory.replace(/\\/g, "/")).toLowerCase()
      if (!name) return acc
      if (!acc.has(name)) {
        acc.set(name, directory)
        return acc
      }
      acc.set(name, undefined)
      return acc
    }, new Map())

    const resolved = await Promise.all(
      Object.entries(toggles).map(async ([directory, enabled]) => {
        const key = await canonical(directory)
        const byCanonical = map.get(key)
        if (byCanonical) return [byCanonical, enabled] as const

        const byDirect = direct.get(pathkey(directory))
        if (byDirect) return [byDirect, enabled] as const

        const name = path.basename(directory.replace(/\\/g, "/")).toLowerCase()
        const byTail = tail.get(name)
        const target = byTail && allowed.includes(byTail) ? byTail : undefined
        if (!target) return
        return [target, enabled] as const
      }),
    )

    return Object.fromEntries(resolved.filter((item): item is readonly [string, boolean] => !!item))
  }

  const workspaceTogglesFromRow = (row: Row) => {
    const toggles = sanitizeWorkspaceToggles(row, row.workspace_toggles ?? {})
    return {
      version: row.workspace_toggles_version,
      toggles,
    }
  }

  export function fromRow(row: Row): Info {
    const icon =
      row.icon_url || row.icon_override || row.icon_color
        ? { url: row.icon_url ?? undefined, override: row.icon_override ?? undefined, color: row.icon_color ?? undefined }
        : undefined
    return {
      id: row.id,
      worktree: row.worktree,
      vcs: row.vcs ? Info.shape.vcs.parse(row.vcs) : undefined,
      name: row.name ?? undefined,
      icon,
      time: {
        created: row.time_created,
        updated: row.time_updated,
        initialized: row.time_initialized ?? undefined,
      },
      sandboxes: row.sandboxes,
      commands: row.commands ?? undefined,
    }
  }

  export async function fromDirectory(directory: string) {
    log.info("fromDirectory", { directory })

    const data = await iife(async () => {
      const matches = Filesystem.up({ targets: [".git"], start: directory })
      const dotgit = await matches.next().then((x) => x.value)
      await matches.return()
      if (dotgit) {
        let sandbox = path.dirname(dotgit)

        const gitBinary = Bun.which("git")

        // cached id calculation
        let id = await Bun.file(path.join(dotgit, "opencode"))
          .text()
          .then((x) => x.trim())
          .catch(() => undefined)

        if (!gitBinary) {
          return {
            id: id ?? "global",
            worktree: sandbox,
            sandbox: sandbox,
            vcs: Info.shape.vcs.parse(Flag.OPENCODE_FAKE_VCS),
          }
        }

        // generate id from root commit
        if (!id) {
          const roots = await git(["rev-list", "--max-parents=0", "--all"], {
            cwd: sandbox,
          })
            .then(async (result) =>
              (await result.text())
                .split("\n")
                .filter(Boolean)
                .map((x) => x.trim())
                .toSorted(),
            )
            .catch(() => undefined)

          if (!roots) {
            return {
              id: "global",
              worktree: sandbox,
              sandbox: sandbox,
              vcs: Info.shape.vcs.parse(Flag.OPENCODE_FAKE_VCS),
            }
          }

          id = roots[0]
          if (id) {
            void Bun.file(path.join(dotgit, "opencode"))
              .write(id)
              .catch(() => undefined)
          }
        }

        if (!id) {
          return {
            id: "global",
            worktree: sandbox,
            sandbox: sandbox,
            vcs: "git",
          }
        }

        const top = await git(["rev-parse", "--show-toplevel"], {
          cwd: sandbox,
        })
          .then(async (result) => path.resolve(sandbox, (await result.text()).trim()))
          .catch(() => undefined)

        if (!top) {
          return {
            id,
            sandbox,
            worktree: sandbox,
            vcs: Info.shape.vcs.parse(Flag.OPENCODE_FAKE_VCS),
          }
        }

        sandbox = top

        const worktree = await git(["rev-parse", "--git-common-dir"], {
          cwd: sandbox,
        })
          .then(async (result) => {
            const dirname = path.dirname((await result.text()).trim())
            if (dirname === ".") return sandbox
            return dirname
          })
          .catch(() => undefined)

        if (!worktree) {
          return {
            id,
            sandbox,
            worktree: sandbox,
            vcs: Info.shape.vcs.parse(Flag.OPENCODE_FAKE_VCS),
          }
        }

        return {
          id,
          sandbox,
          worktree,
          vcs: "git",
        }
      }

      return {
        id: "global",
        worktree: "/",
        sandbox: "/",
        vcs: Info.shape.vcs.parse(Flag.OPENCODE_FAKE_VCS),
      }
    })

    const row = Database.use((db) => db.select().from(ProjectTable).where(eq(ProjectTable.id, data.id)).get())
    const existing = await iife(async () => {
      if (row) return fromRow(row)
      const fresh: Info = {
        id: data.id,
        worktree: data.worktree,
        vcs: data.vcs as Info["vcs"],
        sandboxes: [],
        time: {
          created: Date.now(),
          updated: Date.now(),
        },
      }
      if (data.id !== "global") {
        await migrateFromGlobal(data.id, data.worktree)
      }
      return fresh
    })

    if (Flag.OPENCODE_EXPERIMENTAL_ICON_DISCOVERY) discover(existing)

    const result: Info = {
      ...existing,
      worktree: data.worktree,
      vcs: data.vcs as Info["vcs"],
      time: {
        ...existing.time,
        updated: Date.now(),
      },
    }
    if (data.sandbox !== result.worktree && !result.sandboxes.includes(data.sandbox))
      result.sandboxes.push(data.sandbox)
    result.sandboxes = result.sandboxes.filter((x) => existsSync(x))
    const insert = {
      id: result.id,
      worktree: result.worktree,
      vcs: result.vcs ?? null,
      name: result.name,
      icon_url: result.icon?.url,
      icon_override: result.icon?.override,
      icon_color: result.icon?.color,
      time_created: result.time.created,
      time_updated: result.time.updated,
      time_initialized: result.time.initialized,
      sandboxes: result.sandboxes,
      workspace_toggles: row?.workspace_toggles ?? {},
      workspace_toggles_version: row?.workspace_toggles_version ?? 0,
      commands: result.commands,
    }
    const updateSet = {
      worktree: result.worktree,
      vcs: result.vcs ?? null,
      name: result.name,
      icon_url: result.icon?.url,
      icon_override: result.icon?.override,
      icon_color: result.icon?.color,
      time_updated: result.time.updated,
      time_initialized: result.time.initialized,
      sandboxes: result.sandboxes,
      workspace_toggles: row?.workspace_toggles ?? {},
      workspace_toggles_version: row?.workspace_toggles_version ?? 0,
      commands: result.commands,
    }
    Database.use((db) =>
      db.insert(ProjectTable).values(insert).onConflictDoUpdate({ target: ProjectTable.id, set: updateSet }).run(),
    )
    GlobalBus.emit("event", {
      payload: {
        type: Event.Updated.type,
        properties: result,
      },
    })
    return { project: result, sandbox: data.sandbox }
  }

  export async function discover(input: Info) {
    if (input.vcs !== "git") return
    if (input.icon?.override) return
    if (input.icon?.url) return
    const glob = new Bun.Glob("**/{favicon}.{ico,png,svg,jpg,jpeg,webp}")
    const matches = await Array.fromAsync(
      glob.scan({
        cwd: input.worktree,
        absolute: true,
        onlyFiles: true,
        followSymlinks: false,
        dot: false,
      }),
    )
    const shortest = matches.sort((a, b) => a.length - b.length)[0]
    if (!shortest) return
    const file = Bun.file(shortest)
    const buffer = await file.arrayBuffer()
    const base64 = Buffer.from(buffer).toString("base64")
    const mime = file.type || "image/png"
    const url = `data:${mime};base64,${base64}`
    await update({
      projectID: input.id,
      icon: {
        url,
      },
    })
    return
  }

  async function migrateFromGlobal(id: string, worktree: string) {
    const row = Database.use((db) => db.select().from(ProjectTable).where(eq(ProjectTable.id, "global")).get())
    if (!row) return

    const sessions = Database.use((db) =>
      db.select().from(SessionTable).where(eq(SessionTable.project_id, "global")).all(),
    )
    if (sessions.length === 0) return

    log.info("migrating sessions from global", { newProjectID: id, worktree, count: sessions.length })

    await work(10, sessions, async (row) => {
      // Skip sessions that belong to a different directory
      if (row.directory && row.directory !== worktree) return

      log.info("migrating session", { sessionID: row.id, from: "global", to: id })
      Database.use((db) => db.update(SessionTable).set({ project_id: id }).where(eq(SessionTable.id, row.id)).run())
    }).catch((error) => {
      log.error("failed to migrate sessions from global to project", { error, projectId: id })
    })
  }

  export function setInitialized(id: string) {
    Database.use((db) =>
      db
        .update(ProjectTable)
        .set({
          time_initialized: Date.now(),
        })
        .where(eq(ProjectTable.id, id))
        .run(),
    )
  }

  export function list() {
    return Database.use((db) =>
      db
        .select()
        .from(ProjectTable)
        .all()
        .map((row) => fromRow(row)),
    )
  }

  export function get(id: string): Info | undefined {
    const row = Database.use((db) => db.select().from(ProjectTable).where(eq(ProjectTable.id, id)).get())
    if (!row) return undefined
    return fromRow(row)
  }

  export const update = fn(
    z.object({
      projectID: z.string(),
      name: z.string().optional(),
      icon: Info.shape.icon.optional(),
      commands: Info.shape.commands.optional(),
    }),
    async (input) => {
      const result = Database.use((db) =>
        db
          .update(ProjectTable)
          .set({
            name: input.name,
            icon_url: input.icon?.url,
            icon_override: input.icon?.override,
            icon_color: input.icon?.color,
            commands: input.commands,
            time_updated: Date.now(),
          })
          .where(eq(ProjectTable.id, input.projectID))
          .returning()
          .get(),
      )
      if (!result) throw new Error(`Project not found: ${input.projectID}`)
      const data = fromRow(result)
      GlobalBus.emit("event", {
        payload: {
          type: Event.Updated.type,
          properties: data,
        },
      })
      return data
    },
  )

  export const remove = fn(z.object({ projectID: z.string() }), async ({ projectID }) => {
    if (projectID === "global") {
      throw new Error("cannot delete global project")
    }

    const removed = Database.use((db) => db.delete(ProjectTable).where(eq(ProjectTable.id, projectID)).returning().get())
    if (!removed) throw new NotFoundError({ message: `Project not found: ${projectID}` })

    return true
  })

  export function getWorkspaceToggles(projectID: string) {
    const row = Database.use((db) => db.select().from(ProjectTable).where(eq(ProjectTable.id, projectID)).get())
    if (!row) {
      throw new NotFoundError({ message: `Project not found: ${projectID}` })
    }
    return WorkspaceToggles.parse(workspaceTogglesFromRow(row))
  }

  export const updateWorkspaceToggles = fn(WorkspaceTogglesInput, async (input) => {
    const row = Database.use((db) => db.select().from(ProjectTable).where(eq(ProjectTable.id, input.projectID)).get())
    if (!row) {
      throw new NotFoundError({ message: `Project not found: ${input.projectID}` })
    }

    const current = workspaceTogglesFromRow(row)
    if (input.version !== current.version) {
      return {
        status: 409 as const,
        data: WorkspaceToggles.parse(current),
      }
    }

    const toggles = await sanitizeWorkspaceTogglesInput(row, input.toggles)
    const nextVersion = current.version + 1
    const updated = Database.use((db) =>
      db
        .update(ProjectTable)
        .set({
          workspace_toggles: toggles,
          workspace_toggles_version: nextVersion,
          time_updated: Date.now(),
        })
        .where(and(eq(ProjectTable.id, input.projectID), eq(ProjectTable.workspace_toggles_version, input.version)))
        .returning()
        .get(),
    )

    if (!updated) {
      const latest = getWorkspaceToggles(input.projectID)
      return {
        status: 409 as const,
        data: latest,
      }
    }

    return {
      status: 200 as const,
      data: WorkspaceToggles.parse(workspaceTogglesFromRow(updated)),
    }
  })

  export async function sandboxes(id: string) {
    const row = Database.use((db) => db.select().from(ProjectTable).where(eq(ProjectTable.id, id)).get())
    if (!row) return []
    const data = fromRow(row)
    const valid: string[] = []
    for (const dir of data.sandboxes) {
      const stat = await Bun.file(dir)
        .stat()
        .catch(() => undefined)
      if (stat?.isDirectory()) valid.push(dir)
    }
    return valid
  }

  export async function addSandbox(id: string, directory: string) {
    const row = Database.use((db) => db.select().from(ProjectTable).where(eq(ProjectTable.id, id)).get())
    if (!row) throw new Error(`Project not found: ${id}`)
    const sandboxes = [...row.sandboxes]
    if (!sandboxes.includes(directory)) sandboxes.push(directory)
    const result = Database.use((db) =>
      db
        .update(ProjectTable)
        .set({ sandboxes, time_updated: Date.now() })
        .where(eq(ProjectTable.id, id))
        .returning()
        .get(),
    )
    if (!result) throw new Error(`Project not found: ${id}`)
    const data = fromRow(result)
    GlobalBus.emit("event", {
      payload: {
        type: Event.Updated.type,
        properties: data,
      },
    })
    return data
  }

  export async function removeSandbox(id: string, directory: string) {
    const row = Database.use((db) => db.select().from(ProjectTable).where(eq(ProjectTable.id, id)).get())
    if (!row) throw new Error(`Project not found: ${id}`)
    const sandboxes = row.sandboxes.filter((s) => s !== directory)
    const result = Database.use((db) =>
      db
        .update(ProjectTable)
        .set({ sandboxes, time_updated: Date.now() })
        .where(eq(ProjectTable.id, id))
        .returning()
        .get(),
    )
    if (!result) throw new Error(`Project not found: ${id}`)
    const data = fromRow(result)
    GlobalBus.emit("event", {
      payload: {
        type: Event.Updated.type,
        properties: data,
      },
    })
    return data
  }
}
