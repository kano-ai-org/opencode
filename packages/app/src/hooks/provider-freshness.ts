type ProviderVariantSnapshot = {
  models: Record<string, { variants?: Record<string, unknown> }>
}

export function hasProviderVariantCoverage(
  globalProvider: ProviderVariantSnapshot | undefined,
  projectProvider: ProviderVariantSnapshot | undefined,
) {
  if (!globalProvider) return true
  if (!projectProvider) return false

  for (const [modelID, globalModel] of Object.entries(globalProvider.models)) {
    const globalVariants = Object.keys(globalModel.variants ?? {})
    if (globalVariants.length === 0) continue

    const projectVariants = new Set(Object.keys(projectProvider.models[modelID]?.variants ?? {}))
    if (projectVariants.size < globalVariants.length) return false
    for (const variant of globalVariants) {
      if (!projectVariants.has(variant)) return false
    }
  }

  return true
}
