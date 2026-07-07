type ModelKey = {
  providerID: string
  modelID: string
}

export function isModelVisibleInSelector(item: ModelKey, visible: boolean, current?: ModelKey) {
  if (current?.providerID === item.providerID && current?.modelID === item.modelID) return true
  return visible
}