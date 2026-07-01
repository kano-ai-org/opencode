import { useServerSync } from "@/context/server-sync"
import { decode64 } from "@/utils/base64"
import type { Provider } from "@opencode-ai/sdk/v2/client"
import { useParams } from "@solidjs/router"
import type { Accessor } from "solid-js"
import { selectProviderCatalog } from "./provider-catalog"

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
type ProviderEntry = [string, Provider]

export function useProviders(directory: Accessor<string | undefined>) {
  const serverSync = useServerSync()
  const params = useParams()
  const dir = () => (directory ? directory() : decode64(params.dir))
  const providers = () => {
    const value = dir()
    const projectStore = value ? serverSync().child(value)[0] : undefined
    if (value)
      return selectProviderCatalog({
        explicit: true,
        directory: value,
        catalog: projectStore && { ready: projectStore.provider_ready, providers: projectStore.provider },
      })
    return selectProviderCatalog({
      explicit: false,
      directory: value,
      catalog: projectStore && { ready: projectStore.provider_ready, providers: projectStore.provider },
      global: serverSync().data.provider,
    })
  }

  return {
    all: () => providers().all as Map<string, Provider>,
    default: () => providers().default,
    defaultModel: () => providers().defaultModel,
    popular: (): Provider[] =>
      Array.from((providers().all as Map<string, Provider>).values()).filter((provider) =>
        popularProviderSet.has(provider.id),
      ),
    connected: () => {
      const connected = new Set(providers().connected)
      return Array.from((providers().all as Map<string, Provider>).values()).filter((provider) =>
        connected.has(provider.id),
      )
    },
    paid: () => {
      const connected = new Set(providers().connected)
      return Array.from(providers().all as Map<string, Provider>).filter(
        ([id, provider]) =>
          connected.has(id) &&
          (id !== "opencode" || Object.values(provider.models).some((model) => model.cost?.input)),
      ) as ProviderEntry[]
    },
  }
}
