import { Select } from "@opencode-ai/ui/select"
import { showToast } from "@opencode-ai/ui/toast"
import { Component, For, Show, createMemo, type JSX } from "solid-js"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
import { useModels } from "@/context/models"
import { useSync } from "@/context/sync"

type Option = {
  value: string
  label: string
}

type AgentModel = {
  providerID: string
  modelID: string
}

type AgentItem = {
  name: string
  description: string
  model?: AgentModel
  configuredModel?: string
}

function parseModel(value: string | undefined): AgentModel | undefined {
  if (!value) return
  const [providerID, modelID] = value.split("/")
  if (!providerID || !modelID) return
  return { providerID, modelID }
}

function modelKey(value: AgentModel) {
  return `${value.providerID}/${value.modelID}`
}

export const SettingsAgents: Component = () => {
  const globalSync = useGlobalSync()
  const sync = useSync()
  const language = useLanguage()
  const models = useModels()

  const options = createMemo<Option[]>(() =>
    models
      .list()
      .map((item) => ({
        value: `${item.provider.id}/${item.id}`,
        label: `${item.provider.name} / ${item.name}`,
      }))
      .sort((a, b) => a.label.localeCompare(b.label)),
  )

  const optionMap = createMemo(() => new Map(options().map((x) => [x.value, x])))

  const agents = createMemo<AgentItem[]>(() =>
    sync.data.agent
      .filter((item) => item.mode !== "subagent" && !item.hidden)
      .map((item) => ({
        name: item.name,
        description: item.description ?? item.name,
        model: item.model,
        configuredModel: globalSync.data.config.agent?.[item.name]?.model,
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  )

  const selected = (agent: AgentItem) => {
    const fromConfig = parseModel(agent.configuredModel)
    if (fromConfig) return optionMap().get(modelKey(fromConfig))
    if (agent.model) return optionMap().get(modelKey(agent.model))
    return
  }

  const save = (name: string, option: Option | undefined) => {
    if (!option) return
    const before = globalSync.data.config.agent?.[name]
    const next = {
      ...(before ?? {}),
      model: option.value,
    }

    globalSync.set("config", "agent", name, next)
    globalSync.updateConfig({
      agent: {
        [name]: {
          model: option.value,
        },
      },
    }).catch((error) => {
      globalSync.set("config", "agent", name, before)
      showToast({
        title: language.t("common.requestFailed"),
        description: error instanceof Error ? error.message : String(error),
      })
    })
  }

  return (
    <div class="flex flex-col h-full overflow-y-auto no-scrollbar">
      <div class="sticky top-0 z-10 bg-[linear-gradient(to_bottom,var(--surface-raised-stronger-non-alpha)_calc(100%_-_24px),transparent)]">
        <div class="flex flex-col gap-1 px-4 py-8 sm:p-8 max-w-[720px]">
          <h2 class="text-16-medium text-text-strong">{language.t("settings.agents.title")}</h2>
          <p class="text-14-regular text-text-weak">{language.t("settings.agents.description")}</p>
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
                    onSelect={(option) => save(item.name, option)}
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
