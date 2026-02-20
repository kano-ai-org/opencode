import { createStore, produce } from "solid-js/store"
import { batch, createEffect, createMemo, createSignal, onCleanup, onMount, type Accessor } from "solid-js"
import { createSimpleContext } from "@opencode-ai/ui/context"
import { useGlobalSync } from "./global-sync"
import { useGlobalSDK } from "./global-sdk"
import { useServer } from "./server"
import { usePlatform } from "./platform"
import { Project } from "@opencode-ai/sdk/v2"
import { Persist, persisted, removePersisted } from "@/utils/persist"
import { same } from "@/utils/same"
import { createScrollPersistence, type SessionScroll } from "./layout-scroll"
import {
  applyWorkspaceToggles,
  EMPTY_WORKSPACE_TOGGLES,
  shouldSeedWorkspaceToggles,
  type WorkspaceTogglesState,
} from "./layout-workspaces-sync"

const AVATAR_COLOR_KEYS = ["pink", "mint", "orange", "purple", "cyan", "lime"] as const
const DEFAULT_PANEL_WIDTH = 344
const DEFAULT_SESSION_WIDTH = 600
const DEFAULT_TERMINAL_HEIGHT = 280
const WORKSPACE_TOGGLE_POLL_MS = 5000
export type AvatarColorKey = (typeof AVATAR_COLOR_KEYS)[number]

export function getAvatarColors(key?: string) {
  if (key && AVATAR_COLOR_KEYS.includes(key as AvatarColorKey)) {
    return {
      background: `var(--avatar-background-${key})`,
      foreground: `var(--avatar-text-${key})`,
    }
  }
  return {
    background: "var(--surface-info-base)",
    foreground: "var(--text-base)",
  }
}

const workspaceKey = (directory: string) => {
  const normalized = directory.replace(/\\/g, "/")
  const drive = normalized.match(/^([A-Za-z]:)\/+$/)
  if (drive) return `${drive[1].toUpperCase()}/`
  if (/^\/+$/i.test(normalized)) return "/"

  const trimmed = normalized.replace(/\/+$/, "")
  if (!/^[A-Za-z]:\//.test(trimmed)) return trimmed
  return `${trimmed.slice(0, 1).toUpperCase()}${trimmed.slice(1).toLowerCase()}`
}

const workspaceTail = (directory: string) => workspaceKey(directory).split("/").filter(Boolean).slice(-2).join("/")

const workspaceMatch = (left: string, right: string) => {
  const leftKey = workspaceKey(left)
  const rightKey = workspaceKey(right)
  if (leftKey === rightKey) return true
  const leftTail = workspaceTail(leftKey)
  if (!leftTail) return false
  return leftTail === workspaceTail(rightKey)
}

const workspaceValue = (map: Record<string, boolean>, directory: string) => {
  const direct = map[workspaceKey(directory)]
  if (direct !== undefined) return direct
  const raw = map[directory]
  if (raw !== undefined) return raw
  for (const [key, value] of Object.entries(map)) {
    if (!workspaceMatch(key, directory)) continue
    return value
  }
}

type SessionTabs = {
  active?: string
  all: string[]
}

type SessionView = {
  scroll: Record<string, SessionScroll>
  reviewOpen?: string[]
  pendingMessage?: string
  pendingMessageAt?: number
}

type WorkspaceKeySnapshot = {
  projectID: string
  worktree: string
  version: number
  local: string[]
  remote: string[]
  source: "opened" | "indexed" | "merged"
  isOpened: boolean
  isIndexed: boolean
  sandboxCount: number
  sandboxes: string[]
  missingPaths: string[]
  pathStatus: "ok" | "missing" | "unresolved"
}

type TabHandoff = {
  dir: string
  id: string
  at: number
}

export type LocalProject = Partial<Project> & { worktree: string; expanded: boolean }

export type ReviewDiffStyle = "unified" | "split"

export function ensureSessionKey(key: string, touch: (key: string) => void, seed: (key: string) => void) {
  touch(key)
  seed(key)
  return key
}

export function createSessionKeyReader(sessionKey: string | Accessor<string>, ensure: (key: string) => void) {
  const key = typeof sessionKey === "function" ? sessionKey : () => sessionKey
  return () => {
    const value = key()
    ensure(value)
    return value
  }
}

export function pruneSessionKeys(input: {
  keep?: string
  max: number
  used: Map<string, number>
  view: string[]
  tabs: string[]
}) {
  if (!input.keep) return []

  const keys = new Set<string>([...input.view, ...input.tabs])
  if (keys.size <= input.max) return []

  const score = (key: string) => {
    if (key === input.keep) return Number.MAX_SAFE_INTEGER
    return input.used.get(key) ?? 0
  }

  return Array.from(keys)
    .sort((a, b) => score(b) - score(a))
    .slice(input.max)
}

function nextSessionTabsForOpen(current: SessionTabs | undefined, tab: string): SessionTabs {
  const all = current?.all ?? []
  if (tab === "review") return { all: all.filter((x) => x !== "review"), active: tab }
  if (tab === "context") return { all: [tab, ...all.filter((x) => x !== tab)], active: tab }
  if (!all.includes(tab)) return { all: [...all, tab], active: tab }
  return { all, active: tab }
}

export const { use: useLayout, provider: LayoutProvider } = createSimpleContext({
  name: "Layout",
  init: () => {
    const globalSdk = useGlobalSDK()
    const globalSync = useGlobalSync()
    const server = useServer()
    const platform = usePlatform()

    const isRecord = (value: unknown): value is Record<string, unknown> =>
      typeof value === "object" && value !== null && !Array.isArray(value)

    const migrate = (value: unknown) => {
      if (!isRecord(value)) return value

      const sidebar = value.sidebar
      const migratedSidebar = (() => {
        if (!isRecord(sidebar)) return sidebar
        if (typeof sidebar.workspaces !== "boolean") return sidebar
        return {
          ...sidebar,
          workspaces: {},
          workspacesDefault: sidebar.workspaces,
        }
      })()

      const review = value.review
      const fileTree = value.fileTree
      const migratedFileTree = (() => {
        if (!isRecord(fileTree)) return fileTree
        if (fileTree.tab === "changes" || fileTree.tab === "all") return fileTree

        const width = typeof fileTree.width === "number" ? fileTree.width : DEFAULT_PANEL_WIDTH
        return {
          ...fileTree,
          opened: true,
          width: width === 260 ? DEFAULT_PANEL_WIDTH : width,
          tab: "changes",
        }
      })()

      const migratedReview = (() => {
        if (!isRecord(review)) return review
        if (typeof review.panelOpened === "boolean") return review

        const opened = isRecord(fileTree) && typeof fileTree.opened === "boolean" ? fileTree.opened : true
        return {
          ...review,
          panelOpened: opened,
        }
      })()

      if (migratedSidebar === sidebar && migratedReview === review && migratedFileTree === fileTree) return value
      return {
        ...value,
        sidebar: migratedSidebar,
        review: migratedReview,
        fileTree: migratedFileTree,
      }
    }

    const target = Persist.global("layout", ["layout.v6"])
    const [store, setStore, _, ready] = persisted(
      { ...target, migrate },
      createStore({
        sidebar: {
          opened: false,
          width: DEFAULT_PANEL_WIDTH,
          workspaces: {} as Record<string, boolean>,
          workspacesDefault: false,
        },
        terminal: {
          height: DEFAULT_TERMINAL_HEIGHT,
          opened: false,
        },
        review: {
          diffStyle: "split" as ReviewDiffStyle,
          panelOpened: true,
        },
        fileTree: {
          opened: true,
          width: DEFAULT_PANEL_WIDTH,
          tab: "changes" as "changes" | "all",
        },
        session: {
          width: DEFAULT_SESSION_WIDTH,
        },
        mobileSidebar: {
          opened: false,
        },
        sessionTabs: {} as Record<string, SessionTabs>,
        sessionView: {} as Record<string, SessionView>,
        handoff: {
          tabs: undefined as TabHandoff | undefined,
        },
      }),
    )

    const MAX_SESSION_KEYS = 50
    const PENDING_MESSAGE_TTL_MS = 2 * 60 * 1000
    const usage = {
      active: undefined as string | undefined,
      pruned: false,
      used: new Map<string, number>(),
    }

    const SESSION_STATE_KEYS = [
      { key: "prompt", legacy: "prompt", version: "v2" },
      { key: "terminal", legacy: "terminal", version: "v1" },
      { key: "file-view", legacy: "file", version: "v1" },
    ] as const

    const dropSessionState = (keys: string[]) => {
      for (const key of keys) {
        const parts = key.split("/")
        const dir = parts[0]
        const session = parts[1]
        if (!dir) continue

        for (const entry of SESSION_STATE_KEYS) {
          const target = session ? Persist.session(dir, session, entry.key) : Persist.workspace(dir, entry.key)
          void removePersisted(target, platform)

          const legacyKey = `${dir}/${entry.legacy}${session ? "/" + session : ""}.${entry.version}`
          void removePersisted({ key: legacyKey }, platform)
        }
      }
    }

    function prune(keep?: string) {
      const drop = pruneSessionKeys({
        keep,
        max: MAX_SESSION_KEYS,
        used: usage.used,
        view: Object.keys(store.sessionView),
        tabs: Object.keys(store.sessionTabs),
      })
      if (drop.length === 0) return

      setStore(
        produce((draft) => {
          for (const key of drop) {
            delete draft.sessionView[key]
            delete draft.sessionTabs[key]
          }
        }),
      )

      scroll.drop(drop)
      dropSessionState(drop)

      for (const key of drop) {
        usage.used.delete(key)
      }
    }

    function touch(sessionKey: string) {
      usage.active = sessionKey
      usage.used.set(sessionKey, Date.now())

      if (!ready()) return
      if (usage.pruned) return

      usage.pruned = true
      prune(sessionKey)
    }

    const scroll = createScrollPersistence({
      debounceMs: 250,
      getSnapshot: (sessionKey) => store.sessionView[sessionKey]?.scroll,
      onFlush: (sessionKey, next) => {
        const current = store.sessionView[sessionKey]
        const keep = usage.active ?? sessionKey
        if (!current) {
          setStore("sessionView", sessionKey, { scroll: next })
          prune(keep)
          return
        }

        setStore("sessionView", sessionKey, "scroll", (prev) => ({ ...(prev ?? {}), ...next }))
        prune(keep)
      },
    })

    const ensureKey = (key: string) => ensureSessionKey(key, touch, (sessionKey) => scroll.seed(sessionKey))

    createEffect(() => {
      if (!ready()) return
      if (usage.pruned) return
      const active = usage.active
      if (!active) return
      usage.pruned = true
      prune(active)
    })

    onMount(() => {
      const flush = () => batch(() => scroll.flushAll())
      const handleVisibility = () => {
        if (document.visibilityState !== "hidden") return
        flush()
      }

      window.addEventListener("pagehide", flush)
      document.addEventListener("visibilitychange", handleVisibility)

      onCleanup(() => {
        window.removeEventListener("pagehide", flush)
        document.removeEventListener("visibilitychange", handleVisibility)
        scroll.dispose()
      })
    })

    const [colors, setColors] = createStore<Record<string, AvatarColorKey>>({})
    const colorRequested = new Map<string, AvatarColorKey>()

    function pickAvailableColor(used: Set<string>): AvatarColorKey {
      const available = AVATAR_COLOR_KEYS.filter((c) => !used.has(c))
      if (available.length === 0) return AVATAR_COLOR_KEYS[Math.floor(Math.random() * AVATAR_COLOR_KEYS.length)]
      return available[Math.floor(Math.random() * available.length)]
    }

    function enrich(project: { worktree: string; expanded: boolean }) {
      const [childStore] = globalSync.child(project.worktree, { bootstrap: false })
      const projectID = childStore.project
      const metadata = projectID
        ? globalSync.data.project.find((x) => x.id === projectID)
        : globalSync.data.project.find((x) => x.worktree === project.worktree)

      const local = childStore.projectMeta
      const localOverride =
        local?.name !== undefined ||
        local?.commands?.start !== undefined ||
        local?.icon?.override !== undefined ||
        local?.icon?.color !== undefined

      const base = {
        ...(metadata ?? {}),
        ...project,
        icon: {
          url: metadata?.icon?.url,
          override: metadata?.icon?.override ?? childStore.icon,
          color: metadata?.icon?.color,
        },
      }

      const isGlobal = projectID === "global" || (metadata?.id === undefined && localOverride)
      if (!isGlobal) return base

      return {
        ...base,
        id: base.id ?? "global",
        name: local?.name,
        commands: local?.commands,
        icon: {
          url: base.icon?.url,
          override: local?.icon?.override,
          color: local?.icon?.color,
        },
      }
    }

    const roots = createMemo(() => {
      const map = new Map<string, string>()
      for (const project of globalSync.data.project) {
        map.set(workspaceKey(project.worktree), project.worktree)
        const sandboxes = project.sandboxes ?? []
        for (const sandbox of sandboxes) {
          map.set(workspaceKey(sandbox), project.worktree)
        }
      }
      return map
    })

    const rootFor = (directory: string) => {
      const map = roots()
      if (map.size === 0) return directory

      const visited = new Set<string>()
      let current = workspaceKey(directory)

      while (current) {
        const next = map.get(current)
        if (!next) return directory

        const key = workspaceKey(next)
        if (visited.has(key)) return directory
        if (key === current) return next
        visited.add(key)
        current = key
      }

      return directory
    }

    const workspaceVersion = new Map<string, number>()
    const workspaceLoaded = new Set<string>()
    const workspaceLoading = new Set<string>()
    let workspaceSeeded = false
    const workspacePendingSync = new Set<string>()
    const [workspacePendingTick, setWorkspacePendingTick] = createSignal(0)

    const queueWorkspacePendingSync = (directory: string) => {
      if (workspacePendingSync.has(directory)) return
      workspacePendingSync.add(directory)
      setWorkspacePendingTick((value) => value + 1)
    }

    const clearWorkspacePendingSync = (directory: string) => {
      if (!workspacePendingSync.has(directory)) return
      workspacePendingSync.delete(directory)
      setWorkspacePendingTick((value) => value + 1)
    }

    const requestHeaders = (json = false) => {
      const password = typeof window === "undefined" ? undefined : window.__OPENCODE__?.serverPassword
      const auth = password && server.isLocal() ? { Authorization: `Basic ${btoa(`opencode:${password}`)}` } : undefined
      return {
        ...(json ? { "Content-Type": "application/json" } : undefined),
        ...auth,
      }
    }

    const parseWorkspaceState = (value: unknown): WorkspaceTogglesState => {
      if (!isRecord(value)) return EMPTY_WORKSPACE_TOGGLES
      const version = typeof value.version === "number" ? Math.max(0, Math.trunc(value.version)) : 0
      const raw = isRecord(value.toggles) ? value.toggles : {}
      const toggles = Object.entries(raw).reduce<Record<string, boolean>>((acc, [directory, enabled]) => {
        if (typeof enabled !== "boolean") return acc
        acc[directory] = enabled
        return acc
      }, {})
      return { version, toggles }
    }

    const projectForWorkspace = (directory: string) => {
      const worktree = rootFor(directory)
      const project = globalSync.data.project.find((item) => workspaceKey(item.worktree) === workspaceKey(worktree))
      if (project?.id) return project

      const [child] = globalSync.child(worktree, { bootstrap: true })
      if (!child.project) return

      return {
        id: child.project,
        worktree,
        sandboxes: project?.sandboxes ?? [],
      }
    }

    const resolveWorkspaceProject = async (directory: string) => {
      const local = projectForWorkspace(directory)
      if (local?.id) return local

      const root = rootFor(directory)
      const [child] = globalSync.child(root, { bootstrap: true })
      child.project
      await globalSync.project.loadSessions(root)

      for (const _ of Array.from({ length: 20 })) {
        const resolved = projectForWorkspace(root)
        if (resolved?.id) return resolved
        await new Promise((resolve) => setTimeout(resolve, 50))
      }

      const match = await fetch(`${server.url}/project/current?directory=${encodeURIComponent(root)}`, {
        headers: requestHeaders(),
      })
        .then((response) => (response.ok ? (response.json() as Promise<Project>) : undefined))
        .catch(() => undefined)
      if (!match?.id) return

      return {
        id: match.id,
        worktree: match.worktree,
        sandboxes: match.sandboxes ?? [],
      }
    }

    const applyProjectWorkspaceToggles = (
      project: Pick<Project, "id" | "worktree" | "sandboxes">,
      state: WorkspaceTogglesState,
      directory?: string,
    ) => {
      if (!project.id) return
      workspaceVersion.set(project.id, state.version)
      setStore("sidebar", "workspaces", (current) => applyWorkspaceToggles(project, current, state.toggles))
      if (!directory) return

      const next = Object.entries(state.toggles).find(([item]) => workspaceMatch(item, directory))?.[1]
      const key = workspaceKey(directory)
      setStore(
        "sidebar",
        "workspaces",
        produce((draft) => {
          for (const item of Object.keys(draft)) {
            if (!workspaceMatch(item, directory)) continue
            delete draft[item]
          }
          if (next === undefined) return
          draft[key] = next
        }),
      )
    }

    const getWorkspaceToggles = async (project: Pick<Project, "id" | "worktree">) => {
      if (!project.id) return
      const url = `${server.url}/project/${encodeURIComponent(project.id)}/workspace-toggles?directory=${encodeURIComponent(project.worktree)}`
      const response = await fetch(url, {
        method: "GET",
        headers: requestHeaders(),
      }).catch(() => undefined)
      if (!response?.ok) return
      const body = await response.json().catch(() => undefined)
      if (!body) return
      return parseWorkspaceState(body)
    }

    const patchWorkspaceToggles = async (
      project: Pick<Project, "id" | "worktree">,
      version: number,
      toggles: Record<string, boolean>,
    ) => {
      if (!project.id) return
      const url = `${server.url}/project/${encodeURIComponent(project.id)}/workspace-toggles?directory=${encodeURIComponent(project.worktree)}`
      const response = await fetch(url, {
        method: "PATCH",
        headers: requestHeaders(true),
        body: JSON.stringify({ version, toggles }),
      }).catch(() => undefined)
      if (!response) return
      const body = await response.json().catch(() => undefined)
      const state = parseWorkspaceState(body)
      return {
        status: response.status,
        state,
      }
    }

    const hydrateWorkspaceToggles = async (directory: string, force = false) => {
      const root = rootFor(directory)
      let project = await resolveWorkspaceProject(root)
      if (!project?.id) {
        await globalSync.project.loadSessions(root)
        project = await resolveWorkspaceProject(root)
      }
      if (!project?.id) return
      if (workspaceLoading.has(project.id)) return
      if (!force && workspaceLoaded.has(project.id)) return

      workspaceLoading.add(project.id)
      try {
        const remote = await getWorkspaceToggles(project)
        if (!remote) return
        const local = store.sidebar.workspaces

        if (shouldSeedWorkspaceToggles(remote, local)) {
          const seeded = await patchWorkspaceToggles(project, remote.version, local)
          if (seeded?.status === 200) {
            applyProjectWorkspaceToggles(project, seeded.state, directory)
            workspaceLoaded.add(project.id)
            return
          }
        }

        applyProjectWorkspaceToggles(project, remote, directory)
        workspaceLoaded.add(project.id)
      } catch {
      } finally {
        workspaceLoading.delete(project.id)
      }
    }

    const syncWorkspaceToggles = async (directory: string) => {
      const root = rootFor(directory)
      let project = await resolveWorkspaceProject(root)
      if (!project?.id) {
        await globalSync.project.loadSessions(root)
        project = await resolveWorkspaceProject(root)
      }
      if (!project?.id) {
        queueWorkspacePendingSync(directory)
        return
      }

      clearWorkspacePendingSync(directory)

      if (!workspaceLoaded.has(project.id)) await hydrateWorkspaceToggles(directory, true)

      const version = workspaceVersion.get(project.id) ?? 0
      const desired = { ...store.sidebar.workspaces }
      const result = await patchWorkspaceToggles(project, version, desired)
      if (!result) return

      if (result.status === 200) {
        applyProjectWorkspaceToggles(project, result.state, directory)
        return
      }

      if (result.status === 409) {
        applyProjectWorkspaceToggles(project, result.state, directory)
        const retry = await patchWorkspaceToggles(project, result.state.version, desired)
        if (retry?.status === 200) {
          applyProjectWorkspaceToggles(project, retry.state, directory)
        }
      }
    }

    createEffect(() => {
      if (!globalSync.ready) return
      workspacePendingTick()
      for (const directory of Array.from(workspacePendingSync)) {
        const [child] = globalSync.child(rootFor(directory), { bootstrap: true })
        child.project
        const project = projectForWorkspace(directory)
        if (!project?.id) continue
        clearWorkspacePendingSync(directory)
        void syncWorkspaceToggles(directory)
      }
    })

    createEffect(() => {
      if (!globalSync.ready) return
      for (const project of globalSync.data.project) {
        if (project.vcs !== "git") continue
        void hydrateWorkspaceToggles(project.worktree)
      }
    })

    createEffect(() => {
      if (!globalSync.ready) return
      for (const project of server.projects.list()) {
        const [child] = globalSync.child(project.worktree, { bootstrap: true })
        child.project
        void hydrateWorkspaceToggles(project.worktree)
      }
    })

    createEffect(() => {
      if (!globalSync.ready) return
      const refresh = () => {
        for (const project of server.projects.list()) {
          void hydrateWorkspaceToggles(project.worktree, true)
        }
      }

      const timer = setInterval(refresh, WORKSPACE_TOGGLE_POLL_MS)
      onCleanup(() => clearInterval(timer))
    })

    createEffect(() => {
      if (!globalSync.ready) return
      if (workspaceSeeded) return
      if (Object.keys(store.sidebar.workspaces).length > 0) {
        workspaceSeeded = true
        return
      }

      const roots = new Set<string>([
        ...globalSync.data.project.map((project) => project.worktree),
        ...server.projects.list().map((project) => project.worktree),
      ])
      if (roots.size === 0) return
      workspaceSeeded = true

      for (const root of roots) {
        void hydrateWorkspaceToggles(root, true)
      }
    })

    createEffect(() => {
      const projects = server.projects.list()
      const seen = new Set(projects.map((project) => workspaceKey(project.worktree)))

      batch(() => {
        for (const project of projects) {
          const root = rootFor(project.worktree)
          if (workspaceKey(root) === workspaceKey(project.worktree)) continue

          server.projects.close(project.worktree)

          const key = workspaceKey(root)
          if (!seen.has(key)) {
            server.projects.open(root)
            seen.add(key)
          }

          if (project.expanded) server.projects.expand(root)
        }
      })
    })

    createEffect(() => {
      const projects = server.projects.list()
      if (projects.length === 0) return

      const byID = new Map(globalSync.data.project.map((project) => [project.id, project.worktree] as const))

      batch(() => {
        for (const project of projects) {
          const [child] = globalSync.child(project.worktree, { bootstrap: true })
          const id = child.project
          if (!id) continue

          const canonical = byID.get(id)
          if (!canonical) continue
          if (canonical === project.worktree) continue

          server.projects.close(project.worktree)
          if (!server.projects.list().some((item) => item.worktree === canonical)) {
            server.projects.open(canonical)
          }
          if (project.expanded) server.projects.expand(canonical)
        }
      })
    })

    const enriched = createMemo(() => server.projects.list().map(enrich))
    const list = createMemo(() => {
      const projects = enriched()
      return projects.map((project) => {
        const color = project.icon?.color ?? colors[project.worktree]
        if (!color) return project
        const icon = project.icon ? { ...project.icon, color } : { color }
        return { ...project, icon }
      })
    })

    createEffect(() => {
      const projects = enriched()
      if (projects.length === 0) return
      if (!globalSync.ready) return

      for (const project of projects) {
        if (!project.id) continue
        if (project.id === "global") continue
        globalSync.project.icon(project.worktree, project.icon?.override)
      }
    })

    createEffect(() => {
      const projects = enriched()
      if (projects.length === 0) return

      for (const project of projects) {
        if (project.icon?.color) colorRequested.delete(project.worktree)
      }

      const used = new Set<string>()
      for (const project of projects) {
        const color = project.icon?.color ?? colors[project.worktree]
        if (color) used.add(color)
      }

      for (const project of projects) {
        if (project.icon?.color) continue
        const worktree = project.worktree
        const existing = colors[worktree]
        const color = existing ?? pickAvailableColor(used)
        if (!existing) {
          used.add(color)
          setColors(worktree, color)
        }
        if (!project.id) continue

        const requested = colorRequested.get(worktree)
        if (requested === color) continue
        colorRequested.set(worktree, color)

        if (project.id === "global") {
          globalSync.project.meta(worktree, { icon: { color } })
          continue
        }

        void globalSdk.client.project
          .update({ projectID: project.id, directory: worktree, icon: { color } })
          .catch(() => {
            if (colorRequested.get(worktree) === color) colorRequested.delete(worktree)
          })
      }
    })

    onMount(() => {
      Promise.all(
        server.projects.list().map((project) => {
          return globalSync.project.loadSessions(project.worktree)
        }),
      )
    })

    return {
      ready,
      handoff: {
        tabs: createMemo(() => store.handoff?.tabs),
        setTabs(dir: string, id: string) {
          setStore("handoff", "tabs", { dir, id, at: Date.now() })
        },
        clearTabs() {
          if (!store.handoff?.tabs) return
          setStore("handoff", "tabs", undefined)
        },
      },
      projects: {
        list,
        open(directory: string) {
          const root = rootFor(directory)
          if (server.projects.list().find((x) => x.worktree === root)) return
          globalSync.project.loadSessions(root)
          server.projects.open(root)
        },
        close(directory: string) {
          server.projects.close(directory)
        },
        expand(directory: string) {
          server.projects.expand(directory)
        },
        collapse(directory: string) {
          server.projects.collapse(directory)
        },
        move(directory: string, toIndex: number) {
          server.projects.move(directory, toIndex)
        },
      },
      sidebar: {
        opened: createMemo(() => store.sidebar.opened),
        open() {
          setStore("sidebar", "opened", true)
        },
        close() {
          setStore("sidebar", "opened", false)
        },
        toggle() {
          setStore("sidebar", "opened", (x) => !x)
        },
        width: createMemo(() => store.sidebar.width),
        resize(width: number) {
          setStore("sidebar", "width", width)
        },
        workspaces(directory: string) {
          return () => {
            void hydrateWorkspaceToggles(directory)
            return (
              workspaceValue(store.sidebar.workspaces, directory) ?? store.sidebar.workspacesDefault ?? false
            )
          }
        },
        setWorkspaces(directory: string, value: boolean) {
          const key = workspaceKey(directory)
          setStore("sidebar", "workspaces", key, value)
          setStore(
            "sidebar",
            "workspaces",
            produce((draft) => {
              for (const item of Object.keys(draft)) {
                if (item === key) continue
                if (!workspaceMatch(item, directory)) continue
                delete draft[item]
              }
            }),
          )
          void syncWorkspaceToggles(directory)
        },
        toggleWorkspaces(directory: string) {
          const key = workspaceKey(directory)
          const current = workspaceValue(store.sidebar.workspaces, directory) ?? store.sidebar.workspacesDefault ?? false
          setStore("sidebar", "workspaces", key, !current)
          setStore(
            "sidebar",
            "workspaces",
            produce((draft) => {
              for (const item of Object.keys(draft)) {
                if (item === key) continue
                if (!workspaceMatch(item, directory)) continue
                delete draft[item]
              }
            }),
          )
          void syncWorkspaceToggles(directory)
        },
      },
      workspaceSync: {
        localKeys: createMemo(() => Object.keys(store.sidebar.workspaces).sort((a, b) => a.localeCompare(b))),
        async refresh() {
          const roots = new Set<string>([
            ...globalSync.data.project.map((project) => project.worktree),
            ...server.projects.list().map((project) => project.worktree),
          ])
          for (const root of roots) {
            await hydrateWorkspaceToggles(root, true)
          }
        },
        async snapshot() {
          const opened = new Set(server.projects.list().map((project) => project.worktree))
          const indexed = new Set(globalSync.data.project.map((project) => project.worktree))
          const roots = new Set<string>([...indexed, ...opened])

          const rows = await Promise.all(
            Array.from(roots).map(async (worktree) => {
              const project = await resolveWorkspaceProject(worktree)
              if (!project?.id) return
              const remote = await getWorkspaceToggles(project)
              if (!remote) return

              const local = Object.keys(store.sidebar.workspaces)
                .filter((key) => workspaceMatch(key, worktree))
                .sort((a, b) => a.localeCompare(b))
              const remoteKeys = Object.keys(remote.toggles).sort((a, b) => a.localeCompare(b))
              const pathStatus = await fetch(
                `${server.url}/project/${encodeURIComponent(project.id)}/workspace-paths`,
                { headers: requestHeaders() },
              )
                .then(async (response) => {
                  if (!response.ok) return { status: "unresolved" as const, missing: [] as string[] }
                  const body = await response.json().catch(() => undefined)
                  if (!body || typeof body !== "object") return { status: "unresolved" as const, missing: [] as string[] }
                  const paths = Array.isArray((body as { paths?: unknown[] }).paths)
                    ? ((body as { paths: { path?: unknown; exists?: unknown }[] }).paths ?? [])
                    : []
                  const missing = paths
                    .filter((item) => typeof item.path === "string" && item.exists === false)
                    .map((item) => item.path as string)
                    .sort((a, b) => a.localeCompare(b))
                  if (missing.length > 0) return { status: "missing" as const, missing }
                  return { status: "ok" as const, missing: [] as string[] }
                })
                .catch(() => ({ status: "unresolved" as const, missing: [] as string[] }))

              const row: WorkspaceKeySnapshot = {
                projectID: project.id,
                worktree,
                version: remote.version,
                local,
                remote: remoteKeys,
                source: opened.has(worktree) && indexed.has(worktree) ? "merged" : opened.has(worktree) ? "opened" : "indexed",
                isOpened: opened.has(worktree),
                isIndexed: indexed.has(worktree),
                sandboxCount: project.sandboxes?.length ?? 0,
                sandboxes: (project.sandboxes ?? []).slice().sort((a, b) => a.localeCompare(b)),
                missingPaths: pathStatus.missing,
                pathStatus: pathStatus.status,
              }
              return row
            }),
          )

          return rows
            .filter((row): row is WorkspaceKeySnapshot => !!row)
            .sort((a, b) => a.worktree.localeCompare(b.worktree))
        },
        async deleteProject(projectID: string, worktree?: string) {
          const response = await fetch(`${server.url}/project/${encodeURIComponent(projectID)}`, {
            method: "DELETE",
            headers: requestHeaders(),
          })
          if (!response.ok) {
            throw new Error(`failed to delete project ${projectID}: ${response.status}`)
          }

          workspaceVersion.delete(projectID)
          workspaceLoaded.delete(projectID)
          workspaceLoading.delete(projectID)
          if (worktree) {
            server.projects.close(worktree)
            setStore(
              "sidebar",
              "workspaces",
              produce((draft) => {
                for (const key of Object.keys(draft)) {
                  if (!workspaceMatch(key, worktree)) continue
                  delete draft[key]
                }
              }),
            )
          }
        },
      },
      terminal: {
        height: createMemo(() => store.terminal.height),
        resize(height: number) {
          setStore("terminal", "height", height)
        },
      },
      review: {
        diffStyle: createMemo(() => store.review?.diffStyle ?? "split"),
        setDiffStyle(diffStyle: ReviewDiffStyle) {
          if (!store.review) {
            setStore("review", { diffStyle, panelOpened: true })
            return
          }
          setStore("review", "diffStyle", diffStyle)
        },
      },
      fileTree: {
        opened: createMemo(() => store.fileTree?.opened ?? true),
        width: createMemo(() => store.fileTree?.width ?? DEFAULT_PANEL_WIDTH),
        tab: createMemo(() => store.fileTree?.tab ?? "changes"),
        setTab(tab: "changes" | "all") {
          if (!store.fileTree) {
            setStore("fileTree", { opened: true, width: DEFAULT_PANEL_WIDTH, tab })
            return
          }
          setStore("fileTree", "tab", tab)
        },
        open() {
          if (!store.fileTree) {
            setStore("fileTree", { opened: true, width: DEFAULT_PANEL_WIDTH, tab: "changes" })
            return
          }
          setStore("fileTree", "opened", true)
        },
        close() {
          if (!store.fileTree) {
            setStore("fileTree", { opened: false, width: DEFAULT_PANEL_WIDTH, tab: "changes" })
            return
          }
          setStore("fileTree", "opened", false)
        },
        toggle() {
          if (!store.fileTree) {
            setStore("fileTree", { opened: true, width: DEFAULT_PANEL_WIDTH, tab: "changes" })
            return
          }
          setStore("fileTree", "opened", (x) => !x)
        },
        resize(width: number) {
          if (!store.fileTree) {
            setStore("fileTree", { opened: true, width, tab: "changes" })
            return
          }
          setStore("fileTree", "width", width)
        },
      },
      session: {
        width: createMemo(() => store.session?.width ?? DEFAULT_SESSION_WIDTH),
        resize(width: number) {
          if (!store.session) {
            setStore("session", { width })
            return
          }
          setStore("session", "width", width)
        },
      },
      mobileSidebar: {
        opened: createMemo(() => store.mobileSidebar?.opened ?? false),
        show() {
          setStore("mobileSidebar", "opened", true)
        },
        hide() {
          setStore("mobileSidebar", "opened", false)
        },
        toggle() {
          setStore("mobileSidebar", "opened", (x) => !x)
        },
      },
      pendingMessage: {
        set(sessionKey: string, messageID: string) {
          const at = Date.now()
          touch(sessionKey)
          const current = store.sessionView[sessionKey]
          if (!current) {
            setStore("sessionView", sessionKey, {
              scroll: {},
              pendingMessage: messageID,
              pendingMessageAt: at,
            })
            prune(usage.active ?? sessionKey)
            return
          }

          setStore(
            "sessionView",
            sessionKey,
            produce((draft) => {
              draft.pendingMessage = messageID
              draft.pendingMessageAt = at
            }),
          )
        },
        consume(sessionKey: string) {
          const current = store.sessionView[sessionKey]
          const message = current?.pendingMessage
          const at = current?.pendingMessageAt
          if (!message || !at) return

          setStore(
            "sessionView",
            sessionKey,
            produce((draft) => {
              delete draft.pendingMessage
              delete draft.pendingMessageAt
            }),
          )

          if (Date.now() - at > PENDING_MESSAGE_TTL_MS) return
          return message
        },
      },
      view(sessionKey: string | Accessor<string>) {
        const key = createSessionKeyReader(sessionKey, ensureKey)
        const s = createMemo(() => store.sessionView[key()] ?? { scroll: {} })
        const terminalOpened = createMemo(() => store.terminal?.opened ?? false)
        const reviewPanelOpened = createMemo(() => store.review?.panelOpened ?? true)

        function setTerminalOpened(next: boolean) {
          const current = store.terminal
          if (!current) {
            setStore("terminal", { height: DEFAULT_TERMINAL_HEIGHT, opened: next })
            return
          }

          const value = current.opened ?? false
          if (value === next) return
          setStore("terminal", "opened", next)
        }

        function setReviewPanelOpened(next: boolean) {
          const current = store.review
          if (!current) {
            setStore("review", { diffStyle: "split" as ReviewDiffStyle, panelOpened: next })
            return
          }

          const value = current.panelOpened ?? true
          if (value === next) return
          setStore("review", "panelOpened", next)
        }

        return {
          scroll(tab: string) {
            return scroll.scroll(key(), tab)
          },
          setScroll(tab: string, pos: SessionScroll) {
            scroll.setScroll(key(), tab, pos)
          },
          terminal: {
            opened: terminalOpened,
            open() {
              setTerminalOpened(true)
            },
            close() {
              setTerminalOpened(false)
            },
            toggle() {
              setTerminalOpened(!terminalOpened())
            },
          },
          reviewPanel: {
            opened: reviewPanelOpened,
            open() {
              setReviewPanelOpened(true)
            },
            close() {
              setReviewPanelOpened(false)
            },
            toggle() {
              setReviewPanelOpened(!reviewPanelOpened())
            },
          },
          review: {
            open: createMemo(() => s().reviewOpen),
            setOpen(open: string[]) {
              const session = key()
              const current = store.sessionView[session]
              if (!current) {
                setStore("sessionView", session, {
                  scroll: {},
                  reviewOpen: open,
                })
                return
              }

              if (same(current.reviewOpen, open)) return
              setStore("sessionView", session, "reviewOpen", open)
            },
          },
        }
      },
      tabs(sessionKey: string | Accessor<string>) {
        const key = createSessionKeyReader(sessionKey, ensureKey)
        const tabs = createMemo(() => store.sessionTabs[key()] ?? { all: [] })
        return {
          tabs,
          active: createMemo(() => tabs().active),
          all: createMemo(() => tabs().all.filter((tab) => tab !== "review")),
          setActive(tab: string | undefined) {
            const session = key()
            if (!store.sessionTabs[session]) {
              setStore("sessionTabs", session, { all: [], active: tab })
            } else {
              setStore("sessionTabs", session, "active", tab)
            }
          },
          setAll(all: string[]) {
            const session = key()
            const next = all.filter((tab) => tab !== "review")
            if (!store.sessionTabs[session]) {
              setStore("sessionTabs", session, { all: next, active: undefined })
            } else {
              setStore("sessionTabs", session, "all", next)
            }
          },
          async open(tab: string) {
            const session = key()
            const next = nextSessionTabsForOpen(store.sessionTabs[session], tab)
            setStore("sessionTabs", session, next)
          },
          close(tab: string) {
            const session = key()
            const current = store.sessionTabs[session]
            if (!current) return

            if (tab === "review") {
              if (current.active !== tab) return
              setStore("sessionTabs", session, "active", current.all[0])
              return
            }

            const all = current.all.filter((x) => x !== tab)
            if (current.active !== tab) {
              setStore("sessionTabs", session, "all", all)
              return
            }

            const index = current.all.findIndex((f) => f === tab)
            const next = current.all[index - 1] ?? current.all[index + 1] ?? all[0]
            batch(() => {
              setStore("sessionTabs", session, "all", all)
              setStore("sessionTabs", session, "active", next)
            })
          },
          move(tab: string, to: number) {
            const session = key()
            const current = store.sessionTabs[session]
            if (!current) return
            const index = current.all.findIndex((f) => f === tab)
            if (index === -1) return
            setStore(
              "sessionTabs",
              session,
              "all",
              produce((opened) => {
                opened.splice(to, 0, opened.splice(index, 1)[0])
              }),
            )
          },
        }
      },
    }
  },
})
