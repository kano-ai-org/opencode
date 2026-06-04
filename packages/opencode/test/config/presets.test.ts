import { afterEach, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { applyConfigPreset, listConfigPresets } from "../../src/config/presets"

const roots: string[] = []

async function tempDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-config-presets-"))
  roots.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
})

describe("config presets", () => {
  test("lists oh-my-openagent jsonc presets and detects the active one", async () => {
    const dir = await tempDir()
    await fs.writeFile(path.join(dir, "oh-my-openagent-all.jsonc"), '{ "agents": { "a": "all" } }\n')
    await fs.writeFile(path.join(dir, "oh-my-openagent-minimax.jsonc"), '{ "agents": { "a": "minimax" } }\n')
    await fs.writeFile(path.join(dir, "oh-my-openagent.jsonc"), '{ "agents": { "a": "minimax" } }\n')
    await fs.writeFile(path.join(dir, "oh-my-openagent-openai.json"), "{}\n")
    await fs.writeFile(path.join(dir, "not-a-preset.jsonc"), "{}\n")

    const result = await listConfigPresets(dir)

    expect(result.active).toBe("minimax")
    expect(result.presets.map((preset) => preset.id).sort()).toEqual(["all", "minimax"])
    expect(result.presets.find((preset) => preset.id === "minimax")?.active).toBe(true)
  })

  test("applies a preset by replacing the active oh-my-openagent jsonc config", async () => {
    const dir = await tempDir()
    await fs.writeFile(path.join(dir, "oh-my-openagent-all.jsonc"), '{ "agents": { "a": "all" } }\n')
    await fs.writeFile(path.join(dir, "oh-my-openagent-minimax.jsonc"), '{ "agents": { "a": "minimax" } }\n')
    await fs.writeFile(path.join(dir, "oh-my-openagent.jsonc"), '{ "agents": { "a": "minimax" } }\n')

    const result = await applyConfigPreset("all", dir)
    const activeContent = await fs.readFile(path.join(dir, "oh-my-openagent.jsonc"), "utf8")

    expect(activeContent).toBe('{ "agents": { "a": "all" } }\n')
    expect(result.active).toBe("all")
  })
})
