import type { UxFlow } from "./types"
import { assertVisible, openFreshSeededChat, sendComposer } from "./utils"

export const assistantFlow: UxFlow = {
  name: "assistant",
  description: "Run the Assistant command path against seeded history and a ready fixture task.",
  steps: [
    {
      name: "seed-history",
      run: openFreshSeededChat,
    },
    {
      name: "submit-assistant-command",
      run: async ({ page }) => {
        await sendComposer(page, "@assistant what did I leave unfinished this week?")
        await assertVisible(page.getByText("@assistant what did I leave unfinished this week?").first(), "assistant user message")
      },
    },
    {
      name: "ready-assistant-card",
      run: async ({ page }) => {
        await assertVisible(page.getByText("Assistant").first(), "assistant card")
        await assertVisible(page.getByText("Ready", { exact: true }).first(), "assistant ready status")
        await assertVisible(page.getByText("unfinished-work-brief.md").first(), "assistant artifact")
        await assertVisible(page.getByText(/Two loose ends are still open/).first(), "assistant result summary")
      },
    },
  ],
}
