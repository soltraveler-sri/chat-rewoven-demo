import { enforceRateLimit } from "@/lib/rate-limit"
import { NextRequest, NextResponse } from "next/server"
import OpenAI from "openai"
import {
  createTextResponse,
  createTextResponseStream,
  extractTextOutput,
  formatOpenAIError,
  getConfigInfo,
  type RequestKind,
} from "@/lib/openai"

export const runtime = "nodejs"

const SYSTEM_INSTRUCTIONS = `You are a helpful, concise assistant. Keep responses brief and focused. Avoid lengthy explanations unless specifically asked for detail. Be direct and practical.

CRITICAL RULE — Coding task awareness:
When you receive context about coding tasks (files created, code generated, plans executed, etc.), you MUST treat that work as your own. You wrote that code. You created those files. You know every line. Never say "I don't have the code contents", "I can't see the files", "I can only guess", or anything similar. If the user asks about files, code, or implementation details from a task, answer from the full context you were given — quote specific code, reference exact file contents, and explain implementation decisions. The user expects you to have complete knowledge of the work because you did it.

Rules:
- NEVER reference "context injection", "task system", "context window", or internal processes
- NEVER say you "can't see" or "don't have access to" code from tasks you completed
- ALWAYS answer questions about your completed work with full confidence and specificity
- If asked "what files did you create?", list them all with descriptions of their contents
- If asked about specific code, quote the relevant sections directly`

interface RespondRequest {
  input: string
  previous_response_id?: string | null
  mode?: "fast" | "deep"
  stream?: boolean
}

function isPreviousResponseNotFound(error: unknown): boolean {
  if (error instanceof OpenAI.APIError) {
    return (
      error.code === "previous_response_not_found" ||
      error.message?.includes("previous_response_not_found")
    )
  }

  if (typeof error === "object" && error !== null) {
    const maybeError = error as { code?: string | null; message?: string | null }
    return (
      maybeError.code === "previous_response_not_found" ||
      maybeError.message?.includes("previous_response_not_found") === true
    )
  }

  return false
}

function toSSEFrame(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`
}

export async function POST(request: NextRequest) {
  const limited = await enforceRateLimit(request, "model")
  if (limited) return limited

  let kind: RequestKind = "chat_deep"

  try {
    const body = (await request.json()) as RespondRequest

    if (!body.input || typeof body.input !== "string") {
      return NextResponse.json(
        { error: "Missing or invalid 'input' field" },
        { status: 400 }
      )
    }

    // Determine request kind based on mode
    const mode = body.mode || "deep"
    kind = mode === "fast" ? "chat_fast" : "chat_deep"

    const config = getConfigInfo(kind)
    console.log(`[Respond] Using ${kind} mode:`, config)
    console.log(`[Respond] Input length: ${body.input.length} chars, hasPreviousResponseId: ${!!body.previous_response_id}`)

    if (body.stream === true) {
      const encoder = new TextEncoder()

      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          let fullOutput = ""

          const send = (payload: unknown) => {
            controller.enqueue(encoder.encode(toSSEFrame(payload)))
          }

          try {
            const responseStream = await createTextResponseStream({
              kind,
              input: [{ role: "user", content: body.input }],
              previousResponseId: body.previous_response_id,
              instructions: SYSTEM_INSTRUCTIONS,
            })

            for await (const event of responseStream) {
              if (event.type === "response.output_text.delta") {
                fullOutput += event.delta
                send({ type: "delta", text: event.delta })
                continue
              }

              if (event.type === "response.completed") {
                const outputText = extractTextOutput(event.response) || fullOutput
                send({
                  type: "done",
                  id: event.response.id,
                  output_text: outputText,
                })
                break
              }

              if (event.type === "error") {
                if (isPreviousResponseNotFound(event)) {
                  send({
                    type: "error",
                    code: "chain_broken",
                    message: "The conversation chain has expired or was not found.",
                  })
                } else {
                  send({
                    type: "error",
                    code: event.code ?? undefined,
                    message: event.message,
                  })
                }
                break
              }

              if (event.type === "response.failed" || event.type === "response.incomplete") {
                send({
                  type: "error",
                  message: `Response ${event.response.status}`,
                })
                break
              }
            }
          } catch (error) {
            console.error("Streaming API error:", error)

            if (isPreviousResponseNotFound(error)) {
              send({
                type: "error",
                code: "chain_broken",
                message: "The conversation chain has expired or was not found.",
              })
            } else {
              const errorResponse = formatOpenAIError(error, kind)
              send({
                type: "error",
                message: errorResponse.error,
                details: errorResponse.details,
              })
            }
          } finally {
            controller.close()
          }
        },
      })

      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
        },
      })
    }

    // Use centralized client for the request
    const response = await createTextResponse({
      kind,
      input: [{ role: "user", content: body.input }],
      previousResponseId: body.previous_response_id,
      instructions: SYSTEM_INSTRUCTIONS,
    })

    const outputText = extractTextOutput(response)

    // Debug: Log if output is empty or incomplete
    if (!outputText) {
      console.warn("Empty output_text. Full response output:", JSON.stringify(response.output, null, 2))
    }

    if (response.status === "incomplete") {
      console.warn("Response incomplete:", {
        reason: response.incomplete_details,
      })
    }

    return NextResponse.json({
      id: response.id,
      output_text: outputText,
    })
  } catch (error) {
    console.error("API error:", error)

    // Check for previous_response_not_found error - return 409 with recovery info
    if (isPreviousResponseNotFound(error)) {
      console.warn(
        "[Respond] Chain broken: previous_response_id not found. " +
        "Client should retry without previous_response_id."
      )
      return NextResponse.json(
        {
          code: "chain_broken",
          message: "The conversation chain has expired or was not found.",
          suggestion: "start_new_thread",
        },
        { status: 409 }
      )
    }

    const errorResponse = formatOpenAIError(error, kind)
    return NextResponse.json(errorResponse, { status: 500 })
  }
}
