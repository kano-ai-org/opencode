import { Button } from "@opencode-ai/ui/button"
import { Select } from "@opencode-ai/ui/select"
import { showToast } from "@opencode-ai/ui/toast"
import { Component, For, Show, createMemo, createResource, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { useGlobalSDK } from "@/context/global-sdk"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
import { useModels } from "@/context/models"

type Option = {
  value: string
  label: string
}

type AgentModel = {
  providerID: string
  modelID: string
}

type AgentItem = {
  key: string
  name: string
  description: string
  model?: AgentModel
  configuredModel?: string
}

type OhMyConfig = {
  agents?: Record<string, { model?: string }>
}

type ConfigState = {
  config: OhMyConfig
  directory: string
  path: string
  absolutePath: string
}

type Layer = {
  scope: string
  directory: string
  path: string
  absolutePath: string
  exists: boolean
  agentKeys: number
}

function resolveAbsolutePath(directory: string, relativePath: string) {
  const normalizedDirectory = directory.replace(/\\/g, "/")
  const normalizedRelative = relativePath.replace(/\\/g, "/")
  const isAbsolute = /^[a-zA-Z]:\//.test(normalizedRelative) || normalizedRelative.startsWith("/")
  const merged = isAbsolute ? normalizedRelative : `${normalizedDirectory}/${normalizedRelative}`
  const parts = merged.split("/")
  const stack: string[] = []
  for (const part of parts) {
    if (!part || part === ".") continue
    if (part === "..") {
      const last = stack[stack.length - 1]
      if (last && last !== ".." && !/^[a-zA-Z]:$/.test(last)) {
        stack.pop()
      }
      continue
    }
    stack.push(part)
  }
  if (stack.length === 0) return normalizedDirectory
  if (/^[a-zA-Z]:$/.test(stack[0])) {
    return `${stack[0]}/${stack.slice(1).join("/")}`
  }
  return `/${stack.join("/")}`
}

function parseModel(value: string | undefined): AgentModel | undefined {
  if (!value) return
  const idx = value.indexOf("/")
  if (idx <= 0 || idx >= value.length - 1) return
  const providerID = value.slice(0, idx)
  const modelID = value.slice(idx + 1)
  if (!providerID || !modelID) return
  return { providerID, modelID }
}

function modelKey(value: AgentModel) {
  return `${value.providerID}/${value.modelID}`
}

function parseJSONC(text: string) {
  let result = ""
  let i = 0
  let inString = false
  let quote = '"'
  while (i < text.length) {
    const ch = text[i]
    const next = text[i + 1]
    if (inString) {
      result += ch
      if (ch === "\\") {
        if (next) {
          result += next
          i += 2
          continue
        }
      }
      if (ch === quote) inString = false
      i += 1
      continue
    }
    if (ch === '"' || ch === "'") {
      inString = true
      quote = ch
      result += ch
      i += 1
      continue
    }
    if (ch === "/" && next === "/") {
      i += 2
      while (i < text.length && text[i] !== "\n") i += 1
      continue
    }
    if (ch === "/" && next === "*") {
      i += 2
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i += 1
      i += 2
      continue
    }
    result += ch
    i += 1
  }
  const withoutTrailingComma = result.replace(/,\s*([}\]])/g, "$1")
  return JSON.parse(withoutTrailingComma) as OhMyConfig
}

function norm(input: string) {
  return input.toLowerCase().replace(/\(.*?\)/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
}

function aliasFromDescription(input: string) {
  const match = input.match(/\(([^()]+?)\s*-\s*OhMyOpenCode\)/i)
  if (!match?.[1]) return
  return norm(match[1])
}

function findKey(keys: string[], name: string, description: string) {
  if (keys.includes(name)) return name
  const named = norm(name)
  const byName = keys.find((key) => norm(key) === named)
  if (byName) return byName
  const alias = aliasFromDescription(description)
  if (!alias) return
  return keys.find((key) => norm(key) === alias)
}

function normalizePath(value: string) {
  return value.replace(/\\/g, "/").replace(/\/+$/g, "")
}

function parentDirs(start: string, stop: string) {
  const result: string[] = []
  const startPath = normalizePath(start)
  const stopPath = normalizePath(stop)
  if (!startPath || !stopPath) return result
  let current = startPath
  while (true) {
    result.push(current)
    if (current === stopPath) break
    const next = current.replace(/\/[^/]+$/, "")
    if (!next || next === current) break
    current = next
  }
  return result
}

function allParents(start: string) {
  const result: string[] = []
  let current = normalizePath(start)
  while (current) {
    result.push(current)
    const next = current.replace(/\/[^/]+$/, "")
    if (!next || next === current) break
    current = next
  }
  return result
}

export const SettingsAgents: Component = () => {
  const globalSDK = useGlobalSDK()
  const globalSync = useGlobalSync()
  const language = useLanguage()
  const models = useModels()
  const [draft, setDraft] = createStore<Record<string, string>>({})
  const [saving, setSaving] = createStore({ value: false })

  const [agentData] = createResource(
    () => globalSync.data.path.directory,
    (directory) =>
      globalSDK.client.app
        .agents(directory ? { directory } : undefined)
        .then((result) => result.data ?? [])
        .catch((error) => {
          showToast({
            title: language.t("common.requestFailed"),
            description: error instanceof Error ? error.message : String(error),
          })
          return []
        }),
  )

  const [ohMyConfig] = createResource(
    () => ({ directory: globalSync.data.path.directory, root: globalSync.data.path.worktree }),
    async (input): Promise<ConfigState | undefined> => {
      const candidates = [
        ...(input.directory
          ? allParents(input.directory).flatMap((directory) => [
              { directory, path: ".opencode/oh-my-opencode.jsonc" },
              { directory, path: ".opencode/dev/oh-my-opencode.jsonc" },
            ])
          : []),
        ...(input.root
          ? allParents(input.root).flatMap((directory) => [
              { directory, path: ".opencode/oh-my-opencode.jsonc" },
              { directory, path: ".opencode/dev/oh-my-opencode.jsonc" },
            ])
          : []),
      ]
      const unique = new Set<string>()

      for (const candidate of candidates) {
        const absolute = resolveAbsolutePath(candidate.directory, candidate.path)
        if (unique.has(absolute)) continue
        unique.add(absolute)
        const result = await globalSDK.client.file
          .read({ directory: candidate.directory, path: candidate.path })
          .catch(() => undefined)
        if (!result?.data?.content || result.data.type !== "text") continue
        try {
          const config = parseJSONC(result.data.content)
          return {
            config,
            directory: candidate.directory,
            path: candidate.path,
            absolutePath: resolveAbsolutePath(candidate.directory, candidate.path),
          }
        } catch {
          continue
        }
      }
    },
  )

  const [layers] = createResource(
    () => globalSync.data.path,
    async (path) => {
      const projectDirs = parentDirs(path.directory, path.worktree).toReversed()
      const extendedDirs = allParents(path.directory).toReversed()
      const candidates = [
        { scope: "global", directory: path.config, path: "config.jsonc" },
        { scope: "global", directory: path.config, path: "opencode.jsonc" },
        { scope: "global", directory: path.config, path: "opencode.json" },
        { scope: "home", directory: path.home, path: ".opencode/opencode.jsonc" },
        { scope: "home", directory: path.home, path: ".opencode/opencode.json" },
        ...projectDirs.flatMap((directory) => [
          { scope: "project", directory, path: "opencode.jsonc" },
          { scope: "project", directory, path: "opencode.json" },
          { scope: ".opencode", directory, path: ".opencode/opencode.jsonc" },
          { scope: ".opencode", directory, path: ".opencode/opencode.json" },
          { scope: "oh-my-opencode", directory, path: ".opencode/oh-my-opencode.jsonc" },
        ]),
        ...extendedDirs.flatMap((directory) => [
          { scope: "extended", directory, path: ".opencode/oh-my-opencode.jsonc" },
          { scope: "extended", directory, path: ".opencode/dev/oh-my-opencode.jsonc" },
        ]),
      ]

      const unique = new Set<string>()
      const result: Layer[] = []
      for (const item of candidates) {
        const absolutePath = resolveAbsolutePath(item.directory, item.path)
        if (unique.has(absolutePath)) continue
        unique.add(absolutePath)
        const data = await globalSDK.client.file.read({ directory: item.directory, path: item.path }).catch(() => undefined)
        if (!data?.data || data.data.type !== "text") {
          result.push({ ...item, absolutePath, exists: false, agentKeys: 0 })
          continue
        }
        const parsed = (() => {
          try {
            return parseJSONC(data.data.content)
          } catch {
            return {}
          }
        })() as { agent?: Record<string, unknown>; agents?: Record<string, unknown> }
        const keyCount = Object.keys(parsed.agent ?? {}).length + Object.keys(parsed.agents ?? {}).length
        result.push({ ...item, absolutePath, exists: true, agentKeys: keyCount })
      }
      return result
    },
  )

  const [saveTarget] = createResource(
    () => globalSync.data.path.config,
    async (directory) => {
      const files = ["opencode.jsonc", "opencode.json", "config.json"]
      for (const path of files) {
        const data = await globalSDK.client.file.read({ directory, path }).catch(() => undefined)
        if (!data?.data || data.data.type !== "text") continue
        return resolveAbsolutePath(directory, path)
      }
      return resolveAbsolutePath(directory, files[0])
    },
  )

  const options = createMemo<Option[]>(() =>
    (() => {
      const base = models.list().map((item) => ({
        value: `${item.provider.id}/${item.id}`,
        label: `${item.provider.name} / ${item.name}`,
      }))

      const merged = new Map(base.map((item) => [item.value, item]))

      for (const entry of Object.values(ohMyConfig()?.config.agents ?? {})) {
        const model = entry.model?.trim()
        if (!model || merged.has(model)) continue
        merged.set(model, { value: model, label: model })
      }

      for (const entry of Object.values(globalSync.data.config.agent ?? {})) {
        const configured = entry?.model?.trim()
        if (!configured || merged.has(configured)) continue
        merged.set(configured, { value: configured, label: configured })
      }

      return Array.from(merged.values()).sort((a, b) => a.label.localeCompare(b.label))
    })(),
  )

  const optionMap = createMemo(() => new Map(options().map((x) => [x.value, x])))

  const agents = createMemo<AgentItem[]>(() =>
    (agentData() ?? [])
      .filter((item) => item.mode !== "subagent" && !item.hidden)
      .map((item) => {
        const description = item.description ?? item.name
        const globalKeys = Object.keys(globalSync.data.config.agent ?? {})
        const ohMyKeys = Object.keys(ohMyConfig()?.config.agents ?? {})
        const key = findKey(globalKeys, item.name, description) ?? findKey(ohMyKeys, item.name, description) ?? item.name
        return {
          key,
          name: item.name,
          description,
          model: item.model,
          configuredModel: draft[key] ?? globalSync.data.config.agent?.[key]?.model ?? ohMyConfig()?.config.agents?.[key]?.model,
        }
      })
      .sort((a, b) => a.name.localeCompare(b.name)),
  )

  const selected = (agent: AgentItem) => {
    if (agent.configuredModel) {
      const direct = optionMap().get(agent.configuredModel)
      if (direct) return direct
    }
    const fromConfig = parseModel(agent.configuredModel)
    if (fromConfig) {
      const parsed = optionMap().get(modelKey(fromConfig))
      if (parsed) return parsed
    }
    if (agent.model) return optionMap().get(modelKey(agent.model))
    return
  }

  const setModel = (agent: AgentItem, option: Option | undefined) => {
    if (!option) return
    setDraft(agent.key, option.value)
  }

  const dirty = createMemo(() => Object.keys(draft).length > 0)

  const save = () => {
    const entries = Object.entries(draft)
    if (entries.length === 0 || saving.value) return

    const before = Object.fromEntries(entries.map(([key]) => [key, globalSync.data.config.agent?.[key]]))
    for (const [key, model] of entries) {
      globalSync.set("config", "agent", key, { ...(before[key] ?? {}), model })
    }

    setSaving("value", true)
    globalSync
      .updateConfig({
        agent: Object.fromEntries(entries.map(([key, model]) => [key, { model }])),
      })
      .then(() => {
        setDraft({})
        showToast({ variant: "success", title: "Saved" })
      })
      .catch((error) => {
        for (const [key] of entries) {
          globalSync.set("config", "agent", key, before[key])
        }
        showToast({
          title: language.t("common.requestFailed"),
          description: error instanceof Error ? error.message : String(error),
        })
      })
      .finally(() => {
        setSaving("value", false)
      })
  }

  return (
    <div class="flex flex-col h-full overflow-y-auto no-scrollbar">
      <div class="sticky top-0 z-10 bg-[linear-gradient(to_bottom,var(--surface-raised-stronger-non-alpha)_calc(100%_-_24px),transparent)]">
        <div class="flex flex-col gap-2 px-4 py-8 sm:p-8 max-w-[720px]">
          <h2 class="text-16-medium text-text-strong">{language.t("settings.agents.title")}</h2>
          <p class="text-14-regular text-text-weak">{language.t("settings.agents.description")}</p>
          <div class="text-12-regular text-text-weak break-all">
            Config path: {ohMyConfig()?.absolutePath ?? "(not found)"}
          </div>
          <div class="text-12-regular text-text-weak break-all">
            Save target: {saveTarget() ?? "(loading...)"}
          </div>
          <div class="text-12-regular text-text-weak break-all">
            Server base: {globalSync.data.path.directory}
          </div>
          <div class="text-12-regular text-text-weak break-all">
            Worktree root: {globalSync.data.path.worktree}
          </div>
          <div class="text-12-regular text-text-weak break-all">
            Global config dir: {globalSync.data.path.config}
          </div>
          <div class="text-12-regular text-text-weak">
            Hierarchy probe (low -&gt; high override):
          </div>
          <div class="text-11-regular text-text-weak max-h-28 overflow-y-auto border border-border-weak-base rounded p-2">
            <For each={layers() ?? []}>
              {(item) => (
                <div class="break-all">
                  [{item.scope}] {item.exists ? "found" : "missing"} | {item.agentKeys > 0 ? `agent keys: ${item.agentKeys}` : "no agent override"} | {item.absolutePath}
                </div>
              )}
            </For>
          </div>
          <div>
            <Button variant="secondary" size="small" class="min-h-9 px-3" onClick={save} disabled={!dirty() || saving.value}>
              {saving.value ? "Saving..." : "Save"}
            </Button>
          </div>
        </div>
      </div>

      <div class="flex flex-col gap-6 px-4 py-6 sm:p-8 sm:pt-6 max-w-[720px]">
        <div class="border border-border-weak-base rounded-lg overflow-hidden">
          <Show
            when={agents().length > 0}
            fallback={
              <div class="px-4 py-3 text-14-regular text-text-weak">{language.t("dialog.model.empty")}</div>
            }
          >
            <For each={agents()}>
              {(item) => (
                <SettingsRow title={item.name} description={item.description}>
                  <Select
                    options={options()}
                    current={selected(item)}
                    value={(x) => x.value}
                    label={(x) => x.label}
                    onSelect={(option) => setModel(item, option)}
                    variant="secondary"
                    size="small"
                    triggerVariant="settings"
                  />
                </SettingsRow>
              )}
            </For>
          </Show>
        </div>
      </div>
    </div>
  )
}

interface SettingsRowProps {
  title: string
  description: string
  children: JSX.Element
}

const SettingsRow: Component<SettingsRowProps> = (props) => {
  return (
    <div class="flex flex-wrap items-center justify-between gap-4 px-4 py-3 border-b border-border-weak-base last:border-none">
      <div class="flex flex-col gap-0.5 min-w-0">
        <span class="text-14-medium text-text-strong">{props.title}</span>
        <span class="text-12-regular text-text-weak">{props.description}</span>
      </div>
      <div class="flex-shrink-0">{props.children}</div>
    </div>
  )
}
