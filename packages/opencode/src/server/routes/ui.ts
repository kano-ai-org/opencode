import { Flag } from "@opencode-ai/core/flag/flag"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Effect, Exit, Stream } from "effect"
import { HttpBody, HttpClient, HttpClientRequest, HttpClientResponse, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { Hono } from "hono"
import { proxy } from "hono/proxy"
import { getMimeType } from "hono/utils/mime"
import { createHash } from "node:crypto"
import fs from "node:fs/promises"
import { ProxyUtil } from "../proxy-util"

const embeddedUIPromise = Flag.OPENCODE_DISABLE_EMBEDDED_WEB_UI
  ? Promise.resolve(null)
  : // @ts-expect-error - generated file at build time
    import("opencode-web-ui.gen.ts").then((module) => module.default as Record<string, string>).catch(() => null)

const DEFAULT_CSP =
  "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; media-src 'self' data:; connect-src 'self' data:"
const DEFAULT_WEB_UI_ORIGIN = new URL("https://app.opencode.ai")

const csp = (hash = "") =>
  `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'${hash ? ` 'sha256-${hash}'` : ""}; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; media-src 'self' data:; connect-src 'self' data:`

function themePreloadHash(body: string) {
  return body.match(/<script\b(?![^>]*\bsrc\s*=)[^>]*\bid=(['"])oc-theme-preload-script\1[^>]*>([\s\S]*?)<\/script>/i)
}

function requestBody(request: HttpServerRequest.HttpServerRequest) {
  if (request.method === "GET" || request.method === "HEAD") return HttpBody.empty
  const len = request.headers["content-length"]
  return HttpBody.stream(request.stream, request.headers["content-type"], len === undefined ? undefined : Number(len))
}

function proxyResponseHeaders(headers: Record<string, string>) {
  const result = new Headers(headers)
  // FetchHttpClient exposes decoded response bodies, so forwarding upstream
  // transfer metadata makes browsers decode already-decoded assets again.
  result.delete("content-encoding")
  result.delete("content-length")
  return result
}

const resolveWebUIOrigin = () => {
  const value = process.env.OPENCODE_WEB_UI_ORIGIN?.trim()
  if (!value) return DEFAULT_WEB_UI_ORIGIN
  try {
    return new URL(value)
  } catch {
    return DEFAULT_WEB_UI_ORIGIN
  }
}

const webUIOrigins = () => {
  const origin = resolveWebUIOrigin()
  if (origin.href === DEFAULT_WEB_UI_ORIGIN.href) return [DEFAULT_WEB_UI_ORIGIN]
  return [origin, DEFAULT_WEB_UI_ORIGIN]
}

function embeddedUI() {
  if (Flag.OPENCODE_DISABLE_EMBEDDED_WEB_UI) return Promise.resolve(null)
  return embeddedUIPromise
}

export async function serveUI(request: Request) {
  const embeddedWebUI = await embeddedUI()
  const parsed = new URL(request.url)
  const path = parsed.pathname
  const pathWithSearch = `${path}${parsed.search}`

  if (embeddedWebUI) {
    const match = embeddedWebUI[path.replace(/^\//, "")] ?? embeddedWebUI["index.html"] ?? null
    if (!match) return Response.json({ error: "Not Found" }, { status: 404 })

    if (await fs.exists(match)) {
      const mime = getMimeType(match) ?? "text/plain"
      const headers = new Headers({ "content-type": mime })
      if (mime.startsWith("text/html")) headers.set("content-security-policy", DEFAULT_CSP)
      return new Response(new Uint8Array(await fs.readFile(match)), { headers })
    }

    return Response.json({ error: "Not Found" }, { status: 404 })
  }

  const origins = webUIOrigins()
  let response: Response | undefined
  for (const origin of origins) {
    response = await proxy(new URL(pathWithSearch, origin).toString(), {
      raw: request,
      headers: ProxyUtil.headers(request, { host: origin.host }),
    }).catch(() => undefined)
    if (response) break
  }

  if (!response) {
    return Response.json(
      {
        error: "Unable to load web UI",
        tried: origins.map((origin) => origin.toString()),
      },
      { status: 502 },
    )
  }

  const match = response.headers.get("content-type")?.includes("text/html")
    ? themePreloadHash(await response.clone().text())
    : undefined
  const hash = match ? createHash("sha256").update(match[2]).digest("base64") : ""
  response.headers.set("Content-Security-Policy", csp(hash))
  return response
}

export function serveUIEffect(
  request: HttpServerRequest.HttpServerRequest,
  services: { fs: AppFileSystem.Interface; client: HttpClient.HttpClient },
) {
  return Effect.gen(function* () {
    const embeddedWebUI = yield* Effect.promise(() => embeddedUI())
    const parsed = new URL(request.url, "http://localhost")
    const path = parsed.pathname
    const pathWithSearch = `${path}${parsed.search}`

    if (embeddedWebUI) {
      const match = embeddedWebUI[path.replace(/^\//, "")] ?? embeddedWebUI["index.html"] ?? null
      if (!match) return HttpServerResponse.jsonUnsafe({ error: "Not Found" }, { status: 404 })

      if (yield* services.fs.existsSafe(match)) {
        const mime = getMimeType(match) ?? "text/plain"
        const headers = new Headers({ "content-type": mime })
        if (mime.startsWith("text/html")) headers.set("content-security-policy", DEFAULT_CSP)
        return HttpServerResponse.raw(yield* services.fs.readFile(match), { headers })
      }

      return HttpServerResponse.jsonUnsafe({ error: "Not Found" }, { status: 404 })
    }

    const origins = webUIOrigins()
    let response: {
      value: HttpClientResponse.HttpClientResponse
      origin: URL
    } | undefined
    for (const origin of origins) {
      const attempted = yield* Effect.exit(
        services.client.execute(
          HttpClientRequest.make(request.method)(new URL(pathWithSearch, origin).toString(), {
            headers: ProxyUtil.headers(request.headers, { host: origin.host }),
            body: requestBody(request),
          }),
        ),
      )
      if (Exit.isSuccess(attempted)) {
        response = {
          value: attempted.value,
          origin,
        }
        break
      }
    }

    if (!response) {
      return HttpServerResponse.jsonUnsafe(
        {
          error: "Unable to load web UI",
          tried: origins.map((origin) => origin.toString()),
        },
        { status: 502 },
      )
    }

    const upstreamResponse = response.value
    const headers = proxyResponseHeaders(upstreamResponse.headers)

    if (upstreamResponse.headers["content-type"]?.includes("text/html")) {
      const body = yield* upstreamResponse.text
      const match = themePreloadHash(body)
      headers.set("Content-Security-Policy", csp(match ? createHash("sha256").update(match[2]).digest("base64") : ""))
      return HttpServerResponse.text(body, { status: upstreamResponse.status, headers })
    }

    headers.set("Content-Security-Policy", csp())
    return HttpServerResponse.stream(upstreamResponse.stream.pipe(Stream.catchCause(() => Stream.empty)), {
      status: upstreamResponse.status,
      headers,
    })
  })
}

export const UIRoutes = (): Hono => new Hono().all("/*", (c) => serveUI(c.req.raw))
