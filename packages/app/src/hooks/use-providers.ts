import { useGlobalSync } from "@/context/global-sync"
import { decode64 } from "@/utils/base64"
import { useParams } from "@solidjs/router"
import { createMemo } from "solid-js"

export const popularProviders = [
  "opencode",
  "opencode-go",
  "anthropic",
  "github-copilot",
  "openai",
  "google",
  "openrouter",
  "vercel",
]
const popularProviderSet = new Set(popularProviders)

export function useProviders() {
  const globalSync = useGlobalSync()
  const params = useParams()
  const currentDirectory = createMemo(() => decode64(params.dir) ?? "")
  const providers = createMemo(() => {
    const global = globalSync.data.provider
    const directory = currentDirectory()
    if (!directory) return global
    const [projectStore] = globalSync.child(directory)
    if (!projectStore.provider_ready) return global
    const project = projectStore.provider
    if (!project.all.length) return global

    const count = (input: typeof global) =>
      new Map(input.all.map((provider) => [provider.id, Object.keys(provider.models).length]))

    const fresh = (() => {
      const projectCount = count(project)
      const globalCount = count(global)
      return global.connected.every((id) => (projectCount.get(id) ?? 0) >= (globalCount.get(id) ?? 0))
    })()

    if (!fresh) return global
    return project
  })
  return {
    all: () => providers().all,
    default: () => providers().default,
    popular: () => providers().all.filter((p) => popularProviderSet.has(p.id)),
    connected: () => {
      const connected = new Set(providers().connected)
      return providers().all.filter((p) => connected.has(p.id))
    },
    paid: () => {
      const connected = new Set(providers().connected)
      return providers().all.filter(
        (p) => connected.has(p.id) && (p.id !== "opencode" || Object.values(p.models).some((m) => m.cost?.input)),
      )
    },
  }
}
