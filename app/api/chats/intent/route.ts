import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { createParsedResponse, formatOpenAIError } from "@/lib/openai"
import { enforceRateLimit } from "@/lib/rate-limit"

// ---------------------------------------------------------------------------
// POST /api/chats/intent
// ---------------------------------------------------------------------------
// Determines if the user's message is a chat-retrieval request.
// Uses STRICT classification to avoid false positives.
// ---------------------------------------------------------------------------

// Request schema
const IntentRequestSchema = z.object({
  message: z.string().min(1),
  context: z.object({
    isEmptySession: z.boolean(),
    isMidChat: z.boolean(),
  }),
})

// Structured output schema for OpenAI
const IntentOutputSchema = z.object({
  intent: z
    .enum(["retrieve_chat", "normal_chat"])
    .describe(
      "The detected intent: 'retrieve_chat' if user explicitly wants to find/open a past chat, 'normal_chat' otherwise"
    ),
  confidence: z
    .number()
    .min(0)
    .max(1)
    .describe("Confidence score from 0 to 1"),
  rewrittenQuery: z
    .string()
    .describe(
      "If intent is 'retrieve_chat', a rewritten search query optimized for finding the chat. Empty string if normal_chat."
    ),
})

type IntentOutput = z.infer<typeof IntentOutputSchema>

function buildIntentPrompt(
  message: string,
  context: { isEmptySession: boolean; isMidChat: boolean }
): string {
  const strictnessNote = context.isMidChat
    ? `EXTRA STRICT MODE: The user is mid-conversation. Be VERY conservative—only return "retrieve_chat" if the user is UNAMBIGUOUSLY asking to locate or open a DIFFERENT, PAST chat conversation. If there's any chance they're asking a question within the current chat, return "normal_chat".`
    : `STRICT MODE: Be conservative—only return "retrieve_chat" if the user is explicitly asking to find or open a past chat conversation.`

  return `You are a strict intent classifier for a chat application. Your job is to determine if the user wants to retrieve/open a past chat conversation, or if they're making a normal chat request.

${strictnessNote}

RULES:
1. Return "retrieve_chat" ONLY if the user is EXPLICITLY asking to:
   - Find a previous conversation ("find my chat about...", "where's our discussion on...")
   - Open a past chat ("open the conversation where we discussed...")
   - Locate a specific historical exchange ("show me the chat from last week about...")

2. Return "normal_chat" for:
   - Questions seeking information ("what is...", "how do I...", "tell me about...")
   - Requests for help or assistance ("help me with...", "can you explain...")
   - Any ambiguous message that COULD be a question
   - Greetings, small talk, or casual conversation
   - Commands or requests to DO something (not FIND something)

3. When in doubt, ALWAYS return "normal_chat" - false positives are worse than false negatives.

4. If you return "retrieve_chat", provide a rewrittenQuery that extracts the key search terms (topics, keywords, approximate timeframe if mentioned) for finding the chat.

Session context:
- Is empty session (no messages yet): ${context.isEmptySession}
- Is mid-chat (ongoing conversation): ${context.isMidChat}

User message:
"${message}"

Analyze the message and return your classification.`
}

export async function POST(request: NextRequest) {
  const limited = await enforceRateLimit(request, "model")
  if (limited) return limited

  try {
    const body = await request.json()

    // Validate request
    const parseResult = IntentRequestSchema.safeParse(body)
    if (!parseResult.success) {
      return NextResponse.json(
        {
          error: "Invalid request body",
          details: parseResult.error.flatten(),
        },
        { status: 400 }
      )
    }

    const { message, context } = parseResult.data

    // Build prompt
    const prompt = buildIntentPrompt(message, context)

    // Call OpenAI with structured output using centralized client
    // Uses the "intent" request kind from the centralized client
    const { parsed } = await createParsedResponse({
      kind: "intent",
      input: prompt,
      schema: IntentOutputSchema,
      schemaName: "intent_classification",
    })

    if (!parsed) {
      console.error("[POST /api/chats/intent] Failed to parse structured output")
      return NextResponse.json(
        { error: "Failed to parse intent classification from model response" },
        { status: 500 }
      )
    }

    // Ensure rewrittenQuery is empty for normal_chat
    const result: IntentOutput = {
      intent: parsed.intent,
      confidence: parsed.confidence,
      rewrittenQuery: parsed.intent === "retrieve_chat" ? parsed.rewrittenQuery : "",
    }

    return NextResponse.json(result)
  } catch (error) {
    console.error("[POST /api/chats/intent] Error:", error)

    const errorResponse = formatOpenAIError(error, "intent")
    return NextResponse.json(errorResponse, { status: 500 })
  }
}
