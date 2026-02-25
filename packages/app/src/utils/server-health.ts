import type { ServerConnection } from "@/context/server"
import { createSdkForServer } from "./server"

export type ServerHealth = { healthy: boolean; version?: string; reason?: string; statusCode?: number }

interface CheckServerHealthOptions {
  timeoutMs?: number
  signal?: AbortSignal
  retryCount?: number
  retryDelayMs?: number
}

const defaultTimeoutMs = 3000
const defaultRetryCount = 2
const defaultRetryDelayMs = 100

function timeoutSignal(timeoutMs: number) {
  const timeout = (AbortSignal as unknown as { timeout?: (ms: number) => AbortSignal }).timeout
  if (timeout) {
    try {
      return {
        signal: timeout.call(AbortSignal, timeoutMs),
        clear: undefined as (() => void) | undefined,
      }
    } catch {}
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  return { signal: controller.signal, clear: () => clearTimeout(timer) }
}

function wait(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"))
      return
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(new DOMException("Aborted", "AbortError"))
    }
    signal?.addEventListener("abort", onAbort, { once: true })
  })
}

function retryable(error: unknown, signal?: AbortSignal) {
  if (signal?.aborted) return false
  if (!(error instanceof Error)) return false
  if (error.name === "AbortError" || error.name === "TimeoutError") return false
  if (error instanceof TypeError) return true
  return /network|fetch|econnreset|econnrefused|enotfound|timedout/i.test(error.message)
}

function message(error: unknown) {
  if (error instanceof Error) return error.message
  if (typeof error === "string") return error
  if (error && typeof error === "object") {
    const entry = Object.entries(error as Record<string, unknown>).find(([, value]) => typeof value === "string")
    if (entry) return entry[1] as string
  }
}

function statusCode(error: unknown) {
  if (!error || typeof error !== "object") return
  const root = error as Record<string, unknown>
  if (typeof root.statusCode === "number") return root.statusCode
  const data = root.data
  if (!data || typeof data !== "object") return
  const nested = data as Record<string, unknown>
  if (typeof nested.statusCode === "number") return nested.statusCode
}

export async function checkServerHealth(
  server: ServerConnection.HttpBase,
  fetch: typeof globalThis.fetch,
  opts?: CheckServerHealthOptions,
): Promise<ServerHealth> {
  const timeout = opts?.signal ? undefined : timeoutSignal(opts?.timeoutMs ?? defaultTimeoutMs)
  const signal = opts?.signal ?? timeout?.signal
  const retryCount = opts?.retryCount ?? defaultRetryCount
  const retryDelayMs = opts?.retryDelayMs ?? defaultRetryDelayMs
  const failure = (error: unknown): ServerHealth => {
    const detail = message(error)
    const code = statusCode(error)
    if (!detail) return { healthy: false, statusCode: code }
    return { healthy: false, reason: detail, statusCode: code }
  }
  const next = (count: number, error: unknown) => {
    if (count >= retryCount || !retryable(error, signal)) return Promise.resolve(failure(error))
    return wait(retryDelayMs * (count + 1), signal)
      .then(() => attempt(count + 1))
      .catch((error) => failure(error))
  }
  const attempt = (count: number): Promise<ServerHealth> =>
    createSdkForServer({
      server,
      fetch,
      signal,
    })
      .global.health()
      .then((x) => (x.error ? next(count, x.error) : { healthy: x.data?.healthy === true, version: x.data?.version }))
      .catch((error) => next(count, error))
  return attempt(0).finally(() => timeout?.clear?.())
}
