import { describe, expect, test } from "bun:test"
import { Project } from "../../src/project/project"
import { Server } from "../../src/server/server"
import { tmpdir } from "../fixture/fixture"

describe("project workspace toggles routes", () => {
  test("returns default workspace toggles", async () => {
    await using tmp = await tmpdir({ git: true })
    const { project } = await Project.fromDirectory(tmp.path)
    const directory = encodeURIComponent(tmp.path)

    const app = Server.App()
    const response = await app.request(`/project/${project.id}/workspace-toggles?directory=${directory}`)
    expect(response.status).toBe(200)

    const body = await response.json()
    expect(body).toEqual({ version: 0, toggles: {} })
  })

  test("returns 409 for stale toggle updates", async () => {
    await using tmp = await tmpdir({ git: true })
    const { project } = await Project.fromDirectory(tmp.path)
    const directory = encodeURIComponent(tmp.path)

    const app = Server.App()
    const first = await app.request(`/project/${project.id}/workspace-toggles?directory=${directory}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        version: 0,
        toggles: { [project.worktree]: true },
      }),
    })
    expect(first.status).toBe(200)

    const stale = await app.request(`/project/${project.id}/workspace-toggles?directory=${directory}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        version: 0,
        toggles: { [project.worktree]: false },
      }),
    })
    expect(stale.status).toBe(409)

    const body = await stale.json()
    expect(body).toEqual({
      version: 1,
      toggles: { [project.worktree]: true },
    })
  })
})
