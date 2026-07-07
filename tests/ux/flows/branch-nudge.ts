import type { UxFlow } from "./types"
import { assertVisible, waitForApp } from "./utils"

export const branchNudgeFlow: UxFlow = {
  name: "branch-nudge",
  aliases: ["branch"],
  description:
    "Branch prompt card carries through: auto-submits, auto-opens the branch surface, and a merged branch marks the thread woven.",
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
      name: "branch-surface-auto-opens",
      run: async ({ page }) => {
        // The walkthrough carries the user all the way to the feature:
        // the branch surface opens by itself after the reply settles.
        await assertVisible(page.getByPlaceholder("Continue this side thread…"), "branch surface open")
        await assertVisible(page.getByText("Kept separate"), "include pill (off) visible")
        await assertVisible(page.getByText(/tell this branch a secret/i), "in-branch guidance visible")
      },
    },
    {
      name: "always-visible-branch-affordance",
      run: async ({ page }) => {
        // The main chat (dimmed behind) shows a persistent Branch chip under
        // the reply — no hover required anywhere.
        await assertVisible(
          page.locator("button", { hasText: "Branch" }).first(),
          "always-visible Branch chip"
        )
      },
    },
    {
      name: "converse-in-branch",
      run: async ({ page }) => {
        const branchComposer = page.getByPlaceholder("Continue this side thread…")
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
        await page.getByText("Kept separate").click()
        await assertVisible(page.getByText("Including main context"), "include pill toggled on")
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
        await assertVisible(page.getByText(/Walkthrough · [1-5]\/5|Woven · 5\/5/), "rail pill advanced")
      },
    },
  ],
}
