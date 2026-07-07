import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { getChatStore } from "@/lib/store"
import type { StoredChatThreadMeta } from "@/lib/store"
import { createParsedResponse, formatOpenAIError, getConfigInfo } from "@/lib/openai"

// ---------------------------------------------------------------------------
// POST /api/chats/find
// ---------------------------------------------------------------------------
// Finds and ranks candidate chats matching a natural-language query.
// Uses local lexical scoring for candidate generation + LLM rerank.
// ---------------------------------------------------------------------------

// Schema for client-provided local threads (session cache fallback)
const LocalThreadMessageSchema = z.object({
  role: z.string(),
  text: z.string(),
})

const LocalThreadSchema = z.object({
  id: z.string(),
  title: z.string(),
  summary: z.string().optional().default(""),
  category: z.string().optional().default("recent"),
  createdAt: z.number(),
  updatedAt: z.number(),
  messages: z.array(LocalThreadMessageSchema).optional().default([]),
})

// Request schema
const FindRequestSchema = z.object({
  query: z.string().min(1),
  maxCandidates: z.number().min(1).max(60).optional(),
  localThreads: z.array(LocalThreadSchema).optional(),
})

// Structured output schema for LLM rerank
const RerankResultSchema = z.object({
  chatId: z.string().describe("The ID of the matching chat"),
  confidence: z
    .number()
    .min(0)
    .max(1)
    .describe("Confidence score from 0 to 1 that this chat matches the query"),
  why: z.string().describe("A single short sentence explaining why this chat matches"),
})

const RerankOutputSchema = z.object({
  results: z
    .array(RerankResultSchema)
    .describe("Top matching chats, ordered by relevance/confidence"),
})

// Response option type
interface FindOption {
  chatId: string
  title: string
  summary: string
  updatedAt: number
  confidence: number
  why: string
}

interface FindResponse {
  query: string
  options: FindOption[]
}

// Defaults
const DEFAULT_MAX_CANDIDATES = 30
const MAX_CANDIDATES_CAP = 60

/**
 * Minimum confidence threshold for returning results.
 * Results below this threshold are filtered out.
 * 0.6 = "Good Match" threshold (matches finder-option-card.tsx display logic)
 */
const MIN_CONFIDENCE_THRESHOLD = 0.6

// ---------------------------------------------------------------------------
// Lexical scoring for candidate generation
// ---------------------------------------------------------------------------

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 1)
}

interface ScoredCandidateWithSnippet {
  chat: StoredChatThreadMeta
  score: number
  /** Recent message snippet for rerank context */
  messageSnippet?: string
}

function computeLexicalScore(
  query: string,
  chat: StoredChatThreadMeta,
  now: number,
  messageText?: string
): number {
  const queryTokens = new Set(tokenize(query))
  if (queryTokens.size === 0) return 0

  const title = chat.title || ""
  const summary = chat.summary || ""

  const titleTokens = tokenize(title)
  const summaryTokens = tokenize(summary)

  // Count matching tokens
  let titleMatches = 0
  let summaryMatches = 0

  for (const token of titleTokens) {
    if (queryTokens.has(token)) titleMatches++
  }
  for (const token of summaryTokens) {
    if (queryTokens.has(token)) summaryMatches++
  }

  // Also score against message transcript if available
  let messageMatches = 0
  if (messageText) {
    const messageTokens = tokenize(messageText)
    for (const token of messageTokens) {
      if (queryTokens.has(token)) messageMatches++
    }
  }

  // Title matches weighted 3x, summary 1x, message content 0.5x
  const matchScore = titleMatches * 3 + summaryMatches + messageMatches * 0.5

  // Recency bias: chats updated in last 7 days get a slight boost
  const ageMs = now - chat.updatedAt
  const oneWeekMs = 7 * 24 * 60 * 60 * 1000
  const recencyBoost = ageMs < oneWeekMs ? 0.5 : 0

  return matchScore + recencyBoost
}

function selectTopCandidatesWithSnippets(
  chats: StoredChatThreadMeta[],
  query: string,
  maxCandidates: number,
  messageTexts: Map<string, string>
): ScoredCandidateWithSnippet[] {
  const now = Date.now()

  const scored: ScoredCandidateWithSnippet[] = chats.map((chat) => ({
    chat,
    score: computeLexicalScore(query, chat, now, messageTexts.get(chat.id)),
    messageSnippet: messageTexts.get(chat.id),
  }))

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score)

  // Take top maxCandidates
  return scored.slice(0, maxCandidates)
}

// ---------------------------------------------------------------------------
// LLM rerank prompt builder
// ---------------------------------------------------------------------------

function buildRerankPrompt(
  query: string,
  candidates: ScoredCandidateWithSnippet[]
): string {
  const candidateList = candidates
    .map((c, i) => {
      const summary = c.chat.summary || "(no summary available)"
      const date = new Date(c.chat.updatedAt).toISOString().split("T")[0]
      const snippetSection = c.messageSnippet
        ? `\n   Recent messages: ${c.messageSnippet}`
        : ""
      return `${i + 1}. [ID: ${c.chat.id}]
   Title: ${c.chat.title}
   Summary: ${summary}
   Last updated: ${date}${snippetSection}`
    })
    .join("\n\n")

  return `You are a chat search assistant. The user is looking for a past chat conversation.

User query: "${query}"

Here are the candidate chats to consider:

${candidateList}

Your task:
1. Analyze which chats match what the user is looking for
2. Return ONLY chats that are clearly relevant (confidence >= 0.6)
3. For each match, provide:
   - chatId: the ID from [ID: xxx]
   - confidence: score from 0 to 1 (only include if >= 0.6)
   - why: one short sentence explaining the match

IMPORTANT - Be highly selective:
- confidence >= 0.85: Strong, clear match to the query
- confidence 0.6-0.84: Good match with relevant content
- confidence < 0.6: Do NOT include these results

Return empty results array if no chats clearly match. Do not include weak or tangential matches.`
}

// ---------------------------------------------------------------------------
// Helper to get demo_uid from cookies
// ---------------------------------------------------------------------------

function getDemoUid(request: NextRequest): string | null {
  return request.cookies.get("demo_uid")?.value ?? null
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  try {
    // Auth check
    const demoUid = getDemoUid(request)
    if (!demoUid) {
      return NextResponse.json(
        { error: "No demo_uid cookie found" },
        { status: 401 }
      )
    }

    const body = await request.json()

    // Validate request
    const parseResult = FindRequestSchema.safeParse(body)
    if (!parseResult.success) {
      return NextResponse.json(
        {
          error: "Invalid request body",
          details: parseResult.error.flatten(),
        },
        { status: 400 }
      )
    }

    const { query, localThreads } = parseResult.data

    // Determine maxCandidates from env or request
    const envMaxCandidates = process.env.OPENAI_CHAT_FINDER_MAX_CANDIDATES

    const maxCandidates = Math.min(
      parseResult.data.maxCandidates ??
        (envMaxCandidates ? parseInt(envMaxCandidates, 10) : DEFAULT_MAX_CANDIDATES),
      MAX_CANDIDATES_CAP
    )

    // Step A: Load all chats, fetch message snippets, and generate candidates
    const store = getChatStore()
    const storeChats = await store.listThreads(demoUid)

    // Merge store threads with client-provided local threads (union by ID, store wins)
    const chatMap = new Map<string, StoredChatThreadMeta>()
    const localMessageTexts = new Map<string, string>()

    // First add local threads (these may contain threads the server doesn't know about)
    if (localThreads && localThreads.length > 0) {
      for (const lt of localThreads) {
        chatMap.set(lt.id, {
          id: lt.id,
          title: lt.title,
          summary: lt.summary,
          category: lt.category as StoredChatThreadMeta["category"],
          createdAt: lt.createdAt,
          updatedAt: lt.updatedAt,
        })
        // Build message snippets from local thread messages
        if (lt.messages.length > 0) {
          const snippet = lt.messages
            .slice(-10)
            .map((m) => `${m.role}: ${m.text}`)
            .join(" | ")
            .slice(0, 500)
          localMessageTexts.set(lt.id, snippet)
        }
      }
    }

    // Store threads override local (server is source of truth when available)
    for (const chat of storeChats) {
      chatMap.set(chat.id, chat)
    }

    const allChats = Array.from(chatMap.values())

    if (allChats.length === 0) {
      const response: FindResponse = { query, options: [] }
      return NextResponse.json(response)
    }

    // Load message text snippets for transcript-aware search
    // Fetch full threads to extract recent message text for scoring and rerank
    const messageTexts = new Map<string, string>(localMessageTexts)
    await Promise.all(
      storeChats.map(async (chat) => {
        try {
          const thread = await store.getThread(demoUid, chat.id)
          if (thread && thread.messages.length > 0) {
            // Build a compact snippet from the last ~10 messages (max 500 chars)
            const recentMessages = thread.messages.slice(-10)
            const snippet = recentMessages
              .map((m) => `${m.role}: ${m.text}`)
              .join(" | ")
              .slice(0, 500)
            messageTexts.set(chat.id, snippet)
          }
        } catch {
          // Skip if thread load fails — local snippets already in map as fallback
        }
      })
    )

    const scoredCandidates = selectTopCandidatesWithSnippets(allChats, query, maxCandidates, messageTexts)

    if (scoredCandidates.length === 0) {
      const response: FindResponse = { query, options: [] }
      return NextResponse.json(response)
    }

    // Step B: LLM rerank using centralized client
    // Uses the "finder" request kind from the centralized client
    const prompt = buildRerankPrompt(query, scoredCandidates)
    const config = getConfigInfo("finder")

    console.log(`[POST /api/chats/find] Reranking ${scoredCandidates.length} candidates with model ${config.model}`)

    const { parsed } = await createParsedResponse({
      kind: "finder",
      input: prompt,
      schema: RerankOutputSchema,
      schemaName: "rerank_results",
    })

    if (!parsed) {
      console.error("[POST /api/chats/find] Failed to parse rerank output")
      return NextResponse.json(
        { error: "Failed to parse reranking results from model response" },
        { status: 500 }
      )
    }

    // Step C: Build response with joined metadata
    // Create a lookup map for candidates
    const candidateMap = new Map<string, StoredChatThreadMeta>()
    for (const c of scoredCandidates) {
      candidateMap.set(c.chat.id, c.chat)
    }

    const options: FindOption[] = []

    for (const result of parsed.results) {
      const chat = candidateMap.get(result.chatId)
      if (!chat) {
        // Skip if chatId doesn't match any candidate (model hallucination)
        console.warn(
          `[POST /api/chats/find] LLM returned unknown chatId: ${result.chatId}`
        )
        continue
      }

      options.push({
        chatId: chat.id,
        title: chat.title,
        summary: chat.summary || "",
        updatedAt: chat.updatedAt,
        confidence: result.confidence,
        why: result.why,
      })
    }

    // Sort by confidence desc (should already be, but ensure)
    options.sort((a, b) => b.confidence - a.confidence)

    // Filter out low-confidence results (below "Good Match" threshold)
    // This prevents showing "Possible Match" results that clutter the UI
    const filteredOptions = options.filter(
      (opt) => opt.confidence >= MIN_CONFIDENCE_THRESHOLD
    )

    const response: FindResponse = { query, options: filteredOptions }
    return NextResponse.json(response)
  } catch (error) {
    console.error("[POST /api/chats/find] Error:", error)

    const errorResponse = formatOpenAIError(error, "finder")
    return NextResponse.json(errorResponse, { status: 500 })
  }
}
