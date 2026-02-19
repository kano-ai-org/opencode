import { describe, expect, test } from "bun:test"
import {
  applyWorkspaceToggles,
  filterWorkspaceToggles,
  pickLocalWorkspaceToggles,
  shouldSeedWorkspaceToggles,
} from "./layout-workspaces-sync"

const project = {
  worktree: "/repo",
  sandboxes: ["/repo-w1", "/repo-w2"],
}

describe("layout workspace sync helpers", () => {
  test("filters toggles to project workspaces", () => {
    expect(
      filterWorkspaceToggles(project, {
        "/repo": true,
        "/repo-w1": false,
        "/other": true,
      }),
    ).toEqual({
      "/repo": true,
      "/repo-w1": false,
    })
  })

  test("matches toggles across slash and drive-letter casing variants", () => {
    const windowsProject = {
      worktree: "D:/Work/Repo",
      sandboxes: ["D:/Work/Repo/.sandbox"],
    }

    expect(
      filterWorkspaceToggles(windowsProject, {
        "d:\\work\\repo": true,
        "d:/work/repo/.sandbox/": false,
      }),
    ).toEqual({
      "d:\\work\\repo": true,
      "d:/work/repo/.sandbox/": false,
    })

    expect(
      applyWorkspaceToggles(
        windowsProject,
        {
          "D:/Work/Repo": false,
          "D:/Work/Repo/.sandbox": true,
        },
        {
          "d:\\work\\repo": true,
          "d:/work/repo/.sandbox/": false,
        },
      ),
    ).toEqual({
      "D:/Work/Repo": true,
      "D:/Work/Repo/.sandbox": false,
    })
  })

  test("applies toggles by replacing project entries only", () => {
    const result = applyWorkspaceToggles(
      project,
      {
        "/repo": false,
        "/repo-w1": true,
        "/other": true,
      },
      {
        "/repo": true,
        "/repo-w2": false,
      },
    )

    expect(result).toEqual({
      "/repo": true,
      "/repo-w2": false,
      "/other": true,
    })
  })

  test("picks only local toggles for project directories", () => {
    expect(
      pickLocalWorkspaceToggles(project, {
        "/repo": true,
        "/repo-w2": false,
        "/outside": true,
      }),
    ).toEqual({
      "/repo": true,
      "/repo-w2": false,
    })
  })

  test("seeds server only when remote state is empty", () => {
    expect(
      shouldSeedWorkspaceToggles(
        { version: 0, toggles: {} },
        {
          "/repo": true,
        },
      ),
    ).toBe(true)

    expect(
      shouldSeedWorkspaceToggles(
        {
          version: 1,
          toggles: {
            "/repo": false,
          },
        },
        {
          "/repo": true,
        },
      ),
    ).toBe(false)
  })
})
