import type { UxFlow } from "./types"
import { assertVisible, waitForApp } from "./utils"

export const docReadFlow: UxFlow = {
  name: "doc-read",
  description: "Attach the sample weaving PDF shape and exercise read-this-to-me with fixture upload/TTS.",
  steps: [
    {
      name: "load-app",
      run: async ({ page, baseUrl }) => {
        await waitForApp(page, baseUrl)
      },
    },
    {
      name: "sample-document-staged-flow",
      run: async ({ page }) => {
        // The empty-state inline action fetches the bundled sample PDF,
        // attaches it, pre-fills "read this to me", and submits.
        await page.getByText("use our sample document").click()
        await assertVisible(page.getByText(/Here's the audio reading/), "doc-read assistant response")
        await assertVisible(page.getByText("a-short-history-of-weaving.pdf", { exact: true }), "doc-read filename in response")
      },
    },
    {
      name: "audio-player-present",
      run: async ({ page }) => {
        await assertVisible(page.locator("audio").locator(".."), "in-thread audio player container")
      },
    },
  ],
}
