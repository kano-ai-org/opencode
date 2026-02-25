import { describe, expect, test } from "bun:test"
import path from "path"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { Log } from "../../src/util/log"

const projectRoot = path.join(__dirname, "../..")
Log.init({ print: false })

describe("Session.list", () => {
  test("filters by directory", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const first = await Session.create({})

        const otherDir = path.join(projectRoot, "..", "__session_list_other")
        const second = await Instance.provide({
          directory: otherDir,
          fn: async () => Session.create({}),
        })

        const sessions = [...Session.list({ directory: projectRoot })]
        const ids = sessions.map((s) => s.id)

        expect(ids).toContain(first.id)
        expect(ids).not.toContain(second.id)
      },
    })
  })

  test("filters by directory with slash and casing variants", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const created = await Session.create({ title: "variant-session" })
        const variant = projectRoot.replaceAll("\\", "/").toLowerCase()

        const sessions = [...Session.list({ directory: variant })]
        const ids = sessions.map((s) => s.id)

        expect(ids).toContain(created.id)
      },
    })
  })

  test("filters root sessions", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const root = await Session.create({ title: "root-session" })
        const child = await Session.create({ title: "child-session", parentID: root.id })

        const sessions = [...Session.list({ roots: true })]
        const ids = sessions.map((s) => s.id)

        expect(ids).toContain(root.id)
        expect(ids).not.toContain(child.id)
      },
    })
  })

  test("filters by start time", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const session = await Session.create({ title: "new-session" })
        const futureStart = Date.now() + 86400000

        const sessions = [...Session.list({ start: futureStart })]
        expect(sessions.length).toBe(0)
      },
    })
  })

  test("filters by search term", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        await Session.create({ title: "unique-search-term-abc" })
        await Session.create({ title: "other-session-xyz" })

        const sessions = [...Session.list({ search: "unique-search" })]
        const titles = sessions.map((s) => s.title)

        expect(titles).toContain("unique-search-term-abc")
        expect(titles).not.toContain("other-session-xyz")
      },
    })
  })

  test("respects limit parameter", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        await Session.create({ title: "session-1" })
        await Session.create({ title: "session-2" })
        await Session.create({ title: "session-3" })

        const sessions = [...Session.list({ limit: 2 })]
        expect(sessions.length).toBe(2)
      },
    })
  })

  test("filters by explicit projectID", async () => {
    await using first = await tmpdir({ git: true })
    await using second = await tmpdir({ git: true })

    await Instance.provide({
      directory: first.path,
      fn: async () => {
        const a = await Session.create({ title: "project-a-session" })
        const b = await Instance.provide({
          directory: second.path,
          fn: async () => Session.create({ title: "project-b-session" }),
        })

        const projectA = await Session.get(a.id).then((x) => x.projectID)
        const projectB = await Session.get(b.id).then((x) => x.projectID)

        const sessionsA = [...Session.list({ projectID: projectA, limit: 200 })]
        const idsA = sessionsA.map((s) => s.id)
        expect(idsA).toContain(a.id)
        expect(idsA).not.toContain(b.id)

        const sessionsB = await Instance.provide({
          directory: second.path,
          fn: async () => [...Session.list({ projectID: projectB, limit: 200 })],
        })
        const idsB = sessionsB.map((s) => s.id)
        expect(idsB).toContain(b.id)
        expect(idsB).not.toContain(a.id)
      },
    })
  })
})
