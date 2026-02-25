import { Component } from "solid-js"
import { createStore } from "solid-js/store"
import { Dialog } from "@opencode-ai/ui/dialog"
import { Button } from "@opencode-ai/ui/button"
import { Tabs } from "@opencode-ai/ui/tabs"
import { Icon } from "@opencode-ai/ui/icon"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { SettingsGeneral } from "./settings-general"
import { SettingsKeybinds } from "./settings-keybinds"
import { SettingsProviders } from "./settings-providers"
import { SettingsModels } from "./settings-models"

import { SettingsAgents } from "./settings-agents"
import { SettingsWorkspaceSync } from "./settings-workspace-sync"

export const DialogSettings: Component = () => {
  const language = useLanguage()
  const platform = usePlatform()
  const [view, setView] = createStore({
    zoom: 1 as 0 | 1 | 2,
  })
  const branch = import.meta.env.VITE_APP_GIT_BRANCH || "unknown"
  const revision = import.meta.env.VITE_APP_GIT_REVISION || "unknown"
  const revisionNumber = import.meta.env.VITE_APP_GIT_REVISION_NUMBER || "unknown"

  const zoomClass = () => {
    if (view.zoom === 0) return "settings-dialog-compact"
    if (view.zoom === 2) return "settings-dialog-expanded"
    return "settings-dialog-normal"
  }

  const zoomOut = () => setView("zoom", (value) => (value > 0 ? ((value - 1) as 0 | 1 | 2) : value))
  const zoomIn = () => setView("zoom", (value) => (value < 2 ? ((value + 1) as 0 | 1 | 2) : value))
  const zoomReset = () => setView("zoom", 1)

  return (
    <Dialog size="x-large" transition containerClass={`settings-dialog-shell ${zoomClass()}`}>
      <Tabs orientation="vertical" variant="settings" defaultValue="general" class="h-full settings-dialog relative">
        <div class="settings-dialog-zoom-controls">
          <Button
            variant="secondary"
            size="small"
            aria-label="Zoom out settings"
            onClick={zoomOut}
            disabled={view.zoom === 0}
          >
            -
          </Button>
          <Button variant="secondary" size="small" aria-label="Reset settings size" onClick={zoomReset}>
            100%
          </Button>
          <Button
            variant="secondary"
            size="small"
            aria-label="Zoom in settings"
            onClick={zoomIn}
            disabled={view.zoom === 2}
          >
            +
          </Button>
        </div>
        <Tabs.List>
          <div class="flex flex-col justify-between h-full w-full">
            <div class="flex flex-col gap-3 w-full pt-3">
              <div class="flex flex-col gap-3">
                <div class="flex flex-col gap-1.5">
                  <Tabs.SectionTitle>{language.t("settings.section.desktop")}</Tabs.SectionTitle>
                  <div class="flex flex-col gap-1.5 w-full">
                    <Tabs.Trigger value="general">
                      <Icon name="sliders" />
                      {language.t("settings.tab.general")}
                    </Tabs.Trigger>
                    <Tabs.Trigger value="shortcuts">
                      <Icon name="keyboard" />
                      {language.t("settings.tab.shortcuts")}
                    </Tabs.Trigger>
                  </div>
                </div>

                <div class="flex flex-col gap-1.5">
                  <Tabs.SectionTitle>{language.t("settings.section.server")}</Tabs.SectionTitle>
                  <div class="flex flex-col gap-1.5 w-full">
                    <Tabs.Trigger value="providers">
                      <Icon name="providers" />
                      {language.t("settings.providers.title")}
                    </Tabs.Trigger>
                    <Tabs.Trigger value="models">
                      <Icon name="models" />
                      {language.t("settings.models.title")}
                    </Tabs.Trigger>
                    <Tabs.Trigger value="agents">
                      <Icon name="models" />
                      {language.t("settings.agents.title")}
                    </Tabs.Trigger>
                    <Tabs.Trigger value="workspace-sync">
                      <Icon name="folder" />
                      Workspace Sync
                    </Tabs.Trigger>
                  </div>
                </div>
              </div>
            </div>
            <div class="flex flex-col gap-1 pl-1 py-1 text-12-medium text-text-weak">
              <span>{language.t("app.name.desktop")}</span>
              <span class="text-11-regular">v{platform.version}</span>
              <span class="text-11-regular">{branch}</span>
              <span class="text-11-regular">rev#{revisionNumber}</span>
              <span class="text-11-regular">{revision}</span>
            </div>
          </div>
        </Tabs.List>
        <Tabs.Content value="general" class="no-scrollbar">
          <SettingsGeneral />
        </Tabs.Content>
        <Tabs.Content value="shortcuts" class="no-scrollbar">
          <SettingsKeybinds />
        </Tabs.Content>
        <Tabs.Content value="providers" class="no-scrollbar">
          <SettingsProviders />
        </Tabs.Content>
        <Tabs.Content value="models" class="no-scrollbar">
          <SettingsModels />
        </Tabs.Content>
        <Tabs.Content value="agents" class="no-scrollbar">
          <SettingsAgents />
        </Tabs.Content>
        <Tabs.Content value="workspace-sync" class="no-scrollbar">
          <SettingsWorkspaceSync />
        </Tabs.Content>
      </Tabs>
    </Dialog>
  )
}
