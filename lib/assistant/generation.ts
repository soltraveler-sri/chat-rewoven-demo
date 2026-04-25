import { z } from "zod"
import { makeAssistantArtifact, slugifyFilenamePart } from "@/lib/assistant/artifacts"
import type { AssistantArtifact } from "@/lib/assistant/types"
import { createParsedResponse } from "@/lib/openai"

const MAX_CONTEXT_CHARS = 18000
const MAX_THREAD_CHARS = 2600

const AssistantDocumentSectionSchema = z.object({
  heading: z.string().describe("Short section heading"),
  bullets: z
    .array(z.string())
    .max(6)
    .describe("Specific, non-repetitive bullets grounded in the provided chat context"),
})

const AssistantDocumentSourceSchema = z.object({
  chatId: z.string().describe("Source chat ID exactly as provided"),
  title: z.string().describe("Source chat title exactly as provided"),
  reason: z.string().describe("Why this source was used"),
  snippets: z.array(z.string()).max(3).describe("Short supporting snippets from this source"),
})

const AssistantDocumentSchema = z.object({
  title: z.string().describe("Clear document title"),
  overview: z
    .string()
    .describe("Brief synthesis of what the provided chats support. Do not invent facts."),
  sections: z.array(AssistantDocumentSectionSchema).min(1).max(8),
  sourcesUsed: z.array(AssistantDocumentSourceSchema).max(8),
  missingOrAmbiguous: z
    .array(z.string())
    .max(8)
    .describe("Facts, dates, numbers, or decisions that were not clear from the chats"),
})

export interface AssistantDocumentSourceInput {
  chatId: string
  title: string
  updatedAt?: number
  reason: string
  snippet: string
  transcript: string
}

export interface AssistantDocumentGenerationResult {
  artifact: AssistantArtifact
  summary: string
  missingInfo: string[]
}

function truncateContext(text: string, maxChars: number): string {
  const cleaned = text.replace(/\s+/g, " ").trim()
  if (cleaned.length <= maxChars) return cleaned
  return `${cleaned.slice(0, maxChars - 3).trim()}...`
}

function buildContextBlock(sources: AssistantDocumentSourceInput[]): string {
  let usedChars = 0
  const blocks: string[] = []

  for (const source of sources) {
    const transcript = truncateContext(source.transcript, MAX_THREAD_CHARS)
    const block = [
      `<chat id="${source.chatId}" title="${source.title}">`,
      `Updated: ${source.updatedAt ? new Date(source.updatedAt).toISOString() : "unknown"}`,
      `Why included: ${source.reason}`,
      `Best snippet: ${source.snippet}`,
      "Transcript excerpt:",
      transcript,
      "</chat>",
    ].join("\n")

    if (usedChars + block.length > MAX_CONTEXT_CHARS) break
    blocks.push(block)
    usedChars += block.length
  }

  return blocks.join("\n\n")
}

function renderMarkdownDocument(parsed: z.infer<typeof AssistantDocumentSchema>): string {
  const lines: string[] = [
    `# ${parsed.title}`,
    "",
    "## Overview",
    parsed.overview,
    "",
  ]

  for (const section of parsed.sections) {
    lines.push(`## ${section.heading}`)
    for (const bullet of section.bullets) {
      lines.push(`- ${bullet}`)
    }
    lines.push("")
  }

  lines.push("## Sources Used")
  for (const source of parsed.sourcesUsed) {
    lines.push(`- ${source.title} (${source.chatId}): ${source.reason}`)
    for (const snippet of source.snippets) {
      lines.push(`  - ${snippet}`)
    }
  }
  lines.push("")

  lines.push("## Missing or Ambiguous Information")
  if (parsed.missingOrAmbiguous.length === 0) {
    lines.push("- No major missing information was identified from the provided context.")
  } else {
    for (const item of parsed.missingOrAmbiguous) {
      lines.push(`- ${item}`)
    }
  }
  lines.push("")
  lines.push("_Generated from the provided demo chat context only._")
  lines.push("")

  return lines.join("\n")
}

export async function generateAssistantDocumentArtifact(args: {
  request: string
  interpretedGoal: string
  title: string
  sources: AssistantDocumentSourceInput[]
}): Promise<AssistantDocumentGenerationResult | null> {
  if (!process.env.OPENAI_API_KEY || args.sources.length === 0) {
    return null
  }

  const context = buildContextBlock(args.sources)
  if (!context) return null

  const prompt = `Assistant request:
${args.request}

Interpreted goal:
${args.interpretedGoal}

Available chat context:
${context}

Create the downloadable document artifact. Use only the chat context above.
Requirements:
- Synthesize across chats instead of repeating the same source snippet.
- Preserve exact facts, dates, numbers, units, and claims only when present.
- Leave gaps explicit in missingOrAmbiguous.
- Do not include generic advice unless it is clearly grounded in the provided chats.
- Keep source chat IDs and titles exactly as provided.`

  try {
    const { parsed } = await createParsedResponse({
      kind: "assistant",
      input: prompt,
      schema: AssistantDocumentSchema,
      schemaName: "assistant_document_artifact",
      instructions:
        "You are the product-level Assistant inside a ChatGPT-like app. You create careful artifacts from provided chat context only. Never fabricate missing facts.",
    })

    if (!parsed) return null

    const content = renderMarkdownDocument(parsed)
    return {
      artifact: makeAssistantArtifact({
        kind: "markdown",
        filename: `${slugifyFilenamePart(parsed.title || args.title)}.md`,
        content,
      }),
      summary: `I synthesized a downloadable ${parsed.title.toLowerCase()} from ${args.sources.length} source chat${args.sources.length === 1 ? "" : "s"}.`,
      missingInfo: parsed.missingOrAmbiguous,
    }
  } catch (error) {
    console.error("[Assistant] Model document generation failed, using deterministic fallback:", error)
    return null
  }
}
