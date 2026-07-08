import type { UxFlow } from "./types"
import { assertVisible, waitForApp } from "./utils"

export const codexFlow: UxFlow = {
  name: "codex",
  description: "Run the Codex command path through a draft_ready fixture.",
  steps: [
    {
      name: "load-app",
      run: async ({ page, baseUrl }) => {
        await waitForApp(page, baseUrl)
      },
    },
    {
      name: "codex-card-auto-submits",
      run: async ({ page }) => {
        // Clicking the empty-state prompt card must submit by itself.
        await page.getByText("@codex add a dark-mode toggle to the settings page").first().click()
        await assertVisible(
          page.locator(".max-w-4xl").getByText("@codex add a dark-mode toggle to the settings page"),
          "codex user message submitted without typing"
        )
      },
    },
    {
      name: "draft-ready-task-card",
      run: async ({ page }) => {
        await assertVisible(page.getByText("Dark Mode Settings Toggle").first(), "codex task title")
        await assertVisible(page.getByText("Ready to Apply").first(), "codex draft_ready status")
        await assertVisible(page.getByText("app/settings/page.tsx").first(), "codex changed file path")
      },
    },
  ],
}
