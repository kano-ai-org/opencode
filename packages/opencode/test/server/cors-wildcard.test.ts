import { describe, expect, test } from "bun:test"
import { Server } from "../../src/server/server"

describe("CORS wildcard whitelist", () => {
  test("allows wildcard tailnet origins and blocks others", async () => {
    const app = Server.App()
    const srv = Server.listen({
      port: 0,
      hostname: "127.0.0.1",
      cors: ["https://*.cobia-tailor.ts.net:8443"],
    })

    try {
      const allowed = await app.request("/global/health", {
        method: "OPTIONS",
        headers: {
          Origin: "https://macbuilder.cobia-tailor.ts.net:8443",
          "Access-Control-Request-Method": "GET",
        },
      })
      expect(allowed.status).toBe(204)
      expect(allowed.headers.get("access-control-allow-origin")).toBe("https://macbuilder.cobia-tailor.ts.net:8443")

      const denied = await app.request("/global/health", {
        method: "OPTIONS",
        headers: {
          Origin: "https://evil.example.com:8443",
          "Access-Control-Request-Method": "GET",
        },
      })
      expect(denied.status).toBe(204)
      expect(denied.headers.get("access-control-allow-origin")).toBeNull()
    } finally {
      await srv.stop(true)
    }
  })
})
