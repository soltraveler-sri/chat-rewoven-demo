import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { getChatStore } from "@/lib/store"
import type { StoredChatCategory, StoredChatThread } from "@/lib/store"
import { createParsedResponse, formatOpenAIError, getConfigInfo } from "@/lib/openai"

/**
 * Helper to get demo_uid from cookies
 */
function getDemoUid(request: NextRequest): string | null {
  return request.cookies.get("demo_uid")?.value ?? null
}

/**
 * Zod schema for structured output from the model
 * Categories MUST match exactly: professional, coding, short_qa, personal, travel, shopping
 */
const CategoryEnum = z.enum([
  "professional",
  "coding",
  "short_qa",
  "personal",
  "travel",
  "shopping",
])

const ChatCategorizationSchema = z.object({
  chatId: z.string().describe("The unique ID of the chat"),
  category: CategoryEnum.describe(
    "The category that best fits this conversation"
  ),
  title: z
    .string()
    .describe("A concise, descriptive title for the chat (max 60 chars)"),
  summary: z
    .string()
    .describe("A 1-2 sentence summary of the conversation topic and outcome"),
})

const RefreshOutputSchema = z.object({
  chats: z.array(ChatCategorizationSchema),
})

type RefreshOutput = z.infer<typeof RefreshOutputSchema>

/**
 * Build a compact transcript snippet from messages
 * Takes last N messages, truncates each message text
 */
function buildTranscriptSnippet(
  messages: StoredChatThread["messages"],
  maxMessages = 12,
  maxCharsPerMessage = 200
): string {
  const recentMessages = messages.slice(-maxMessages)
  return recentMessages
    .map((m) => {
      const role = m.role.toUpperCase()
      let text = m.text
      if (text.length > maxCharsPerMessage) {
        text = text.slice(0, maxCharsPerMessage) + "…"
      }
      return `${role}: ${text}`
    })
    .join("\n")
}

/**
 * Build the prompt for categorization
 */
function buildCategorizationPrompt(
  chats: Array<{
    chatId: string
    currentTitle: string
    createdAt: number
    updatedAt: number
    messageCount: number
    transcriptSnippet: string
  }>
): string {
  const chatDescriptions = chats
    .map((chat, idx) => {
      return `
### Chat ${idx + 1}
- ID: ${chat.chatId}
- Current Title: "${chat.currentTitle}"
- Messages: ${chat.messageCount}
- Created: ${new Date(chat.createdAt).toISOString()}

Transcript (last messages):
${chat.transcriptSnippet}
`
    })
    .join("\n---\n")

  return `You are a chat organizer. Analyze each conversation and categorize it.

Categories (choose exactly one per chat):
- professional: Work-related but NOT coding. Project planning, documents, spreadsheets, meetings, business strategy.
- coding: Programming, debugging, technical implementation, code review, software development.
- short_qa: Quick question/answer exchanges that resemble search queries. Brief, factual questions.
- personal: Health, hobbies, creative writing, art, life admin, relationships, journaling.
- travel: Trip planning, destinations, bookings, itineraries, packing, transportation.
- shopping: Product research, buying decisions, price comparisons, reviews, purchases.

For each chat:
1. Assign the most appropriate category
2. Write a concise title (max 60 chars) that captures the main topic
3. Write a 1-2 sentence summary of what was discussed

${chatDescriptions}

Return a JSON object with a "chats" array containing an entry for each chat with: chatId, category, title, summary.`
}

/**
 * POST /api/stacks/refresh - Run the Smart Stacks refresh
 *
 * This categorizes recent chats using an LLM with structured outputs.
 */
export async function POST(request: NextRequest) {
  const demoUid = getDemoUid(request)

  if (!demoUid) {
    return NextResponse.json(
      { error: "No demo_uid cookie found" },
      { status: 401 }
    )
  }

  try {
    const store = getChatStore()

    // Step 1: Get lastRefreshAt
    const meta = await store.getStacksMeta(demoUid)
    const lastRefreshAt = meta.lastRefreshAt

    // Step 2: Get all threads and find refresh candidates
    const allThreads = await store.listThreads(demoUid)

    // Find candidates: chats that are "recent" OR updated since last refresh
    const candidateIds: string[] = []
    for (const thread of allThreads) {
      const isRecent = thread.category === "recent"
      const isUpdatedSinceRefresh =
        lastRefreshAt && thread.updatedAt > lastRefreshAt
      if (isRecent || isUpdatedSinceRefresh) {
        candidateIds.push(thread.id)
      }
    }

    // Limit to 30 chats max for this demo
    const limitedCandidateIds = candidateIds.slice(0, 30)

    if (limitedCandidateIds.length === 0) {
      // No chats to refresh
      const now = Date.now()
      await store.setLastStacksRefreshAt(demoUid, now)
      const updatedMeta = await store.getStacksMeta(demoUid)

      return NextResponse.json({
        message: "No chats to refresh",
        refreshedCount: 0,
        updatedChats: [],
        counts: updatedMeta.counts,
        lastRefreshAt: now,
      })
    }

    // Step 3: Load full threads for candidates
    const fullThreads: StoredChatThread[] = []
    for (const id of limitedCandidateIds) {
      const thread = await store.getThread(demoUid, id)
      if (thread && thread.messages.length > 0) {
        fullThreads.push(thread)
      }
    }

    if (fullThreads.length === 0) {
      // No threads with messages
      const now = Date.now()
      await store.setLastStacksRefreshAt(demoUid, now)
      const updatedMeta = await store.getStacksMeta(demoUid)

      return NextResponse.json({
        message: "No chats with messages to refresh",
        refreshedCount: 0,
        updatedChats: [],
        counts: updatedMeta.counts,
        lastRefreshAt: now,
      })
    }

    // Step 4: Build payload for model
    const chatPayloads = fullThreads.map((thread) => ({
      chatId: thread.id,
      currentTitle: thread.title,
      createdAt: thread.createdAt,
      updatedAt: thread.updatedAt,
      messageCount: thread.messages.length,
      transcriptSnippet: buildTranscriptSnippet(thread.messages),
    }))

    const prompt = buildCategorizationPrompt(chatPayloads)

    // Step 5: Call OpenAI with structured outputs using centralized client
    // Uses the "stacks" request kind from the centralized client
    const config = getConfigInfo("stacks")
    console.log(
      `[Stacks Refresh] Processing ${fullThreads.length} chats with model ${config.model}`
    )

    const { parsed } = await createParsedResponse({
      kind: "stacks",
      input: prompt,
      schema: RefreshOutputSchema,
      schemaName: "categorization_result",
    })

    if (!parsed || !parsed.chats) {
      console.error("[Stacks Refresh] Failed to parse response")
      return NextResponse.json(
        { error: "Failed to parse categorization response" },
        { status: 500 }
      )
    }

    console.log(`[Stacks Refresh] Got ${parsed.chats.length} categorizations`)

    // Step 6: Update each chat in store
    const updatedChats: Array<{
      id: string
      category: StoredChatCategory
      title: string
      summary: string
    }> = []

    for (const result of parsed.chats) {
      // Validate the chatId exists in our candidates
      const thread = fullThreads.find((t) => t.id === result.chatId)
      if (!thread) {
        console.warn(
          `[Stacks Refresh] Unknown chatId in response: ${result.chatId}`
        )
        continue
      }

      // Update the thread
      await store.updateThread(demoUid, result.chatId, {
        category: result.category as StoredChatCategory,
        title: result.title,
        summary: result.summary,
      })

      updatedChats.push({
        id: result.chatId,
        category: result.category as StoredChatCategory,
        title: result.title,
        summary: result.summary,
      })
    }

    // Step 7: Set lastRefreshAt = now
    const now = Date.now()
    await store.setLastStacksRefreshAt(demoUid, now)

    // Get updated counts
    const updatedMeta = await store.getStacksMeta(demoUid)

    return NextResponse.json({
      message: `Refreshed ${updatedChats.length} chats`,
      refreshedCount: updatedChats.length,
      updatedChats,
      counts: updatedMeta.counts,
      lastRefreshAt: now,
    })
  } catch (error) {
    console.error("[POST /api/stacks/refresh] Error:", error)

    const errorResponse = formatOpenAIError(error, "stacks")
    return NextResponse.json(errorResponse, { status: 500 })
  }
}
