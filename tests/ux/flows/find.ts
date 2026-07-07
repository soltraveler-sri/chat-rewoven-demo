import type { UxFlow } from "./types"
import { assertVisible, openFreshSeededChat, sendComposer } from "./utils"

export const findFlow: UxFlow = {
  name: "find",
  description: "Find a seeded past chat through the real composer and fixture-ranked /api/chats/find.",
  steps: [
    {
      name: "seed-history",
      run: openFreshSeededChat,
    },
    {
      name: "submit-find-command",
      run: async ({ page }) => {
        await sendComposer(page, "/find the chat about the telescope")
        await assertVisible(page.getByText(/Found 1 matching chat/), "finder result count")
      },
    },
    {
      name: "ranked-telescope-result",
      run: async ({ page }) => {
        await assertVisible(page.getByRole("heading", { name: "How JWST sees the early universe" }), "JWST finder result")
        await assertVisible(page.getByText("High match").first(), "high-confidence label")
        await assertVisible(page.getByText(/query mentions the telescope/).first(), "fixture why text")
      },
    },
  ],
}
