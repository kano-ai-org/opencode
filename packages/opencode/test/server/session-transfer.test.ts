import { describe, expect, test } from "bun:test"
import { Server } from "../../src/server/server"
import { tmpdir } from "../fixture/fixture"

describe("session transfer routes", () => {
  test(
    "exports and imports session bundle",
    async () => {
    await using tmp = await tmpdir({ git: true })
    const app = Server.App()
    const directory = encodeURIComponent(tmp.path)

    const created = await app.request(`/session?directory=${directory}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    })
    expect(created.status).toBe(200)

    const exported = await app.request(`/session/export?directory=${directory}`)
    expect(exported.status).toBe(200)
    const bundle = (await exported.json()) as {
      version: number
      tables: { session: unknown[]; project: unknown[] }
    }
    expect(bundle.version).toBe(1)
    expect(bundle.tables.project.length).toBeGreaterThan(0)
    expect(bundle.tables.session.length).toBeGreaterThan(0)

    const imported = await app.request(`/session/import?directory=${directory}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: bundle }),
    })
    expect(imported.status).toBe(200)
    const result = (await imported.json()) as { session: number; project: number }
    expect(result.project).toBeGreaterThan(0)
    expect(result.session).toBeGreaterThan(0)
    },
    15_000,
  )
})
