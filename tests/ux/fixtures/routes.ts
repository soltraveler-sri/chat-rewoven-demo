import type { BrowserContext, Route } from "playwright"
import {
  cannedChatResponses,
  codexTask,
  makeAssistantTask,
  sampleDocText,
  silentMp3Base64,
} from "./onboarding-data"

function json(body: unknown, status = 200) {
  return {
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  }
}

function parsePostData(route: Route): Record<string, unknown> {
  const raw = route.request().postData()
  if (!raw) return {}
  try {
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

function sseFrame(payload: unknown) {
  return `data: ${JSON.stringify(payload)}\n\n`
}

function responseForInput(input: string) {
  const normalized = input.toLowerCase()
  if (normalized.includes("kyoto")) return cannedChatResponses.kyoto
  if (normalized.includes("secret")) return cannedChatResponses.branch
  if (normalized.includes("context from branch")) return cannedChatResponses.merge
  if (normalized.includes("coding task")) return "The completed task changed app/settings/page.tsx and added a dark-mode toggle."
  return cannedChatResponses.default
}

export async function installNetworkFixtures(context: BrowserContext) {
  await context.route("**/api/respond", async (route) => {
    const body = parsePostData(route)
    const input = String(body.input || "")
    const outputText = responseForInput(input)
    const id = `resp_${Math.random().toString(36).slice(2)}`

    if (body.stream === true) {
      const chunks = outputText.match(/.{1,36}(\s|$)/g) || [outputText]
      const streamBody =
        chunks.map((chunk) => sseFrame({ type: "delta", text: chunk })).join("") +
        sseFrame({ type: "done", id, output_text: outputText })
      await route.fulfill({
        status: 200,
        headers: {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache, no-transform",
          connection: "keep-alive",
        },
        body: streamBody,
      })
      return
    }

    await route.fulfill(json({ id, output_text: outputText }))
  })

  await context.route("**/api/chats/generate-title", async (route) => {
    const body = parsePostData(route)
    const userMessage = String(body.userMessage || "New Chat")
      .replace(/^@\w+\s+/i, "")
      .replace(/^\/find\s+/i, "Find: ")
    await route.fulfill(json({ title: userMessage.slice(0, 48) || "New Chat" }))
  })

  await context.route("**/api/chats/find", async (route) => {
    const body = parsePostData(route)
    const threads = Array.isArray(body.localThreads)
      ? (body.localThreads as Array<Record<string, unknown>>)
      : []
    const telescope =
      threads.find((thread) => String(thread.title).includes("JWST")) || threads[0]

    await route.fulfill(
      json({
        options: telescope
          ? [
              {
                chatId: String(telescope.id),
                title: String(telescope.title),
                summary: String(telescope.summary || ""),
                updatedAt: Number(telescope.updatedAt || Date.now()),
                confidence: 0.96,
                why: "The query mentions the telescope and this chat explains JWST infrared observations.",
                category: String(telescope.category || "professional"),
              },
            ]
          : [],
      })
    )
  })

  await context.route("**/api/codex/workspace", async (route) => {
    await route.fulfill(
      json({
        workspace: {
          updatedAt: Date.now(),
          files: {
            "app/settings/page.tsx": "export default function SettingsPage() { return null }",
          },
        },
      })
    )
  })

  await context.route("**/api/codex/tasks", async (route) => {
    if (route.request().method() === "POST") {
      await new Promise((resolve) => setTimeout(resolve, 1_000))
      await route.fulfill(json({ task: { ...codexTask, updatedAt: Date.now() } }, 201))
      return
    }
    await route.fulfill(json({ tasks: [codexTask] }))
  })

  await context.route(/.*\/api\/codex\/tasks\/[^/]+(\/(apply|pr))?$/, async (route) => {
    const url = route.request().url()
    if (url.endsWith("/apply")) {
      await route.fulfill(json({ task: { ...codexTask, status: "applied" }, workspace: { updatedAt: Date.now(), files: {} } }))
      return
    }
    if (url.endsWith("/pr")) {
      await route.fulfill(json({ task: { ...codexTask, status: "pr_created", prUrl: "https://github.com/example/example/pull/1" } }))
      return
    }
    await route.fulfill(json({ task: codexTask }))
  })

  await context.route("**/api/assistant/run", async (route) => {
    const body = parsePostData(route)
    const threads = Array.isArray(body.localThreads)
      ? (body.localThreads as Array<Record<string, unknown>>)
      : []
    const source =
      threads.find((thread) => String(thread.title).includes("asyncio")) || threads[0] || {
        id: "current-chat",
        title: "Current chat",
      }
    const task = makeAssistantTask({
      id: String(body.clientTaskId || "ux-assistant-task"),
      request: String(body.request || "what did I leave unfinished this week?"),
      sourceChatId: String(source.id),
      sourceTitle: String(source.title),
    })
    await route.fulfill(json({ task }))
  })

  await context.route("**/api/doc/upload", async (route) => {
    await route.fulfill(
      json({
        text: sampleDocText,
        wordCount: sampleDocText.split(/\s+/).length,
        filename: "a-short-history-of-weaving.pdf",
      })
    )
  })

  await context.route("**/api/doc/classify", async (route) => {
    await route.fulfill(json({ intent: "read_aloud", confidence: 0.99 }))
  })

  await context.route("**/api/doc/tts", async (route) => {
    await route.fulfill({
      status: 200,
      headers: {
        "content-type": "audio/mpeg",
        "cache-control": "no-store",
      },
      body: Buffer.from(silentMp3Base64, "base64"),
    })
  })
}
