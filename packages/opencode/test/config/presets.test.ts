import { afterEach, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { parse } from "jsonc-parser"
import { applyConfigPreset, listConfigPresets } from "../../src/config/presets"

const roots: string[] = []

async function tempDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-config-presets-"))
  roots.push(dir)
  return dir
}

function preset(model: string, reasoning?: string) {
  const tuning = reasoning ? { reasoningEffort: reasoning } : {}
  return JSON.stringify(
    {
      agents: { a: { model, ...tuning } },
      categories: { c: { model, ...tuning } },
    },
    null,
    2,
  ).concat("\n")
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
})

describe("config presets", () => {
  test("detects the active preset from the canonical OMO config", async () => {
    const dir = await tempDir()
    const omoPath = path.join(dir, "omo.jsonc")
    await fs.writeFile(path.join(dir, "oh-my-openagent-all.jsonc"), preset("all"))
    await fs.writeFile(path.join(dir, "oh-my-openagent-minimax.jsonc"), preset("minimax"))
    await fs.writeFile(path.join(dir, "oh-my-openagent.jsonc"), preset("all"))
    await fs.writeFile(path.join(dir, "oh-my-openagent-openai.json"), "{}\n")
    await fs.writeFile(path.join(dir, "not-a-preset.jsonc"), "{}\n")
    await fs.writeFile(
      omoPath,
      `{
  "[opencode]": {
    "agents": { "a": { "model": "minimax" } },
    "categories": { "c": { "model": "minimax" } },
    "skills": { "paths": ["keep"] }
  }
}\n`,
    )

    const result = await listConfigPresets(dir, omoPath)

    expect(result.active).toBe("minimax")
    expect(result.presets.map((preset) => preset.id).sort()).toEqual(["all", "minimax"])
    expect(result.presets.find((preset) => preset.id === "minimax")?.active).toBe(true)
  })

  test("applies model fields to legacy and canonical configs without replacing other OMO settings", async () => {
    const dir = await tempDir()
    const omoPath = path.join(dir, "omo.jsonc")
    const all = preset("all", "high")
    await fs.writeFile(path.join(dir, "oh-my-openagent-all.jsonc"), all)
    await fs.writeFile(path.join(dir, "oh-my-openagent-minimax.jsonc"), preset("minimax"))
    await fs.writeFile(path.join(dir, "oh-my-openagent.jsonc"), preset("minimax"))
    await fs.writeFile(
      omoPath,
      `{
  // Preserve user-owned settings and comments.
  "memory": { "enabled": true },
  "[opencode]": {
    "agents": { "a": { "model": "minimax" } },
    "categories": { "c": { "model": "minimax" } },
    "skills": { "paths": ["keep"] }
  }
}\n`,
    )

    const result = await applyConfigPreset("all", dir, omoPath)
    const activeContent = await fs.readFile(path.join(dir, "oh-my-openagent.jsonc"), "utf8")
    const omoContent = await fs.readFile(omoPath, "utf8")
    const omo = parse(omoContent)

    expect(activeContent).toBe(all)
    expect(omo["[opencode]"].agents).toEqual({ a: { model: "all", reasoning: "high" } })
    expect(omo["[opencode]"].categories).toEqual({ c: { model: "all", reasoning: "high" } })
    expect(omo["[opencode]"].agents.a).not.toHaveProperty("reasoningEffort")
    expect(omo["[opencode]"].categories.c).not.toHaveProperty("reasoningEffort")
    expect(omo["[opencode]"].skills).toEqual({ paths: ["keep"] })
    expect(omo.memory).toEqual({ enabled: true })
    expect(omoContent).toContain("// Preserve user-owned settings and comments.")
    expect(result.active).toBe("all")
  })

  test("does not replace the legacy active config when canonical OMO config is invalid", async () => {
    const dir = await tempDir()
    const omoPath = path.join(dir, "omo.jsonc")
    const minimax = preset("minimax")
    await fs.writeFile(path.join(dir, "oh-my-openagent-all.jsonc"), preset("all"))
    await fs.writeFile(path.join(dir, "oh-my-openagent-minimax.jsonc"), minimax)
    await fs.writeFile(path.join(dir, "oh-my-openagent.jsonc"), minimax)
    await fs.writeFile(omoPath, "{ invalid")

    expect(applyConfigPreset("all", dir, omoPath)).rejects.toThrow()

    expect(await fs.readFile(path.join(dir, "oh-my-openagent.jsonc"), "utf8")).toBe(minimax)
  })
})
