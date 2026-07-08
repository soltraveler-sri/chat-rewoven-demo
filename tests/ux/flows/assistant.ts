import type { UxFlow } from "./types"
import { assertVisible, openFreshSeededChat } from "./utils"

const ASSISTANT_WALKTHROUGH_PROMPT =
  "@assistant can you create an itinerary for my portugal trip exactly like we did for kyoto"

export const assistantFlow: UxFlow = {
  name: "assistant",
  description:
    "Assistant walkthrough: the empty-state card submits the cross-chat itinerary prompt by itself and the Assistant runs to a ready result.",
  steps: [
    {
      name: "seed-history",
      run: openFreshSeededChat,
    },
    {
      name: "assistant-card-auto-submits",
      run: async ({ page }) => {
        // The walkthrough entry point: clicking the empty-state Assistant card
        // submits the itinerary prompt by itself (no typing).
        await page.getByText(ASSISTANT_WALKTHROUGH_PROMPT).first().click()
        await assertVisible(
          page.locator(".max-w-4xl").getByText(ASSISTANT_WALKTHROUGH_PROMPT),
          "assistant walkthrough prompt submitted without typing"
        )
      },
    },
    {
      name: "ready-assistant-card",
      run: async ({ page }) => {
        await assertVisible(page.getByText("Assistant").first(), "assistant card")
        await assertVisible(page.getByText("Ready", { exact: true }).first(), "assistant ready status")
      },
    },
  ],
}
