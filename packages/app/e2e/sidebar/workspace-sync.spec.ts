import { test, expect } from "../fixtures"
import { openSidebar, seedProjects, setWorkspacesEnabled } from "../actions"
import { promptSelector } from "../selectors"
import { sessionPath } from "../utils"

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
      await expect(secondPage.getByRole("button", { name: "New workspace" }).first()).toBeVisible()

      await setWorkspacesEnabled(secondPage, slug, false)
      await page.reload()
      await expect(page.locator(promptSelector)).toBeVisible()
      await expect(page.getByRole("button", { name: "New session" }).first()).toBeVisible()
    } finally {
      await secondContext.close()
    }
  })
})
