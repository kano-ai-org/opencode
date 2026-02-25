import { describe, expect, test } from "bun:test"
import { Server } from "../../src/server/server"

describe("global identity routes", () => {
  test("returns persistent instance identity", async () => {
    const app = Server.App()

    const first = await app.request("/global/identity")
    expect(first.status).toBe(200)
    const one = (await first.json()) as { instanceID: string; state: string; data: string; config: string }
    expect(one.instanceID.length).toBeGreaterThan(10)
    expect(one.state.length).toBeGreaterThan(1)
    expect(one.data.length).toBeGreaterThan(1)
    expect(one.config.length).toBeGreaterThan(1)

    const second = await app.request("/global/identity")
    expect(second.status).toBe(200)
    const two = (await second.json()) as { instanceID: string }
    expect(two.instanceID).toBe(one.instanceID)
  })
})
