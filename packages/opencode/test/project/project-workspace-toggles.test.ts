import { describe, expect, test } from "bun:test"
import { Project } from "../../src/project/project"
import { tmpdir } from "../fixture/fixture"

describe("Project workspace toggles", () => {
  test("returns empty toggles with version 0 by default", async () => {
    await using tmp = await tmpdir({ git: true })
    const { project } = await Project.fromDirectory(tmp.path)

    const state = Project.getWorkspaceToggles(project.id)
    expect(state.version).toBe(0)
    expect(state.toggles).toEqual({})
  })

  test("updates workspace toggles and increments version", async () => {
    await using tmp = await tmpdir({ git: true })
    const { project } = await Project.fromDirectory(tmp.path)

    const updated = await Project.updateWorkspaceToggles({
      projectID: project.id,
      version: 0,
      toggles: {
        [project.worktree]: true,
        "/not/in/project": true,
      },
    })

    expect(updated.status).toBe(200)
    expect(updated.data.version).toBe(1)
    expect(updated.data.toggles).toEqual({
      [project.worktree]: true,
    })
  })

  test("returns conflict when version is stale", async () => {
    await using tmp = await tmpdir({ git: true })
    const { project } = await Project.fromDirectory(tmp.path)

    await Project.updateWorkspaceToggles({
      projectID: project.id,
      version: 0,
      toggles: {
        [project.worktree]: true,
      },
    })

    const stale = await Project.updateWorkspaceToggles({
      projectID: project.id,
      version: 0,
      toggles: {
        [project.worktree]: false,
      },
    })

    expect(stale.status).toBe(409)
    expect(stale.data.version).toBe(1)
    expect(stale.data.toggles).toEqual({
      [project.worktree]: true,
    })
  })
})
