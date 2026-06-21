import { DateTime } from "luxon"

export type LatestModelKey = {
  providerID: string
  modelID: string
}

type LatestModelCandidate = LatestModelKey & {
  family?: string
  release_date: string
}

function validRecentRelease(model: LatestModelCandidate, now: DateTime<boolean>) {
  const date = DateTime.fromISO(model.release_date)
  if (!date.isValid) return false
  return Math.abs(date.diff(now).as("months")) < 6
}

export function pickLatestModels(models: LatestModelCandidate[], now: DateTime<boolean> = DateTime.now()): LatestModelKey[] {
  const groups = new Map<string, LatestModelCandidate[]>()

  for (const model of models.filter((model) => validRecentRelease(model, now))) {
    const key = `${model.providerID}:${model.family ?? ""}`
    groups.set(key, [...(groups.get(key) ?? []), model])
  }

  return [...groups.values()].flatMap((group) => {
    const latest = Math.max(...group.map((model) => DateTime.fromISO(model.release_date).toMillis()))
    return group
      .filter((model) => DateTime.fromISO(model.release_date).toMillis() === latest)
      .map((model) => ({ providerID: model.providerID, modelID: model.modelID }))
  })
}
