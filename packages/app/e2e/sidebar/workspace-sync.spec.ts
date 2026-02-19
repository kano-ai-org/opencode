import { test, expect } from "../fixtures"
import { openSidebar, seedProjects, setWorkspacesEnabled } from "../actions"
import { promptSelector } from "../selectors"
import { sessionPath } from "../utils"

async function hasVisibleButton(page: { getByRole: Function }, name: string) {
  const buttons = page.getByRole("button", { name })
  const count = await buttons.count()
  for (const index of Array.from({ length: count }, (_, i) => i)) {
    const visible = await buttons
      .nth(index)
      .isVisible()
      .then((result: boolean) => result)
      .catch(() => false)
    if (visible) return true
  }
  return false
}

test("workspace toggle syncs across browser contexts after reload", async ({ page, withProject }) => {
  await withProject(async ({ directory, slug, gotoSession }) => {
    await gotoSession()
    await openSidebar(page)
    await setWorkspacesEnabled(page, slug, false)

    const browser = page.context().browser()
    if (!browser) throw new Error("browser is not available")

    const secondContext = await browser.newContext()
    const secondPage = await secondContext.newPage()

    try {
      await seedProjects(secondPage, { directory })
      await secondPage.addInitScript(() => {
        localStorage.setItem(
          "opencode.global.dat:model",
          JSON.stringify({
            recent: [{ providerID: "opencode", modelID: "big-pickle" }],
            user: [],
            variant: {},
          }),
        )
      })

      await secondPage.goto(sessionPath(directory))
      await expect(secondPage.locator(promptSelector)).toBeVisible()
      await openSidebar(secondPage)

      await setWorkspacesEnabled(page, slug, true)
      await secondPage.reload()
      await expect(secondPage.locator(promptSelector)).toBeVisible()
      await openSidebar(secondPage)
      await expect
        .poll(async () => {
          return await hasVisibleButton(secondPage, "New workspace")
        }, { timeout: 30_000 })
        .toBe(true)

      await setWorkspacesEnabled(secondPage, slug, false)
      await page.reload()
      await expect(page.locator(promptSelector)).toBeVisible()
      await openSidebar(page)
      await expect
        .poll(async () => {
          return await hasVisibleButton(page, "New session")
        }, { timeout: 30_000 })
        .toBe(true)
    } finally {
      await secondContext.close()
    }
  })
})
