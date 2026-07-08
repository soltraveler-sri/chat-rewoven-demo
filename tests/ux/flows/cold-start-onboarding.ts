import type { UxFlow } from "./types"
import { assertCurrentEmptyState, assertVisible, waitForApp, waitForAutoSeededSidebar } from "./utils"

export const coldStartOnboardingFlow: UxFlow = {
  name: "cold-start-onboarding",
  aliases: ["cold-start"],
  description: "Empty profile boot: auto-seeded starter chats plus the onboarding empty-state contract.",
  steps: [
    {
      name: "load-empty-profile",
      run: async ({ page, baseUrl }) => {
        await waitForApp(page, baseUrl)
        await assertCurrentEmptyState(page)
      },
    },
    {
      name: "auto-seeded-starter-chats",
      run: async ({ page }) => {
        await waitForAutoSeededSidebar(page)
        await assertVisible(page.getByText("Bond yields and rate cuts, explained"), "seeded markets thread")
        await assertVisible(page.getByText("A week in Portugal: Lisbon to the Algarve"), "seeded travel thread")
      },
    },
    {
      name: "rail-panel-contract",
      run: async ({ page }) => {
        await page.getByText(/Walkthrough · \d\/5/).click()
        await assertVisible(page.getByText("Branch & merge"), "rail row: branch")
        await assertVisible(page.getByText("Find a past chat"), "rail row: find")
        await assertVisible(page.getByText("Run a Codex task"), "rail row: codex")
        await assertVisible(page.getByText("Listen to a document"), "rail row: doc")
        await assertVisible(page.getByText("Ask the Assistant"), "rail row: assistant")
        await assertVisible(page.getByText("Hide this"), "rail hide affordance")
      },
    },
  ],
}
