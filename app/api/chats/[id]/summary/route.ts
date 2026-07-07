import { NextRequest, NextResponse } from "next/server"
import { getChatStore } from "@/lib/store"
import {
  createSummarizeResponse,
  extractTextOutput,
  formatOpenAIError,
  getConfigInfo,
} from "@/lib/openai"

/**
 * Helper to get demo_uid from cookies
 */
function getDemoUid(request: NextRequest): string | null {
  return request.cookies.get("demo_uid")?.value ?? null
}

/**
 * Build a compact transcript from messages for summarization
 */
function buildTranscriptForSummary(
  messages: Array<{ role: string; text: string }>,
  maxMessages = 20,
  maxCharsPerMessage = 300
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

function buildFallbackSummary(messages: Array<{ role: string; text: string }>): string {
  const substantive = messages
    .filter((message) => message.text?.trim())
    .slice(-6)
    .map((message) => {
      const text = message.text.replace(/\s+/g, " ").trim()
      return `${message.role === "user" ? "User" : "Assistant"}: ${text.slice(0, 160)}`
    })

  if (substantive.length === 0) {
    return "No messages in this conversation."
  }

  return substantive.join(" | ").slice(0, 360)
}

/**
 * GET /api/chats/[id]/summary - Get or generate summary for a chat
 *
 * If the chat already has a summary, returns it.
 * Otherwise, generates a new summary using OpenAI and saves it.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const demoUid = getDemoUid(request)

  if (!demoUid) {
    return NextResponse.json(
      { error: "No demo_uid cookie found" },
      { status: 401 }
    )
  }

  try {
    const { id } = await params
    const store = getChatStore()
    const thread = await store.getThread(demoUid, id)

    if (!thread) {
      return NextResponse.json({ error: "Thread not found" }, { status: 404 })
    }

    // If summary already exists, return it
    if (thread.summary) {
      return NextResponse.json({
        chatId: id,
        title: thread.title,
        category: thread.category,
        summary: thread.summary,
        generated: false,
      })
    }

    // No summary exists - generate one
    if (thread.messages.length === 0) {
      return NextResponse.json({
        chatId: id,
        title: thread.title,
        category: thread.category,
        summary: "No messages in this conversation.",
        generated: true,
      })
    }

    // Build transcript for summarization
    const transcript = buildTranscriptForSummary(thread.messages)

    const prompt = `Summarize the following conversation in 1-2 sentences. Focus on the main topic discussed and any key outcomes or conclusions.

Conversation:
${transcript}

Summary:`

    // Call OpenAI to generate summary using centralized client
    // Uses the "summarize" request kind from the centralized client
    const config = getConfigInfo("summarize")
    console.log(
      `[Summary] Generating summary for chat ${id} with model ${config.model}`
    )

    let summary = ""
    try {
      const { response } = await createSummarizeResponse({
        input: prompt,
        instructions: "You are a concise chat summarizer. Output only the summary text.",
      })
      summary = extractTextOutput(response).trim()
    } catch (error) {
      console.error("[Summary] Model summary failed, using fallback:", error)
      summary = buildFallbackSummary(thread.messages)
    }

    if (!summary) {
      console.warn("[Summary] Empty summary generated, using fallback")
      summary = buildFallbackSummary(thread.messages)
    }

    // Save summary back to thread
    await store.updateThread(demoUid, id, { summary })

    return NextResponse.json({
      chatId: id,
      title: thread.title,
      category: thread.category,
      summary,
      generated: true,
    })
  } catch (error) {
    console.error("[GET /api/chats/[id]/summary] Error:", error)

    const errorResponse = formatOpenAIError(error, "summarize")
    return NextResponse.json(errorResponse, { status: 500 })
  }
}
