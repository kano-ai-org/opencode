import { Global } from "../global"
import { Log } from "../util/log"
import path from "path"
import z from "zod"
import { Installation } from "../installation"
import { Flag } from "../flag/flag"
import { lazy } from "@/util/lazy"
import { Filesystem } from "../util/filesystem"
import fs from "fs/promises"

// Try to import bundled snapshot (generated at build time)
// Falls back to undefined in dev mode when snapshot doesn't exist
/* @ts-ignore */

export namespace ModelsDev {
  const log = Log.create({ service: "models.dev" })
  const filepath = path.join(Global.Path.cache, "models.json")

  export const Model = z.object({
    id: z.string(),
    name: z.string(),
    family: z.string().optional(),
    release_date: z.string(),
    attachment: z.boolean(),
    reasoning: z.boolean(),
    temperature: z.boolean(),
    tool_call: z.boolean(),
    interleaved: z
      .union([
        z.literal(true),
        z
          .object({
            field: z.enum(["reasoning_content", "reasoning_details"]),
          })
          .strict(),
      ])
      .optional(),
    cost: z
      .object({
        input: z.number(),
        output: z.number(),
        cache_read: z.number().optional(),
        cache_write: z.number().optional(),
        context_over_200k: z
          .object({
            input: z.number(),
            output: z.number(),
            cache_read: z.number().optional(),
            cache_write: z.number().optional(),
          })
          .optional(),
      })
      .optional(),
    limit: z.object({
      context: z.number(),
      input: z.number().optional(),
      output: z.number(),
    }),
    modalities: z
      .object({
        input: z.array(z.enum(["text", "audio", "image", "video", "pdf"])),
        output: z.array(z.enum(["text", "audio", "image", "video", "pdf"])),
      })
      .optional(),
    experimental: z.boolean().optional(),
    status: z.enum(["alpha", "beta", "deprecated"]).optional(),
    options: z.record(z.string(), z.any()),
    headers: z.record(z.string(), z.string()).optional(),
    provider: z.object({ npm: z.string().optional(), api: z.string().optional() }).optional(),
    variants: z.record(z.string(), z.record(z.string(), z.any())).optional(),
  })
  export type Model = z.infer<typeof Model>

  export const Provider = z.object({
    api: z.string().optional(),
    name: z.string(),
    env: z.array(z.string()),
    id: z.string(),
    npm: z.string().optional(),
    models: z.record(z.string(), Model),
  })

  export type Provider = z.infer<typeof Provider>

  function url() {
    return Flag.OPENCODE_MODELS_URL || "https://models.dev"
  }

  export const Data = lazy(async () => {
    const result = await Filesystem.readJson(Flag.OPENCODE_MODELS_PATH ?? filepath).catch(() => {})
    if (result) return result
    if (Flag.OPENCODE_DISABLE_MODELS_FETCH) return {}
    const remote = await fetch(`${url()}/api.json`)
      .then((x) => x.text())
      .then((x) => JSON.parse(x) as Record<string, unknown>)
      .catch(() => undefined)
    if (remote && Object.keys(remote).length > 0) return remote
    // @ts-ignore
    const snapshot = await import("./models-snapshot.js")
      .then((m) => m.snapshot as Record<string, unknown>)
      .catch(() => undefined)
    if (snapshot) return snapshot
    return {}
  })

  export async function get() {
    const result = await Data()
    return result as Record<string, Provider>
  }

  export async function refresh() {
    const file = Flag.OPENCODE_MODELS_PATH ?? filepath
    const temp = `${file}.tmp-${process.pid}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`

    const restore = async () => {
      // @ts-ignore
      const snapshot = await import("./models-snapshot")
        .then((m) => m.snapshot as Record<string, unknown> | undefined)
        .catch(() => undefined)
      if (!snapshot || Object.keys(snapshot).length === 0) return false
      await fs.mkdir(path.dirname(file), { recursive: true }).catch(() => {})
      const text = JSON.stringify(snapshot)
      await Filesystem.write(temp, text)
      await fs.rm(file, { force: true }).catch(() => {})
      const moved = await fs.rename(temp, file).then(() => true).catch(() => false)
      if (!moved) {
        await Filesystem.write(file, text)
        await fs.rm(temp, { force: true }).catch(() => {})
      }
      ModelsDev.Data.reset()
      log.info("Restored models cache from bundled snapshot")
      return true
    }

    const result = await fetch(`${url()}/api.json`, {
      headers: {
        "User-Agent": Installation.USER_AGENT,
      },
      signal: AbortSignal.timeout(10 * 1000),
    }).catch((e) => {
      log.error("Failed to fetch models.dev", {
        error: e,
      })
    })
    if (!result || !result.ok) {
      if ((await Filesystem.size(file).catch(() => 0)) === 0) await restore()
      return
    }

    const data = await result.json().catch(() => undefined)
    if (!data || typeof data !== "object" || Array.isArray(data) || Object.keys(data).length === 0) {
      log.error("Refusing to overwrite models cache with invalid payload")
      if ((await Filesystem.size(file).catch(() => 0)) === 0) await restore()
      return
    }

    const text = JSON.stringify(data)
    await fs.mkdir(path.dirname(file), { recursive: true }).catch(() => {})
    await Filesystem.write(temp, text)
    await fs.rm(file, { force: true }).catch(() => {})
    const moved = await fs.rename(temp, file).then(() => true).catch(() => false)
    if (!moved) {
      await Filesystem.write(file, text)
      await fs.rm(temp, { force: true }).catch(() => {})
    }
    ModelsDev.Data.reset()
  }
}

if (!Flag.OPENCODE_DISABLE_MODELS_FETCH && !process.argv.includes("--get-yargs-completions")) {
  ModelsDev.refresh()
  setInterval(
    async () => {
      await ModelsDev.refresh()
    },
    60 * 1000 * 60,
  ).unref()
}
