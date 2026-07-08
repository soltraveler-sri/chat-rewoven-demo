import type { UxFlow } from "./types"
import { assertVisible, waitForApp } from "./utils"

export const railCompletionFlow: UxFlow = {
  name: "rail-completion",
  description: "The loose-threads pill tracks real feature completions and can be hidden.",
  steps: [
    {
      name: "load-app-pill-at-zero",
      run: async ({ page, baseUrl }) => {
        await waitForApp(page, baseUrl)
        await assertVisible(page.getByText("Walkthrough · 0/5"), "rail pill starts at 0/5")
      },
    },
    {
      name: "stage-codex-from-rail",
      run: async ({ page }) => {
        await page.getByText("Walkthrough · 0/5").click()
        await page.getByText("Run a Codex task").click()
        await assertVisible(page.getByText("Ready to Apply").first(), "codex fixture task ready")
        await page.waitForFunction(
          () => (window.localStorage.getItem("cr:threads-woven") || "").includes("codex"),
          null,
          { timeout: 15_000 }
        )
        await assertVisible(page.getByText("Walkthrough · 1/5"), "pill advanced to 1/5")
      },
    },
    {
      name: "stage-find-from-rail",
      run: async ({ page }) => {
        // Let post-task ingestion re-renders settle before toggling the panel,
        // then re-click if an outside re-render closed it.
        await page.waitForFunction(() => {
          const t = [...document.querySelectorAll("textarea")].pop()
          return t && !t.disabled
        })
        await page.getByText("Walkthrough · 1/5").click()
        const findRow = page.getByText("Find a past chat")
        if (!(await findRow.isVisible().catch(() => false))) {
          await page.waitForTimeout(500)
          await page.getByText("Walkthrough · 1/5").click()
        }
        await page.getByText("Find a past chat").click()
        await assertVisible(page.getByRole("heading", { name: "How JWST sees the early universe" }), "find fixture result")
        await page.waitForFunction(
          () => (window.localStorage.getItem("cr:threads-woven") || "").includes("find"),
          null,
          { timeout: 15_000 }
        )
        await assertVisible(page.getByText("Walkthrough · 2/5"), "pill advanced to 2/5")
      },
    },
    {
      name: "hide-rail-forever",
      run: async ({ page }) => {
        await page.getByText("Walkthrough · 2/5").click()
        const hideRow = page.getByText("Hide this")
        if (!(await hideRow.isVisible().catch(() => false))) {
          await page.waitForTimeout(500)
          await page.getByText("Walkthrough · 2/5").click()
        }
        await page.getByText("Hide this").click()
        await page.waitForFunction(
          () => document.body.innerText.indexOf("Walkthrough · ") === -1,
          null,
          { timeout: 5_000 }
        )
      },
    },
  ],
}
