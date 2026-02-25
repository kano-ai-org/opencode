import { Button } from "@opencode-ai/ui/button"
import { Tabs } from "@opencode-ai/ui/tabs"
import { showToast } from "@opencode-ai/ui/toast"
import { Component, For, Show, createMemo, createResource, createSignal } from "solid-js"
import { createStore } from "solid-js/store"
import { useLayout } from "@/context/layout"
import { useLanguage } from "@/context/language"
import { useLocation, useNavigate } from "@solidjs/router"
import { base64Encode } from "@opencode-ai/util/encode"
import { useServer } from "@/context/server"
import { TextField } from "@opencode-ai/ui/text-field"
import { workspaceMatch } from "@/pages/layout/helpers"
import { Avatar } from "@opencode-ai/ui/avatar"

const isTempProject = (worktree: string) => {
  const value = worktree.replace(/\\/g, "/").toLowerCase()
  if (value.includes("/appdata/local/temp/")) return true
  if (value.includes("/tmp/")) return true
  if (value.includes("/var/folders/")) return true
  if (value.includes("opencode-e2e-")) return true
  if (value.includes("opencode-test-")) return true
  return false
}

const isInternalGitMeta = (worktree: string) => {
  const value = worktree.replace(/\\/g, "/").toLowerCase()
  return value.includes("/.git/modules/")
}

const isGlobalProject = (projectID: string) => projectID === "global"

const displayDirectory = (worktree: string) => {
  if (!worktree || worktree === "/") return "(unknown)"
  return worktree
}

const isSubagent = (session: { title: string; parentID?: string }) => {
  if (session.parentID) return true
  return /(^|\s)@\w+\s+subagent(\s|$)/i.test(session.title)
}

const time = (value?: number) => {
  if (!value) return "-"
  return new Date(value).toLocaleString()
}

const WorkspaceIcon = (props: { icon?: { override?: string; color?: string }; title: string }) => (
  <div class="size-5 rounded-[6px] overflow-hidden bg-surface-weak flex items-center justify-center shrink-0">
    <Avatar
      fallback={props.title}
      src={props.icon?.override}
      style={{ background: props.icon?.color }}
      class="size-full rounded-[6px]"
    />
  </div>
)

export const SettingsWorkspaceSync: Component = () => {
  const layout = useLayout()
  const language = useLanguage()
  const navigate = useNavigate()
  const location = useLocation()
  const server = useServer()
  const [tick, setTick] = createSignal(0)
  const [transfer, setTransfer] = createStore({
    busy: false,
    url: "",
  })
  const [detail, setDetail] = createStore({
    worktree: "",
    showSubagent: false,
  })
  let upload: HTMLInputElement | undefined

  const [snapshot] = createResource(
    () => tick(),
    () => layout.workspaceSync.snapshot().catch(() => []),
  )

  const local = createMemo(() => layout.workspaceSync.localKeys())
  const rows = createMemo(() => snapshot() ?? [])
  const sourceRows = createMemo(() => ({
    merged: rows().filter(
      (row) =>
        row.source === "merged" && !isTempProject(row.worktree) && !isInternalGitMeta(row.worktree) && row.pathStatus === "ok" && row.missingPaths.length === 0,
    ),
    opened: rows().filter(
      (row) =>
        row.source === "opened" && !isTempProject(row.worktree) && !isInternalGitMeta(row.worktree) && row.pathStatus === "ok" && row.missingPaths.length === 0,
    ),
    indexed: rows().filter(
      (row) =>
        row.source === "indexed" && !isTempProject(row.worktree) && !isInternalGitMeta(row.worktree) && row.pathStatus === "ok" && row.missingPaths.length === 0,
    ),
  }))
  const tempRows = createMemo(() => rows().filter((row) => isTempProject(row.worktree) && row.missingPaths.length === 0))
  const internalRows = createMemo(() => rows().filter((row) => isInternalGitMeta(row.worktree)))
  const missingRows = createMemo(
    () => rows().filter((row) => row.projectID !== "global" && row.pathStatus !== "ok" && !isInternalGitMeta(row.worktree)),
  )

  const refresh = async () => {
    await layout.workspaceSync.refresh()
    setTick((value) => value + 1)
  }

  const refreshSafe = () => {
    void refresh().catch((error) => {
      showToast({
        title: language.t("common.requestFailed"),
        description: error instanceof Error ? error.message : String(error),
      })
    })
  }

  const headers = (json = false) => {
    return {
      ...(json ? { "Content-Type": "application/json" } : undefined),
    }
  }

  const pullExport = () => {
    setTransfer("busy", true)
    void fetch(`${server.url}/session/export`, { headers: headers() })
      .then(async (response) => {
        if (!response.ok) throw new Error(`export failed: ${response.status}`)
        const blob = await response.blob()
        const link = document.createElement("a")
        const url = URL.createObjectURL(blob)
        link.href = url
        link.download = `opencode-session-export-${Date.now()}.json`
        link.click()
        URL.revokeObjectURL(url)
      })
      .catch((error) => {
        showToast({
          title: language.t("common.requestFailed"),
          description: error instanceof Error ? error.message : String(error),
        })
      })
      .finally(() => setTransfer("busy", false))
  }

  const pushFile = (file?: File) => {
    if (!file) return
    const form = new FormData()
    form.set("file", file)
    setTransfer("busy", true)
    void fetch(`${server.url}/session/import`, {
      method: "POST",
      headers: headers(),
      body: form,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`import failed: ${response.status}`)
        await refresh()
        showToast({ variant: "success", title: "Import finished" })
      })
      .catch((error) => {
        showToast({
          title: language.t("common.requestFailed"),
          description: error instanceof Error ? error.message : String(error),
        })
      })
      .finally(() => setTransfer("busy", false))
  }

  const pushUrl = () => {
    if (!transfer.url.trim()) return
    setTransfer("busy", true)
    void fetch(`${server.url}/session/import`, {
      method: "POST",
      headers: headers(true),
      body: JSON.stringify({ url: transfer.url.trim() }),
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`import failed: ${response.status}`)
        await refresh()
        showToast({ variant: "success", title: "Import finished" })
      })
      .catch((error) => {
        showToast({
          title: language.t("common.requestFailed"),
          description: error instanceof Error ? error.message : String(error),
        })
      })
      .finally(() => setTransfer("busy", false))
  }

  const diagnostics = createMemo(() =>
    JSON.stringify(
      {
        generatedAt: Date.now(),
        localKeys: local(),
        projects: snapshot() ?? [],
      },
      null,
      2,
    ),
  )

  const detailRows = createMemo(() => {
    if (!detail.worktree) return []
    const values = rows().find((row) => row.worktree === detail.worktree)?.sessions ?? []
    if (detail.showSubagent) return values
    return values.filter((session) => !isSubagent(session))
  })
  const detailSummary = createMemo(() => ({
    active: detailRows().filter((x) => !x.archived).length,
    archived: detailRows().filter((x) => x.archived).length,
  }))
  const detailHidden = createMemo(() => {
    if (!detail.worktree) return 0
    const values = rows().find((row) => row.worktree === detail.worktree)?.sessions ?? []
    return values.filter((session) => isSubagent(session)).length
  })
  const currentSessionID = createMemo(() => location.pathname.match(/\/session\/([^/]+)/)?.[1] ?? "")
  const [currentSession] = createResource(currentSessionID, async (id) => {
    if (!id) return
    const response = await fetch(`${server.url}/session/${encodeURIComponent(id)}`, { headers: headers() }).catch(() => undefined)
    if (!response?.ok) return
    return (await response.json().catch(() => undefined)) as
      | { id: string; directory: string; title: string; time?: { archived?: number } }
      | undefined
  })
  const owner = createMemo(() => {
    const item = currentSession()
    if (!item) return
    const row = rows().find((row) => workspaceMatch(item.directory, row.worktree))
    if (!row) return
    return row
  })

  const copyDiagnostics = () => {
    const value = diagnostics()
    void navigator.clipboard
      .writeText(value)
      .then(() => showToast({ variant: "success", title: "Diagnostics copied" }))
      .catch((error) => {
        showToast({
          title: language.t("common.requestFailed"),
          description: error instanceof Error ? error.message : String(error),
        })
      })
  }

  const openProject = (worktree: string) => {
    layout.projects.open(worktree)
    navigate(`/${base64Encode(worktree)}`)
  }

  const removeProject = (projectID: string) => {
    const worktree = snapshot()?.find((x) => x.projectID === projectID)?.worktree
    void layout.workspaceSync
      .deleteProject(projectID, worktree)
      .then(() => layout.workspaceSync.refresh())
      .then(() => setTick((value) => value + 1))
      .catch((error) => {
        showToast({
          title: language.t("common.requestFailed"),
          description: error instanceof Error ? error.message : String(error),
        })
      })
  }

  const removeTemp = () => {
    const items = tempRows().filter((row) => row.projectID !== "global")
    void Promise.all(items.map((row) => layout.workspaceSync.deleteProject(row.projectID, row.worktree)))
      .then(() => layout.workspaceSync.refresh())
      .then(() => setTick((value) => value + 1))
      .catch((error) => {
        showToast({
          title: language.t("common.requestFailed"),
          description: error instanceof Error ? error.message : String(error),
        })
      })
  }

  const openDetail = (worktree: string) => {
    setDetail({ worktree, showSubagent: false })
  }

  const backToTab = () => {
    setDetail({ worktree: "", showSubagent: false })
  }

  const removeSession = (id: string) => {
    setTransfer("busy", true)
    void fetch(`${server.url}/session/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: headers(),
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`session delete failed: ${response.status}`)
        await refresh()
        showToast({ variant: "success", title: "Session deleted" })
      })
      .catch((error) => {
        showToast({
          title: language.t("common.requestFailed"),
          description: error instanceof Error ? error.message : String(error),
        })
      })
      .finally(() => setTransfer("busy", false))
  }

  return (
    <div
      class="flex flex-col h-full overflow-hidden"
      style={{ "touch-action": "pan-y", "overscroll-behavior": "contain", "-webkit-overflow-scrolling": "touch" }}
    >
      <div class="sticky top-0 z-10 bg-[linear-gradient(to_bottom,var(--surface-raised-stronger-non-alpha)_calc(100%_-_24px),transparent)]">
        <div class="flex flex-col gap-2 px-4 py-6 sm:p-8 max-w-[920px]">
          <h2 class="text-16-medium text-text-strong">Workspace Sync Keys</h2>
          <p class="text-14-regular text-text-weak">
            Show local cached keys and server keys per project, then refresh on demand.
          </p>
          <p class="text-12-regular text-text-weak break-all">Current server: {server.url}</p>
          <p class="text-12-regular text-text-weak break-all">Instance ID: {server.identity() ?? "(resolving...)"}</p>
          {server.identity() ? null : <p class="text-11-regular text-text-warning-base break-all">identity status: {server.identityError() ?? "resolving"}</p>}
          <p class="text-12-regular text-text-weak">Sources: merged, opened, indexed.</p>
          <div class="flex flex-wrap gap-2">
            <Button variant="secondary" size="small" onClick={refreshSafe} class="min-h-9 px-3">
              Refresh from server
            </Button>
            <Button variant="secondary" size="small" onClick={copyDiagnostics} class="min-h-9 px-3">
              Copy diagnostics JSON
            </Button>
          </div>
        </div>
      </div>

      <div class="flex-1 overflow-y-auto px-4 pb-20 sm:px-8 sm:pb-8" style={{ "touch-action": "pan-y" }}>
        <div class="pt-3 sm:pt-2 max-w-[920px]">
          <Tabs defaultValue="overview" class="flex flex-col gap-4">
            <Tabs.List class="flex gap-2 overflow-x-auto pb-1">
              <Tabs.Trigger value="overview">Overview</Tabs.Trigger>
              <Tabs.Trigger value="merged">Merged</Tabs.Trigger>
              <Tabs.Trigger value="opened">Opened</Tabs.Trigger>
              <Tabs.Trigger value="indexed">Indexed</Tabs.Trigger>
              <Tabs.Trigger value="temp">Temporary</Tabs.Trigger>
              <Tabs.Trigger value="missing">Missing Paths</Tabs.Trigger>
              <Tabs.Trigger value="internal">Internal</Tabs.Trigger>
              <Tabs.Trigger value="raw-json">Raw JSON</Tabs.Trigger>
            </Tabs.List>

            <Show
              when={!detail.worktree}
              fallback={
                <div class="flex flex-col gap-3">
                  <div class="flex items-center justify-between">
                    <div class="flex items-center gap-2 min-w-0">
                      <WorkspaceIcon icon={rows().find((row) => row.worktree === detail.worktree)?.icon} title={detail.worktree} />
                      <div class="text-13-medium text-text-strong break-all">Session details: {detail.worktree}</div>
                    </div>
                    <Button variant="secondary" size="small" class="min-h-8 px-3" onClick={backToTab}>
                      Back
                    </Button>
                  </div>
                  <div class="text-11-regular text-text-weak">
                    {detailRows().length} session(s) | active: {detailSummary().active} | archived: {detailSummary().archived}
                  </div>
                  <div class="flex items-center gap-2">
                    <Button
                      variant="secondary"
                      size="small"
                      class="min-h-8 px-3"
                      onClick={() => setDetail("showSubagent", (value) => !value)}
                    >
                      {detail.showSubagent ? "Hide subagent sessions" : `Show subagent sessions (${detailHidden()})`}
                    </Button>
                  </div>
                  <Show when={currentSession()}>
                    {(session) => {
                      const entry = session()
                      const inWorkspace = detailRows().some((item) => item.id === entry.id)
                      const own = owner()
                      return (
                        <div class="border border-border-weak-base rounded-lg p-3 bg-surface-raised-base">
                          <div class="text-12-medium text-text-strong">Current URL session</div>
                          <div class="text-11-regular text-text-weak break-all">{entry.id}</div>
                          <div class="text-11-regular text-text-weak break-all">directory: {entry.directory}</div>
                          <div class="text-11-regular text-text-weak">
                            state: {typeof entry.time?.archived === "number" ? "archived" : "active"} | in this workspace list: {String(inWorkspace)}
                          </div>
                          <div class="text-11-regular text-text-weak break-all">owner workspace: {own?.worktree ?? "(unresolved)"}</div>
                          <Show when={own && own.worktree !== detail.worktree}>
                            <div class="pt-2">
                              <Button variant="secondary" size="small" class="min-h-8 px-3" onClick={() => setDetail({ worktree: own!.worktree })}>
                                Go to owner workspace
                              </Button>
                            </div>
                          </Show>
                        </div>
                      )
                    }}
                  </Show>
                  <For each={detailRows()}>
                    {(session) => (
                      <div class="border border-border-weak-base rounded-lg p-3 bg-surface-raised-base flex items-center justify-between gap-3">
                        <div class="min-w-0">
                          <div class="text-12-medium text-text-strong break-all">{session.title}</div>
                          <div class="text-11-regular text-text-weak">
                            {session.archived ? "archived" : "active"} | {isSubagent(session) ? "subagent" : "human"}
                          </div>
                          <div class="text-11-regular text-text-weak">created: {time(session.created)}</div>
                          <div class="text-11-regular text-text-weak">archived: {time(session.archivedAt)}</div>
                          <div class="text-11-regular text-text-weak break-all">{session.id}</div>
                        </div>
                        <div class="flex gap-2">
                          <Button variant="secondary" size="small" class="min-h-8 px-3" onClick={() => navigate(`/${base64Encode(detail.worktree)}/session/${session.id}`)}>
                            Open
                          </Button>
                          <Button variant="secondary" size="small" class="min-h-8 px-3" disabled={transfer.busy} onClick={() => removeSession(session.id)}>
                            Delete
                          </Button>
                        </div>
                      </div>
                    )}
                  </For>
                  {detailRows().length === 0 ? (
                    <div class="border border-border-weak-base rounded-lg p-4 bg-surface-raised-base text-12-regular text-text-weak">(empty)</div>
                  ) : null}
                </div>
              }
            >
            <Tabs.Content value="overview" class="flex flex-col gap-6">
              <div class="border border-border-weak-base rounded-lg p-4 bg-surface-raised-base">
                <div class="text-13-medium text-text-strong mb-2">Session transfer</div>
                <div class="flex flex-wrap gap-2">
                  <Button variant="secondary" size="small" class="min-h-9 px-3" onClick={pullExport} disabled={transfer.busy}>
                    Export JSON
                  </Button>
                  <Button variant="secondary" size="small" class="min-h-9 px-3" onClick={() => upload?.click()} disabled={transfer.busy}>
                    Import file
                  </Button>
                </div>
                <input
                  ref={(el) => (upload = el)}
                  type="file"
                  accept=".json,.tar,.tgz,.gz,.zip"
                  class="hidden"
                  onChange={(event) => {
                    const file = event.currentTarget.files?.[0]
                    pushFile(file)
                    event.currentTarget.value = ""
                  }}
                />
                <div class="pt-3">
                  <TextField
                    type="text"
                    hideLabel
                    placeholder="Import URL (Dropbox direct link, etc.)"
                    value={transfer.url}
                    onChange={(value) => setTransfer("url", value)}
                  />
                  <div class="pt-2">
                    <Button
                      variant="secondary"
                      size="small"
                      class="min-h-9 px-3"
                      onClick={pushUrl}
                      disabled={transfer.busy || !transfer.url.trim()}
                    >
                      Import URL
                    </Button>
                  </div>
                </div>
              </div>

              <div class="border border-border-weak-base rounded-lg p-4 bg-surface-raised-base">
                <div class="text-13-medium text-text-strong mb-2">Local cached keys</div>
                    <div class="text-12-regular text-text-weak break-all max-h-40 overflow-y-auto pr-1">
                      <For each={local()}>{(key) => <div>{key}</div>}</For>
                      <div class="empty:hidden" />
                      {local().length === 0 ? <div>(empty)</div> : null}
                    </div>
                  </div>

                  <div class="border border-border-weak-base rounded-lg p-4 bg-surface-raised-base">
                    <div class="text-13-medium text-text-strong mb-2">Workspace session counts</div>
                    <div class="text-12-regular text-text-weak flex flex-col gap-2">
                      <For each={rows().slice().sort((a, b) => b.sessionCount - a.sessionCount)}>
                        {(row) => (
                          <div class="flex items-center justify-between gap-2">
                            <div class="break-all">{row.worktree}</div>
                            <Button variant="secondary" size="small" class="min-h-8 px-3" onClick={() => openDetail(row.worktree)}>
                              {row.sessionCount} session(s)
                            </Button>
                          </div>
                        )}
                      </For>
                    </div>
                  </div>
                </Tabs.Content>

            <Tabs.Content value="merged" class="flex flex-col gap-3">
              <div class="text-11-regular text-text-weak">{sourceRows().merged.length} project(s)</div>
              <For each={sourceRows().merged}>
                {(row) => (
                  <div class="border border-border-weak-base rounded-lg p-4 bg-surface-raised-base flex flex-col gap-3">
                    <div>
                      <div class="flex items-center gap-2 min-w-0">
                        <WorkspaceIcon icon={row.icon} title={row.worktree} />
                        <div class="text-13-medium text-text-strong break-all">{row.worktree}</div>
                      </div>
                      {isGlobalProject(row.projectID) ? <div class="text-11-regular text-text-warning-base">Virtual project (global)</div> : null}
                      <div class="text-11-regular text-text-weak break-all">projectID: {row.projectID}</div>
                      <div class="text-11-regular text-text-weak break-all">directory: {displayDirectory(row.worktree)}</div>
                      <div class="text-11-regular text-text-weak">version: {row.version}</div>
                      <div class="text-11-regular text-text-weak">source: {row.source} | sandboxes: {row.sandboxCount}</div>
                      <div class="text-11-regular text-text-weak">sessions: {row.sessionCount}</div>
                      <div class="flex flex-wrap gap-2 pt-2">
                        <Button variant="secondary" size="small" class="min-h-9 px-3" onClick={() => openProject(row.worktree)}>
                          Open project
                        </Button>
                        <Button variant="secondary" size="small" class="min-h-9 px-3" onClick={() => openDetail(row.worktree)}>
                          Session details
                        </Button>
                        <Button
                          variant="secondary"
                          size="small"
                          class="min-h-9 px-3"
                          onClick={() => removeProject(row.projectID)}
                          disabled={isGlobalProject(row.projectID)}
                        >
                          Delete project
                        </Button>
                      </div>
                    </div>
                    <div>
                      <div class="text-12-medium text-text-strong">Sandboxes</div>
                      <div class="text-12-regular text-text-weak break-all">
                        <For each={row.sandboxes}>{(key) => <div>{key}</div>}</For>
                        {row.sandboxes.length === 0 ? <div>(empty)</div> : null}
                      </div>
                    </div>
                    <div>
                      <div class="text-12-medium text-text-strong">Local keys (matched)</div>
                      <div class="text-12-regular text-text-weak break-all">
                        <For each={row.local}>{(key) => <div>{key}</div>}</For>
                        {row.local.length === 0 ? <div>(empty)</div> : null}
                      </div>
                    </div>
                    <div>
                      <div class="text-12-medium text-text-strong">Server keys</div>
                      <div class="text-12-regular text-text-weak break-all">
                        <For each={row.remote}>{(key) => <div>{key}</div>}</For>
                        {row.remote.length === 0 ? <div>(empty)</div> : null}
                      </div>
                    </div>
                  </div>
                )}
              </For>
              {sourceRows().merged.length === 0 ? (
                <div class="border border-border-weak-base rounded-lg p-4 bg-surface-raised-base text-12-regular text-text-weak">(empty)</div>
              ) : null}
            </Tabs.Content>

            <Tabs.Content value="opened" class="flex flex-col gap-3">
              <div class="text-11-regular text-text-weak">{sourceRows().opened.length} project(s)</div>
              <For each={sourceRows().opened}>
                {(row) => (
                  <div class="border border-border-weak-base rounded-lg p-4 bg-surface-raised-base flex flex-col gap-3">
                    <div>
                      <div class="flex items-center gap-2 min-w-0">
                        <WorkspaceIcon icon={row.icon} title={row.worktree} />
                        <div class="text-13-medium text-text-strong break-all">{row.worktree}</div>
                      </div>
                      {isGlobalProject(row.projectID) ? <div class="text-11-regular text-text-warning-base">Virtual project (global)</div> : null}
                      <div class="text-11-regular text-text-weak break-all">projectID: {row.projectID}</div>
                      <div class="text-11-regular text-text-weak break-all">directory: {displayDirectory(row.worktree)}</div>
                      <div class="text-11-regular text-text-weak">version: {row.version}</div>
                      <div class="text-11-regular text-text-weak">source: {row.source} | sandboxes: {row.sandboxCount}</div>
                      <div class="text-11-regular text-text-weak">sessions: {row.sessionCount}</div>
                      <div class="flex flex-wrap gap-2 pt-2">
                        <Button variant="secondary" size="small" class="min-h-9 px-3" onClick={() => openProject(row.worktree)}>
                          Open project
                        </Button>
                        <Button variant="secondary" size="small" class="min-h-9 px-3" onClick={() => openDetail(row.worktree)}>
                          Session details
                        </Button>
                        <Button
                          variant="secondary"
                          size="small"
                          class="min-h-9 px-3"
                          onClick={() => removeProject(row.projectID)}
                          disabled={isGlobalProject(row.projectID)}
                        >
                          Delete project
                        </Button>
                      </div>
                    </div>
                  </div>
                )}
              </For>
              {sourceRows().opened.length === 0 ? (
                <div class="border border-border-weak-base rounded-lg p-4 bg-surface-raised-base text-12-regular text-text-weak">(empty)</div>
              ) : null}
            </Tabs.Content>

            <Tabs.Content value="indexed" class="flex flex-col gap-3">
              <div class="text-11-regular text-text-weak">{sourceRows().indexed.length} project(s)</div>
              <For each={sourceRows().indexed}>
                {(row) => (
                  <div class="border border-border-weak-base rounded-lg p-4 bg-surface-raised-base flex flex-col gap-3">
                    <div>
                      <div class="flex items-center gap-2 min-w-0">
                        <WorkspaceIcon icon={row.icon} title={row.worktree} />
                        <div class="text-13-medium text-text-strong break-all">{row.worktree}</div>
                      </div>
                      {isGlobalProject(row.projectID) ? <div class="text-11-regular text-text-warning-base">Virtual project (global)</div> : null}
                      <div class="text-11-regular text-text-weak break-all">projectID: {row.projectID}</div>
                      <div class="text-11-regular text-text-weak break-all">directory: {displayDirectory(row.worktree)}</div>
                      <div class="text-11-regular text-text-weak">version: {row.version}</div>
                      <div class="text-11-regular text-text-weak">source: {row.source} | sandboxes: {row.sandboxCount}</div>
                      <div class="text-11-regular text-text-weak">sessions: {row.sessionCount}</div>
                      <div class="flex flex-wrap gap-2 pt-2">
                        <Button variant="secondary" size="small" class="min-h-9 px-3" onClick={() => openProject(row.worktree)}>
                          Open project
                        </Button>
                        <Button variant="secondary" size="small" class="min-h-9 px-3" onClick={() => openDetail(row.worktree)}>
                          Session details
                        </Button>
                        <Button
                          variant="secondary"
                          size="small"
                          class="min-h-9 px-3"
                          onClick={() => removeProject(row.projectID)}
                          disabled={isGlobalProject(row.projectID)}
                        >
                          Delete project
                        </Button>
                      </div>
                    </div>
                  </div>
                )}
              </For>
              {sourceRows().indexed.length === 0 ? (
                <div class="border border-border-weak-base rounded-lg p-4 bg-surface-raised-base text-12-regular text-text-weak">(empty)</div>
              ) : null}
            </Tabs.Content>

            <Tabs.Content value="temp" class="flex flex-col gap-3">
              <div class="flex items-center justify-between">
                <div class="text-11-regular text-text-weak">{tempRows().length} project(s)</div>
                <Button variant="secondary" size="small" class="min-h-8 px-3" onClick={removeTemp} disabled={tempRows().length === 0}>
                  Delete all temp
                </Button>
              </div>
              <For each={tempRows()}>
                {(row) => (
                  <div class="border border-border-weak-base rounded-lg p-4 bg-surface-raised-base flex flex-col gap-3">
                    <div>
                      <div class="flex items-center gap-2 min-w-0">
                        <WorkspaceIcon icon={row.icon} title={row.worktree} />
                        <div class="text-13-medium text-text-strong break-all">{row.worktree}</div>
                      </div>
                      {isGlobalProject(row.projectID) ? <div class="text-11-regular text-text-warning-base">Virtual project (global)</div> : null}
                      <div class="text-11-regular text-text-weak break-all">projectID: {row.projectID}</div>
                      <div class="text-11-regular text-text-weak break-all">directory: {displayDirectory(row.worktree)}</div>
                      <div class="text-11-regular text-text-weak">source: {row.source}</div>
                      <div class="text-11-regular text-text-weak">sessions: {row.sessionCount}</div>
                      <div class="flex flex-wrap gap-2 pt-2">
                        <Button variant="secondary" size="small" class="min-h-9 px-3" onClick={() => openProject(row.worktree)}>
                          Open project
                        </Button>
                        <Button variant="secondary" size="small" class="min-h-9 px-3" onClick={() => openDetail(row.worktree)}>
                          Session details
                        </Button>
                        <Button
                          variant="secondary"
                        size="small"
                        class="min-h-9 px-3"
                        onClick={() => removeProject(row.projectID)}
                        disabled={isGlobalProject(row.projectID)}
                      >
                        Delete project
                      </Button>
                      </div>
                    </div>
                  </div>
                )}
              </For>
              {tempRows().length === 0 ? (
                <div class="border border-border-weak-base rounded-lg p-4 bg-surface-raised-base text-12-regular text-text-weak">(empty)</div>
              ) : null}
            </Tabs.Content>

            <Tabs.Content value="missing" class="flex flex-col gap-3">
              <div class="text-11-regular text-text-warning-base">{missingRows().length} project(s) with missing paths</div>
              <div class="text-12-regular text-text-weak">These paths may have been moved, renamed, or deleted. Review and decide whether to keep or delete those project records.</div>
              <For each={missingRows()}>
                {(row) => (
                  <div class="border border-border-warning-base rounded-lg p-4 bg-surface-raised-base flex flex-col gap-3">
                    <div>
                      <div class="flex items-center gap-2 min-w-0">
                        <WorkspaceIcon icon={row.icon} title={row.worktree} />
                        <div class="text-13-medium text-text-strong break-all">{row.worktree}</div>
                      </div>
                      <div class="text-11-regular text-text-weak break-all">projectID: {row.projectID}</div>
                      <div class="text-11-regular text-text-weak">source: {row.source} | path status: {row.pathStatus}</div>
                      <div class="text-11-regular text-text-weak">sessions: {row.sessionCount}</div>
                    </div>
                    <div>
                      <div class="text-12-medium text-text-warning-base">Missing paths</div>
                      <div class="text-12-regular text-text-weak break-all">
                        <For each={row.missingPaths}>{(item) => <div>{item}</div>}</For>
                        {row.pathStatus === "unresolved" ? <div>(path status unresolved: failed to query server)</div> : null}
                      </div>
                    </div>
                    <div class="flex flex-wrap gap-2">
                      <Button variant="secondary" size="small" class="min-h-9 px-3" onClick={() => openProject(row.worktree)}>
                        Open project
                      </Button>
                      <Button variant="secondary" size="small" class="min-h-9 px-3" onClick={() => openDetail(row.worktree)}>
                        Session details
                      </Button>
                      <Button
                        variant="secondary"
                        size="small"
                        class="min-h-9 px-3"
                        onClick={() => removeProject(row.projectID)}
                        disabled={isGlobalProject(row.projectID)}
                      >
                        Delete project
                      </Button>
                    </div>
                  </div>
                )}
              </For>
              {missingRows().length === 0 ? (
                <div class="border border-border-weak-base rounded-lg p-4 bg-surface-raised-base text-12-regular text-text-weak">(empty)</div>
              ) : null}
            </Tabs.Content>

            <Tabs.Content value="internal" class="flex flex-col gap-3">
              <div class="text-11-regular text-text-weak">{internalRows().length} internal project(s)</div>
              <For each={internalRows()}>
                {(row) => (
                  <div class="border border-border-weak-base rounded-lg p-4 bg-surface-raised-base flex flex-col gap-3">
                    <div>
                      <div class="flex items-center gap-2 min-w-0">
                        <WorkspaceIcon icon={row.icon} title={row.worktree} />
                        <div class="text-13-medium text-text-strong break-all">{row.worktree}</div>
                      </div>
                      <div class="text-11-regular text-text-weak break-all">projectID: {row.projectID}</div>
                      <div class="text-11-regular text-text-weak break-all">directory: {displayDirectory(row.worktree)}</div>
                      <div class="text-11-regular text-text-weak">source: {row.source}</div>
                      <div class="text-11-regular text-text-weak">sessions: {row.sessionCount}</div>
                    </div>
                  </div>
                )}
              </For>
              {internalRows().length === 0 ? (
                <div class="border border-border-weak-base rounded-lg p-4 bg-surface-raised-base text-12-regular text-text-weak">(empty)</div>
              ) : null}
            </Tabs.Content>

            <Tabs.Content value="raw-json" class="flex flex-col gap-3">
              <div class="border border-border-weak-base rounded-lg p-4 bg-surface-raised-base">
                <div class="text-13-medium text-text-strong mb-2">Raw JSON</div>
                <pre class="text-11-regular text-text-weak whitespace-pre-wrap break-all max-h-[58vh] overflow-y-auto pr-1">{diagnostics()}</pre>
              </div>
            </Tabs.Content>
            </Show>
          </Tabs>
        </div>
      </div>

      <div class="sticky bottom-0 z-10 sm:hidden border-t border-border-weak-base bg-surface-base/95 backdrop-blur px-4 py-3">
        <div class="flex gap-2">
          <Button variant="secondary" size="small" class="min-h-10 flex-1" onClick={refreshSafe}>
            Refresh
          </Button>
          <Button variant="secondary" size="small" class="min-h-10 flex-1" onClick={copyDiagnostics}>
            Copy JSON
          </Button>
        </div>
      </div>
    </div>
  )
}
