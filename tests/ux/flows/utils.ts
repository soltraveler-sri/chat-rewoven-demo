import type { Locator, Page } from "playwright"
import { seededThreads } from "../fixtures/onboarding-data"
import type { UxFlowContext } from "./types"

export async function waitForApp(page: Page, baseUrl: string) {
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" })
  await page.getByText("Unified Chat").waitFor({ state: "visible", timeout: 20_000 })
}

export async function sendComposer(page: Page, text: string) {
  const composer = page.getByPlaceholder(/Type a message/)
  await composer.fill(text)
  // Enter submits (see handleKeyDown); clicking "the last button" is fragile
  // because the Next.js dev-tools widget appends buttons to the page in dev.
  await composer.press("Enter")
}

export async function assertVisible(locator: Locator, label: string) {
  await locator.waitFor({ state: "visible", timeout: 12_000 }).catch((error) => {
    throw new Error(`Expected visible: ${label}\n${error}`)
  })
}

export async function seedStarterChats(page: Page, baseUrl: string) {
  for (const thread of seededThreads) {
    const createdAt = Date.now()
    const response = await page.request.post(`${baseUrl}/api/chats`, {
      data: {
        title: thread.title,
        category: thread.category,
        summary: thread.summary,
        lastResponseId: null,
        messages: thread.messages.map((message, index) => ({
          id: `${thread.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${index}`,
          role: message.role,
          text: message.text,
          createdAt: createdAt + index,
        })),
      },
    })
    if (!response.ok()) {
      throw new Error(`Failed to seed chat "${thread.title}": ${response.status()} ${await response.text()}`)
    }
  }
}

/**
 * Wait for the app's own first-load auto-seeding (lib/onboarding/seeds.ts)
 * to populate the sidebar. Flows rely on this instead of manual seeding so
 * the real onboarding path is what gets exercised.
 */
export async function waitForAutoSeededSidebar(page: Page) {
  await assertVisible(page.getByText("How JWST sees the early universe"), "seeded JWST thread in sidebar")
  await assertVisible(page.getByText("Debugging a Python asyncio deadlock"), "seeded asyncio thread in sidebar")
}

export async function openFreshSeededChat(ctx: UxFlowContext) {
  await waitForApp(ctx.page, ctx.baseUrl)
  await waitForAutoSeededSidebar(ctx.page)
  await assertVisible(ctx.page.getByRole("heading", { name: "Chat, rewoven" }), "current empty state")
}

export async function assertCurrentEmptyState(page: Page) {
  await assertVisible(page.getByRole("heading", { name: "Chat, rewoven" }), "current wordmark")
  await assertVisible(page.getByText("Try one of these"), "try-one-of-these heading")
  await assertVisible(
    page.getByText("Branch from a reply — explore without derailing the thread"),
    "branch-first prompt card"
  )
  await assertVisible(page.getByText("@codex add a dark-mode toggle to the settings page"), "Codex card")
  await assertVisible(
    page.getByText("@assistant can you create an itinerary for my portugal trip exactly like we did for kyoto"),
    "Assistant card"
  )
  await assertVisible(page.getByText("/find the chat about the telescope"), "Find card")
  await assertVisible(page.getByText("use our sample document"), "sample-document inline action")
  await assertVisible(page.getByText(/Walkthrough · \d\/5/), "loose-threads rail pill")
}
