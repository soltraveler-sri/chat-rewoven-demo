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

const CLASSIFY_INSTRUCTIONS = `You are an intent classifier. The user has attached a document and sent a message. Your job is to determine whether they want:

1. "read_aloud" — They want the document (or a section of it) read aloud / converted to audio / narrated via TTS. Examples:
   - "Read this to me"
   - "Can you read this document aloud?"
   - "Read me this doc"
   - "Convert this to audio"
   - "Read this PDF to me"
   - "I want to listen to this"
   - "Narrate this document"
   - "Play this for me"
   - "TTS this"

2. "discuss" — They want to chat about the document, ask questions, summarize it, analyze it, etc. Examples:
   - "What does this document say about X?"
   - "Summarize this PDF"
   - "What are the key points?"
   - "Explain section 3"
   - "What is the author's main argument?"

Respond with the intent and your confidence level (0.0 to 1.0).`

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
