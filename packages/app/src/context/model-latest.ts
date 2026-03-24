import { DateTime } from "luxon"

type ModelKey = {
  providerID: string
  modelID: string
}

type Model = ModelKey & {
  family?: string
  release_date: string
}

export function pickLatestModels(models: Model[], now?: DateTime): ModelKey[] {
  const current = now ?? DateTime.now()
  const groups = new Map<string, Model[]>()

  for (const model of models) {
    const date = DateTime.fromISO(model.release_date)
    if (!date.isValid) continue
    if (Math.abs(date.diff(current).as("months")) >= 6) continue
    const key = `${model.providerID}:${model.family ?? ""}`
    const group = groups.get(key)
    if (group) {
      group.push(model)
      continue
    }
    groups.set(key, [model])
  }

  const result: ModelKey[] = []
  for (const group of groups.values()) {
    const latest = Math.max(...group.map((model) => DateTime.fromISO(model.release_date).toMillis()))
    for (const model of group) {
      if (DateTime.fromISO(model.release_date).toMillis() !== latest) continue
      result.push({ providerID: model.providerID, modelID: model.modelID })
    }
  }

  return result
}
