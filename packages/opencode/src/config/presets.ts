export * as ConfigPresets from "./presets"

import { existsSync } from "node:fs"
import fs from "node:fs/promises"
import path from "node:path"
import { Flag } from "@opencode-ai/core/flag/flag"
import { Global } from "@opencode-ai/core/global"

const PRESET_PREFIX = "oh-my-openagent-"
const PRESET_EXTENSION = ".jsonc"
const ACTIVE_CONFIG = "oh-my-openagent.jsonc"
const PRESET_ID_PATTERN = /^[a-z0-9][a-z0-9_-]*$/i

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

function normalizeContent(input: string) {
  return input.replace(/\r\n/g, "\n").trim()
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

export async function listConfigPresets(configDir = configPresetDirectory()): Promise<ConfigPresetList> {
  await fs.mkdir(configDir, { recursive: true })

  const [entries, activeContent] = await Promise.all([
    fs.readdir(configDir, { withFileTypes: true }),
    readActiveConfig(configDir).catch(() => undefined),
  ])
  const normalizedActive = activeContent === undefined ? undefined : normalizeContent(activeContent)

  let active: string | undefined
  const presets = (
    await Promise.all(
      entries
        .filter((entry) => entry.isFile())
        .map(async (entry): Promise<ConfigPreset | undefined> => {
          const id = presetID(entry.name)
          if (!id) return

          const content = await fs.readFile(path.join(configDir, entry.name), "utf8")
          const isActive = normalizedActive !== undefined && normalizeContent(content) === normalizedActive
          if (isActive && active === undefined) active = id
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

  return { active, presets }
}

export async function applyConfigPreset(id: string, configDir = configPresetDirectory()): Promise<ConfigPresetList> {
  if (!PRESET_ID_PATTERN.test(id)) throw new Error(`Invalid config preset id: ${id}`)

  const filename = `${PRESET_PREFIX}${id}${PRESET_EXTENSION}`
  const sourcePath = path.join(configDir, filename)
  const targetPath = path.join(configDir, ACTIVE_CONFIG)

  const list = await listConfigPresets(configDir)
  if (!list.presets.some((preset) => preset.id === id && preset.filename === filename)) {
    throw new Error(`Unknown config preset: ${id}`)
  }

  const content = await fs.readFile(sourcePath, "utf8")
  const tempPath = path.join(configDir, `${ACTIVE_CONFIG}.${process.pid}.${Date.now()}.tmp`)
  await fs.writeFile(tempPath, content, "utf8")
  try {
    await fs.rename(tempPath, targetPath)
  } catch (error) {
    await fs.rm(tempPath, { force: true }).catch(() => {})
    throw error
  }

  return listConfigPresets(configDir)
}
