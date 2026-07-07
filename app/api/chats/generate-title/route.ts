import { NextRequest, NextResponse } from "next/server"
import { createSummarizeResponse, extractTextOutput, getConfigInfo } from "@/lib/openai"
import { enforceRateLimit } from "@/lib/rate-limit"

export const runtime = "nodejs"

const TITLE_PROMPT = `Generate a short, descriptive chat title (4-8 words) for this conversation. Output ONLY the title text, nothing else. No quotes, no prefix, no punctuation at the end.`

interface GenerateTitleRequest {
  userMessage: string
  assistantMessage: string
}

function deriveFallbackTitle(userMessage: string): string {
  const cleaned = userMessage
    .replace(/^@\w+\s+/i, "")
    .replace(/\s+/g, " ")
    .trim()
  if (!cleaned) return "New Chat"

  const firstThought = cleaned.split(/[.!?\n]/)[0]?.trim() || cleaned
  const words = firstThought.split(/\s+/).slice(0, 8)
  const title = words.join(" ").replace(/[:;,]+$/g, "").trim()
  if (!title) return "New Chat"
  return title.charAt(0).toUpperCase() + title.slice(1)
}

function cleanGeneratedTitle(title: string, fallback: string): string {
  const cleaned = title
    .trim()
    .replace(/^["']|["']$/g, "")
    .replace(/\s+/g, " ")
    .replace(/[.!?]+$/g, "")
    .slice(0, 80)
    .trim()

  if (!cleaned || cleaned.toLowerCase() === "new chat") {
    return fallback
  }
  return cleaned
}

export async function POST(request: NextRequest) {
  const limited = await enforceRateLimit(request, "model")
  if (limited) return limited

  let fallbackTitle = "New Chat"

  try {
    const body = (await request.json()) as GenerateTitleRequest

    if (!body.userMessage || !body.assistantMessage) {
      return NextResponse.json(
        { error: "Missing userMessage or assistantMessage" },
        { status: 400 }
      )
    }

    fallbackTitle = deriveFallbackTitle(body.userMessage)
    const transcript = `User: ${body.userMessage}\nAssistant: ${body.assistantMessage}`
    const prompt = `${TITLE_PROMPT}\n\n${transcript}`

    // Uses the lightweight "summarize" request kind — fast and cheap
    const config = getConfigInfo("summarize")
    if (process.env.NODE_ENV === "development") {
      console.log(`[GenerateTitle] Using model: ${config.model}`)
    }

    const { response } = await createSummarizeResponse({
      input: [{ role: "user", content: prompt }],
      instructions: "You are a chat title generator. Output only the title, nothing else.",
    })

    const title = cleanGeneratedTitle(extractTextOutput(response), fallbackTitle)

    return NextResponse.json({ title })
  } catch (error) {
    console.error("[GenerateTitle] Error:", error)
    // Non-critical: return a deterministic title so the sidebar does not get stuck
    // on "New Chat" when the title model or Redis path is degraded.
    return NextResponse.json({ title: fallbackTitle }, { status: 200 })
  }
}
