export * as ConfigPresets from "./presets"

import { existsSync } from "node:fs"
import fs from "node:fs/promises"
import path from "node:path"
import { isDeepStrictEqual } from "node:util"
import { Flag } from "@opencode-ai/core/flag/flag"
import { Global } from "@opencode-ai/core/global"
import { applyEdits, modify } from "jsonc-parser"
import { isRecord } from "@/util/record"
import { ConfigParse } from "./parse"

const PRESET_PREFIX = "oh-my-openagent-"
const PRESET_EXTENSION = ".jsonc"
const ACTIVE_CONFIG = "oh-my-openagent.jsonc"
const PRESET_ID_PATTERN = /^[a-z0-9][a-z0-9_-]*$/i
const MODEL_CONFIG_KEYS = ["agents", "categories"] as const

export type ConfigPreset = {
  id: string
  name: string
  filename: string
  active: boolean
}

export type ConfigPresetList = {
  active?: string
  presets: ConfigPreset[]
}

export function configPresetDirectory() {
  return Flag.OPENCODE_CONFIG_DIR ?? Global.Path.config
}

function userOmoConfigPath(env: NodeJS.ProcessEnv = process.env) {
  const dir = path.join(path.resolve(env.HOME ?? env.USERPROFILE ?? process.cwd()), ".omo")
  const jsonc = path.join(dir, "omo.jsonc")
  if (existsSync(jsonc)) return jsonc
  const json = path.join(dir, "omo.json")
  return existsSync(json) ? json : jsonc
}

function presetID(filename: string) {
  if (!filename.startsWith(PRESET_PREFIX) || !filename.endsWith(PRESET_EXTENSION)) return
  const id = filename.slice(PRESET_PREFIX.length, -PRESET_EXTENSION.length)
  if (!PRESET_ID_PATTERN.test(id)) return
  return id
}

function presetName(id: string) {
  const special: Record<string, string> = {
    all: "All",
    copilot: "Copilot",
    minimax: "MiniMax",
    openai: "OpenAI",
  }
  return (
    special[id] ??
    id
      .split(/[-_]/g)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ")
  )
}

async function readActiveConfig(configDir: string) {
  const activePath = path.join(configDir, ACTIVE_CONFIG)
  if (!existsSync(activePath)) return
  return fs.readFile(activePath, "utf8")
}

function parseObject(content: string, filepath: string) {
  const parsed = ConfigParse.jsonc(content, filepath)
  if (!isRecord(parsed)) throw new Error(`Config must contain a JSON object: ${filepath}`)
  return parsed
}

function normalizeDefinition(input: unknown) {
  if (!isRecord(input)) return input
  const reasoning = input["reasoning"] ?? input["reasoningEffort"] ?? input["variant"]
  if (reasoning === undefined) return input
  const result = { ...input }
  delete result["reasoningEffort"]
  delete result["variant"]
  result["reasoning"] = reasoning
  return result
}

function modelConfig(input: unknown) {
  if (!isRecord(input)) return undefined
  if (!MODEL_CONFIG_KEYS.every((key) => key in input)) return undefined
  return Object.fromEntries(
    MODEL_CONFIG_KEYS.map((key) => [
      key,
      isRecord(input[key])
        ? Object.fromEntries(Object.entries(input[key]).map(([name, value]) => [name, normalizeDefinition(value)]))
        : input[key],
    ]),
  )
}

function presetModelConfig(content: string, filepath: string) {
  const result = modelConfig(parseObject(content, filepath))
  if (!result) throw new Error(`Preset must define agents and categories: ${filepath}`)
  return result
}

function omoModelConfig(content: string, filepath: string) {
  return modelConfig(parseObject(content, filepath)["[opencode]"])
}

function patchOmoModelConfig(content: string, filepath: string, preset: Record<string, unknown>) {
  const current = parseObject(content, filepath)
  if (current["[opencode]"] !== undefined && !isRecord(current["[opencode]"])) {
    throw new Error(`The [opencode] config must contain a JSON object: ${filepath}`)
  }
  return MODEL_CONFIG_KEYS.reduce((next, key) => {
    const edits = modify(next, ["[opencode]", key], preset[key], {
      formattingOptions: { insertSpaces: true, tabSize: 2 },
    })
    return applyEdits(next, edits)
  }, content)
}

async function writeAtomic(filepath: string, content: string) {
  await fs.mkdir(path.dirname(filepath), { recursive: true })
  const temp = path.join(path.dirname(filepath), `${path.basename(filepath)}.${process.pid}.${Date.now()}.tmp`)
  await fs.writeFile(temp, content, "utf8")
  await fs.rename(temp, filepath).catch(async (error) => {
    await fs.rm(temp, { force: true }).catch(() => {})
    throw error
  })
}

export async function listConfigPresets(
  configDir = configPresetDirectory(),
  omoPath = userOmoConfigPath(),
): Promise<ConfigPresetList> {
  await fs.mkdir(configDir, { recursive: true })

  const [entries, legacyContent, omoContent] = await Promise.all([
    fs.readdir(configDir, { withFileTypes: true }),
    readActiveConfig(configDir).catch(() => undefined),
    existsSync(omoPath) ? fs.readFile(omoPath, "utf8") : undefined,
  ])
  const activeModel =
    omoContent !== undefined
      ? omoModelConfig(omoContent, omoPath)
      : legacyContent !== undefined
        ? modelConfig(parseObject(legacyContent, path.join(configDir, ACTIVE_CONFIG)))
        : undefined

  const presets = (
    await Promise.all(
      entries
        .filter((entry) => entry.isFile())
        .map(async (entry): Promise<ConfigPreset | undefined> => {
          const id = presetID(entry.name)
          if (!id) return

          const filepath = path.join(configDir, entry.name)
          const content = await fs.readFile(filepath, "utf8")
          const isActive =
            activeModel !== undefined && isDeepStrictEqual(presetModelConfig(content, filepath), activeModel)
          return {
            id,
            name: presetName(id),
            filename: entry.name,
            active: isActive,
          }
        }),
    )
  )
    .filter((preset): preset is ConfigPreset => !!preset)
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))

  const active = presets.find((preset) => preset.active)?.id
  return { active, presets }
}

export async function applyConfigPreset(
  id: string,
  configDir = configPresetDirectory(),
  omoPath = userOmoConfigPath(),
): Promise<ConfigPresetList> {
  if (!PRESET_ID_PATTERN.test(id)) throw new Error(`Invalid config preset id: ${id}`)

  const filename = `${PRESET_PREFIX}${id}${PRESET_EXTENSION}`
  const sourcePath = path.join(configDir, filename)
  const targetPath = path.join(configDir, ACTIVE_CONFIG)

  const list = await listConfigPresets(configDir, omoPath)
  if (!list.presets.some((preset) => preset.id === id && preset.filename === filename)) {
    throw new Error(`Unknown config preset: ${id}`)
  }

  const content = await fs.readFile(sourcePath, "utf8")
  const preset = presetModelConfig(content, sourcePath)
  const currentOmo = existsSync(omoPath) ? await fs.readFile(omoPath, "utf8") : "{}\n"
  const nextOmo = patchOmoModelConfig(currentOmo, omoPath, preset)

  await writeAtomic(targetPath, content)
  await writeAtomic(omoPath, nextOmo)

  return listConfigPresets(configDir, omoPath)
}
