export const todoState = (input: {
  count: number
  done: boolean
  live: boolean
}): "hide" | "clear" | "open" | "close" => {
  if (input.count === 0) return "hide"
  if (!input.live) return "clear"
  if (!input.done) return "open"
  return "close"
}

export function isPermissionRequestNotFoundError(error: unknown, requestID: string): boolean {
  const message = error instanceof Error ? error.message : String(error)
  if (!message.includes("Permission request not found")) return false
  return !requestID || message.includes(requestID)
}

export function removePermissionRequest<T extends { id: string }>(
  requests: readonly T[] | undefined,
  requestID: string,
): T[] {
  if (!requests?.length) return []
  return requests.filter((request) => request.id !== requestID)
}
