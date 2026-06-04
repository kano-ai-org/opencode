import { useServerSync } from "@/context/server-sync"
import { hasProviderVariantCoverage } from "@/hooks/provider-freshness"
import { decode64 } from "@/utils/base64"
import { useParams } from "@solidjs/router"
import { Iterable, pipe } from "effect"
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
  const serverSync = useServerSync()
  const params = useParams()
  const currentDirectory = createMemo(() => decode64(params.dir) ?? "")
  const providers = createMemo(() => {
    const global = serverSync.data.provider
    const directory = currentDirectory()
    if (!directory) return global
    const [projectStore] = serverSync.child(directory)
    if (!projectStore.provider_ready) return global
    const project = projectStore.provider
    if (project.all.size === 0) return global

    const count = (input: typeof global) =>
      new Map(Array.from(input.all.values(), (provider) => [provider.id, Object.keys(provider.models).length] as const))

    const fresh = (() => {
      const projectCount = count(project)
      const globalCount = count(global)
      return global.connected.every(
        (id) =>
          (projectCount.get(id) ?? 0) >= (globalCount.get(id) ?? 0) &&
          hasProviderVariantCoverage(global.all.get(id), project.all.get(id)),
      )
    })()

    if (!fresh) return global
    return project
  })
  return {
    all: () => providers().all,
    default: () => providers().default,
    popular: () =>
      pipe(
        providers().all,
        Iterable.map(([, p]) => p),
        Iterable.filter((p) => popularProviderSet.has(p.id)),
        (v) => Array.from(v),
      ),
    connected: () => {
      const connected = new Set(providers().connected)
      return pipe(
        providers().all,
        Iterable.map(([, p]) => p),
        Iterable.filter((p) => connected.has(p.id)),
        (v) => Array.from(v),
      )
    },
    paid: () => {
      const connected = new Set(providers().connected)
      return [
        ...Iterable.filter(
          providers().all,
          ([id]) =>
            connected.has(id) &&
            (id !== "opencode" || Object.values(providers().all.get(id)?.models ?? {}).some((m) => m.cost?.input)),
        ),
      ]
    },
  }
}
