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
