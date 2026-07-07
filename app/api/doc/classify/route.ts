import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { createParsedResponse } from "@/lib/openai"

export const runtime = "nodejs"

/**
 * Intent classification schema.
 *
 * The LLM classifies whether the user wants the document read aloud
 * (TTS) or wants to discuss/ask questions about it.
 */
const IntentSchema = z.object({
  intent: z.enum(["read_aloud", "discuss"]),
  confidence: z.number(),
})

const CLASSIFY_INSTRUCTIONS = `You classify user intent when they attach a document. Pick ONE:

"read_aloud" — The user wants the document READ ALOUD, narrated, converted to audio, or played as TTS. This includes ANY phrasing of "read this", "read me this", "could you read", "read it to me", "read this document", "play this", "listen to this", "narrate", "audio", "TTS", or similar. When in doubt and the message is short/vague, prefer read_aloud.

"discuss" — The user wants to ASK QUESTIONS about the document, summarize it, analyze it, or extract specific information. This requires the user to ask a specific question or request analysis.

IMPORTANT: "read this" / "could you read this" = read_aloud (NOT discuss). The word "read" almost always means read_aloud when a document is attached.

Respond with intent and confidence (0.0 to 1.0). Use high confidence (0.8+) when the signal is clear.`

interface ClassifyRequest {
  userMessage: string
  filename: string
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as ClassifyRequest

    if (!body.userMessage || !body.filename) {
      return NextResponse.json(
        { error: "Missing userMessage or filename" },
        { status: 400 }
      )
    }

    // Uses the "intent" request kind from the centralized client
    const { parsed } = await createParsedResponse({
      kind: "intent",
      input: `The user attached a file called "${body.filename}" and said: "${body.userMessage}"`,
      schema: IntentSchema,
      schemaName: "doc_intent",
      instructions: CLASSIFY_INSTRUCTIONS,
    })

    if (!parsed) {
      // Default to discuss if classification fails
      return NextResponse.json({ intent: "discuss", confidence: 0.5 })
    }

    console.log(`[Doc:classify] Intent: ${parsed.intent} (confidence: ${parsed.confidence})`)

    return NextResponse.json({
      intent: parsed.intent,
      confidence: parsed.confidence,
    })
  } catch (error) {
    console.error("[Doc:classify] Error:", error)
    // Default to discuss on error
    return NextResponse.json({ intent: "discuss", confidence: 0.5 })
  }
}
