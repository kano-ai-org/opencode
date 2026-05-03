import { Flag } from "@/flag/flag"
import { Hono } from "hono"
import { proxy } from "hono/proxy"
import { getMimeType } from "hono/utils/mime"
import { createHash } from "node:crypto"
import fs from "node:fs/promises"

const embeddedUIPromise = Flag.OPENCODE_DISABLE_EMBEDDED_WEB_UI
  ? Promise.resolve(null)
  : // @ts-expect-error - generated file at build time
    import("opencode-web-ui.gen.ts").then((module) => module.default as Record<string, string>).catch(() => null)

const DEFAULT_CSP =
  "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; media-src 'self' data:; connect-src 'self' data:"
const DEFAULT_WEB_UI_ORIGIN = new URL("https://app.opencode.ai")

const csp = (hash = "") =>
  `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'${hash ? ` 'sha256-${hash}'` : ""}; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; media-src 'self' data:; connect-src 'self' data:`

const resolveWebUIOrigin = () => {
  const value = process.env.OPENCODE_WEB_UI_ORIGIN?.trim()
  if (!value) return DEFAULT_WEB_UI_ORIGIN
  try {
    return new URL(value)
  } catch {
    return DEFAULT_WEB_UI_ORIGIN
  }
}

export const UIRoutes = (): Hono =>
  new Hono().all("/*", async (c) => {
    const embeddedWebUI = await embeddedUIPromise
    const path = c.req.path

    if (embeddedWebUI) {
      const match = embeddedWebUI[path.replace(/^\//, "")] ?? embeddedWebUI["index.html"] ?? null
      if (!match) return c.json({ error: "Not Found" }, 404)

      if (await fs.exists(match)) {
        const mime = getMimeType(match) ?? "text/plain"
        c.header("Content-Type", mime)
        if (mime.startsWith("text/html")) {
          c.header("Content-Security-Policy", DEFAULT_CSP)
        }
        return c.body(new Uint8Array(await fs.readFile(match)))
      } else {
        return c.json({ error: "Not Found" }, 404)
      }
    } else {
      const uiOrigin = resolveWebUIOrigin()
      const search = new URL(c.req.raw.url).search
      const proxyUI = (origin: URL) =>
        proxy(new URL(`${path}${search}`, origin).toString(), {
          raw: c.req.raw,
          headers: {
            ...Object.fromEntries(c.req.raw.headers.entries()),
            host: origin.host,
          },
        })
      const origins = uiOrigin.href === DEFAULT_WEB_UI_ORIGIN.href ? [DEFAULT_WEB_UI_ORIGIN] : [uiOrigin, DEFAULT_WEB_UI_ORIGIN]
      const response =
        (await proxyUI(origins[0]).catch(() => undefined))
        ?? (origins[1] ? await proxyUI(origins[1]).catch(() => undefined) : undefined)

      if (!response) {
        return c.json(
          {
            error: "Unable to load web UI",
            tried: origins.map((origin) => origin.toString()),
          },
          502,
        )
      }
      const match = response.headers.get("content-type")?.includes("text/html")
        ? (await response.clone().text()).match(
            /<script\b(?![^>]*\bsrc\s*=)[^>]*\bid=(['"])oc-theme-preload-script\1[^>]*>([\s\S]*?)<\/script>/i,
          )
        : undefined
      const hash = match ? createHash("sha256").update(match[2]).digest("base64") : ""
      response.headers.set("Content-Security-Policy", csp(hash))
      return response
    }
  })
