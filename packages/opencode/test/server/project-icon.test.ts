import { afterEach, describe, expect, test } from "bun:test"
import { Server } from "../../src/server/server"
import { Project } from "../../src/project/project"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  await resetDatabase()
})

describe("project icon route", () => {
  test("serves persisted uploaded icon", async () => {
    await using tmp = await tmpdir({ git: true })
    const app = Server.App()
    const { project } = await Project.fromDirectory(tmp.path)

    await Project.update({
      projectID: project.id,
      icon: { override: "data:image/png;base64,AAAA" },
    })

    const res = await app.request(`/project/${project.id}/icon`)

    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toBe("image/png")
    expect(await res.arrayBuffer()).toBeInstanceOf(ArrayBuffer)
  })
})
