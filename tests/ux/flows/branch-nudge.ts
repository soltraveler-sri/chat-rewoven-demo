import type { UxFlow } from "./types"
import { assertVisible, waitForApp } from "./utils"

export const branchNudgeFlow: UxFlow = {
  name: "branch-nudge",
  description: "Branch prompt card auto-submits, BranchNudge appears, and a merged branch marks the thread woven.",
  steps: [
    {
      name: "branch-card-auto-submit",
      run: async ({ page, baseUrl }) => {
        await waitForApp(page, baseUrl)
        await page.getByText("Branch from a reply — explore without derailing the thread").click()
        await assertVisible(page.getByText(/compact Kyoto food plan/), "streamed Kyoto assistant reply")
      },
    },
    {
      name: "branch-nudge-appears",
      run: async ({ page }) => {
        await assertVisible(page.getByText(/Hover this reply/), "BranchNudge callout under the reply")
      },
    },
    {
      name: "open-branch",
      run: async ({ page }) => {
        const reply = page.getByText(/compact Kyoto food plan/)
        await reply.hover()
        const branchButton = page.locator("button:has(svg.lucide-git-branch)").last()
        await branchButton.click()
        await assertVisible(page.getByText("Include in main context"), "branch overlay open")
      },
    },
    {
      name: "converse-in-branch",
      run: async ({ page }) => {
        const branchComposer = page.locator("textarea").last()
        await branchComposer.fill("In the branch only: the password is banana123.")
        await branchComposer.press("Enter")
        await assertVisible(
          page.getByText(/compact Kyoto food plan/).nth(0),
          "branch reply arrived (fixture)"
        )
      },
    },
    {
      name: "merge-branch-back",
      run: async ({ page }) => {
        await page.getByText("Include in main context").click()
        // close the panel via its close button (X)
        await page.keyboard.press("Escape")
        await assertVisible(page.getByText(/context added|context merged/).first(), "merged context chip in main thread")
      },
    },
    {
      name: "branch-thread-woven",
      run: async ({ page }) => {
        await page.waitForFunction(
          () => (window.localStorage.getItem("cr:threads-woven") || "").includes("branch"),
          null,
          { timeout: 10_000 }
        )
        await assertVisible(page.getByText(/Threads · [1-5]\/5|Woven · 5\/5/), "rail pill advanced")
      },
    },
  ],
}
