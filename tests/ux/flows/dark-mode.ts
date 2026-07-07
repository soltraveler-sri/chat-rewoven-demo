import type { UxFlow } from "./types"
import { assertCurrentEmptyState, assertVisible, sendComposer, waitForApp } from "./utils"

export const darkColdStartFlow: UxFlow = {
  name: "dark-cold-start",
  description: "Cold-start empty state with dark theme forced before load.",
  steps: [
    {
      name: "force-dark-and-load",
      run: async ({ page, baseUrl }) => {
        await page.addInitScript(() => localStorage.setItem("theme", "dark"))
        await waitForApp(page, baseUrl)
        await assertCurrentEmptyState(page)
      },
    },
  ],
}

export const darkInThreadFlow: UxFlow = {
  name: "dark-in-thread",
  description: "Dark-theme in-thread state with a streamed assistant response.",
  steps: [
    {
      name: "force-dark-and-load",
      run: async ({ page, baseUrl }) => {
        await page.addInitScript(() => localStorage.setItem("theme", "dark"))
        await waitForApp(page, baseUrl)
      },
    },
    {
      name: "send-message",
      run: async ({ page }) => {
        await sendComposer(page, "Plan a weekend in Kyoto around food")
        await assertVisible(page.getByText(/compact Kyoto food plan/), "dark in-thread assistant reply")
      },
    },
  ],
}
