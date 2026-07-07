import { enforceRateLimit } from "@/lib/rate-limit"
import { NextRequest, NextResponse } from "next/server"
import {
  createSummarizeResponse,
  extractTextOutput,
  formatOpenAIError,
  getConfigInfo,
} from "@/lib/openai"

export const runtime = "nodejs"

/**
 * Prompt for LLM summarization (used only for longer conversations)
 * Short conversations (<= 10 messages) are handled client-side without calling this API
 */
const SUMMARIZE_PROMPT = `Summarize in 2-4 brief bullet points. Key points only. Format: "• point"`

interface SummarizeRequest {
  branchMessages: Array<{ role: "user" | "assistant"; text: string }>
}

export async function POST(request: NextRequest) {
  const limited = await enforceRateLimit(request, "model")
  if (limited) return limited

  const startTime = Date.now()

  try {
    const body = (await request.json()) as SummarizeRequest

    if (!body.branchMessages || !Array.isArray(body.branchMessages)) {
      return NextResponse.json(
        { error: "Missing or invalid 'branchMessages' field" },
        { status: 400 }
      )
    }

    if (body.branchMessages.length === 0) {
      return NextResponse.json({ summary: "" })
    }

    // Build conversation transcript for summarization
    const transcript = body.branchMessages
      .map((msg) => `${msg.role === "user" ? "User" : "Assistant"}: ${msg.text}`)
      .join("\n")

    const prompt = `${SUMMARIZE_PROMPT}\n\n${transcript}`

    // Use optimized summarization with minimal reasoning
    // Uses store: false (summarization shouldn't affect chaining state)
    const config = getConfigInfo("summarize")

    // Dev-only instrumentation
    if (process.env.NODE_ENV === "development") {
      console.log(`[Summarize:route] Starting summarization`, {
        messageCount: body.branchMessages.length,
        transcriptLength: transcript.length,
        model: config.model,
        reasoning: config.reasoning,
      })
    }

    const { response, durationMs, reasoningUsed } = await createSummarizeResponse({
      input: [{ role: "user", content: prompt }],
      instructions: "You are a concise summarizer. Output only bullet points, nothing else.",
    })

    const outputText = extractTextOutput(response)

    // Dev-only instrumentation logging
    if (process.env.NODE_ENV === "development") {
      console.log(`[Summarize:route] Complete`, {
        durationMs,
        reasoningUsed,
        summaryLength: outputText.length,
      })
    }

    return NextResponse.json({
      summary: outputText.trim(),
    })
  } catch (error) {
    const totalDurationMs = Date.now() - startTime

    console.error(`[Summarize:route] Error after ${totalDurationMs}ms:`, error)

    const errorResponse = formatOpenAIError(error, "summarize")
    return NextResponse.json(errorResponse, { status: 500 })
  }
}
